import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { podImageRefs, verifyContent } from "../src/verify.mjs";

const contentDir = fileURLToPath(new URL("../../../content", import.meta.url));
const catalogFile = fileURLToPath(new URL("../../../deploy/images/catalog.yaml", import.meta.url));

/** Copies content/, applies `edit` to one file (relative to content/), and returns the findings for that file. */
async function findingsAfterFile(rel, edit) {
  const dir = await mkdtemp(path.join(tmpdir(), "lab-verify-"));
  try {
    await cp(contentDir, dir, { recursive: true });
    const file = path.join(dir, rel);
    const before = await readFile(file, "utf8");
    const after = edit(before);
    assert.notEqual(after, before, "edit did not change the file");
    await writeFile(file, after);
    const r = await verifyContent(dir, { catalogFile });
    return r.findings.filter((f) => f.file === file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Copies content/, applies `edit` to one lab.yaml, and returns the findings for that lab. */
const findingsAfter = (lab, edit) => findingsAfterFile(path.join("packs/kubernetes/labs", lab, "lab.yaml"), edit);

test("regex backreference is rejected (RE2)", async () => {
  const f = await findingsAfter("hostpath-pv-readonly", (s) => s.replace(`value: '^\\["ReadOnlyMany"\\]$'`, () => "value: '^(\\w+)\\1$'"));
  assert.ok(f.some((x) => x.level === "error" && /backreference/.test(x.message)), JSON.stringify(f));
});

test("mutation without use-context is flagged", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace("kubectl config use-context qm-dispatch\n          kubectl -n dock-scheduling scale deployment --all", "kubectl -n dock-scheduling scale deployment --all"));
  assert.ok(f.some((x) => x.level === "warn" && x.path === "/spec/misconceptions/0/mutation"), JSON.stringify(f));
});

test("unknown expectFail id is an error", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace("expectFail: [others-unchanged]", "expectFail: [no-such-check]"));
  assert.ok(f.some((x) => x.level === "error" && /unknown check 'no-such-check'/.test(x.message)), JSON.stringify(f));
});

test("misconception without a mutation warns at its own index", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) =>
    s.replace(/(    - id: wrong-namespace\n(?:      .*\n)*?)      expectFail: .*\n      mutation:\n(?:        .*\n)+?(?=    - id: )/, "$1"),
  );
  assert.ok(f.some((x) => x.level === "warn" && x.path === "/spec/misconceptions/1"), JSON.stringify(f));
});

test("topology image missing from the catalog is an error", async () => {
  const f = await findingsAfter("drain-yard-worker", (s) => s.replace("image: kubeadm:1.37", "image: kubeadm:1.35"));
  assert.ok(f.some((x) => x.level === "error" && x.path === "/spec/topology/nodes/1/image" && /not in catalog/.test(x.message)), JSON.stringify(f));
});

test("kubeadm cluster without an image is an error", async () => {
  const f = await findingsAfter("drain-yard-worker", (s) => s.replace("        image: kubeadm:1.37\n", ""));
  assert.ok(f.some((x) => x.level === "error" && /needs a catalog image/.test(x.message)), JSON.stringify(f));
});

test("kubeadm cluster version must match the image", async () => {
  const f = await findingsAfter("drain-yard-worker", (s) => s.replace('version: "v1.37.1"', 'version: "v1.36.4"'));
  assert.ok(f.some((x) => x.level === "error" && x.path === "/spec/topology/nodes/1/cluster/version"), JSON.stringify(f));
});

test("Pod image in a manifest that is not a workload image is an error", async () => {
  const f = await findingsAfter("drain-yard-worker", (s) => s.replace("image: redis:7.4-alpine", "image: redis:8"));
  assert.ok(f.some((x) => x.level === "error" && /'redis:8' is not in workloadImages/.test(x.message)), JSON.stringify(f));
});

test("--image in a hint command is checked too", async () => {
  const f = await findingsAfter("nodeselector-nvme-pod", (s) => s.replace("run {{pod}} --image=httpd:2.4-alpine --dry-run", "run {{pod}} --image=httpd:latest --dry-run"));
  assert.ok(f.some((x) => x.level === "error" && /^\/spec\/hints\//.test(x.path) && /httpd:latest/.test(x.message)), JSON.stringify(f));
});

test("check with more than 4 skills warns", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) =>
    s.replace("skills: [k8s.cli.scoped-changes]", "skills: [k8s.cli.scoped-changes, k8s.cli.imperative, k8s.cli.manifests, k8s.workloads.scaling, k8s.workloads.deployments]"),
  );
  assert.ok(f.some((x) => x.level === "warn" && /tagged with 5 skills/.test(x.message)), JSON.stringify(f));
});

test("lab framework that shares no skill with its checks warns", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace("frameworks: [cka:workloads-scheduling, ckad:deployment]", "frameworks: [cka:workloads-scheduling, ckad:deployment, cka:storage]"));
  assert.ok(f.some((x) => x.level === "warn" && /'cka:storage' maps none/.test(x.message)), JSON.stringify(f));
});

test("framework topic skill must be listed by its objective", async () => {
  const f = await findingsAfterFile("frameworks/cka.yaml", (s) => s.replace("skills: [k8s.cluster.ha-control-plane]", "skills: [k8s.cluster.ha-control-plane, k8s.security.sbom]"));
  assert.ok(f.some((x) => x.level === "error" && /missing from the objective/.test(x.message)), JSON.stringify(f));
});

test("skills no lab uses are reported as info, never as warnings", async () => {
  const r = await verifyContent(contentDir, { catalogFile });
  const info = r.findings.filter((x) => x.level === "info");
  assert.ok(info.some((x) => x.path === "net.wireless.fundamentals"), "wireless fundamentals has no lab yet");
  assert.ok(!info.some((x) => x.path === "k8s.scheduling.cordon-drain"), "cordon-drain is exercised");
  assert.deepEqual(r.findings.filter((x) => x.level === "warn"), []);
});

test("podImageRefs finds manifest, flag and JSON refs and skips jsonpath and params", () => {
  const text = [
    "containers:",
    "  - name: a",
    "    image: busybox:1.37",
    '  - {name: b, image: "redis:7.4-alpine"}',
    "kubectl run x --image=httpd:2.4-alpine --overrides='{\"spec\":{\"containers\":[{\"name\":\"c\",\"image\":\"caddy:2-alpine\"}]}}'",
    "kubectl get pod x -o jsonpath='{.spec.containers[0].image}'",
    "kubectl run y --image={{img}} --image=$IMG",
    "imagePullPolicy: Always",
  ].join("\n");
  assert.deepEqual([...podImageRefs(text)].sort(), ["busybox:1.37", "caddy:2-alpine", "httpd:2.4-alpine", "redis:7.4-alpine"]);
});

test("exam task with hints is an error, and needs no hints or course otherwise", async () => {
  const f = await findingsAfter("xkd-job-completions", (s) =>
    s.replace("  misconceptions:\n", "  hints:\n    - {title: Peek, body: Use kubectl create job.}\n  misconceptions:\n"),
  );
  assert.ok(f.some((x) => x.level === "error" && x.path === "/spec/hints" && /exam task/.test(x.message)), JSON.stringify(f));
  const clean = await findingsAfter("xkd-job-completions", (s) => s.replace("estimatedMinutes: 5", "estimatedMinutes: 6"));
  assert.ok(!clean.some((x) => /no hints/.test(x.message)), JSON.stringify(clean));
});

// Rules merged from build/k8s-admin, build/k8s-dev, build/k8s-sec and build/linux-a.

test("exam task in a course is an error; an exam task needs no course", async () => {
  const packYaml = path.join("packs/kubernetes/pack.yaml");
  const clean = await findingsAfterFile(packYaml, (s) => s.replace("    title: Kubernetes administration essentials\n", "    title: Kubernetes administration essentials \n"));
  assert.ok(!clean.some((x) => /'xkd-job-completions' is not in any course/.test(x.message)), JSON.stringify(clean));
  const f = await findingsAfterFile(packYaml, (s) => s.replace("      - scale-berth-planner\n", "      - scale-berth-planner\n      - xkd-job-completions\n"));
  assert.ok(f.some((x) => x.level === "error" && /exam task 'xkd-job-completions' must not be in a course/.test(x.message)), JSON.stringify(f));
});

test("a lab tagged exam follows exam rules even outside the curriculum's exam list", async () => {
  const f = await findingsAfter("scale-berth-planner", (s) => s.replace(/\n  tags: \[/, "\n  tags: [exam, "));
  assert.ok(f.some((x) => x.level === "error" && x.path === "/spec/hints" && /exam task/.test(x.message)), JSON.stringify(f));
});

test("objectives of curriculum-declared frameworks (ct-platform) are accepted; unknown ones are not", async () => {
  const ok = await findingsAfter("scale-berth-planner", (s) => s.replace("frameworks: [cka:workloads-scheduling, ckad:deployment]", "frameworks: [cka:workloads-scheduling, ckad:deployment, ct-platform:containers-delivery]"));
  assert.ok(!ok.some((x) => x.level === "error" && /framework objective/.test(x.message)), JSON.stringify(ok));
  const bad = await findingsAfter("scale-berth-planner", (s) => s.replace("frameworks: [cka:workloads-scheduling, ckad:deployment]", "frameworks: [cka:workloads-scheduling, ct-platform:no-such-objective]"));
  assert.ok(bad.some((x) => x.level === "error" && x.path === "/metadata/frameworks" && /ct-platform:no-such-objective/.test(x.message)), JSON.stringify(bad));
});

test("pack labs may use curriculum newSkills; unknown skills are still errors", async () => {
  const ok = await findingsAfter("scale-berth-planner", (s) => s.replace("skills: [k8s.workloads.scaling]", "skills: [k8s.workloads.scaling, linux.shell.editors]"));
  assert.ok(!ok.some((x) => x.level === "error" && /unknown skill/.test(x.message)), JSON.stringify(ok));
  const bad = await findingsAfter("scale-berth-planner", (s) => s.replace("skills: [k8s.workloads.scaling]", "skills: [k8s.workloads.no-such-skill]"));
  assert.ok(bad.some((x) => x.level === "error" && /unknown skill 'k8s.workloads.no-such-skill'/.test(x.message)), JSON.stringify(bad));
});
