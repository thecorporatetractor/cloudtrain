import { loadConfig } from '../config.js';
import { loadSiteConfig } from '../site/config.js';
import { isLiveKey, isTestKey, StripeApi, StripeError } from './stripe.js';
import { syncPlans } from './sync.js';

/*
 * pnpm --filter @cloudtrain/gateway stripe:sync [--dry-run] [--site <file>]
 *
 * Creates or updates the Stripe Products and Prices for the plans in the site
 * configuration (CT_SITE_CONFIG, default content/site.yaml), by lookup key.
 * Needs STRIPE_SECRET_KEY (a test-mode key; live keys are refused) in the
 * environment, e.g. `set -a; . ~/.config/cloudtrain/stripe-test.env; set +a`.
 * The key is never printed.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const siteArg = args.indexOf('--site');
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (isLiveKey(key)) throw new Error('STRIPE_SECRET_KEY is a live key; only the test account may be synced');
  if (!isTestKey(key)) throw new Error('STRIPE_SECRET_KEY must be set to a test-mode key (sk_test_...)');
  if ((process.env.STRIPE_MODE ?? 'test') !== 'test') throw new Error('STRIPE_MODE must be test');
  const file = siteArg >= 0 ? args[siteArg + 1]! : loadConfig({ ...process.env, CT_DEV_IMPERSONATE: '0' }).siteConfigFile;
  const site = await loadSiteConfig(file);
  // The key itself is never printed, not even masked.
  console.log(`stripe:sync ${dryRun ? '(dry run) ' : ''}test-mode key from STRIPE_SECRET_KEY, site ${file}, plans ${site.plans?.items.map((p) => p.id).join(', ') ?? '(none)'}`);
  const actions = await syncPlans(new StripeApi(key), site, { dryRun, log: (l) => console.log(l) });
  const changed = actions.filter((a) => !a.action.endsWith('.ok') && a.action !== 'skip.free').length;
  console.log(`${actions.length} plan/price checks, ${changed} change(s)${dryRun ? ' would be made' : ''}`);
}

main().catch((e: unknown) => {
  // Fixed texts only: nothing read from the environment or from Stripe's answer is echoed.
  if (e instanceof StripeError) console.error('stripe:sync failed: Stripe refused a request (check the key, STRIPE_MODE and the plan configuration; the dashboard log has the details)');
  else if (e instanceof Error && /STRIPE_SECRET_KEY|STRIPE_MODE/.test(e.message)) console.error('stripe:sync refused: STRIPE_SECRET_KEY must be a test-mode key and STRIPE_MODE must be test');
  else if (e instanceof Error && /site config/.test(e.message)) console.error('stripe:sync failed: the site configuration is invalid (run lab-verify for details)');
  else console.error('stripe:sync failed');
  process.exit(1);
});
