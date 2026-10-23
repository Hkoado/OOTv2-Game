"""Hostile fixture: try to exhaust the process limit. Trusted test code only."""
import os
import time

while True:
    try:
        pid = os.fork()
    except OSError:
        time.sleep(0.05)
        continue
    if pid == 0:
        time.sleep(5)
        os._exit(0)
