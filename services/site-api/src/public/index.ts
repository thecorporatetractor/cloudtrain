import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import type { SiteWaitlist } from '@cloudtrain/api-types';
import { postPrivacyConfirm, postPrivacyRequest, postWaitlist, type ApiResponse, type ConsentEvidence, type PublicDeps } from './handlers.js';
import { publicDeps } from './wiring.js';

/*
 * The public Function app. Authentication is the platform's (Entra auth and an IP restriction);
 * handlers.ts checks the caller again and fails closed. `authLevel: 'anonymous'` only means no
 * function key: a request without an Entra token never reaches this code.
 */

/** `waitlist` of content/site.yaml, put into the bundle by scripts/package.mjs. */
declare const __WAITLIST_CONFIG__: SiteWaitlist | null;
const waitlist: SiteWaitlist | null = typeof __WAITLIST_CONFIG__ !== 'undefined' ? __WAITLIST_CONFIG__ : null;
/** The consent wording's hash and the notice's date, from the same file. */
declare const __CONSENT_EVIDENCE__: ConsentEvidence | null;
const consent: ConsentEvidence | null = typeof __CONSENT_EVIDENCE__ !== 'undefined' ? __CONSENT_EVIDENCE__ : null;

let deps: PublicDeps | undefined;

const toInit = (r: ApiResponse): HttpResponseInit => ({ status: r.status, jsonBody: r.body, ...(r.headers ? { headers: r.headers } : {}) });

function route(name: string, path: string, handler: (req: HttpRequest, d: PublicDeps) => Promise<ApiResponse>) {
  app.http(name, {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: path,
    handler: async (req: HttpRequest, c: InvocationContext) => {
      try {
        deps ??= publicDeps(process.env, waitlist, consent, { info: (o, m) => c.log(m, JSON.stringify(o)), warn: (o, m) => c.warn(m, JSON.stringify(o)) });
      } catch (e) {
        // Fails closed on missing settings. The message names a setting, never a value.
        c.error(e instanceof Error ? e.message : 'configuration failed');
        return toInit({ status: 503, body: { error: 'Not available right now', code: 'upstream' }, headers: { 'cache-control': 'no-store' } });
      }
      return toInit(await handler(req, deps));
    },
  });
}

route('waitlist', 'public/waitlist', postWaitlist);
route('privacyRequests', 'public/privacy/requests', postPrivacyRequest);
route('privacyConfirm', 'public/privacy/confirm', postPrivacyConfirm);
