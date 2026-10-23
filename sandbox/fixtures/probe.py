"""Isolation probe: prints one JSON line describing what the sandbox exposes."""
import json
import os
import socket


def attempt(fn):
    try:
        return {"ok": True, "value": fn()}
    except Exception as error:  # noqa: BLE001 - probe records the failure type only
        return {"ok": False, "error": type(error).__name__}


def read_first(path):
    with open(path, "rb") as handle:
        return handle.read(1).decode("latin1")


def write(path):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("x")
    return True


def connect():
    with socket.create_connection(("1.1.1.1", 80), timeout=1):
        return True


def fork():
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    os.waitpid(pid, 0)
    return True


report = {
    "uid": os.getuid(),
    "gid": os.getgid(),
    "cwd": os.getcwd(),
    "root": sorted(os.listdir("/")),
    "envKeys": sorted(os.environ),
    "hostname": socket.gethostname(),
    "checks": {
        "readRepo": attempt(lambda: read_first("/mnt/d/OOTv2-Game/AGENTS.md")),
        "readWindows": attempt(lambda: read_first("/mnt/c/Windows/win.ini")),
        "readShadow": attempt(lambda: read_first("/etc/shadow")),
        "readRootHome": attempt(lambda: read_first("/root/.bashrc")),
        "writeUsr": attempt(lambda: write("/usr/escape")),
        "writeTmp": attempt(lambda: write("/tmp/escape")),
        "network": attempt(connect),
        "fork": attempt(fork),
        "procStatus": attempt(lambda: read_first("/proc/self/status")),
    },
}
print(json.dumps(report, sort_keys=True), flush=True)
