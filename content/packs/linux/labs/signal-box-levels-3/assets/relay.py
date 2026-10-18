#!/usr/bin/env python3
"""Signal box relay: a plain-text service on 30013 and a TLS service on 30014.
Each asks for the password the learner used to unlock the level and answers with the
password of the next one. Tokens are read from a root-only file."""
import json, socketserver, ssl, threading

TOK = json.load(open("/var/lib/cloudtrain/sb-tokens.json"))
CTX = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
CTX.load_cert_chain("/var/lib/cloudtrain/sb-relay.crt", "/var/lib/cloudtrain/sb-relay.key")


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        lvl = self.server.level
        try:
            if self.server.tls:
                self.request.do_handshake()
            self.wfile.write(f"sb-relay level {lvl}: send the password you used to unlock this level\n".encode())
            line = self.rfile.readline(200).decode(errors="replace").strip()
            if line == TOK[str(int(lvl) - 1)]:
                self.wfile.write(f"Accepted. The password for level {int(lvl) + 1} is {TOK[lvl]}\n".encode())
            else:
                self.wfile.write(b"Denied.\n")
        except Exception:
            pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, port, level, tls):
        self.level, self.tls = level, tls
        super().__init__(("127.0.0.1", port), Handler)

    def get_request(self):
        sock, addr = self.socket.accept()
        sock.settimeout(10)
        if self.tls:
            sock = CTX.wrap_socket(sock, server_side=True, do_handshake_on_connect=False)
        return sock, addr


for port, level, tls in ((30013, "13", False), (30014, "14", True)):
    threading.Thread(target=Server(port, level, tls).serve_forever, daemon=True).start()
threading.Event().wait()
