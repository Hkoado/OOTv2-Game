"""Trusted selftest fixture: probe dangerous syscalls inside the sandbox.

Prints one JSON object on stdout. The seccomp deny-list must turn every call
into EPERM; the same fixture with --seccomp-mode off is also used to prove that
the filter (not the namespaces alone) is what changes /proc/self/status.
"""
import ctypes
import errno
import json
import platform
import sys

ARCH = platform.machine()
NUMBERS = {
    "x86_64": {"ptrace": 101, "mount": 165, "unshare": 272, "keyctl": 250,
               "bpf": 321, "io_uring_setup": 425},
    "aarch64": {"ptrace": 117, "mount": 40, "unshare": 97, "keyctl": 219,
                "bpf": 280, "io_uring_setup": 425},
}[ARCH]

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long


def call(name, *args):
    ctypes.set_errno(0)
    result = libc.syscall(ctypes.c_long(NUMBERS[name]), *args)
    return {"result": result, "errno": ctypes.get_errno()}


report = {
    "arch": ARCH,
    "seccomp": next((line.split(":", 1)[1].strip()
                     for line in open("/proc/self/status", encoding="utf-8")
                     if line.startswith("Seccomp:")), None),
    "checks": {
        "ptrace": call("ptrace", ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0)),
        "mount": call("mount", ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0),
                      ctypes.c_long(0), ctypes.c_long(0)),
        "unshare": call("unshare", ctypes.c_long(0x00020000)),
        "keyctl": call("keyctl", ctypes.c_long(0), ctypes.c_long(0)),
        "bpf": call("bpf", ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0)),
        "io_uring_setup": call("io_uring_setup", ctypes.c_long(2), ctypes.c_long(0)),
    },
}
report["blocked"] = all(check["result"] == -1 and check["errno"] == errno.EPERM
                        for check in report["checks"].values())
json.dump(report, sys.stdout, sort_keys=True)
sys.stdout.write("\n")
