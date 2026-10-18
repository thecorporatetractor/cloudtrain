#!/usr/bin/env python3
"""Copy the licence and notice files of every NuGet package in a project's dependency graph.

  collect-nuget-licences.py project.assets.json NUGET_PACKAGES_DIR OUT_DIR [OVERRIDES_DIR]

For each package: OUT_DIR/<id>-<version>/ gets the package's LICENSE/NOTICE/COPYING/
THIRD-PARTY files (top level of the package) and the nuspec's <license> or <licenseUrl>
goes into OUT_DIR/packages.tsv. A package that declares nothing may be covered by
OVERRIDES_DIR/overrides.tsv (licence + source) and OVERRIDES_DIR/<id>.LICENSE. Fails if a package declares no licence at all, or if any
package carries the Azure Data Explorer SDK EULA (the licence-clean build must not).
"""
import json
import os
import re
import shutil
import sys

NOTICE = re.compile(r"(?i)^(licen[cs]e|notice|copying|third[-_]?party)")


def main():
    assets, cache, out = sys.argv[1:4]
    overrides_dir = sys.argv[4] if len(sys.argv) > 4 else None
    overrides = {}
    if overrides_dir:
        for line in open(os.path.join(overrides_dir, "overrides.tsv"), encoding="utf-8"):
            if line.strip() and not line.startswith("#"):
                pid, lic, src = line.rstrip("\n").split("\t")
                overrides[pid] = (lic, src)
    os.makedirs(out, exist_ok=True)
    libs = json.load(open(assets, encoding="utf-8"))["libraries"]
    rows, problems = [], []
    for key, lib in sorted(libs.items()):
        if lib.get("type") != "package":
            continue
        pid, ver = key.split("/")
        pdir = os.path.join(cache, pid.lower(), ver.lower())
        nuspec = next((os.path.join(pdir, f) for f in os.listdir(pdir) if f.endswith(".nuspec")), None)
        text = open(nuspec, encoding="utf-8", errors="replace").read() if nuspec else ""
        m = re.search(r"<license type=\"(\w+)\">([^<]+)</license>", text)
        declared = (m.group(2) if m.group(1) == "expression" else f"file: {m.group(2)}") if m else ""
        if not declared:
            m = re.search(r"<licenseUrl>([^<]+)</licenseUrl>", text)
            declared = f"url: {m.group(1)}" if m else ""
        files = [f for f in os.listdir(pdir) if NOTICE.match(f) and os.path.isfile(os.path.join(pdir, f))]
        if files:
            dest = os.path.join(out, f"{pid}-{ver}")
            os.makedirs(dest, exist_ok=True)
            for f in files:
                shutil.copy(os.path.join(pdir, f), dest)
        if not declared and not files and pid in overrides:
            dest = os.path.join(out, f"{pid}-{ver}")
            os.makedirs(dest, exist_ok=True)
            shutil.copy(os.path.join(overrides_dir, f"{pid}.LICENSE"), os.path.join(dest, "LICENSE"))
            declared, files = f"{overrides[pid][0]} ({overrides[pid][1]})", ["LICENSE"]
        if os.path.exists(os.path.join(pdir, "EULA-agreement.txt")):
            problems.append(f"{pid} {ver}: Azure Data Explorer SDK EULA")
        if not declared and not files:
            problems.append(f"{pid} {ver}: no licence declared")
        rows.append(f"{pid}\t{ver}\t{declared or 'see files'}\t{' '.join(files)}")
    with open(os.path.join(out, "packages.tsv"), "w", encoding="utf-8") as f:
        f.write("package\tversion\tlicence\tfiles\n" + "\n".join(rows) + "\n")
    if problems:
        sys.exit("licence check failed:\n  " + "\n  ".join(problems))
    print(f"{len(rows)} NuGet packages, notices in {out}")


if __name__ == "__main__":
    main()
