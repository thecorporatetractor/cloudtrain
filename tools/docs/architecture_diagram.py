#!/usr/bin/env python3
"""Renders docs/images/architecture-{light,dark}.svg (the README's "How it works").

    python3 tools/docs/architecture_diagram.py

One layout, two palettes; the README picks one with <picture>.
"""
from pathlib import Path
from xml.sax.saxutils import escape

W, H = 1280, 820
FONT = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'

PALETTES = {
    "light": dict(bg="#f6f8fa", panel="#ffffff", sunk="#eef2f5", line="#d0d9e0", text="#14202b", muted="#5a6a77",
                  web="#1f6f8b", idp="#6a4fb8", core="#1f6f8b", orch="#0e7c66", lab="#217a4b", exam="#a86400",
                  net="#b3372f", data="#3b5b9a", content="#7a5a00", arrow="#55636f"),
    "dark": dict(bg="#0d1117", panel="#151d24", sunk="#1b252d", line="#2d3b45", text="#e6edf2", muted="#93a3ae",
                 web="#5fb3d1", idp="#a892f0", core="#5fb3d1", orch="#4fd1b0", lab="#6fd19b", exam="#f0c26a",
                 net="#f08a80", data="#9db5ea", content="#e0c36a", arrow="#8b9aa6"),
}


class Svg:
    def __init__(self, p):
        self.p, self.out = p, []

    def add(self, s):
        self.out.append(s)

    def rect(self, x, y, w, h, fill=None, stroke=None, r=10, sw=1.2, dash=None, opacity=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        o = f' opacity="{opacity}"' if opacity else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or "none"}" '
                 f'stroke="{stroke or "none"}" stroke-width="{sw}"{d}{o}/>')

    def text(self, x, y, s, size=13, color=None, weight=400, anchor="start", mono=False, opacity=None):
        o = f' opacity="{opacity}"' if opacity else ""
        self.add(f'<text x="{x}" y="{y}" font-family=\'{MONO if mono else FONT}\' font-size="{size}" '
                 f'font-weight="{weight}" fill="{color or self.p["text"]}" text-anchor="{anchor}"{o}>{escape(s)}</text>')

    def chip(self, x, y, label, color, w=None, mono=False, size=12):
        w = w or int(len(label) * (7.3 if mono else 6.9) + 20)
        self.rect(x, y, w, 24, fill=color, r=12, opacity="0.14")
        self.rect(x, y, w, 24, stroke=color, r=12, sw=1, opacity="0.55")
        self.text(x + w / 2, y + 16.5, label, size=size, color=self.p["text"], anchor="middle", mono=mono)
        return w

    def card(self, x, y, w, h, title, sub, color, icon=None):
        p = self.p
        self.rect(x, y, w, h, fill=p["panel"], stroke=p["line"], r=12)
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="4" rx="2" fill="{color}"/>')
        self.text(x + 16, y + 30, title, size=15, weight=650)
        if sub:
            self.text(x + 16, y + 49, sub, size=12, color=p["muted"])

    def arrow(self, pts, color, label=None, lx=None, ly=None, dash=None, anchor="middle", both=False):
        d = "M" + " L".join(f"{x},{y}" for x, y in pts)
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        start = ' marker-start="url(#arrow-start)"' if both else ""
        self.add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{dash_attr} '
                 f'marker-end="url(#arrow)"{start}/>')
        if label:
            tw = len(label) * 6.6 + 14
            bx = lx - tw / 2 if anchor == "middle" else lx
            self.rect(bx, ly - 14, tw, 20, fill=self.p["bg"], r=6)
            self.text(bx + tw / 2, ly, label, size=11.5, color=self.p["muted"], anchor="middle")

    def node(self, x, y, label, color, shape="box", w=74):
        p = self.p
        if shape == "circle":
            self.add(f'<circle cx="{x}" cy="{y}" r="20" fill="{p["panel"]}" stroke="{color}" stroke-width="1.6"/>')
            self.text(x, y + 4.5, label, size=11.5, anchor="middle", mono=True)
        else:
            self.rect(x - w / 2, y - 15, w, 30, fill=p["panel"], stroke=color, r=7, sw=1.4)
            self.text(x, y + 4.5, label, size=11.5, anchor="middle", mono=True)


def render(theme):
    p = PALETTES[theme]
    s = Svg(p)
    s.add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
          f'role="img" aria-labelledby="t d">')
    s.add('<title id="t">How CloudTrain works</title>')
    s.add('<desc id="d">People use the web app; the gateway signs them in through Keycloak and their company '
          'identity provider, stores data in Postgres with per-organisation row-level security, and asks the lab '
          'orchestrator for lab and exam sessions. The orchestrator provisions isolated labs (kubeadm clusters on '
          'VMs, virtual clusters, routed networks) on Kubernetes with KubeVirt and Kube-OVN, and grades them. Lab '
          'content is validated and verified live before it is published.</desc>')
    s.add(f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
          f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{p["arrow"]}"/></marker>'
          f'<marker id="arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" '
          f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{p["arrow"]}"/></marker>'
          f'<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0 L0 0 0 24" '
          f'fill="none" stroke="{p["line"]}" stroke-width="0.5" opacity="0.6"/></pattern></defs>')
    s.rect(0, 0, W, H, fill=p["bg"], r=16)
    s.rect(0, 0, W, H, fill="url(#grid)", r=16, opacity="0.5")

    # Heading
    s.text(40, 52, "How CloudTrain works", size=24, weight=700)
    s.text(40, 76, "Every learner gets real, isolated infrastructure. The platform grades the end state and "
                   "feeds a skill model.", size=13.5, color=p["muted"])

    # ---- Column 1: people and the web app
    s.text(40, 122, "PEOPLE", size=11, weight=650, color=p["muted"])
    for i, (who, what) in enumerate([("Learners", "labs · paths · exams"), ("Managers · instructors", "assign · observe · report"),
                                     ("Org & platform admins", "SSO · users · capacity")]):
        y = 134 + i * 54
        s.rect(40, y, 220, 44, fill=p["panel"], stroke=p["line"], r=10)
        s.add(f'<circle cx="62" cy="{y + 22}" r="9" fill="{p["web"]}" opacity="0.18"/>'
              f'<circle cx="62" cy="{y + 19}" r="3.2" fill="{p["web"]}"/>'
              f'<path d="M55.5,{y + 29} a6.5,5.5 0 0 1 13,0" fill="{p["web"]}"/>')
        s.text(80, y + 19, who, size=13, weight=600)
        s.text(80, y + 35, what, size=11.5, color=p["muted"])
    s.card(40, 312, 220, 214, "Web app", "React · xterm.js · React Flow", p["web"])
    for i, c in enumerate(["Lab workspace", "Exam simulations", "Team & cohorts", "Admin & platform"]):
        s.chip(56, 382 + i * 32, c, p["web"], w=188)
    s.arrow([(150, 296), (150, 312)], p["arrow"])

    # ---- Column 2: identity + gateway + data
    s.card(310, 112, 160, 92, "Company IdP", "Entra ID · Okta · SAML", p["idp"])
    s.chip(326, 168, "app roles → roles", p["idp"], w=128, size=11)
    s.card(510, 112, 160, 92, "Keycloak", "SSO broker · orgs", p["idp"])
    s.chip(526, 168, "identity-first login", p["idp"], w=128, size=11)
    s.arrow([(510, 150), (470, 150)], p["arrow"], both=True)
    s.text(490, 140, "OIDC", size=11, color=p["muted"], anchor="middle")

    s.card(310, 248, 360, 196, "Gateway", "Backend for the web app · TypeScript · Fastify", p["core"])
    chips = [("OIDC sessions", "CSRF"), ("Permission matrix", "audit log"), ("Lab sessions", "exam attempts"),
             ("Terminal WebSocket", "learner model")]
    for i, (a, b) in enumerate(chips):
        s.chip(326, 314 + i * 31, a, p["core"], w=160)
        s.chip(494, 314 + i * 31, b, p["core"], w=160)
    s.arrow([(590, 248), (590, 204)], p["arrow"])
    s.text(600, 232, "OIDC + PKCE", size=11, color=p["muted"])
    s.arrow([(260, 418), (310, 418)], p["arrow"], both=True)
    s.text(285, 406, "HTTPS", size=11, color=p["muted"], anchor="middle")
    s.text(285, 440, "WS", size=11, color=p["muted"], anchor="middle")

    # Postgres cylinder
    cx, cy, cw, ch = 310, 488, 170, 104
    s.add(f'<path d="M{cx},{cy + 12} v{ch - 24} a{cw / 2},12 0 0 0 {cw},0 v-{ch - 24}" fill="{p["panel"]}" '
          f'stroke="{p["line"]}" stroke-width="1.2"/>'
          f'<ellipse cx="{cx + cw / 2}" cy="{cy + 12}" rx="{cw / 2}" ry="12" fill="{p["sunk"]}" stroke="{p["data"]}" stroke-width="1.4"/>')
    s.text(cx + 16, cy + 50, "Postgres", size=15, weight=650)
    s.text(cx + 16, cy + 69, "row-level security", size=12, color=p["muted"])
    s.text(cx + 16, cy + 85, "per organisation", size=12, color=p["muted"])
    s.arrow([(395, 444), (395, 476)], p["arrow"], both=True)

    s.card(500, 488, 170, 104, "Learner model", "per-skill μ / σ", p["data"])
    s.chip(516, 552, "evidence from checks", p["data"], w=138, size=11)
    s.arrow([(585, 444), (585, 488)], p["arrow"])

    # ---- Column 3: orchestrator
    s.card(722, 112, 196, 480, "Lab orchestrator", "Kubernetes operator · Go", p["orch"])
    s.text(738, 188, "RESOURCES", size=10.5, weight=650, color=p["muted"])
    for i, c in enumerate(["LabTemplate", "LabSession", "WarmPool", "ExamTemplate", "ExamSession"]):
        s.chip(738, 198 + i * 30, c, p["orch"], w=164, mono=True, size=11.5)
    s.text(738, 370, "NODE DRIVERS", size=10.5, weight=650, color=p["muted"])
    for i, c in enumerate(["container", "vm", "kubeadm", "vcluster", "netdev"]):
        x = 738 + (i % 2) * 84
        y = 380 + (i // 2) * 30
        s.chip(x, y, c, p["orch"], w=80, mono=True, size=11.5)
    s.text(738, 494, "GRADER", size=10.5, weight=650, color=p["muted"])
    s.chip(738, 504, "typed checks → score", p["exam"], w=164, size=11.5)
    s.chip(738, 536, "exam freeze · reboot", p["exam"], w=164, size=11.5)
    s.arrow([(670, 300), (722, 300)], p["arrow"])
    s.text(696, 288, "sessions", size=11, color=p["muted"], anchor="middle")

    # ---- Column 4: the cluster with labs
    kx, ky, kw, kh = 958, 104, 282, 604
    s.rect(kx, ky, kw, kh, fill=p["sunk"], stroke=p["line"], r=16)
    s.text(kx + 18, ky + 30, "Kubernetes cluster", size=15, weight=650)
    s.text(kx + 18, ky + 49, "KubeVirt · Kube-OVN · Multus", size=12, color=p["muted"])
    s.arrow([(918, 300), (958, 300)], p["arrow"])
    s.text(938, 288, "run", size=11, color=p["muted"], anchor="middle")

    def lab(y, h, title, color):
        s.rect(kx + 14, y, kw - 28, h, fill=p["panel"], stroke=color, r=12, dash="5 4", sw=1.3)
        s.text(kx + 28, y + 22, title, size=12.5, weight=650)
        s.text(kx + kw - 28, y + 22, "own VPC", size=10.5, color=color, anchor="end")

    # Lab A: kubeadm cluster on VMs (with a warm-pool stack behind it)
    for k in (2, 1):
        s.rect(kx + 14 + 5 * k, 176 - 5 * k, kw - 28, 172, fill=p["panel"], stroke=p["line"], r=12, opacity="0.7")
    lab(176, 172, "kubeadm cluster lab", p["lab"])
    s.node(kx + 70, 228, "workstation", p["web"], w=94)
    for i, n in enumerate(["cp-1", "wk-1", "wk-2"]):
        s.node(kx + 60 + i * 80, 300, n, p["lab"], w=64)
    s.add(f'<path d="M{kx + 70},{243} V{262} M{kx + 60},{262} H{kx + 220} M{kx + 60},{262} V{285} '
          f'M{kx + 140},{262} V{285} M{kx + 220},{262} V{285}" stroke="{p["lab"]}" stroke-width="1.4" fill="none"/>')
    s.text(kx + 178, 232, "ssh · kubectl", size=10.5, color=p["muted"], anchor="middle", mono=True)
    s.chip(kx + 118, 318, "warm pool · ready <1 s", p["exam"], w=134, size=10.5)

    # Lab B: virtual cluster
    lab(366, 110, "virtual cluster lab", p["lab"])
    s.node(kx + 70, 428, "workstation", p["web"], w=94)
    hx, hy = kx + 200, 428
    pts = " ".join(f"{hx + 40 * dx},{hy + 24 * dy}" for dx, dy in [(-1, 0), (-0.5, -1), (0.5, -1), (1, 0), (0.5, 1), (-0.5, 1)])
    s.add(f'<polygon points="{pts}" fill="{p["panel"]}" stroke="{p["lab"]}" stroke-width="1.5"/>')
    s.text(hx, hy + 4.5, "vcluster", size=11, anchor="middle", mono=True)
    s.add(f'<path d="M{kx + 117},{hy} H{hx - 40}" stroke="{p["lab"]}" stroke-width="1.4"/>')

    # Lab C: routed network
    lab(494, 196, "network lab", p["net"])
    r1, r2 = (kx + 92, 570), (kx + 188, 570)
    s.add(f'<path d="M{r1[0] + 20},{r1[1]} H{r2[0] - 20}" stroke="{p["net"]}" stroke-width="1.6"/>')
    s.chip(kx + 108, 526, "+30 ms", p["net"], w=64, size=10.5)
    s.node(*r1, "r1", p["net"], shape="circle")
    s.node(*r2, "r2", p["net"], shape="circle")
    for (rx, ry), (hx2, label) in zip((r1, r2), ((kx + 62, "h1"), (kx + 218, "h2"))):
        s.add(f'<path d="M{rx},{ry + 20} L{hx2},{ry + 62}" stroke="{p["net"]}" stroke-width="1.4"/>')
        s.node(hx2, ry + 76, label, p["net"], w=46)
    s.text(kx + 140, 672, "FRR · per-link segments · capture", size=10.5, color=p["muted"], anchor="middle")

    # ---- Bottom: content pipeline
    by = 640
    s.text(40, by - 10, "CONTENT PIPELINE", size=11, weight=650, color=p["muted"])
    steps = [("lab.yaml", "topology · checks · solution", p["content"]),
             ("lab-verify", "schema · skills · denylist", p["content"]),
             ("labctl verify", "fail → solve → pass, mutations", p["content"]),
             ("LabTemplate", "published to the catalog", p["orch"])]
    x = 40
    for i, (t, sub, col) in enumerate(steps):
        w = 196
        s.rect(x, by, w, 64, fill=p["panel"], stroke=p["line"], r=10)
        s.add(f'<rect x="{x}" y="{by}" width="4" height="64" rx="2" fill="{col}"/>')
        s.text(x + 18, by + 27, t, size=14, weight=650, mono=True)
        s.text(x + 18, by + 47, sub, size=11.5, color=p["muted"])
        if i < len(steps) - 1:
            s.arrow([(x + w, by + 32), (x + w + 22, by + 32)], p["arrow"])
        x += w + 22
    s.arrow([(x - 22 - 98, by), (x - 22 - 98, 616), (820, 616), (820, 592)], p["arrow"])

    # Legend / footer
    s.text(40, 760, "Every lab ships a reference solution, alternative solutions and wrong-approach mutations; "
                    "it is published only after the live verifier proves all of them.", size=12, color=p["muted"])
    s.text(40, 782, "Learners never see admin credentials: setup and grading run out of band, from a sidecar the "
                    "learner can't read.", size=12, color=p["muted"])
    s.add("</svg>")
    return "\n".join(s.out)


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[2] / "docs" / "images"
    for theme in PALETTES:
        (out / f"architecture-{theme}.svg").write_text(render(theme))
        print(f"wrote docs/images/architecture-{theme}.svg")
