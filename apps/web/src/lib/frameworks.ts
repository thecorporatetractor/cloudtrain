import type { Framework } from '@/api/types';

/*
 * Framework lists for pickers. Groups and their order come from the API
 * (Framework.group, list ordered by group); nothing here knows framework ids.
 */

export interface FrameworkGroup {
  group: string;
  frameworks: Framework[];
}

/** Groups in the order they first appear in the list. */
export function groupFrameworks(frameworks: readonly Framework[]): FrameworkGroup[] {
  const out: FrameworkGroup[] = [];
  for (const f of frameworks) {
    let g = out.find((x) => x.group === f.group);
    if (!g) out.push((g = { group: f.group, frameworks: [] }));
    g.frameworks.push(f);
  }
  return out;
}

/** Text a framework is found by: short and full name, certifying body, group and id. */
export function frameworkSearchText(f: Framework): string {
  return `${f.name} ${f.fullName} ${f.vendor} ${f.group} ${f.id}`.toLowerCase();
}

/** Every whitespace-separated term of the query occurs in the framework's search text. */
export function matchesFramework(f: Framework, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = frameworkSearchText(f);
  return terms.every((t) => text.includes(t));
}

/** Below this share of objectives with labs, pickers mark a framework "coverage in progress". */
export const COVERAGE_IN_PROGRESS = 0.5;

export function coverageInProgress(f: Pick<Framework, 'coverage'>): boolean {
  return f.coverage < COVERAGE_IN_PROGRESS;
}
