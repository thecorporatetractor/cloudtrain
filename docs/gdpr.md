# GDPR data-subject rights and provable erasure

How CloudTrain answers access, erasure, withdrawal and restriction requests, and how to
prove afterwards that it did. Items marked **counsel** or **owner** are proposals that
someone has to confirm; this document is not legal advice.

CloudTrain has no SOC 2 audit and this document claims none. The most that may be said is
that these controls were designed against the Trust Services Criteria.

Code: `services/gateway/src/gdpr`. Page: `apps/web/src/site/PrivacyRequest.tsx`,
`apps/web/src/routes/AccountPrivacy.tsx`.

**The production website has no Postgres.** It runs Cloudflare, a small VM and a Function
app over Azure Tables (`services/site-api`, `services/site-proxy`). Those Functions implement
the same two public routes and the same ledger format below. What this document says about
the gateway applies to the platform and to self-hosters; the Function app has its own
storage and its own evidence wiring.

The public privacy notice describes the website only. `docs/gdpr-platform-launch.md` holds the
wording to add back before sign-in, labs or billing go live; it is a launch gate.

## Who can ask for what

| Request | Who | Route | What happens |
|---|---|---|---|
| Erase my waitlist entry | Anyone, by mailbox | `POST /api/public/privacy/requests` then `/confirm` | Deletes the entry. If the address has no account, also anonymises its traces in the audit log (a refused login). Ledger type `erasure`, scope `waitlist` |
| Withdraw consent | Anyone, by mailbox | Same | Consent is the waitlist's only basis, so the entry is deleted. Ledger type `withdrawal`, scope `waitlist` |
| Copy of my data | Anyone, by mailbox | Same | Shows the waitlist entry to the holder of the mailbox. Ledger type `export` |
| Download my data | Signed in | `POST /api/me/privacy/export` | JSON of everything under the data map's Export column. Ledger first: no record, no download |
| Withdraw consent | Signed in | `POST /api/me/privacy/withdraw` | As above. Nothing else in an account rests on consent today |
| Delete my account | Signed in | `POST /api/me/privacy/delete` | Everything below. Needs the address typed. Refused while a blocker holds |
| Close my account | Signed in | `POST /api/me/privacy/close` | Access ends now; deletion follows after 90 days. See Closure |
| Restrict processing (Art. 18) | Signed in | `PUT`, `DELETE /api/me/privacy/restriction` | See below. Ledger type `restriction` |
| Correct my details (Art. 16) | Signed in | Link on the page | See below |
| Object to processing (Art. 21) | Signed in | `POST /api/me/privacy/objection` | Raises it with a person. See below. Ledger type `objection` |
| Erase on someone's behalf | Platform admin | `POST /api/platform/privacy/erase` | For someone with no active membership, such as a deactivated user who wrote in. Ledger `actor: admin` |

A person whose membership is deactivated cannot sign in, so they write to `gdpr@` and a platform
admin acts at `/platform/privacy`.

**Recent sign-in.** Download, deletion and closure, and an admin's erasure, need a real sign-in in
the last 15 minutes (`CT_GDPR_RECENT_SIGNIN_MINUTES`), or they answer `403 reauth_required`. The session's
start is not proof, because a live Keycloak session starts a gateway session with no password, so
the session keeps the ID token's `auth_time`; no `auth_time` counts as not recent. "Sign in again" goes
through `/api/auth/login?reauth=1`, which sends `prompt=login`. **Limit**: for an SSO user Keycloak's
re-authentication may be satisfied by their company's identity provider, depending on how
that broker passes the prompt on. Not tested against a real Keycloak.

### Restriction (Art. 18): what it actually does

Self-service and immediate at `/account/privacy`, and the person can lift it. The app:

- ends running labs, and refuses new labs and exams (`409`). It waits for a running exam to finish;
- leaves the person out of team dashboards, member detail and progress CSV exports;
- pauses automatic inactivity deletion, since restriction means keep the data;
- keeps all the data, and mails `gdpr@` so a person can check what the app cannot see.

**What it does not do:** the org's user list still shows the account exists. Cohort boards, assignment
status views, exam results for managers and CTF scoreboards still show existing data: those reads are
not filtered. The audit log keeps recording, including sign-ins, which is needed to show who did what. Stripe,
Keycloak and backups are not told. Sign-in itself stays open, because the person
needs it to lift the restriction. **counsel**: whether this is enough, or whether those reads must be filtered too.

### Rectification (Art. 16)

Users cannot edit their name or address in CloudTrain. They come from the identity provider and
are overwritten at every sign-in (`provision`), so editing them here would not last. The page says so:

- A local account gets a link to Keycloak's account console, `<issuer>/account/`. That console must be enabled
  in the realm and the user must hold `manage-account`; the dev realm has not been checked against a real Keycloak.
- An SSO account is told that only their organisation can change them.

A change reaches CloudTrain at the next sign-in. It does not rewrite old audit rows or the Stripe customer. Job title
is set by org admins. Anything else goes to `gdpr@`.

### Objection (Art. 21)

An objection needs a person to weigh it, so the app raises it and changes nothing by itself. It mails
`gdpr@` (`CT_GDPR_CONTACT`) with the person's address and free-text reason, then writes a ledger record with the category
only, and confirms to the person. If the mail fails the request fails, as nobody would ever see it. The categories
are the security log, progress reporting, terminal observation, and other. **Owner: `gdpr@cloudtrain.app` must exist**; see `docs/email.md`.
The ledger shows it was raised, not how it was answered.

### Closure

`POST /api/me/privacy/close` ends access at once: memberships deactivated, sessions revoked, labs ended, Keycloak user
disabled. A closed account cannot sign in even with a live Keycloak session (`provision` and `loadPrincipal` refuse it).
Deletion follows the same steps as above after `CT_RETENTION_CLOSED_DAYS` (default 90), with a ledger record `reason: closure-period-ended`. Until
then a platform admin can reopen it, which restores the memberships closure took. The person cannot reopen
it themselves or download their data once it is closed, and the page says so first.

### The public contract

```
POST /api/public/privacy/requests  { email, type: erasure|withdrawal|export, website }
  202 { status: 'accepted', message }      the same bytes for every address; also for the honeypot
  422 { code: 'invalid', details: { fields } }
  429 { code: 'rate_limited', details: { retryAfterSeconds } }
POST /api/public/privacy/confirm   { token }
  200 { status: 'completed', type, removed, data? }
  202 { status: 'pending', type }          not finished: never shown as done
  410                                      invalid, expired or used: one body for all three
  503                                      nothing can be recorded right now
```

The mail links to `<web>/legal/privacy-request#token=...`. The token is in the fragment, so it
reaches no access log and no referrer. Opening the link does nothing: mail scanners
fetch links, so the page acts only when the visitor presses Confirm. Only the token's SHA-256 is
stored, and the address is sealed (AES-256-GCM under `CT_SESSION_SECRET`) until the request
finishes or the link expires (24 hours by default, `CT_GDPR_LINK_TTL_MINUTES`).

Enumeration: known and unknown addresses get the same response, and the mail goes in the
background so its timing says nothing. Every address gets a mail, limited to three an hour
per address beyond which requests are silently dropped, plus a per-client limit
(`CT_PRIVACY_RATE_PER_HOUR`, default 10). Only the holder of the mailbox learns whether
anything was held.

### Deleting an account

The request and its checks are one transaction under one lock, so two admins deleting
themselves at once cannot both pass "another admin remains". From that point the person's
memberships are deactivated and their sessions revoked. Then, each step idempotent, with
progress committed after each one:

1. **Cluster**: deletes their LabSessions and ExamSessions; closes metered usage.
2. **Keycloak**: ends sessions, deletes the user. It goes before the database so a live
   Keycloak session cannot recreate the row at the next login.
3. **Billing**: flushes the meter outbox, waits for anything still on its way, deletes the
   Stripe customer. A customer already gone (404) is not an error.
4. **Waitlist**: through the `WaitlistStore` interface.
5. **Data**: one transaction deleting and anonymising per the data map, then checking that
   nothing is left, then recording the step.
6. **Ledger**: appends the evidence.

The response says `completed` only after step 6. Any failure answers `202 pending`. The sweep
(`CT_GDPR_SWEEP_MS`, default 60 s) resumes where it stopped, and mails the person when done.

**Blocked, with a message and no change:**

| Code | Why |
|---|---|
| `sole_org_admin` | Would leave an org with no administrator. Applies to a sole-member org too: promote someone or ask us to close it |
| `last_platform_admin` | No operator would remain |
| `subscription` | A running plan under the person's own name. Cancel it first; deletable once it has ended |
| `open_balance` | A failed invoice or dunning state |
| `unbilled_usage` | Personally paid compute not yet invoiced, or a personally paid lab still running. Deleting the Stripe customer would cancel the metered subscription and lose that invoice |
| `billing_unavailable`, `identity_unavailable` | The deployment cannot complete the erasure (no Stripe client, no Keycloak admin). Refused up front rather than half done |
| `impersonated` | A support or dev session may not act in someone's name |

Lab sessions paid by an org, or on a trial, are simply ended.

## Data map

"Export" names the section of the download. `postgres.*` rows are counted into the ledger per table.
A test (`test/gdpr-pg.test.ts`) compares `PERSONAL_COLUMNS` in `src/gdpr/erase.ts` with the live
schema and fails when a personal column is not mapped, and scans every table as text
after an erasure for the id, address and name.

| Table or system | Personal fields | On erasure | Export |
|---|---|---|---|
| `users` | id, email, name, title, avatar_url, last_login_at, last_idp | Delete | `profile` |
| `memberships` | user_id, invited_by | Delete; `invited_by` of others set null | `memberships` |
| `invitations` | email, user_id, invited_by | Delete, by id and by address | `invitations` |
| `team_members`, `cohort_members` | user_id | Delete | `teams`, `cohorts` |
| `cohorts` | instructor_ids, created_by | Remove from the array; set null. The cohort stays | Via membership |
| `assignments` | target_id (kind `user`), assigned_by | Delete those targeting them; set null | `assignments` |
| `lab_attempts`, `check_results` | user_id, results | Delete | `labAttempts`, `checkResults` |
| `skill_evidence`, `learner_skill_state`, `learner_goals` | user_id, scores | Delete | `skillEvidence`, `skillState`, `goals` |
| `session_notices` | user_id, from_id, message | Delete theirs. In others' notices: `from_id` null, their name replaced in the message | `notices` |
| `exam_attempts`, `exam_task_results`, `exam_retake_grants` | user_id, scores, reports, voided_by, granted_by | Delete; set null where they acted on others. **counsel**: an org may need to keep exam records | `examAttempts`, `examTaskResults`, `examRetakeGrants` (no seeds or task pools) |
| `answer_submissions`, `answer_hint_reveals` | user_id, answers | Delete, so a team's CTF scoreboard changes. **owner** | `answerSubmissions`, `answerHints` |
| `ctf_event_participants` | user_id | Delete | `events` |
| `ctf_events`, `ctf_event_teams` | created_by | Set null | No |
| `auth_sessions` | user_id, ip, user_agent, tokens | Delete | `signIns` (never tokens) |
| `auth_login_states` | email | Delete by address; also expires after 15 minutes | No: seconds-lived |
| `billing_customers`, `billing_subscriptions`, `billing_entitlements`, `billing_limits`, `billing_seats` | user_id, email, updated_by, assigned_by | Delete; set null where they acted on others | `billingCustomers`, `billingSubscriptions` |
| `billing_usage` | user_id, payer_key | **Anonymise and retain**: user_id null, payer_key `erased`. Supports issued invoices | `billingUsage` |
| `billing_meter_outbox` | stripe_customer_id | **Anonymise and retain**: `cus_erased` once sent | No |
| `billing_events` | user_id, customer id in summary | **Anonymise and retain** | No |
| `audit_log` | actor_id, actor_name, target_id, target_label, ip, details | **Anonymise and retain**, through `gdpr_scrub_audit_log`. See below | `activity`, `aboutYou` |
| `waitlist_entries` | email, organisation, role, consent_at | Delete | `waitlist` |
| `gdpr_requests` | email_sealed, user_id, token_hash | Cleared when the request finishes; row deleted after 30 days | No |
| `gdpr_ledger`, Azure ledger table | subject_key, user_key | **Retain**, pseudonymous, as evidence | No |
| Keycloak | The user, federated links, sessions | Delete | `identityProvider` |
| Stripe customer | Name, email, payment method | Delete (`DELETE /v1/customers`) | `billingCustomers` holds the id |
| Stripe invoices | Name and address on the invoice | **Retain in Stripe** under tax and accounting law, stated in the UI and in the ledger's `stripe.invoices` outcome. Period: **counsel** | Billing portal, not in the file |
| LabSession, ExamSession in the cluster | Learner id in labels and spec | Delete | No: runtime state |
| Backups | Everything above | **Expire in 14 days**. See Backups | No |
| Gateway and orchestrator logs, Caddy logs | IPs, user ids in requests | Not touched by erasure; expire with log rotation. **owner**: set and document that rotation | No |

### The audit log

`audit_log` stays append-only for the app role: it has SELECT and INSERT, and no blanket
UPDATE or DELETE. Erasure goes through one SECURITY DEFINER function, which refuses outside a
platform code path. For one person it clears `actor_id`, sets `actor_name` to `[erased]`,
clears `ip`, replaces `target_id` and `target_label`, and rewrites `details`:

- Rows the person performed, rows about them, rows where the address appears in the label or
  the details (`user.invite`, `invitation.revoke`).
- `auth.login_denied`, where `actor_id` is null and `actor_name` and `target_label` hold the
  **attempted address**, with the IP. These go whether or not the address has an account.

Another actor's IP in a row about this person is theirs and stays. Matching is exact on id and
address, so `jo@` does not touch `jo.bloggs@` (tested).

An address erased through the public flow has its audit traces scrubbed only when no account
holds it. An account holder erases through the account.

## The evidence ledger

`src/gdpr/ledger.ts`, behind `ErasureLedger`. Stores: `AzureTableLedger`, `PostgresLedger`
(default), `MemoryLedger` (tests).

```
{ version: 1, seq, requestId, type: erasure|withdrawal|export|restriction,
  scope: waitlist|account, subjectKey, userKey?, dataCategories: [..],
  outcomes: [{ system, category, action: deleted|anonymised|retained|exported|expires|none, rows, legalBasis? }],
  requestedAt, verifiedAt, completedAt, actor: self|admin, reason?, prevHash, hash }
```

- `hash` is SHA-256 of the canonical JSON of the record without `hash`: keys sorted recursively,
  no whitespace. `prevHash` of the first record is 64 zeros. `seq` starts at 1.
- `subjectKey` is HMAC-SHA-256 hex over `email:<address>`, the address normalised as NFC, trimmed,
  lowercased. `userKey` is the same over `user:<id>`.
- `append` refuses a record containing `@` or a key that is not 64 hex characters.
- A repeated `requestId` returns the existing record, so a retry cannot double the evidence.

**Nothing is reported done without evidence.** If the append fails, the request stays
`evidence_pending` and the person sees `pending`. A public or signed-in export returns no data
at all until the record exists.

### The keyed hash is still personal data

A subject key is **pseudonymous personal data, not anonymous**: anyone holding the key can test an
address against it. The ledger is kept under GDPR Art. 17(3)(e) and Art. 5(2) (accountability).
**counsel** to confirm the basis and the 3-year period.

### `CT_GDPR_HMAC_KEY`

The gateway refuses to start in production without it, or with fewer than 32 characters. Dev has a
fixed key that production refuses.

**Production: from Key Vault through the VM's managed identity, at deploy time.** The VM's
user-assigned identity has `Key Vault Secrets User` on the one secret, and the deploy step writes
it into the root-only `.env`:

```sh
az login --identity --client-id "$UAMI_CLIENT_ID"
az keyvault secret show --vault-name "$VAULT" --name ct-gdpr-hmac-key --query value -o tsv
```

It is read once per deploy, not per request, so rotation in Key Vault takes effect at the next
deploy. See Rotating the key for the procedure. The Helm chart
generates one and keeps it across upgrades; with `existingSecret` you must add the key, and the
gateway pod will not start until you do.

### Rotating the key

The ledger is append-only, so old records stay under the key that made them. Rotation therefore means *adding* a key,
never replacing one. If the old key is lost or leaked, see below.

1. Generate the new key and store it in Key Vault as a new secret, `ct-gdpr-hmac-key-<date>`. Keep the old secret.
2. Set `CT_GDPR_HMAC_KEY` to the new key and `CT_GDPR_HMAC_KEY_PREVIOUS` to the old one (comma-separated, newest first).
3. Deploy. New records use the new key; matching tries every key: `gdpr:reapply`, links in flight, checkpoints and `gdpr:find`.
4. Run `pnpm --filter @cloudtrain/gateway gdpr:verify`; it must pass, including any checkpoint signed by the old key.
5. Check an old subject: `echo address | pnpm --filter @cloudtrain/gateway gdpr:find`.
6. **Keep the old key for as long as a record made under it exists**, 3 years with the default pruning, and never less than that. Remove it from
   `CT_GDPR_HMAC_KEY_PREVIOUS` only once `gdpr:ledger-export` shows no older record and the checkpoint is newer than the rotation.

Dropping an old key too early means earlier erasures can no longer be matched, so a restored backup would bring those people back with nothing to catch it; a checkpoint signed by it fails verification.

**A leaked key** cannot be fully undone. Anyone holding it can test guessed addresses against the old records, so it stays personal-data exposure: treat it as an incident and rotate as above. **A lost key**: earlier records stay valid as evidence and the chain still verifies, but they can no longer be matched to anyone, and reapply can't match them. Records are not re-keyed, because that would rewrite the append-only chain.

The Function app on the website must use the same procedure and hold the same keys for its own records.

### Tamper evidence, and its limits

`verifyChain` detects a changed, removed or reordered record.

```sh
pnpm --filter @cloudtrain/gateway gdpr:verify [--expect <seq>:<hash>] [--ledger-file <file>]
```

It exits 1 on any problem. It prints positions and hashes, never an address.

What the chain alone does not catch:

- **The newest records cut off.** The remaining chain is valid. In Azure the `head` entity
  disagrees unless that was rewritten too. Compare with `--expect` against a head noted elsewhere.
  The gateway logs seq and hash on every append for that purpose.
- **The whole chain rebuilt** by someone with write access to the store, because the hash is
  unkeyed. Again only an outside record shows it: the Sentinel log of writes and the logged heads.
- **Postgres**: the owner can disable the trigger. The chain detects what they then change, subject to
  the two points above.

**Azure Table Storage has no immutability policy.** Tamper evidence comes from the hash chain plus the
Sentinel log of writes, not from the table itself.

### Admin view

`GET /api/platform/privacy/requests` and `/platform/privacy`: platform admins only. It shows
type, scope, actor, times, outcomes and the state of the chain, with no subject keys.

## Which log proves what

| Question from an auditor | Evidence |
|---|---|
| Was this person's data erased? | Compute the subject key for the address they give; find the record in the ledger. Outcomes list each system with row counts |
| Has the evidence been altered? | `gdpr:verify`, against a head from the gateway logs or Sentinel |
| Did someone write to the ledger outside the app? | `StorageTableLogs` in Log Analytics: every write with caller identity. Anything but the gateway's identity is an incident |
| Was the key used as intended? | `AzureDiagnostics` for Key Vault: secret reads by the VM's identity at deploy time |
| Was the storage encryption key available? | Key Vault diagnostics: wrap and unwrap by the storage identity |
| What did an org's staff do? | `audit_log`, retained 13 months, with the erased person's identifiers removed |
| Why was something kept? | `retained` outcomes with `legalBasis` |
| What about data in backups? | The `backups` outcome, and `post-restore-reapply` records after any restore |

What the ledger cannot prove: that no copy exists outside the mapped systems (an export the person
or an admin downloaded, a CSV in someone's mailbox, the upstream identity provider of an SSO org).

## Backups

This section is about a gateway on Postgres (the platform, self-hosters). The website has no database:
its worker copies the waitlist to a private container each night and removes each copy after 14 days
(docs/deploy-site-vm.md).

Keep dumps for 14 days. Deleted data stays in them until then, and a
restore brings it back. **`gdpr:reapply` handles this. Run it after every restore, before opening traffic.**

```sh
pnpm --filter @cloudtrain/gateway gdpr:reapply --dry-run   # counts only
pnpm --filter @cloudtrain/gateway gdpr:reapply [--ledger-file <file>]
```

It hashes every address and user id in the restored data and compares with the ledger. It erases only
within the scope asked for: a waitlist erasure never touches an account of the same address. A row
created **after** the erasure is left alone: that person came back of their own accord. Each re-erasure
gets its own record (`actor: admin`, `reason: post-restore-reapply`). It is idempotent.

**The limit you must plan for: the Postgres ledger is in the dump.** A restore rolls it back too, so
it forgets every erasure since the dump, and those are the ones you need. So the backup job must also write
the ledger to a file with `gdpr:ledger-export` (no addresses, kept 3 years), which `--ledger-file` restores first:

1. **If the database is still alive**, before restoring: `gdpr:ledger-export --out ledger.jsonl`.
2. **Otherwise** use the newest ledger file. Erasures after that file are **lost to reapply**:
   up to a day's worth, and everything if the file was only on the same disk. **Copy it off the VM.**

With the Azure ledger the evidence is outside the dump and `--ledger-file` is not needed.

Other limits: Keycloak is re-erased only if `CT_KEYCLOAK_ADMIN_CLIENT_SECRET` is set (the command says when
it is not); a Keycloak restore from its own backup needs the same run. Running labs are not stopped. A link
sent before the dump becomes valid again after a restore until it expires. Records pruned after 3 years can
no longer be matched, which is safe while dumps live 14 days.

## In-app transparency

- **First sign-in notice** (`apps/web/src/app/PrivacyNotice.tsx`): who processes the data, what is processed, links to the notice
  and to Privacy. For someone in an org it says the org manages the account and that they may not have signed up themselves.
  It informs, and "Got it" is not consent. It records which version was shown (`users.privacy_notice_version`); bump `PRIVACY_NOTICE_VERSION` to show a materially changed one again.
  A support or dev session neither sees nor answers it.
- **Links**: the account menu and the sign-in page link the privacy notice and `/legal/privacy-request`. The invitation **mail** links both too.
  There is no invitation **screen**: the invitation link goes straight to Keycloak's login page, which this repository does not theme, so the mail and the first-sign-in notice cover that path.
- **Terminal observation**: confirmed still in place. Starting an observation writes a learner-visible notice, pushes it to their terminal,
  shows the banner in the workspace ("An instructor is observing this session") and writes `session.observe` to the audit log. The gateway test covers the notice and the audit row.
  It appears **when observing starts, not before**: there is no advance warning or a way to refuse. The first-sign-in notice now says this can happen.

## Retention

`src/gdpr/retention.ts` runs every `CT_RETENTION_SWEEP_MS` (default 6 hours; `0` turns off all of it).
Batched and idempotent. It logs one line of counts and part names, with no personal data. `0` in a
period turns that sweep off, so self-hosters can set their own.

| Data | Default | Setting | How |
|---|---|---|---|
| `waitlist_entries` | 24 months after `created_at` | `CT_RETENTION_WAITLIST_MONTHS` | `WaitlistStore.removeOlderThan` |
| `audit_log` | 13 months | `CT_RETENTION_AUDIT_MONTHS` (at least 1) | `sys_prune_audit_log`: the app role has no DELETE; the function refuses a cutoff within 28 days |
| Ledger | 36 months after `completedAt` | `CT_RETENTION_LEDGER_MONTHS` (at least 12) | `sys_prune_gdpr_ledger`, under a signed checkpoint. Refuses records newer than 12 months |
| Unconfirmed privacy links | On expiry | Runs with the sweep | |
| Finished `gdpr_requests` rows | 30 days | `CT_RETENTION_REQUEST_DAYS` | |
| Expired `auth_sessions` | On expiry | Runs with the sweep | They used to go only if the cookie was presented again, so IPs stayed |
| `auth_login_states` | 15 minutes | Runs with the sweep | They used to go only at the next login |
| Closed accounts | 90 days after closure | `CT_RETENTION_CLOSED_DAYS` | Full erasure with a ledger record |
| Inactive accounts | 24 months after the last sign-in or creation, then a warning mail, then 30 days | `CT_RETENTION_INACTIVE_MONTHS`, `CT_RETENTION_INACTIVE_WARNING_DAYS` | Full erasure, `actor: admin`, `reason: inactivity`. Signing in cancels it |

Inactivity deletion never touches platform admins, restricted accounts, or anyone a blocker holds such as a sole org admin or open billing: they are
counted as `accountsSkipped` in the log line. So an org's sole admin who left stays until someone acts, and a learner whose org still pays is
treated like any other. No mail, no deletion: a warning that cannot be sent is tried again at the next sweep. **counsel and owner**: an org may want its learners' records kept longer than 24 months of inactivity. There is no per-org setting yet.

Retention deletions are ordinary housekeeping and write no ledger record: no one asked, and there is no
subject to key them by. The log line is the evidence that the sweep ran. Dumps keep pruned rows for 14 more days.

**Ledger pruning does not break verification.** It removes the oldest unbroken run of records and stores a
checkpoint: position, hash, total pruned, signed with a key derived from `CT_GDPR_HMAC_KEY`. `verifyChain`
starts from there. Removing or forging the checkpoint fails verification; so does verifying without the key.

Set `CT_RETENTION_LEDGER_MONTHS=0` if **counsel** rejects pruning. Limitation periods for claims may exceed 3 years.

## Infrastructure the ledger expects

Azure, for `AzureTableLedger`. Not provisioned by this repository, and the code has run only against a mocked SDK.

- **Storage account**: StorageV2 with `infrastructure_encryption_enabled = true` and table encryption scope
  using the account key (`table_encryption_key_type = "Account"`), so the CMK applies to tables. **Both must be
  set at creation and cannot be changed later.** Without the second, tables stay on Microsoft-managed keys
  whatever the account says.
- **CMK**: in Key Vault through a user-assigned identity, with purge protection on. Losing the key loses the evidence.
- **Firewall**: default deny, with the VM's subnet allowed (service endpoint) or its IP.
- **Diagnostic settings**: on the table service and on Key Vault, to a Log Analytics workspace with Sentinel:
  `StorageRead`, `StorageWrite`, `StorageDelete`, and Key Vault `AuditEvent`.
- **Role**: `Storage Table Data Contributor` for the gateway's UAMI, scoped to the table. No account keys, no connection
  strings: `allowSharedKeyAccess = false` is a good addition. Retention pruning needs this role's delete.
- **Retention**: logs in Log Analytics for 3 years, aligned with the ledger's proposal, so the write log outlives what it protects.

```hcl
resource "azurerm_storage_account" "evidence" {
  account_kind                      = "StorageV2"
  infrastructure_encryption_enabled = true       # creation only
  table_encryption_key_type         = "Account"  # creation only
  shared_access_key_enabled         = false
  identity { type = "UserAssigned", identity_ids = [azurerm_user_assigned_identity.storage.id] }
  customer_managed_key { key_vault_key_id = azurerm_key_vault_key.evidence.id, user_assigned_identity_id = azurerm_user_assigned_identity.storage.id }
  network_rules { default_action = "Deny", virtual_network_subnet_ids = [azurerm_subnet.vm.id] }
  # ...
}
```

Gateway settings: `CT_GDPR_LEDGER_TABLE_URL` (`https://<account>.table.core.windows.net`), `CT_GDPR_LEDGER_TABLE`,
`AZURE_CLIENT_ID`. All three or none; half is a startup error, not a quiet fallback. The table must exist.

## Mail

The confirmation mails use the `Mailer` interface (`src/mail.ts`): SMTP today, Mailpit in dev. The planned ACS mailer
replaces it there. Without a reachable SMTP host the response is still the generic one and no link arrives: the
failure is only in the log, by design, as the answer must not vary. Watch for `gdpr: a mail could not be sent`.

## To confirm

**Counsel**
- Retention of the ledger (3 years) and its basis, including the keyed hash as personal data.
- Invoice retention period, and that Stripe's copy satisfies it.
- Controller or processor for org-managed learners: may a learner erase themselves, or must the org decide? As built, they may.
- Whether exam results an org relies on may be erased at the learner's request.
- The waitlist period (24 months) and the audit period (13 months).
- Whether the restriction above goes far enough, and inactivity deletion for org-managed learners.
- Observation is announced when it starts, not in advance, and cannot be refused.
- Response time: requests that stay blocked for a billing period against the one-month limit of Art. 12(3).

**Owner**
- A team's CTF score changes when a member is erased.
- `gdpr@cloudtrain.app` must exist before objections and restrictions can reach anyone.
- A sole admin of a sole-member org must contact us, as there is no self-service org closing.
- Log rotation for gateway and proxy logs.

## Follow-ups

- Filtering restricted people out of cohort boards, assignment views and manager exam results.
- A per-org setting for inactivity deletion.
- A key id on ledger records, so a lookup needs no trial across keys.
- Stripe data in the download: invoices come from the billing portal.
- A link to `/legal/privacy-request` from the privacy notice and the footer, owned by the task editing those.
