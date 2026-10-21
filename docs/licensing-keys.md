# License keys and entitlements (operator guide)

CloudTrain is free to self-host, as long as you do not sell it as a service: every lab,
local accounts, teams, assignments, cohorts, exam simulations and the basic dashboards
work without a license, including for internal corporate training. That is the
**community edition**. A handful of **premium enterprise features** need a paid
subscription on the hosted service, or a **license key** on a self-hosted deployment.
The licence terms themselves are in `LICENSE` and `docs/licensing.md`; this page is about
how the software applies them.

## Editions and where features come from

| `CT_EDITION` | Premium features come from | Compute |
|---|---|---|
| `selfhosted` (default) | The license key, for the whole deployment. Without one: none (community edition) | Not metered or billed unless `CT_BILLING_ENABLED=1` |
| `hosted` | The plan: the organisation's plan for organisation features, the person's own plan (or their seat on the organisation plan) for personal ones. A license key is ignored | Metered and billed (`docs/billing.md`) |

One service answers every question about it: `Entitlements`
(`services/gateway/src/entitlements/service.ts`), with `has(feature, { orgId, userId })`,
`assert(...)` (refuses with 402) and the seat limit. The gateway enforces; the web app
reads `GET /api/me` → `entitlements` (edition, features, source, the plans that would
unlock a missing feature, and for admins a license notice) to show locks and upsells.

On a self-hosted deployment with billing explicitly enabled, plan features and license
features add up.

## The premium features

| Feature | Scope | What is gated | Always free |
|---|---|---|---|
| `sso` | organisation | Organisation identity providers: creating, changing and testing SSO connections; signing in through an organisation's IdP; SSO enforcement | Local accounts (password, MFA, passkeys) always work; platform operators can always sign in through a platform IdP (`CT_PLATFORM_IDPS`) to fix the license |
| `scim` | organisation | Reserved: SCIM 2.0 provisioning is not built yet | |
| `audit_export` | organisation | The CSV export of the audit log | Browsing and filtering the audit log |
| `advanced_analytics` | organisation | See "Basic and advanced analytics" | |
| `exam_certificates` | person | Reserved: certificates for passed exam simulations are not built yet | Exam simulations and their reports |
| `custom_branding` | organisation | The organisation logo and accent colour in the app | |
| `multi_org` | deployment | Creating a second (and further) organisation on a self-hosted deployment. Always on for the hosted operator | Existing organisations keep working |

The gating itself (which routes refuse, which UI locks) is described in
`docs/billing.md`, "Premium features". A missing feature answers

```
HTTP 402  { "error": "...", "code": "feature_required",
            "details": { "feature": "sso", "featureName": "Single sign-on", "edition": "selfhosted",
                         "reason": "no_license" | "license_expired" | "license_invalid" | "not_in_plan",
                         "action": "license" | "upgrade" | "contact_admin",
                         "href": "/platform/license", "plans": [{ "id": "team", "name": "Team" }] } }
```

and a missing permission stays `403 forbidden` as before: permissions say *who* may do
something, entitlements say whether the deployment or plan includes it at all.

## License keys

A license is a JWS (compact serialization) signed with **Ed25519**:

```
base64url({"alg":"EdDSA","typ":"ct-license+jws","kid":"ct-2026-10"}) . base64url(claims) . base64url(signature)
```

| Claim | |
|---|---|
| `v` | Format version, `1` |
| `licenseId` | Unique id, e.g. `lic_20261021_8f3a2c91d0` |
| `licensee` | `{ name, email? }`, shown on `/platform/license` |
| `edition` | Commercial label, e.g. `enterprise` |
| `features` | Premium features granted. Names this gateway does not know are kept and ignored, so a newer license works on an older gateway |
| `seats` | Active members covered; `0` = unlimited |
| `issuedAt`, `notBefore`, `expiresAt` | ISO 8601 instants |

The license file wraps the token in readable comment lines (`# Licensee: ...`); the
gateway ignores those lines and the line breaks, so the file can be pasted or mounted as
is. Any JOSE library can verify a license with the public key.

**No phoning home.** The gateway verifies the signature against public keys built into
it, evaluates the dates against its own clock and counts seats in its own database. It
never contacts CloudTrain or anyone else about the license.

### Installing

Pick one; the first that is set wins:

| Source | |
|---|---|
| `CT_LICENSE_KEY` | The token or the whole file in the environment. The Helm chart sets it from a Secret: `gateway.license.existingSecret` (key `gateway.license.key`, default `license`): `kubectl create secret generic cloudtrain-license --from-file=license=license.txt` |
| `CT_LICENSE_FILE` | A path to the file (relative paths resolve against `CT_BASE_DIR`) |
| `/platform/license` | A platform admin pastes or uploads the file. It is verified before it is stored (table `platform_licenses`, platform scope only); the previous one is kept as history (`removed_at`, `removed_by`). Every gateway replica re-reads it within 5 minutes |

While the environment sets a license, the page shows it and refuses uploads (409): the
environment always wins. An upload is refused when it is malformed, tampered with, signed
by an unknown or retired key, or already past its grace period (422 with the reason).

`/platform/license` shows the state, the licensee, validity, grace period, the seats in
use, each premium feature on or off, and the accepted signing keys. The CLI shows the same
for a file: `pnpm --filter @cloudtrain/gateway license:inspect license.txt`.

### Expiry, grace and what switches off

```
notBefore ........ expiresAt - 30 days ........ expiresAt ........ expiresAt + 14 days ........
not_yet_valid | valid              | expiring           | grace               | expired
```

- **30 days before expiry** platform and org admins see a banner in the app (and the
  license page warns).
- **At expiry** a 14-day grace period starts: every feature keeps working, the banner says
  until when.
- **After the grace period** the premium features switch off. Nothing is deleted: SSO
  connections, saved branding, audit history and organisations stay where they are and come
  back the moment a renewed license is installed. Sign-in with a local account always works,
  and so does a platform operator's sign-in through a platform IdP, so the operator can
  always install the renewal.
- Before `notBefore` (5 minutes of clock skew tolerated) the license grants nothing yet.

The state is evaluated against the clock on every request, so none of this needs a restart.

### Seats

`seats` counts the distinct active members of active organisations on the deployment.
It is enforced softly: past the limit the license page and the admin banner warn, and
adding people (invitations, reactivating a member) is refused with
`402 seats_exceeded` (`details: { licensed, used, href }`) until members are deactivated or
the license is extended. Nobody already active is affected and sign-in is never refused;
members who arrive through SSO just-in-time provisioning are counted, not blocked.

## Issuing licenses

The private signing key lives only on the issuer's machine (default
`~/.config/cloudtrain/license-signing.key`, mode 600) and is never committed, copied to a
server, printed or pasted anywhere. The repository holds only public keys
(`services/gateway/src/license/keys.ts`).

```bash
# Once per signing key: writes the private key (mode 600) and prints only the public key
pnpm --filter @cloudtrain/gateway license:keygen [--kid ct-2026-10] [--out FILE]

# A license (to stdout, or --out FILE)
pnpm --filter @cloudtrain/gateway license:issue \
  --key ~/.config/cloudtrain/license-signing.key \
  --licensee "Quillmoor Logistics Ltd" --email it@quillmoor.example \
  --features all            # or sso,audit_export,advanced_analytics,custom_branding,multi_org
  --seats 250               # 0 = unlimited
  --days 365                # or --expires 2027-10-31 [--not-before 2026-11-01]
  --out quillmoor.license

# Check a file against the embedded keys
pnpm --filter @cloudtrain/gateway license:inspect quillmoor.license
```

`license:issue` refuses a key whose id is not in `keys.ts`, a key file that does not match
the public key of that id, and a retired key, so it cannot produce a license gateways would
refuse. It warns when the key file is readable by others.

### Rotating the signing key

1. `license:keygen --kid ct-2027-10 --out ~/.config/cloudtrain/license-signing-2027.key`.
2. Add the printed public key to `ACCEPTED_KEYS` in `services/gateway/src/license/keys.ts`
   and ship a release. Keep the old entry: licenses it signed stay valid until they expire.
3. Issue new licenses and renewals with the new key.
4. Retiring the old key: set `retiredAt` on its entry. Licenses it signed before that
   instant keep working; anything it signs later is refused. If a key leaks, set
   `retiredAt` to just before the leak, ship a release and re-issue the affected licenses
   with the new key. Removing an entry invalidates every license it signed.

Gateways accept every listed key at once, so customers can upgrade before or after
receiving a license signed with the new key.

## Development

The local stack seeds several organisations with SSO (Quillmoor with local accounts,
Acme Freight through the `acme-idp` realm, AzarGuard through Entra) and the platform
views. `task dev:gateway` sets `CT_DEV_LICENSE=1`: at startup the gateway generates a key
pair that exists only in that process, signs a development license with every premium
feature (licensee "Local development (CT_DEV_LICENSE)", unlimited seats, one year) and
accepts that key only in that process. Nothing is written to disk, the token is useless to
any other process, and `/platform/license` shows it as a development license.

- `CT_DEV_LICENSE=1` is refused with `NODE_ENV=production` and when `CT_PUBLIC_URL` or
  `CT_WEB_URL` is not on localhost/127.0.0.1 (like `CT_DEV_IMPERSONATE`); the license
  manager refuses it in production a second time on its own.
- `CT_DEV_LICENSE=0 task dev:gateway` runs the community edition: SSO logins for Acme
  Freight and AzarGuard are then refused (except platform operators through a platform IdP),
  local logins work.
- A real `CT_LICENSE_KEY`/`CT_LICENSE_FILE` wins over the development license.
- Mock mode (`task dev:web:mock`) plays a licensed self-hosted deployment; the
  `ct.mock.license` localStorage key switches it to `community`, `expiring`, `grace` or
  `expired`.
- Tests sign with ephemeral key pairs generated per run (`test/license.test.ts`,
  `test/license-pg.test.ts`); the real signing key never takes part.

## Configuration summary

| Variable | Default | |
|---|---|---|
| `CT_EDITION` | `selfhosted` | `hosted` or `selfhosted`; anything else refuses to start. Hosted without `CT_BILLING_ENABLED=1` logs a warning (no plan can be bought, so no premium features) |
| `CT_LICENSE_KEY` | | The license token or file content |
| `CT_LICENSE_FILE` | | Path to the license file |
| `CT_DEV_LICENSE` | `1` in `task dev:gateway`, else off | Development only, see above |
| `CT_BILLING_ENABLED` | off | Billing and compute metering (`docs/billing.md`); off on self-hosted unless set |

Helm: `gateway.edition`, `gateway.license.existingSecret`, `gateway.license.key`.

## Code

`services/gateway/src/license/` (`token.ts` format, signing and verification, `state.ts`
expiry rules, `manager.ts` sources and status, `keys.ts` accepted public keys, `routes.ts`
`GET/PUT/DELETE /api/platform/license`, `cli.ts` keygen, issue, inspect),
`src/entitlements/` (`features.ts` the catalog, `service.ts`), migration
`0010_license.ts`. Web: `apps/web/src/routes/platform/License.tsx`,
`src/components/license.tsx` (`LicenseBanner`, `FeatureLock`), `src/lib/entitlements.ts`.
