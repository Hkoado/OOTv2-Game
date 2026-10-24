#!/usr/bin/env bash
# Deploy one immutable release and swap /srv/ootv2/current atomically.
# Usage: deploy-release.sh /home/ootv2/staging
# Failure after the swap restores the previous symlink; a broken release never
# stays active. Does not create, enable or start any service by itself, except
# restoring the services that were active before the installer stopped them.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo root_required; exit 78; }
staging="${1:-}"
root=/srv/ootv2
services=(ootv2-github-worker.service ootv2-official-worker.service)
[ -d "$staging" ] || { echo staging_missing; exit 78; }

for required in package.json package-lock.json server/githubWorker.js server/worker.js \
  server/officialWorker.js server/shared/githubWorkerDeps.js sandbox/linux/run-bot.sh tools/cli/worker-health.js; do
  [ -f "$staging/$required" ] || { echo "release_incomplete:$required"; exit 78; }
done

# The installer stops the workers before touching the runtime. Ask it which ones ran
# before that stop, otherwise an update would silently leave them disabled.
state_file="${OOTV2_PREVIOUS_ACTIVE:-}"
active_services=()
if [ -n "$state_file" ] && [ -r "$state_file" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    for known in "${services[@]}"; do
      [ "$line" = "$known" ] && active_services+=("$known")
    done
  done < "$state_file"
else
  for service in "${services[@]}"; do
    if systemctl is-active --quiet "$service"; then active_services+=("$service"); fi
  done
fi

export PATH=/opt/ootv2-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
install -d -m 0755 "$root" "$root/releases"
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
target="$root/releases/$release_id"
install -d -m 0755 "$target"

# Copy contents only; the staging directory itself is disposable.
tar -C "$staging" -cf - . | tar -C "$target" -xf -
chown -R root:root "$target"
find "$target/sandbox/linux" -name '*.sh' -exec chmod 755 {} +
find "$target/tools/provision" -name '*.sh' -exec chmod 755 {} +

cd "$target"
npm ci --omit=dev --ignore-scripts
node --check server/githubWorker.js
node --check server/worker.js
node --check server/officialWorker.js

previous="$(readlink "$root/current" 2>/dev/null || true)"

activate() {
  ln -sfn "$1" "$root/current.next"
  mv -T "$root/current.next" "$root/current"
}

rollback() {
  echo "release_failed:$release_id"
  for service in "${active_services[@]}"; do systemctl stop "$service" || true; done
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    activate "$previous"
    echo "rolled_back_to:$previous"
    # Re-attest the restored sandbox before any worker consumes work again.
    if ! systemctl start ootv2-attest.service; then
      echo 'attestation_after_rollback_failed'
      for service in "${active_services[@]}"; do systemctl stop "$service" || true; done
      exit 79
    fi
    for service in "${active_services[@]}"; do
      systemctl restart "$service" || echo 'restart_after_rollback_failed'
    done
  else
    rm -f "$root/current"
    echo 'no_previous_release'
  fi
  exit 79
}

for service in "${active_services[@]}"; do
  if ! systemctl stop "$service"; then rollback; fi
done
if ! activate "$target"; then rollback; fi
echo "activated:$release_id"

if [ "${#active_services[@]}" -gt 0 ]; then
  if ! systemctl start ootv2-attest.service; then rollback; fi
  for service in "${active_services[@]}"; do
    if ! systemctl restart "$service"; then rollback; fi
  done
  sleep 3
  for service in "${active_services[@]}"; do
    if ! systemctl is-active --quiet "$service"; then rollback; fi
  done
  if ! node tools/cli/worker-health.js --scope=all; then rollback; fi
fi

# Keep the rollback target even when it falls outside the newest three releases.
current="$(readlink -f "$root/current")"
mapfile -t releases < <(ls -1d "$root"/releases/*/ 2>/dev/null | sed 's:/$::' | sort)
if [ "${#releases[@]}" -gt 3 ]; then
  for old in "${releases[@]:0:${#releases[@]}-3}"; do
    if [ "$old" = "$current" ] || [ "$old" = "$previous" ]; then continue; fi
    rm -rf "$old"
  done
fi

echo "release_ready:$release_id"
