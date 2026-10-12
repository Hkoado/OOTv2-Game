"""Fixture: bot trả JSON hợp lệ nhưng kèm dòng thừa -> bad_json (nhiều dòng)."""
import json
import sys

sys.stdin.readline()
sys.stdout.write(json.dumps({"legal": True}) + "\n")
sys.stdout.write(json.dumps({"legal": True}) + "\n")
sys.stdout.flush()
