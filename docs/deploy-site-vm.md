# The public website on one small VM

How `cloudtrain.app` runs in production while it is a coming-soon site with a waitlist. The files are
in [`deploy/site-vm/`](../deploy/site-vm/), [`services/site-proxy`](../services/site-proxy/) and
[`services/site-api`](../services/site-api/). Other hosts for the same static build are in
[deploy-website.md](deploy-website.md). Mail is in [email.md](email.md).

The platform (sign-in, labs, exams, billing) is not here. It needs a Kubernetes cluster
([deploy.md](deploy.md)) and gets its own host name later.

Goals, in this order: limit what a breach can reach, and limit what an attack can cost.

## Architecture

```
Browser ──> Cloudflare (free, proxied) ──> VM: Caddy ──> sidecar ──> public Function app ──> Azure Tables, queue
                                                                                                    │
                                                  worker Function app (no public inbound) <─────────┘
                                                     ├─ Azure Tables, ledger, immutable blob
                                                     ├─ backup blobs (14 days)
                                                     └─ Azure Communication Services (mail)
```

| Part | Holds | Can do | If it is breached |
|---|---|---|---|
| Cloudflare | Traffic in transit | Deliver and protect | Sees traffic, including form contents |
| VM: Caddy | The static site, the origin certificate's key | Serve files, talk to the sidecar. No outbound, no IMDS | The site can be defaced. It reads nothing stored |
| VM: sidecar | Nothing on disk. Client addresses in memory for an hour | Get a token for one audience, call the public app | Can see form contents in transit from then on, and can call the public app at full speed. It reads nothing stored |
| Public app | The HMAC secret | **Only add** rows to two tables, send to one queue | Can add rows and queue mail, within the caps. Can test an address against a subject key. Cannot read or delete anything, and cannot confirm a request |
| Worker app | The HMAC secret | Read and delete, write the ledger, send mail | Everything on the waitlist. It has no public inbound |

Nothing personal is on the VM's disk: no database, no gateway, no form bodies in any log.

## Data

Azure table names allow letters and digits only, so the brief's `privacy_requests` is `privacyrequests`.

| Table | PartitionKey | RowKey | Who |
|---|---|---|---|
| `waitlist` | First 2 hex of the subject key | The subject key | Public adds. Worker reads, updates, deletes |
| `privacyrequests` | UTC day of expiry | Request id, or `claim-<token hash>` | Public adds. Worker reads, deletes |
| `privacystate` | UTC day of expiry, or `mail-cap` | Request id, or the day | Worker only |
| `gdprledger` | `chain` | `r<seq>`, `q<request id>`, `head`, `checkpoint` | Worker only |

**The row key and the duplicate check.** RowKey appears in storage logs, so it is never plaintext: it
is the subject key, `HMAC-SHA-256(CT_GDPR_HMAC_KEY, "email:" + normalised address)`. Normalised means
NFC, trimmed, lowercased. It is unique across months because a row's key does not depend on when it
joined. The public app inserts, and a `409` is the duplicate: no read happens, and none is allowed.

**A duplicate looks like a new signup.** It gets the same `201 created`, no second welcome, and the
form has one outcome. Nobody can use the form to test whether an address is on the list.
`SITE_WAITLIST_REVEAL_DUPLICATES=true` would bring back `200 duplicate`, and only that exact value does.
One small signal remains: a new signup also sends a queue message, so it takes a little longer, and
that shows only over many careful measurements within the rate limit.

The same key serves two purposes: the waitlist's RowKey and the ledger's `subjectKey`, so a ledger
record points straight at the row, with no address and no scan. A consequence of not partitioning by
month is that retention scans `createdAt`, which is cheap at this size.

**The public app cannot see single use, so a claim row does it.** A link is single use. The public
app can read nothing, so it adds `claim-<token hash>` to `privacyrequests`: a `409` means used, and it
answers the same `410` as a bad link. The worker checks again from its own state.

**What the public app writes decides nothing.** Its identity can add any row, so the worker treats
the intake row as input. Only the worker issues a confirmation token, sends it, and keeps its hash, in
`privacystate`, which the public identity cannot touch. The same goes for the leave link's nonce,
which only the worker sets on the row. So a breached public app, holding the HMAC key, can sign a
token but not one that acts on anything: it never saw the random part, and it can only make us send
mail, within the caps.

This differs from the first brief, which had the public app store the token hash. Doing that would
let a breached public app confirm a request it created itself and erase any address it can name.

**The queue** holds no address: a request id, a subject key, or a token the visitor sent. The poison
queue is the same and is readable only by the worker.

**Consent evidence** on each row: `consentAt`, the SHA-256 of the consent wording, the notice's
`updated` date and the form. No IP. `pnpm --filter @cloudtrain/site-api package` puts the hash and the
date into the public bundle, so a change to the wording needs a new deployment.

## What the browser sees

The contract is the gateway's (`apps/web/src/lib/waitlist.ts`, `privacyRequest.ts`), with one
difference: the public app cannot read or delete, so a confirm never answers `200`.

| Route | Answers |
|---|---|
| `POST /api/public/waitlist` | `201 created` for a new address, a duplicate and the honeypot alike, `422` with fields, `429`, `503` |
| `POST /api/public/privacy/requests` | `202` with one body for every address and for the honeypot, `422`, `429`, `503` |
| `POST /api/public/privacy/confirm` | `202 { status: 'pending', type }`, or `410` with one body for invalid, expired or used, `429`, `503` |

Everything else under `/api` is a `404` from Caddy, and again from the sidecar.

The mailed link is `<site>/legal/privacy-request#token=<token>`. The token stays in the fragment and
the page posts it only when the visitor presses the button, so a mail scanner cannot act on it.

The prerendered site needs no API: the site configuration is exported at build time to
`/data/site.json`, and `build-site.mjs` fails if the page calls `/api/*` while loading. The catalog,
path and exam documents come from `/data` too. `task dev:site` with a real gateway is unchanged.

## Limits

| Limit | Where | Default | Over it |
|---|---|---|---|
| Requests per address per hour (IPv6 by /64) | Sidecar | 60 | `429`, `Retry-After`, the function is not called |
| API requests per second, all visitors | Sidecar | 5, burst 5 | `429` |
| Tracked addresses | Sidecar | 50,000 | The oldest is forgotten |
| Body | Caddy, sidecar, function | 16 KB, 8 KB, 8 KB | `413` |
| Concurrent upstream calls | Sidecar | 16 | `429` |
| Writes per second per instance | Public app | 5, burst 5 (`SITE_WRITES_PER_SECOND`) | `429`. A signup takes 2: the row and the message |
| Confirmation mails to one address per hour | Worker | 3 | No mail, same answer |
| Confirmation and welcome mails per day | Worker | 500 (`SITE_MAIL_DAILY_CAP`) | No mail. The signup stays. The log says `daily_cap` |
| Instances | Infrastructure | Keep at 1 or 2 | The write cap multiplies by this |

The sidecar trusts `CF-Connecting-IP`. What makes that safe is Authenticated Origin Pulls: without
Cloudflare's client certificate no connection reaches Caddy, so nobody can talk to the VM directly and
set the header to anything. The NSG admitting only Cloudflare is the layer before it. For local development,
`SITE_PROXY_CLIENT_IP_HEADER=socket` uses the connection's address, and `SITE_PROXY_AUTH=none` skips
the token.

## Memory

`AZR-CLOUDTRAIN-VM` is a `Standard_B1s`: 1 GiB, with a swap file from first boot. Container limits
total 96 MiB. Measured with `docker stats` on 2026-11-02 on a development machine, not on the VM, so its
burstable CPU was not measured:

| State | Caddy (limit 64m) | Sidecar (limit 32m) |
|---|---|---|
| Idle after start | 12.3 MiB | 2.0 MiB |
| 20,000 static requests, 20 at a time | 45.6 MiB peak, 41.3 after | 2.0 MiB |
| 3,000 API requests at the default cap | 24.6 MiB | 7.7 MiB |
| 55,000 API requests from 55,000 /64s, cap lifted for this test | 28.1 MiB peak | 23.1 MiB peak, 19.6 after |
| Idle, under `userns-remap` and `icc: false` | 13.5 MiB | 2.5 MiB |

No OOM kill and no restart. The last row fills the limiter past its bound. At the default cap it would
take about three hours to reach it. `GOMEMLIMIT` is 48 MiB for Caddy and 24 MiB for the sidecar, and
Caddy compresses with gzip only.

## Infrastructure

A separate Terraform session provisions this. Nothing in this repository creates cloud resources.
Names and ids are settings. These are what the code expects.

### VM

- `AZR-CLOUDTRAIN-VM`, `Standard_B1s`, Ubuntu 24.04 LTS, in an EU region, admin user `ubuntu`, with `AZR-CLOUDTRAIN-MI` as its user-assigned identity.
- First boot creates `/swapfile` and the host firewall unit. Its `DOCKER-USER` rule must name the sidecar's fixed address, `10.250.50.20`.
- Docker daemon: `userns-remap: default`, `no-new-privileges`, `icc: false`. See install step 5 for what that means for file ownership.
- NSG: TCP 443 from [Cloudflare's ranges](https://www.cloudflare.com/ips/) only. SSH from the admin's address only. **No port 80.**
- A static public IP: it is the public app's IP restriction, as well as the DNS target.

### Public Function app (Flex Consumption, Node 22)

- Entra auth (Easy Auth) required, audience of its app registration, only `AZR-CLOUDTRAIN-MI` allowed.
- Access restriction: the VM's public IP only. Keep the instance count small.

| Setting | Value |
|---|---|
| `SITE_ALLOWED_PRINCIPAL_ID` | **Object** id of `AZR-CLOUDTRAIN-MI`. Empty or different: every request gets `403` |
| `AZURE_CLIENT_ID` | Client id of this app's identity |
| `CT_GDPR_HMAC_KEY` | Key Vault reference. The same secret as the worker and the gateway |
| `SITE_TABLE_ENDPOINT`, `SITE_QUEUE_ENDPOINT` | `https://<account>.table.core.windows.net`, `https://<account>.queue.core.windows.net` |
| `SITE_WAITLIST_TABLE`, `SITE_PRIVACY_REQUESTS_TABLE`, `SITE_QUEUE_NAME` | Defaults `waitlist`, `privacyrequests`, `privacy-requests` |
| `SITE_WAITLIST_REVEAL_DUPLICATES` | Leave unset |

Its role, custom and add-only, scoped to those two tables and that queue:

```
Microsoft.Storage/storageAccounts/tableServices/tables/entities/add/action
Microsoft.Storage/storageAccounts/queueServices/queues/messages/add/action
```

and `secrets/get` on that one secret. **Never exercised against real Azure:** check first that an
insert works with this action alone, and that a duplicate still answers `409`, not `403`.

### Worker Function app (Flex Consumption, Node 22)

No public inbound (no HTTP triggers, public access off). A separate identity.

| Setting | Value |
|---|---|
| `AZURE_CLIENT_ID`, `CT_GDPR_HMAC_KEY` | As above, its own identity |
| `SITE_TABLE_ENDPOINT`, `SITE_BLOB_ENDPOINT` | Endpoints |
| `SITE_STORAGE__queueServiceUri`, `SITE_STORAGE__credential=managedidentity`, `SITE_STORAGE__clientId` | The queue trigger's connection |
| `SITE_QUEUE_NAME` and the table settings | As the public app, plus `SITE_PRIVACY_STATE_TABLE` (`privacystate`), `CT_GDPR_LEDGER_TABLE` (`gdprledger`) |
| `SITE_PUBLIC_URL` | `https://cloudtrain.app`: the mailed links |
| `SITE_ACS_ENDPOINT`, `SITE_MAIL_SENDER`, `SITE_MAIL_REPLY_TO` | [email.md](email.md) |
| `SITE_BACKUP_CONTAINER` | Default `waitlist-backup`. **Immutable for 13 days, deleted at day 14**, which the privacy notice promises |
| `SITE_LEDGER_COPY_CONTAINER` | The immutable ledger container. It must be set in production: it is the long-term evidence. Keep its blobs for 3 years, as the notice says of the deletion record |

Roles: Table Data Contributor on the four tables, Queue Data Contributor on the queue (the poison
queue needs creating), Blob Data Contributor on the two containers, permission to send on the ACS
resource, `secrets/get` on the secret. Each Function app also needs the platform's own
`AzureWebJobsStorage` and deployment storage. Keep those apart from the data account.

### Logs: the notice depends on these

The privacy notice states these periods, so the infrastructure must match them, or the notice must change:

| What | Notice says | Set |
|---|---|---|
| Application logs (Function apps' workspace) | 90 days | Workspace or table retention |
| Security logs (storage access and deletions) | 13 months | Sentinel workspace retention |
| Backup container | 14 days | Immutable 13 days, lifecycle delete at day 14 |
| Ledger copy container | 3 years | Immutability and lifecycle to match |

**ACS diagnostic settings.** Leave **Email Status Update** and **Email User Engagement** off: they
hold the recipient's address in `RecipientId`, out of reach of an erasure. Email Send Mail holds only
counts. [email.md](email.md) has what Microsoft keeps itself.

**Function logs.** `host.json` samples at one item per second, and handlers log 1% of successes. A log
line holds at most the visitor's /24 or /48. Logs are kept 90 days, so they are not the ledger's
long-term evidence: the immutable container is (see "The ledger").

## Cloudflare

1. Add the zone on the free plan. Proxy `A cloudtrain.app` and `CNAME www` (orange cloud), pointing at the VM.
2. **SSL/TLS: Full (strict).** Create an origin certificate for `cloudtrain.app` and `*.cloudtrain.app`.
3. Always Use HTTPS on. HSTS stays with Caddy.
4. **Do not turn on Bot Fight Mode or other bot features.** They add a `__cf_bm` cookie, and the cookie
   notice says Cloudflare sets none. After launch, check with `curl -sI https://cloudtrain.app/ | grep -i set-cookie`.
5. Accept Cloudflare's data processing addendum. The privacy notice relies on it for transfers.
6. Mail's records under `notify` and the MX, SPF, DKIM and DMARC records must be DNS only (grey cloud).

### Authenticated Origin Pulls

Caddy requires a client certificate on 443, verified against the CA file `certs/origin-pull-ca.pem`.
Without a valid one the TLS handshake is refused, on the apex and on `www`. It fails closed: a missing
CA file or a mistyped mode stops Caddy from starting. This is what makes the sidecar's trust in
`CF-Connecting-IP` safe.

**Which certificate.** This setup uses Cloudflare's **Global** mode, whose certificate Cloudflare says
"is shared across all Cloudflare accounts" and "only proves a request came from the Cloudflare network".
So another Cloudflare customer pointing a zone at this IP still passes. They cannot reach the VM
directly, but they could get past our zone's WAF rule, including step 1 of the kill switch. The sidecar's
limits still apply to them.

**Zone-level and per-hostname** modes use a certificate of your own, which closes that. Cloudflare's
overview lists Authenticated Origin Pulls as available on every plan including Free, and neither setup
page names a plan requirement, but the docs do not state availability per mode. Check that the
**Zone-level** section offers **Upload certificate** in your dashboard. To move to it later: issue a CA and
a leaf, upload the leaf, put your CA in `certs/origin-pull-ca.pem`, and do the steps below with the
Zone-level toggle. No code changes. Keep the CA's key off the VM, and watch for the expiry alerts.

**The CA file** comes from [Cloudflare's setup page](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/global/).
It is not in this repository. Install step 4 downloads it. As fetched on 2026-11-02, its subject CN is
`origin-pull.cloudflare.net`, it expires on 2029-11-01, and its SHA-256 fingerprint is
`9A:1A:C2:B4:BE:15:F9:F2:7E:EE:20:A7:34:CB:A4:E9:89:8F:61:00:1B:3B:D7:C8:4B:69:B5:6A:3E:25:A2:B9`.
It is not the same as the Cloudflare Origin CA behind `origin.pem`.

**Turning it on without downtime.** In this order, and the order matters: an origin that enforces before
Cloudflare presents the certificate refuses all traffic.

1. **Origin accepts, does not require.** With the CA file in place, on the VM, in `/opt/cloudtrain-site`:

   ```sh
   echo 'SITE_CLIENT_AUTH_MODE=verify_if_given' | sudo tee -a .env
   sudo docker compose up -d caddy
   ```

2. **Cloudflare presents.** Dashboard, your zone, **SSL/TLS, Origin Server, Authenticated Origin Pulls**
   tab, **Global** section: switch it **On**.
3. **Confirm.** Load the site, then on the VM. Lines must show a `client_common_name`:

   ```sh
   sudo docker compose logs --tail 50 caddy | grep -c client_common_name
   ```

   If the count is 0, stop here and find out why. The site still works in this state.
4. **Origin requires.** Takes effect with a restart of a few seconds:

   ```sh
   sudo sed -i '/^SITE_CLIENT_AUTH_MODE=/d' .env
   sudo docker compose up -d caddy
   ```

5. **Check.** The site still loads through Cloudflare. On the VM, a request without the certificate is
   refused: this must print `000` and exit with 56 (or 35).

   ```sh
   curl -sk -m 5 -o /dev/null -w '%{http_code}\n' --resolve cloudtrain.app:443:127.0.0.1 https://cloudtrain.app/; echo "exit $?"
   ```

**To back out**, go in reverse: step 1 first, and only then the toggle off. Local development without it
uses `SITE_CLIENT_AUTH_MODE=verify_if_given`.

## Install

From a checkout, on your machine, unless a step says "on the VM". `VM` stands for `ubuntu@<the IP>`.

1. **Check the site.** `node tools/lab-verify/bin/lab-verify.mjs --strict` validates `content/site.yaml`.
   A paragraph holding `: ` must be quoted.
2. **Build the site.** `CT_API_BASE` stays empty, since the form posts to the same origin.

   ```sh
   pnpm install --frozen-lockfile
   CT_API_BASE= CT_SITE_URL=https://cloudtrain.app CT_APP_URL= pnpm --filter web build:site
   ```

3. **Package and deploy the functions.** `out/public` and `out/worker` each hold `host.json`, a
   `package.json` and one bundled file.

   ```sh
   pnpm --filter @cloudtrain/site-api package
   (cd services/site-api/out/public && zip -qr ../public.zip . && az functionapp deployment source config-zip -g <rg> -n <public app> --src ../public.zip)
   (cd services/site-api/out/worker && zip -qr ../worker.zip . && az functionapp deployment source config-zip -g <rg> -n <worker app> --src ../worker.zip)
   ```

4. **Copy the files to the VM.** The origin certificate goes in `/opt/cloudtrain-site/certs/`, as `origin.pem` and `origin.key`.

   ```sh
   rsync -a deploy/site-vm/ VM:/tmp/cloudtrain-site/
   rsync -a --delete apps/web/dist-site/ VM:/tmp/cloudtrain-site/site/
   ssh VM 'sudo rsync -a /tmp/cloudtrain-site/ /opt/cloudtrain-site/ && rm -rf /tmp/cloudtrain-site'
   ssh VM 'sudo curl -fsSo /opt/cloudtrain-site/certs/origin-pull-ca.pem --create-dirs https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem'
   ssh VM 'openssl x509 -in /opt/cloudtrain-site/certs/origin-pull-ca.pem -noout -subject -enddate -fingerprint -sha256'
   ```

   Compare the output with "The CA file" above. If it differs, read Cloudflare's page before going on.

5. **Start it, on the VM.** First boot already created `/swapfile` and the host firewall unit, so check
   them rather than create them. The daemon has `userns-remap`, so container root is an unprivileged host
   UID: **the certificate files must belong to the mapped user**, or Caddy gets "permission denied" and
   does not start. `.env.example` lists the settings.

   ```sh
   cd /opt/cloudtrain-site && sudo cp .env.example .env && sudo chmod 600 .env   # then fill it in
   echo 'SITE_CLIENT_AUTH_MODE=verify_if_given' | sudo tee -a .env                # removed again in step 4 of "Authenticated Origin Pulls"
   swapon --show | grep -q swapfile && echo 'swap ok'
   sudo iptables -S DOCKER-USER | grep 169.254.169.254    # must name 10.250.50.20
   sudo ./imds-firewall.sh                                # adds Caddy's outbound block, and is safe to repeat
   mapped=$(awk -F: '$1=="dockremap"{print $2}' /etc/subuid)
   sudo chown -R "$mapped:$mapped" certs
   sudo chmod 750 certs && sudo chmod 400 certs/origin.key && sudo chmod 444 certs/origin.pem certs/origin-pull-ca.pem
   sudo docker compose up -d && sudo docker compose ps
   ```

   `imds-firewall.sh` does not run at boot unless the host unit calls it. Ask for its Caddy rule to be
   in that unit, or run it after a reboot. Then go on from step 2 of "Authenticated Origin Pulls" above:
   its step 1 is the `verify_if_given` line here. Without that line, Caddy refuses Cloudflare until the
   toggle is on, which is also what happens if the line is left out by mistake: it fails closed.

6. **Check from your machine.**

   ```sh
   curl -sI https://cloudtrain.app/ | grep -iE '^HTTP|strict-transport|content-security|set-cookie'
   curl -s -o /dev/null -w '%{http_code}\n' https://cloudtrain.app/api/public/site      # 404
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.cloudtrain.app/ # 301
   curl -s -o /dev/null -w '%{http_code}\n' https://<public app>.azurewebsites.net/api/public/waitlist -d '{}' -H 'content-type: application/json' # 401 or 403
   ```

   Check that Caddy has no IMDS: `sudo docker compose exec caddy wget -T3 -qO- --header Metadata:true 'http://169.254.169.254/metadata/instance?api-version=2021-02-01'` must time out.

   Then join the waitlist in a browser. A welcome mail with a leave link must arrive.

## Operations

On the VM, in `/opt/cloudtrain-site`, with `sudo`.

| Task | How |
|---|---|
| Status, logs | `docker compose ps`, `docker compose logs -f --tail 100 site-proxy` |
| Update the site | Install steps 1, 2 and 4. Caddy serves new files at once. **A changed consent label or notice date also needs step 3** |
| Update the sidecar | Set `SITE_PROXY_IMAGE` to the new digest, then `docker compose up -d`. The limiter's counts start over |
| Renew the origin pull CA | Before 2029-11-01: step 4's download, then the `chown` and `chmod` of step 5, then `docker compose restart caddy` |
| Read the waitlist | Azure portal or `az storage entity query`, as someone with a data role. There is no admin page |

The operator's tasks run from a checkout, as the signed-in `az` user, who needs the worker's data
roles for the job. They print positions, hashes and counts, never an address.

```sh
export SITE_TABLE_ENDPOINT=... SITE_BLOB_ENDPOINT=... SITE_PUBLIC_URL=https://cloudtrain.app CT_GDPR_HMAC_KEY=...
pnpm --filter @cloudtrain/site-api cli verify [--expect <seq>:<hash>]
pnpm --filter @cloudtrain/site-api cli reapply --dry-run
pnpm --filter @cloudtrain/site-api cli restore waitlist/2026-11-02.ndjson
```

### The mail cap

At most **500 confirmation and welcome mails a day** (`SITE_MAIL_DAILY_CAP`), whatever the traffic. That
is the owner's limit on what a breached VM or public app can cost in mail. It counts per UTC day, in the
worker's own table, so a restart does not reset it and the public identity cannot change it.

Past it, the visitor sees the usual answer and no mail goes. A signup is kept, and it gets no welcome and
no later retry. A privacy request's link is not sent, so the person has to ask again the next day. The
log line says `daily_cap`: alert on it. Before an announcement, decide whether to raise the setting.
Results of confirmed requests and "you have left" notices do not count.

### Timers on the worker

| Timer (UTC) | Does |
|---|---|
| Hourly, `:07` | Finishes verified requests whose message ran out of retries, deletes expired requests and claims |
| 02:30 | Exports the waitlist to `waitlist/<date>.ndjson` in the backup container. The container is immutable, so a second run on one date leaves the first copy and counts as a success, with `written: false` in the log |
| 03:15 | Deletes entries over 24 months old, prunes the ledger at 3 years under a signed checkpoint, verifies the chain, and writes the head to `head/<date>.json` in the immutable container |

### When things fail

| What | What happens | What to do |
|---|---|---|
| Mail or storage fails on a message | Retried 5 times, then `privacy-requests-poison` | Read why in the logs. A verified request is finished by the sweep anyway |
| A welcome ran out of retries | The signup stays. No welcome, and no leave link until a later mail | Nothing needed: `/legal/privacy-request` still works |
| Leave: the record was written and the delete failed for all retries | The ledger says deleted, the row stays | `cli reapply` deletes it, with a second record. Alert on the poison queue |
| The ledger is down | Verified requests wait. No copy goes out and nothing says done | Fix it. The sweep finishes them |

### Restore

The backups hold the addresses, encrypted at rest, in a container only the worker can reach.

`cli restore <blob>` adds a backup's rows back, keeping rows that exist, and then re-applies erasures.
From the ledger's subject keys, it looks up each row by key: a row from before its erasure goes
again, with a new record marked `post-restore-reapply`. A row from after it stays, since that person
came back of their own accord. The ledger is not in the backup, so a restore does not roll it back.

The backup is NDJSON and holds what strangers typed into the form, so treat it as untrusted text. When
you convert it to CSV or Excel, neutralise spreadsheet formulas: a cell starting with `=`, `+`, `-` or `@`
would run when opened. `csvCell` in `services/gateway/src/waitlist/validate.ts` shows how.

### The ledger

The record format is the gateway's (`services/gateway/src/gdpr/ledger.ts`): hash chain, keyed subject,
no direct identifiers, the same Azure layout. `services/site-api/test/ledger.test.ts` pins a record
and a checkpoint produced by that code. It is a matched copy, not a shared package, so the two
branches merge cleanly; see Open decisions.

**The table is mutable.** Anyone with write access can change it. The chain makes a change visible, not
impossible, and the whole chain could be rebuilt by someone holding the key.

**The immutable container is the long-term evidence.** It holds one blob per record
(`ledger/<seq>.json`) and one for the chain's position each day (`head/<date>.json`, with no identifier
in it). Application logs also carry the head, but they are kept only 90 days. To prove the table against
it, take a head from the container and run `cli verify --expect <seq>:<hash>`.

## Emergency kill switch

Fastest first. The site keeps serving in all of them, and the form shows its own error message.

| Step | Stops | How |
|---|---|---|
| 1 | The API, at the edge | Cloudflare, Security, WAF: a custom rule blocking `/api/` |
| 2 | The sidecar | `sudo docker compose stop site-proxy`. Caddy answers `503` |
| 3 | The public app | `az functionapp stop -g <rg> -n <public app>` |
| 4 | Queued work and mail | `az functionapp stop -g <rg> -n <worker app>`. Messages wait in the queue |
| 5 | A stolen identity | Remove the role assignment for the identity, rotate the HMAC secret in Key Vault |

The website's code knows one key. Rotating the HMAC secret orphans every row's subject key, so duplicates stop being detected and ledger
records stop matching. Treat that as a last resort, and write down why in the ledger's records.

Under attack, Cloudflare's "Under Attack" mode also works, but it sets a cookie, so note it if it stays on.

## Cost

The VM's figure is from the Terraform session. The others are rough pay-as-you-go figures from memory of the list prices, not a quote. Check the calculator for your region.

| Item | Monthly |
|---|---|
| `Standard_B1s` (`AZR-CLOUDTRAIN-VM`) | About $8.76 |
| OS disk, Standard SSD E4 | About $2.50 |
| Static public IP | About $3.65 |
| Function apps at normal traffic | Inside the free grant |
| Tables, queue, blobs | Under $1 |
| Cloudflare free | $0 |
| ACS Email | About $0.00025 a mail |

**Under attack**, the caps bound it. At 5 requests a second for a month, about 13 million requests:
table writes come to under $1, mail is capped at 500 a day, about $4 a month, and function executions
and memory come to tens of euros at the smallest instance size. Set a budget alert at $15 to $20 and
keep the instance count low. The VM's bill does not change with traffic. Cloudflare's free plan has
no charge for traffic.

## What has been tested, and what has not

`dev/run-local.sh` and `dev/integration.mjs` in `services/site-api` run the real Caddy and sidecar
containers, with a real browser driving the form, against the real handlers and storage SDKs on
Azurite. It takes 31 checks, with Authenticated Origin Pulls enforced against a local stand-in CA, and
needs nothing in Azure. A request without a client certificate, or with one from another CA, is refused.

The packaged bundles were also started once in Azure Functions Core Tools 4.16 (runtime 4.1054) with
Azurite. Both apps registered all their functions. Over the real HTTP triggers: no principal `403`,
signup `201`, duplicate `200` (the default at that time), bad token `410`, `GET` `404`. The write cap answered `429` on a fourth
write burst. The real queue trigger fired on the welcome message and went on to the ACS credential,
which has no identity to use on a development machine: that invocation was not seen to finish, so the
retry and poison path has been tested only with the local host's stand-in for the trigger.

`deploy/site-vm/compose.yaml` also ran in a throwaway Docker daemon with `userns-remap`, `no-new-privileges`
and `icc: false`: bind mounts, the fixed addresses, `NET_BIND_SERVICE` and Caddy reaching the sidecar all
work. A key owned by host root is refused and the install step's ownership fixes it. That daemon ran
nested on a development machine, on the `vfs` storage driver.

Caddy also started and validated with Cloudflare's real CA file, and refused a local client certificate.

Never exercised against real Azure:

- **IMDS:** only a fake with the documented request and answer.
- **Entra auth:** a stand-in sets the principal. Whether `x-ms-client-principal-id` holds the object id for a managed identity's token is from the documentation.
- **The add-only role:** Azurite grants everything. That an add-only role can insert, gets `409` on a duplicate, and gets refused on a read, needs checking.
- **ACS:** the real client was never called. Tests use a memory mailer. The sender domain, `disableUserEngagementTracking` and Reply-To have not been seen in a real mail.
- **Flex Consumption:** deployment, Key Vault references, identity-based trigger connections.
- **Cloudflare:** `CF-Connecting-IP`, the origin certificate, Full (strict), and Cloudflare actually presenting its client certificate. The header and the client certificate were the test's own.
- **`imds-firewall.sh`:** its rules were applied in a throwaway container's own chain, so their syntax and idempotence are checked, but not their effect on a real VM's IMDS.

## Open decisions

1. **Authenticated Origin Pulls with your own certificate.** See "Which certificate". Global is on now.
2. **Sharing the ledger code.** Move the pure parts into a package once `feat/gdpr-rights` is merged.
3. **Double opt-in.** Not built. The welcome mail carries "if this wasn't you, remove this address".
4. **The gateway still tells a duplicate apart.** `services/gateway/src/waitlist/routes.ts` answers
   `200 duplicate`. It is not in this deployment. The form no longer shows a difference, but the platform's
   API still does: decide before that route is public.
