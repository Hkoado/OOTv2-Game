"""Benign JSONL echo bot used to prove stdin/stdout pass through the sandbox."""
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    print(json.dumps({"echo": request.get("n")}), flush=True)
