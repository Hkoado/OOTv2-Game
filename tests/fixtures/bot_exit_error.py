"""Fixture: bot thoát với mã lỗi -> nonzero_exit."""
import sys

sys.stdin.readline()
print("bot crashed on purpose", file=sys.stderr)
sys.exit(3)
