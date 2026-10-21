import type { SiteConfig, SiteLaunchMode } from '@/api/types';
import { isRealApi } from '@/api/mode';

/*
 * Launch mode of the public website (content/site.yaml `launch.mode`).
 *
 * `coming-soon` replaces every website page except the legal ones with one
 * standalone landing (src/site/ComingSoon.tsx) and hides sign-in, checkout and
 * links into the platform; `live` is the full website. Without a `launch`
 * block the site is live.
 *
 * Overrides, strongest first:
 * - VITE_LAUNCH_MODE at build time (build-site.mjs --launch, or a dev server);
 * - in mock mode only, localStorage `ct.site.launch` (the screenshot scripts take
 *   both modes from one dev server).
 */

const valid = (v: unknown): v is SiteLaunchMode => v === 'coming-soon' || v === 'live';

function override(): SiteLaunchMode | undefined {
  const env = import.meta.env.VITE_LAUNCH_MODE as string | undefined;
  if (valid(env)) return env;
  if (isRealApi) return undefined;
  try {
    const v = localStorage.getItem('ct.site.launch');
    return valid(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function launchMode(site: SiteConfig | undefined): SiteLaunchMode {
  return override() ?? site?.launch?.mode ?? 'live';
}

export const isComingSoon = (site: SiteConfig | undefined) => launchMode(site) === 'coming-soon';

/** Website paths that keep their own page in coming-soon mode; every other one shows the coming-soon landing. */
const KEPT = ['/legal'];
export const keepsOwnPage = (pathname: string) => KEPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** The mode is known: from an override, or once the configuration has loaded (until then neither chrome is drawn). */
export const launchKnown = (site: SiteConfig | undefined) => !!site || override() !== undefined;
