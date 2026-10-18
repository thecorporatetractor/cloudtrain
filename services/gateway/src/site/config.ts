import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateSite, type Site } from '@cloudtrain/lab-schema';
import type { SiteConfig } from '@cloudtrain/api-types';

/**
 * Reads the public website configuration (content/site.yaml by default, or the
 * file CT_SITE_CONFIG names, e.g. a ConfigMap mount) and validates it against
 * the Site schema. An invalid file is a startup error: the website would render
 * with holes otherwise.
 */
export async function loadSiteConfig(file: string): Promise<SiteConfig> {
  let doc: unknown;
  try {
    doc = parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`site config ${file}: ${(e as Error).message}`);
  }
  const { valid, issues } = validateSite(doc);
  if (!valid) throw new Error(`site config ${file} is invalid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  // The generated schema type must stay assignable to the API contract (packages/api-types/public.d.ts).
  const site: SiteConfig = doc as Site;
  return site;
}
