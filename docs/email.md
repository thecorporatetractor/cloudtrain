# Email for cloudtrain.app

How the contact addresses for `cloudtrain.app` are set up in Microsoft 365, and the DNS
records they need. The website lists one address, `hello@cloudtrain.app`
(`contact.email` and `contact.salesEmail` in `content/site.yaml`).

Neither the website nor the gateway sends email today. The waitlist stores entries, and
nobody gets an automatic message. Outgoing application mail is covered at the end.

## Mailbox layout

One **shared mailbox**, `hello@cloudtrain.app`, with the other role addresses as
aliases of it. A shared mailbox needs no license of its own (up to 50 GB). Every
person who reads it needs an Exchange Online license (Business Basic or higher), and
gets Full Access and Send As on the mailbox. Nobody signs in to the shared mailbox
itself.

| Address | Kind | Used for |
|---|---|---|
| `hello@cloudtrain.app` | Shared mailbox | Contact page, general questions, Let's Encrypt and budget alerts |
| `sales@cloudtrain.app` | Alias of `hello@` | Team and pilot enquiries. Point `contact.salesEmail` here once it exists |
| `privacy@cloudtrain.app` | Alias of `hello@` | Data requests (the privacy notice should name it) |
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
   Set-Mailbox hello@cloudtrain.app -EmailAddresses @{add='smtp:sales@cloudtrain.app','smtp:privacy@cloudtrain.app','smtp:security@cloudtrain.app','smtp:billing@cloudtrain.app','smtp:legal@cloudtrain.app','smtp:dmarc@cloudtrain.app','smtp:postmaster@cloudtrain.app','smtp:abuse@cloudtrain.app'}
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
| `TXT` | `@` | `v=spf1 include:spf.protection.outlook.com -all` | Only Microsoft 365 sends as `@cloudtrain.app`. Add every new sender here (see below); one SPF record per name |
| `CNAME` | `autodiscover` | `autodiscover.outlook.com` | Outlook account setup |
| `CNAME` | `selector1._domainkey` | `<selector1 value from Defender>` | DKIM |
| `CNAME` | `selector2._domainkey` | `<selector2 value from Defender>` | DKIM |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@cloudtrain.app; adkim=s; aspf=s` | Start in report-only mode |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | Optional: only Let's Encrypt may issue certificates for the website |

**DMARC rollout.** Leave `p=none` for two to four weeks and read the reports in
`dmarc@`. When only Microsoft 365 shows up, and it passes, change to `p=quarantine`.
A few weeks later, change to `p=reject`. Every service that sends as `@cloudtrain.app`
must pass SPF or DKIM before you tighten the policy, or its mail is lost.

## Outgoing application mail (later)

The gateway has an SMTP client (`CT_SMTP_HOST`, `CT_SMTP_PORT`, `CT_SMTP_FROM`) for
platform mail such as invitations. None of it is used by the website VM. When the
platform goes live, send its mail through a transactional service, not the shared
mailbox. Microsoft is retiring basic-auth SMTP submission for Exchange Online. Two
options:

- **Azure Communication Services Email** with the custom domain `cloudtrain.app`, or a
  subdomain such as `mail.cloudtrain.app` to keep its reputation apart. It adds its own
  verification `TXT`, an SPF include and DKIM `CNAME`s.
- **Another transactional provider** (Postmark, Amazon SES and similar), with the same
  kind of records.

Send from `no-reply@cloudtrain.app` (or the subdomain) with `Reply-To:
hello@cloudtrain.app`. Update the SPF record before the first message goes out.
