// Checks content/site.yaml (the public website configuration). Shape comes from the
// Site JSON Schema in @cloudtrain/lab-schema; this file checks what the schema cannot:
// highlighted domains that have labs, internal links that point at website routes,
// screenshots that exist, and the alignment notice wherever frameworks could be named.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { validateSite } from "@cloudtrain/lab-schema";

/** Website routes an internal link may point at (apps/web/src/router.tsx, public section). */
export const SITE_ROUTES = ["/", "/catalog", "/pricing", "/about", "/faq", "/contact", "/legal/terms", "/legal/privacy", "/sign-in"];

/**
 * @param {string} file path of content/site.yaml
 * @param {{ domainsWithLabs: Set<string>, repoRoot: string }} ctx
 * @param {import("./verify.mjs").Finding[]} findings
 * @returns {Promise<{ brand: string, features: number, faq: number } | undefined>}
 */
export async function checkSite(file, ctx, findings) {
  if (!existsSync(file)) return undefined;
  const err = (p, message) => findings.push({ level: "error", file, path: p, message });
  const warn = (p, message) => findings.push({ level: "warn", file, path: p, message });
  let doc;
  try {
    doc = YAML.parse(await readFile(file, "utf8"), { prettyErrors: true });
  } catch (e) {
    err(undefined, `YAML parse error: ${e.message}`);
    return undefined;
  }
  const v = validateSite(doc);
  for (const i of v.issues) err(i.path, `schema: ${i.message}`);
  if (!v.valid) return undefined;

  for (const d of doc.highlightDomains) {
    if (!ctx.domainsWithLabs.has(d)) warn(`/highlightDomains/${d}`, `highlighted domain '${d}' has no published lab yet`);
  }

  const links = [
    ...(doc.hero.primaryCta ? [["/hero/primaryCta", doc.hero.primaryCta.to]] : []),
    ...(doc.hero.secondaryCta ? [["/hero/secondaryCta", doc.hero.secondaryCta.to]] : []),
    ...(doc.pricing?.contactCta ? [["/pricing/contactCta", doc.pricing.contactCta.to]] : []),
    ...doc.footer.columns.flatMap((c, ci) => c.links.map((l, li) => [`/footer/columns/${ci}/links/${li}`, l.to])),
    ...(doc.contact.links ?? []).map((l, li) => [`/contact/links/${li}`, l.to]),
  ];
  for (const [p, to] of links) {
    if (!to.startsWith("/")) continue;
    const route = to.split(/[?#]/)[0];
    if (!SITE_ROUTES.includes(route) && !route.startsWith("/catalog/")) err(p, `internal link '${to}' is not a website route (${SITE_ROUTES.join(", ")})`);
    if (route === "/pricing" && !doc.flags.showPricing) warn(p, "links to /pricing while flags.showPricing is off");
    if (route.startsWith("/catalog") && !doc.flags.showCatalog) warn(p, "links to the catalog while flags.showCatalog is off");
  }

  // Absolute image paths are served from apps/web/public; URLs are not checked.
  for (const [i, s] of (doc.screenshots ?? []).entries()) {
    if (s.image.startsWith("/") && !existsSync(path.join(ctx.repoRoot, "apps/web/public", s.image))) err(`/screenshots/${i}/image`, `screenshot '${s.image}' is not in apps/web/public`);
  }
  for (const [k, img] of Object.entries({ logo: doc.brand.logo, logoDark: doc.brand.logoDark, favicon: doc.brand.favicon })) {
    if (img && img.startsWith("/") && !existsSync(path.join(ctx.repoRoot, "apps/web/public", img))) err(`/brand/${k}`, `'${img}' is not in apps/web/public`);
  }

  if (!/not affiliated/i.test(doc.legal.alignmentNotice)) err("/legal/alignmentNotice", "the alignment notice must say the platform is not affiliated with the certifying bodies");
  for (const [k, legal] of Object.entries({ terms: doc.legal.terms, privacy: doc.legal.privacy })) {
    if (legal.placeholder && !legal.sections.some((s) => /placeholder|draft/i.test(s.title) || s.paragraphs.some((p) => /placeholder|draft/i.test(p)))) {
      warn(`/legal/${k}`, "a placeholder legal document should say so in its text");
    }
  }
  return { brand: doc.brand.name, features: doc.features.length, faq: doc.faq.length };
}
