"""Fixture: bot in log rác ra stdout -> phải bị xử lý là bad_json."""
import json
import sys

sys.stdin.readline()
print("hello from noisy bot")
print(json.dumps({"placements": []}))
