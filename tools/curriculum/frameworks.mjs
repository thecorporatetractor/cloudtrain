// Generates content/frameworks/<id>.yaml for every framework declared in content/curriculum.yaml
// `frameworks`, so the gateway (Skills, readiness, assignments) serves them like the hand-written
// framework files. Each objective maps to the union of the skills of the curriculum labs that
// reference `<framework>:<objective>`. Used by tools/curriculum/render.mjs (write and --check).

/** Marks a generated file; tools/lab-verify validates the curriculum entry instead of the file. */
export const GENERATED_FROM = "content/curriculum.yaml";

const DOMAINS = ["kubernetes", "linux", "containers", "iac", "automation", "networking"];

/** Domain of most labs referencing the framework (more than half), else cross-domain. */
export function majorityDomain(labs) {
  const n = new Map();
  for (const l of labs) n.set(l.domain, (n.get(l.domain) ?? 0) + 1);
  const [top, count] = [...n.entries()].sort((a, b) => b[1] - a[1] || DOMAINS.indexOf(a[0]) - DOMAINS.indexOf(b[0]))[0] ?? [];
  return top && count * 2 > labs.length ? top : "cross-domain";
}

/** Short name: explicit shortName, else an acronym in parentheses in the title, else the id. */
export function shortNameOf(f) {
  if (f.shortName) return f.shortName;
  const acronym = /\(([A-Z][A-Z0-9+-]{1,11})\)/.exec(f.title ?? "")?.[1];
  return acronym ?? f.id;
}

/** Alignment disclaimer in the pattern paths and exams use; none for CloudTrain's own frameworks. */
export function disclaimerOf(f) {
  if (!f.body || f.body === "CloudTrain") return undefined;
  return `CloudTrain is not affiliated with or endorsed by ${f.body.replace(/\.$/, "")}. Certification and exam names are trademarks of their respective owners. This framework maps CloudTrain skills to objectives aligned to that exam; readiness shown here confers no certification.`;
}

/**
 * @param {any} doc parsed content/curriculum.yaml
 * @param {any} YAML the yaml module
 * @returns {Map<string, string>} file name -> file text
 */
export function renderFrameworks(doc, YAML) {
  const out = new Map();
  const labs = doc.labs ?? [];
  for (const f of doc.frameworks ?? []) {
    const refs = (l) => (l.frameworks ?? []).filter((r) => r.startsWith(`${f.id}:`));
    const tagged = labs.filter((l) => refs(l).length);
    const domain = f.domain ?? majorityDomain(tagged);
    const disclaimer = disclaimerOf(f);
    const body = {
      apiVersion: "cloudtrain.dev/v1",
      kind: "Framework",
      id: f.id,
      generatedFrom: GENERATED_FROM,
      title: f.title,
      shortName: shortNameOf(f),
      issuer: f.body ?? "",
      domain,
      ...(f.version ? { curriculumVersion: String(f.version) } : {}),
      ...(f.weightsSource ? { weightsSource: f.weightsSource } : {}),
      ...(disclaimer ? { disclaimer } : {}),
      objectives: f.objectives.map((o) => {
        const ref = `${f.id}:${o.id}`;
        const skills = [...new Set(tagged.filter((l) => l.frameworks.includes(ref)).flatMap((l) => l.skills ?? []))].sort();
        return { id: o.id, title: o.title, ...(o.weight !== undefined ? { weight: o.weight } : {}), skills };
      }),
    };
    const head = [
      `# GENERATED from content/curriculum.yaml (frameworks/${f.id}) by tools/curriculum/render.mjs. Do not edit by hand:`,
      "# change the curriculum entry and re-run the script. Objective titles are CloudTrain paraphrases of the",
      "# public objective themes; alignment to the external exam lives only in this mapping and its disclaimer.",
      "# Each objective's `skills` is the union of the skills of the curriculum labs that reference it",
      `# (\`${f.id}:<objective>\`), built or not; the gateway shows only skills in the loaded skill graph.`,
    ].join("\n");
    out.set(`${f.id}.yaml`, `${head}\n${YAML.stringify(body, { lineWidth: 0 })}`);
  }
  return out;
}
