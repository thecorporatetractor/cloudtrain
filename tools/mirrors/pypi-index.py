"""Write a PEP 503 simple index (simple/<name>/index.html) and pypi.lock for <root>/files."""
import hashlib
import html
import os
import re
import sys

root = sys.argv[1]
files = sorted(os.listdir(os.path.join(root, "files")))


def norm(n):
    return re.sub(r"[-_.]+", "-", n).lower()


def sha(f):
    with open(os.path.join(root, "files", f), "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


projects = {}
for f in files:
    projects.setdefault(norm(re.split(r"-\d", f, maxsplit=1)[0]), []).append(f)
os.makedirs(os.path.join(root, "simple"), exist_ok=True)
with open(os.path.join(root, "simple", "index.html"), "w") as idx:
    idx.write("<!DOCTYPE html><html><body>\n")
    for name, fs in sorted(projects.items()):
        idx.write(f'<a href="{name}/">{name}</a>\n')
        os.makedirs(os.path.join(root, "simple", name), exist_ok=True)
        with open(os.path.join(root, "simple", name, "index.html"), "w") as p:
            p.write("<!DOCTYPE html><html><body>\n")
            for f in fs:
                p.write(f'<a href="../../files/{html.escape(f)}#sha256={sha(f)}">{html.escape(f)}</a>\n')
            p.write("</body></html>\n")
    idx.write("</body></html>\n")
with open(os.path.join(root, "pypi.lock"), "w") as lock:
    for f in files:
        lock.write(f"{f} sha256:{sha(f)}\n")
