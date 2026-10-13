// Anonymization denylist: identifiers from external question banks and earlier
// prototypes that must never appear in CloudTrain content. Each entry is a regex
// (case-insensitive) plus a reason. Generic tokens that are legitimate in other
// roles (e.g. `k8s.` skill ids, the word "internal" in prose) are matched only in
// the role that would leak them (context name, namespace).
//
// This file lives outside content/ on purpose so the scan never flags itself.

const ctx = (name) => [
  // kubectl config use-context NAME / --context NAME / --context=NAME
  new RegExp(String.raw`(use-context|--context[= ])\s*${name}(?![\w.-])`, "i"),
  // YAML: context: NAME, query.cluster: NAME
  new RegExp(String.raw`\b(context|cluster)\s*:\s*["']?${name}["']?\s*(?:[,}#]|$)`, "im"),
];

const ns = (name) => [
  new RegExp(String.raw`(?:^|\s)(-n|--namespace[= ])\s*${name}(?![\w.-])`, "i"),
  new RegExp(String.raw`\bnamespace\s*:\s*["']?${name}["']?\s*(?:[,}#]|$)`, "im"),
  new RegExp(String.raw`\bnamespaces?/${name}(?![\w.-])`, "i"),
];

const word = (s) => new RegExp(String.raw`(?<![\w-])${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\w-])`, "i");
const anywhere = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "i");

/** @type {{ id: string, reason: string, patterns: RegExp[] }[]} */
export const DENYLIST = [
  ...["k8s", "hk8s", "mk8s", "ek8s"].map((c) => ({ id: `context:${c}`, reason: "original context name", patterns: ctx(c) })),
  ...["hk8s", "mk8s", "ek8s"].map((c) => ({ id: c, reason: "original cluster/context token", patterns: [word(c)] })),
  ...["ek8s-node-0", "mk8s-master-0", "k8s-master-0", "k8s-node-"].map((s) => ({ id: s, reason: "original node name", patterns: [anywhere(s)] })),
  { id: "namespace:internal", reason: "original namespace", patterns: ns("internal") },
  ...[
    "app-team1",
    "cicd-token",
    "deployment-clusterrole",
    "fubar",
    "allow-port-from-namespace",
    "front-end",
    "front-end-svc",
    "presentation",
    "nginx-kusc00401",
    "kusc00401",
    "kusc00402",
    "kucc8",
    "kuin00601",
    "app-data",
    "big-corp-app",
    "overloaded-cpu",
    "kubekosh",
  ].map((s) => ({ id: s, reason: "original resource/file identifier", patterns: [word(s)] })),
  ...["/srv/app-data", "/var/lib/backup/etcd-snapshot", "/opt/KUSC", "/opt/KUIN"].map((s) => ({
    id: s,
    reason: "original file path",
    patterns: [anywhere(s)],
  })),
  {
    id: "disk=ssd",
    reason: "original node label",
    patterns: [/\bdisk\s*[=:]\s*["']?ssd\b/i],
  },
];

/**
 * Scans one file's text. Returns hits with 1-based line numbers.
 * @param {string} text
 */
export function scanText(text) {
  const hits = [];
  const lines = text.split("\n");
  for (const entry of DENYLIST) {
    for (const re of entry.patterns) {
      lines.forEach((line, i) => {
        if (re.test(line)) hits.push({ id: entry.id, reason: entry.reason, line: i + 1, text: line.trim() });
      });
    }
  }
  // de-duplicate (several patterns of one entry can hit the same line)
  const seen = new Set();
  return hits.filter((h) => {
    const k = `${h.id}|${h.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
