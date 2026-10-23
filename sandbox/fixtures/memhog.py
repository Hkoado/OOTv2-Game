"""Hostile fixture: try to exhaust memory. Trusted test code only."""
chunks = []
while True:
    chunks.append(bytearray(8 * 1024 * 1024))
