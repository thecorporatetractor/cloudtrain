#!/usr/bin/env python3
"""Local pre-flight for tier-A labs: mimics labctl verify in plain docker containers.
usage: localverify.py LABDIR [--seed N] [--only base|mut:<id>|alt:<id>] [--keep]
"""
import subprocess, sys, yaml, json, re, uuid, os

LABCTL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../services/lab-orchestrator/bin/labctl")
IMAGES = {"linux-pod-deb:24.04": "cloudtrain/linux-pod-deb:24.04", "linux-pod-el:10": "cloudtrain/linux-pod-el:10"}
LEARNER_ENV = ["env", "-i", "HOME=/home/learner", "USER=learner", "LOGNAME=learner", "SHELL=/bin/bash",
               "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "TERM=dumb",
               "/bin/sh", "-c", 'cd "$HOME" && exec "$@"', "sh"]


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def compile_lab(labdir, seed):
    out = sh([LABCTL, "compile", "--seed", str(seed), os.path.join(labdir, "lab.yaml")])
    if out.returncode:
        sys.exit(out.stderr)
    return yaml.safe_load(out.stdout)


class Box:
    def __init__(self, tpl):
        node = tpl["spec"]["topology"]["nodes"][0]
        self.name = "lv-" + uuid.uuid4().hex[:8]
        r = sh(["docker", "run", "-d", "--name", self.name, "--hostname", node["name"],
                "--security-opt", "no-new-privileges", IMAGES[node["image"]], "sleep", "infinity"])
        if r.returncode:
            sys.exit(r.stderr)
        # mimic the platform's learner wiring
        self.exec(["/bin/sh", "-c", "install -d -m700 -o learner -g learner /home/learner/.ssh && "
                   "runuser -u learner -- ssh-keygen -q -t ed25519 -N '' -f /home/learner/.ssh/id_ed25519 && "
                   "touch /home/learner/.ssh/config /home/learner/.ssh/known_hosts && chown learner: /home/learner/.ssh/*"])

    def exec(self, argv, stdin=None, timeout=600):
        try:
            return subprocess.run(["docker", "exec", "-i", self.name] + argv, input=stdin, capture_output=True,
                                  text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return subprocess.CompletedProcess(argv, 124, "", "timeout")

    def action(self, a):
        user = a.get("as", "admin")
        t = a.get("timeoutSec", 600)
        if "run" in a:
            argv = ["/bin/sh", "-c", a["run"]]
            stdin = None
        elif "file" in a:
            f = a["file"]
            script = 'set -e; mkdir -p "$(dirname "$1")"; cat > "$1"'
            argv = ["/bin/sh", "-c", script, "sh", f["path"]]
            if f.get("mode"):
                argv = ["/bin/sh", "-c", script + '; chmod "$2" "$1"', "sh", f["path"], f["mode"]]
            stdin = f.get("content", "")
        else:
            raise SystemExit("unsupported action")
        if user == "learner":
            argv = ["runuser", "-u", "learner", "--"] + LEARNER_ENV + argv
        return self.exec(argv, stdin, timeout=t + 30)

    def check(self, c):
        t = c.get("timeoutSec", 5)
        r = self.exec(["timeout", str(t), "/bin/sh", "-c", c["command"]], timeout=t + 30)
        out = r.stdout
        if out.endswith("\r\n"):
            out = out[:-2]
        elif out.endswith("\n"):
            out = out[:-1]
        e = c.get("expect")
        if not e:
            ok = r.returncode == 0
        else:
            m, v = e["match"], e["value"]
            ok = {"exact": out == v, "not_exact": out != v, "contains": v in out,
                  "not_contains": v not in out, "regex": re.search(v, out) is not None}[m]
            if r.returncode in (124, 137):
                ok = False
        return ok, out

    def close(self, keep=False):
        if keep:
            print("  kept container", self.name)
        else:
            sh(["docker", "rm", "-f", self.name])


def run(tpl, steps, label, keep, expect_all=True, expect_fail=None, pre=False):
    b = Box(tpl)
    try:
        for a in tpl["spec"].get("setup", []):
            r = b.action(a)
            if r.returncode:
                print(f"  [{label}] SETUP FAILED rc={r.returncode}\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
                return False
        if pre:
            res = {c["id"]: b.check(c) for c in tpl["spec"]["checks"]}
            failing = [k for k, (ok, _) in res.items() if not ok]
            print(f"  [{label}/pre] failing before solution: {failing}" if failing else f"  [{label}/pre] NOTHING FAILS before solution")
            if not failing:
                return False
        for a in steps:
            r = b.action(a)
            if r.returncode:
                print(f"  [{label}] STEP rc={r.returncode}\n  stdout: {r.stdout[-800:]}\n  stderr: {r.stderr[-800:]}")
                if expect_all:
                    return False
        res = {c["id"]: b.check(c) for c in tpl["spec"]["checks"]}
        if expect_all:
            bad = {k: v[1] for k, v in res.items() if not v[0]}
            if bad:
                print(f"  [{label}] FAIL checks: {json.dumps(bad)[:1500]}")
                return False
            print(f"  [{label}] ok")
            return True
        bad = [k for k in expect_fail if res[k][0]]
        if bad:
            print(f"  [{label}] FAIL expected to fail but passed: {bad}; outputs: {[res[k][1] for k in bad]}")
            return False
        print(f"  [{label}] ok (failed: {[k for k, v in res.items() if not v[0]]})")
        return True
    finally:
        b.close(keep)


def main():
    labdir = sys.argv[1]
    seed = 1234
    only = None
    keep = "--keep" in sys.argv
    if "--seed" in sys.argv:
        seed = int(sys.argv[sys.argv.index("--seed") + 1])
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    tpl = compile_lab(labdir, seed)
    spec = tpl["spec"]
    print(f"{tpl['metadata']['labels']['labs.cloudtrain.dev/lab-id']} seed={seed} params={ {k.split('.')[-1]: v for k, v in tpl['metadata']['annotations'].items() if 'param.' in k} }")
    ok = True
    if only in (None, "base"):
        ok &= run(tpl, spec["solution"]["steps"], "base", keep, pre=True)
    for m in spec.get("misconceptions", []):
        if "mutation" in m and (only is None or only == "mut:" + m["id"]):
            ok &= run(tpl, [m["mutation"]], "mut:" + m["id"], keep, expect_all=False, expect_fail=m["expectFail"])
    for a in spec["solution"].get("alternatives", []):
        if only is None or only == "alt:" + a["id"]:
            ok &= run(tpl, a["steps"], "alt:" + a["id"], keep)
    print("RESULT", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
