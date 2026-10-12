"""Fixture: bot ghi quá nhiều ra stdout -> output_limit."""
import sys

sys.stdin.readline()
sys.stdout.write("x" * 200000)
sys.stdout.write("\n")
sys.stdout.flush()
