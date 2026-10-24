"""Hostile fixture: stdout flood for output-budget tests. Trusted test code only."""
import sys

chunk = "x" * 4096
while True:
    sys.stdout.write(chunk)
