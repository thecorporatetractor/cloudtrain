#!/usr/bin/python3
"""tr-resolver: the dispatch site's tiny authoritative resolver (training build).
Answers A queries for the names in /etc/tr-resolver/zone.txt ("name address" lines),
NOERROR without data for other types of known names, NXDOMAIN otherwise."""
import socket, struct, sys

ZONE = "/etc/tr-resolver/zone.txt"
LISTEN = (sys.argv[1] if len(sys.argv) > 1 else "127.0.0.53", 53)


def load():
    z = {}
    for line in open(ZONE):
        parts = line.split("#")[0].split()
        if len(parts) == 2:
            z[parts[0].lower().rstrip(".")] = socket.inet_aton(parts[1])
    return z


def qname(data, off):
    labels = []
    while True:
        n = data[off]
        off += 1
        if n == 0:
            return ".".join(labels), off
        labels.append(data[off:off + n].decode("ascii", "replace"))
        off += n


def answer(data, zone):
    tid, flags, qd = struct.unpack("!HHH", data[:6])
    name, end = qname(data, 12)
    qtype, qclass = struct.unpack("!HH", data[end:end + 4])
    question = data[12:end + 4]
    key = name.lower().rstrip(".")
    rd = flags & 0x0100
    if key not in zone:
        return struct.pack("!HHHHHH", tid, 0x8083 | rd, 1, 0, 0, 0) + question
    if qtype not in (1, 255):
        return struct.pack("!HHHHHH", tid, 0x8480 | rd, 1, 0, 0, 0) + question
    rr = struct.pack("!HHHIH", 0xC00C, 1, 1, 60, 4) + zone[key]
    return struct.pack("!HHHHHH", tid, 0x8480 | rd, 1, 1, 0, 0) + question + rr


def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(LISTEN)
    while True:
        data, peer = s.recvfrom(512)
        try:
            s.sendto(answer(data, load()), peer)
        except Exception:
            pass


if __name__ == "__main__":
    main()
