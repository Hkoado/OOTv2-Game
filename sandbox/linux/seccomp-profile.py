#!/usr/bin/env python3
"""Generate the seccomp deny-list profile loaded by bwrap --seccomp.

The output is a raw BPF program (an array of struct sock_filter), the format
produced by libseccomp's seccomp_export_bpf(). bubblewrap loads it with
prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER) before exec'ing the bot.

Policy: allow-by-default, deny a curated list of escape/host-abuse syscalls with
EPERM. This mirrors the Docker default profile plus the newer mount and io_uring
families. It is a defence-in-depth layer; the sandbox also uses user/mount/net/pid
namespaces, a read-only root, dropped capabilities and cgroup limits.

Usage: python3 seccomp-profile.py OUTPUT.bpf [--json]
Requires: python3-seccomp (libseccomp bindings).
"""
import json
import errno
import platform
import sys

try:
    import seccomp
except ImportError:  # pragma: no cover - exercised by preflight
    print("seccomp-profile: python3-seccomp is required", file=sys.stderr)
    raise SystemExit(78)

# Escape / host-abuse syscalls. Names absent from the running kernel headers are
# skipped by libseccomp; the generator reports them instead of failing.
DENIED = (
    "_sysctl", "acct", "add_key", "adjtimex", "bpf", "clock_adjtime",
    "clock_settime", "create_module", "delete_module",
    "fanotify_init", "finit_module", "fsconfig", "fsmount", "fsopen", "fspick",
    "get_kernel_syms", "get_mempolicy", "init_module", "io_uring_enter",
    "io_uring_register", "io_uring_setup", "ioperm", "iopl", "kcmp",
    "kexec_file_load", "kexec_load", "keyctl", "lookup_dcookie", "mbind",
    "mount", "mount_setattr", "move_mount", "move_pages", "name_to_handle_at",
    "nfsservctl", "open_by_handle_at", "open_tree", "perf_event_open",
    "personality", "pidfd_getfd", "pivot_root", "process_madvise",
    "process_vm_readv", "process_vm_writev", "ptrace", "query_module",
    "quotactl", "quotactl_fd", "reboot", "request_key", "set_mempolicy",
    "setns", "settimeofday", "swapoff", "swapon", "sysfs", "syslog", "umount",
    "umount2", "unshare", "uselib", "userfaultfd", "ustat", "vm86", "vm86old",
)


def main(argv):
    if len(argv) < 2 or len(argv) > 3:
        print("usage: seccomp-profile.py OUTPUT.bpf [--json]", file=sys.stderr)
        return 64
    output = argv[1]
    if argv[2:] not in ([], ["--json"]):
        print("usage: seccomp-profile.py OUTPUT.bpf [--json]", file=sys.stderr)
        return 64
    if not output.startswith("/"):
        print("seccomp-profile: OUTPUT must be an absolute path", file=sys.stderr)
        return 64
    flt = seccomp.SyscallFilter(defaction=seccomp.ALLOW)
    blocked, skipped = [], []
    for name in DENIED:
        try:
            flt.add_rule(seccomp.ERRNO(errno.EPERM), name)
            blocked.append(name)
        except Exception:
            skipped.append(name)
    with open(output, "wb") as handle:
        flt.export_bpf(handle)
    report = {
        "profile": "seccomp-deny-list.v1",
        "arch": platform.machine(),
        "policy": "allow-by-default; denied syscalls return EPERM",
        "output": output,
        "blocked": len(blocked),
        "skipped": skipped,
    }
    if argv[2:] == ["--json"]:
        print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
