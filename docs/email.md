# Email for cloudtrain.app

How the contact addresses for `cloudtrain.app` are set up in Microsoft 365, and the DNS
records they need. The website lists one address, `hello@cloudtrain.app`
(`contact.email` and `contact.salesEmail` in `content/site.yaml`).

The website sends one kind of automated mail: waitlist and privacy messages from the worker
Function app, through Azure Communication Services (see "Outgoing application mail"). The
privacy notice names `gdpr@cloudtrain.app` as the contact for data rights; create that alias before
the site goes live.

## Mailbox layout

One **shared mailbox**, `hello@cloudtrain.app`, with the other role addresses as
aliases of it. A shared mailbox needs no license of its own (up to 50 GB). Every
person who reads it needs an Exchange Online license (Business Basic or higher), and
gets Full Access and Send As on the mailbox. Nobody signs in to the shared mailbox
itself.

| Address | Kind | Used for |
|---|---|---|
| `hello@cloudtrain.app` | Shared mailbox | Contact page, general questions, replies to waitlist mail, budget alerts |
| `sales@cloudtrain.app` | Alias of `hello@` | Team and pilot enquiries. Point `contact.salesEmail` here once it exists |
| `gdpr@cloudtrain.app` | Alias of `hello@` | Privacy and data-rights requests (the privacy and cookie notices name it), and objections and restrictions raised in the app (`CT_GDPR_CONTACT`, docs/gdpr.md). **Must exist** before those reach anyone |
| `security@cloudtrain.app` | Alias of `hello@` | Vulnerability reports (`SECURITY.md`, a future `security.txt`) |
| `billing@cloudtrain.app` | Alias of `hello@` | Invoices and payment questions once billing is live |
| `legal@cloudtrain.app` | Alias of `hello@` | Licensing and contract questions |
| `dmarc@cloudtrain.app` | Alias of `hello@` | DMARC aggregate reports (see below). Use a rule to file them away from the inbox |

Aliases are free and can turn into separate shared mailboxes later, when different
people answer them. Keep `postmaster@` and `abuse@` as aliases too: some providers
send to them.

## Setup in Microsoft 365

1. **Add the domain.** Microsoft 365 admin center, Settings, Domains, Add domain,
   `cloudtrain.app`. Add the `TXT` verification record it shows (`MS=ms...`), then
   verify.
2. **Add the mail records** from the next section. Copy the values the admin center
   shows for this domain; the MX host in particular is specific to the tenant.
3. **Create the shared mailbox.** Exchange admin center, Recipients, Mailboxes, Add a
   shared mailbox: display name `CloudTrain`, address `hello@cloudtrain.app`. Then add
   the members who read it (Full Access and Send As).
4. **Add the aliases.** Open the mailbox, Manage email address types, and add each
   alias from the table as an SMTP address. In Exchange Online PowerShell:

   ```powershell
   Set-Mailbox hello@cloudtrain.app -EmailAddresses @{add='smtp:sales@cloudtrain.app','smtp:gdpr@cloudtrain.app','smtp:security@cloudtrain.app','smtp:billing@cloudtrain.app','smtp:legal@cloudtrain.app','smtp:dmarc@cloudtrain.app','smtp:postmaster@cloudtrain.app','smtp:abuse@cloudtrain.app'}
   ```

5. **Let replies go out from the shared address.** Run
   `Set-Mailbox hello@cloudtrain.app -MessageCopyForSentAsEnabled $true`, so a reply sent as
   `hello@` stays in the shared Sent Items. In Outlook, members pick `hello@` in the From
   field.
6. **Turn on DKIM.** Microsoft Defender portal, Email & collaboration, Policies, Threat
   policies, Email authentication settings, DKIM, `cloudtrain.app`. Add its two `CNAME`
   records first, then turn on signing.
7. **Test.** Send from an outside address to `hello@` and to one alias, and reply from
   `hello@`. In the received reply's headers, check `spf=pass`, `dkim=pass` and
   `dmarc=pass`.

## DNS records

In the `cloudtrain.app` zone, next to the website's `A` records
([deploy-site-vm.md](deploy-site-vm.md#infrastructure-to-create)). Placeholders in
angle brackets come from the admin center or the Defender portal.

| Type | Name | Value | Notes |
|---|---|---|---|
| `TXT` | `@` | `MS=ms<number>` | Domain verification, from step 1 |
| `MX` | `@` | `<tenant MX host>`, priority 0 | From the admin center, e.g. `cloudtrain-app.mail.protection.outlook.com` or a `*.mx.microsoft` host |
| `TXT` | `@` | `v=spf1 include:spf.protection.outlook.com -all` | Only Microsoft 365 sends as `@cloudtrain.app`. ACS sends from `notify.cloudtrain.app`, with records of its own (see below). One SPF record per name |
| `CNAME` | `autodiscover` | `autodiscover.outlook.com` | Outlook account setup |
| `CNAME` | `selector1._domainkey` | `<selector1 value from Defender>` | DKIM |
| `CNAME` | `selector2._domainkey` | `<selector2 value from Defender>` | DKIM |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@cloudtrain.app; adkim=s; aspf=s` | Start in report-only mode |
| `CAA` | `@` | Not set | Cloudflare issues the edge certificate from several authorities, and a narrow record can break it |

**DMARC rollout.** Leave `p=none` for two to four weeks and read the reports in
`dmarc@`. When only Microsoft 365 shows up, and it passes, change to `p=quarantine`.
A few weeks later, change to `p=reject`. Every service that sends as `@cloudtrain.app`
must pass SPF or DKIM before you tighten the policy, or its mail is lost.

## Outgoing application mail

The website's worker Function app (`services/site-api`, [deploy-site-vm.md](deploy-site-vm.md))
sends through **Azure Communication Services Email**, authenticated with its managed identity:
there is no connection string and no key.

```ts
new EmailClient(endpoint, new ManagedIdentityCredential({ clientId }))
```

| Setting on the worker | Value |
|---|---|
| `SITE_ACS_ENDPOINT` | `https://<resource>.<geography>.communication.azure.com` |
| `AZURE_CLIENT_ID` | The worker's identity, which needs permission to send on the ACS resource |
| `SITE_MAIL_SENDER` | Default `no-reply@notify.cloudtrain.app` |
| `SITE_MAIL_REPLY_TO` | Default `hello@cloudtrain.app`, so a reply reaches a person |
| `SITE_MAIL_DAILY_CAP` | Default 500. The most confirmation and welcome mails a day, whatever the traffic |
| `SITE_MAIL_PER_SUBJECT_PER_HOUR` | Default 3 confirmation mails to one address |

The subdomain `notify.cloudtrain.app` keeps this mail's reputation apart from the mailboxes. It is
verified on the ACS resource, which adds its own verification `TXT`, an SPF record and DKIM `CNAME`s
under `notify`. None of it touches the apex records above. Add the subdomain to what you read in the
DMARC reports before tightening the policy.

### What is sent

Only waitlist and privacy messages. Nothing is marketing.

| Mail | When | Leave link |
|---|---|---|
| Welcome | A new waitlist row. Not a duplicate, not the honeypot | Yes |
| Confirm your privacy request | A request on `/legal/privacy-request` | No: it holds its own link |
| Result of a request, or a copy of the data | After the worker has written the ledger | No |
| You have left | After a leave link was confirmed | No: one brief notice, no links |

Later status mail (a changed opening date, an entry about to expire) must go through
`sendWaitlistMail` in `services/site-api/src/worker/requests.ts`, which checks at send time that the
row still exists and adds the leave link.

**No tracking.** Every send sets `disableUserEngagementTracking`, and the templates hold no pixels.

**Templates** are pure functions returning `{ subject, html, text }` from
`packages/email-templates`. The worker imports them in one place,
`services/site-api/src/worker/email-templates.ts`.

### What Azure keeps

From [Microsoft's privacy page](https://learn.microsoft.com/en-us/azure/communication-services/concepts/privacy)
and [email logs reference](https://learn.microsoft.com/en-us/azure/communication-services/concepts/analytics/logs/email-logs), read on 2026-11-02:

- Message content is processed "in real-time". The page gives no storage period for it.
- For spam and abuse prevention, the service "temporarily retains recipient email addresses that
  resulted in hard bounced messages". It gives no period and no way to delete one. The privacy
  notice says this. **Ask Microsoft for the period if a request ever turns on it.**
- The diagnostic categories **Email Status Update** and **Email User Engagement** hold the recipient
  address in `RecipientId`. **Email Send Mail** holds only counts. Send the first to a workspace only
  if you need delivery troubleshooting, with a short retention, since an erasure cannot reach into
  it without a purge in Azure Monitor. The default in this design is not to enable them: see
  [deploy-site-vm.md](deploy-site-vm.md).

### Replacing the provider

ACS Email retires on **2028-09-30**. The worker talks to one interface, `Mailer` in
`services/site-api/src/mailer.ts`, which has one implementation, `AcsMailer`. A new provider is one new
class, one line in `wiring.ts`, and new DNS records under `notify`.

The gateway keeps its own SMTP client (`CT_SMTP_HOST`, `CT_SMTP_PORT`, `CT_SMTP_FROM`) for platform mail
such as invitations. It does not run on the website VM.
