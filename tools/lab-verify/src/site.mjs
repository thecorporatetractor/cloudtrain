// Checks content/site.yaml (the public website configuration). Shape comes from the
// Site JSON Schema in @cloudtrain/lab-schema; this file checks what the schema cannot:
// highlighted domains that have labs, internal links that point at website routes,
// screenshots (hero preview, differentiators, showcase) that exist, and the alignment
// notice wherever frameworks could be named.
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
    ...(doc.closing?.primaryCta ? [["/closing/primaryCta", doc.closing.primaryCta.to]] : []),
    ...(doc.closing?.secondaryCta ? [["/closing/secondaryCta", doc.closing.secondaryCta.to]] : []),
    ...(doc.audiences ?? []).map((a, ai) => [`/audiences/${ai}/cta`, a.cta.to]),
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
  const figures = [
    ...(doc.hero.preview ? [["/hero/preview", doc.hero.preview]] : []),
    ...(doc.differentiators ?? []).flatMap((d, i) => (d.figure ? [[`/differentiators/${i}/figure`, d.figure]] : [])),
    ...(doc.showcase ?? []).map((s, i) => [`/showcase/${i}/figure`, s.figure]),
  ];
  for (const [p, f] of figures) {
    for (const k of ["image", "imageLight"]) {
      const img = f[k];
      if (img && img.startsWith("/") && !existsSync(path.join(ctx.repoRoot, "apps/web/public", img))) err(`${p}/${k}`, `screenshot '${img}' is not in apps/web/public`);
    }
  }
  if ((doc.faq ?? []).filter((f) => f.featured).length > 6) warn("/faq", "more than six featured questions; the landing page shows the first six");
  for (const [k, img] of Object.entries({ logo: doc.brand.logo, logoDark: doc.brand.logoDark, favicon: doc.brand.favicon })) {
    if (img && img.startsWith("/") && !existsSync(path.join(ctx.repoRoot, "apps/web/public", img))) err(`/brand/${k}`, `'${img}' is not in apps/web/public`);
  }

  // Plans: unique ids and lookup keys, one highlighted card at most, free means no price.
  const plans = doc.plans?.items ?? [];
  const planIds = new Set();
  const lookupKeys = new Map();
  for (const [i, pl] of plans.entries()) {
    if (planIds.has(pl.id)) err(`/plans/items/${i}/id`, `duplicate plan id '${pl.id}'`);
    planIds.add(pl.id);
    for (const [interval, price] of Object.entries(pl.prices ?? {})) {
      const seen = lookupKeys.get(price.lookupKey);
      if (seen) err(`/plans/items/${i}/prices/${interval}/lookupKey`, `lookup key '${price.lookupKey}' is also used by ${seen}`);
      lookupKeys.set(price.lookupKey, `${pl.id}/${interval}`);
    }
    if (pl.kind === "free" && pl.prices) err(`/plans/items/${i}/prices`, "a free plan has no prices");
    if (pl.kind !== "free" && !pl.prices?.monthly && !pl.prices?.yearly) err(`/plans/items/${i}/prices`, "a paid plan needs a monthly or yearly price");
    if (pl.perSeat && pl.kind !== "organisation") err(`/plans/items/${i}/perSeat`, "per-seat pricing is for organisation plans");
    if (pl.minSeats && pl.maxSeats && pl.minSeats > pl.maxSeats) err(`/plans/items/${i}/minSeats`, "minSeats is above maxSeats");
    if (pl.cta.action === "checkout" && pl.kind === "free") err(`/plans/items/${i}/cta`, "a free plan cannot check out");
    if ((pl.placeholderPrices || doc.plans?.placeholder) && !doc.pricing?.placeholderNote) warn(`/plans/items/${i}`, "placeholder prices need pricing.placeholderNote so the page says so");
  }
  if (plans.filter((pl) => pl.highlight).length > 1) warn("/plans/items", "more than one highlighted plan");
  if (doc.flags.showPricing && plans.length === 0) warn("/flags/showPricing", "pricing is shown but no plans are configured");

  if (!/not affiliated/i.test(doc.legal.alignmentNotice)) err("/legal/alignmentNotice", "the alignment notice must say the platform is not affiliated with the certifying bodies");
  for (const [k, legal] of Object.entries({ terms: doc.legal.terms, privacy: doc.legal.privacy })) {
    if (legal.placeholder && !legal.sections.some((s) => /placeholder|draft/i.test(s.title) || s.paragraphs.some((p) => /placeholder|draft/i.test(p)))) {
      warn(`/legal/${k}`, "a placeholder legal document should say so in its text");
    }
  }
  return { brand: doc.brand.name, features: doc.features.length, faq: doc.faq.length, plans: plans.length };
}
