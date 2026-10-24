#!/usr/bin/env bash
# Deploy one immutable release and swap /srv/ootv2/current atomically.
# Usage: deploy-release.sh /home/ootv2/staging
# Failure after the swap restores the previous symlink; a broken release never
# stays active. Does not create, enable or start any service by itself.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo root_required; exit 78; }
staging="${1:-}"
root=/srv/ootv2
service=ootv2-github-worker.service
[ -d "$staging" ] || { echo staging_missing; exit 78; }

for required in package.json package-lock.json server/githubWorker.js server/worker.js \
  server/shared/githubWorkerDeps.js sandbox/linux/run-bot.sh tools/cli/worker-health.js; do
  [ -f "$staging/$required" ] || { echo "release_incomplete:$required"; exit 78; }
done

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

previous="$(readlink "$root/current" 2>/dev/null || true)"
was_active=0
if systemctl is-active --quiet "$service"; then was_active=1; fi

activate() {
  ln -sfn "$1" "$root/current.next"
  mv -T "$root/current.next" "$root/current"
}

rollback() {
  echo "release_failed:$release_id"
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    activate "$previous"
    echo "rolled_back_to:$previous"
    if [ "$was_active" = 1 ]; then
      systemctl restart "$service" || echo 'restart_after_rollback_failed'
    fi
  else
    rm -f "$root/current"
    echo 'no_previous_release'
  fi
  exit 79
}

activate "$target"
echo "activated:$release_id"

if [ "$was_active" = 1 ]; then
  if ! systemctl restart "$service"; then rollback; fi
  sleep 3
  if ! systemctl is-active --quiet "$service"; then rollback; fi
  node tools/cli/worker-health.js --json || echo 'health_degraded: worker is running but prerequisites changed'
fi

# Keep current + two previous releases for a manual rollback.
current="$(readlink -f "$root/current")"
mapfile -t releases < <(ls -1d "$root"/releases/*/ 2>/dev/null | sed 's:/$::' | sort)
if [ "${#releases[@]}" -gt 3 ]; then
  for old in "${releases[@]:0:${#releases[@]}-3}"; do
    if [ "$old" = "$current" ]; then continue; fi
    rm -rf "$old"
  done
fi

echo "release_ready:$release_id"
