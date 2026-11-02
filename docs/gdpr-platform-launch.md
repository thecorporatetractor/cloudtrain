# Privacy notice text to add back when the platform launches

**This is a launch gate.** The privacy notice (`legal.privacy` in `content/site.yaml`) describes
what the live website does: a coming-soon page and a waitlist, with no sign-in and no charges. The
wording below was taken out on 2026-11-02 because none of it is true yet. Before sign-in, labs or
billing go live, put the matching wording back, check it against what is then running, change the
notice's `updated` date, and tell the people on the waitlist of the material change.

| Goes live | Add back |
|---|---|
| Sign-in, labs, exams | "Account and labs", "Terminal contents", "Service emails", the organisation paragraph, "Automated decisions", account retention, the identity provider recipient |
| Paid plans | "Billing", Stripe as a recipient and in the transfers paragraph, billing-records retention |

Every paragraph holding `: ` must be quoted in `site.yaml`, or it becomes a YAML mapping and the
gateway refuses the file. `node tools/lab-verify/bin/lab-verify.mjs --strict` checks the real file.

## Who is responsible

> This notice covers the website and the hosted CloudTrain service. If your organisation runs
> CloudTrain itself, that organisation is responsible for the data on its installation, and you
> should ask it.

## What else we process and why

> Account and labs. When you sign in, your identity provider or our sign-in service gives us your
> name, email address and the groups that map to your role. We then process your lab and exam
> activity (attempts, check results, skill evidence), terminal session metadata, and the settings of
> your organisation. We use them to run your labs and exams, to compute your mastery and
> recommendations, and to let your organisation's managers and instructors see the progress they are
> entitled to. The legal basis is the contract with you or with your organisation (Art. 6(1)(b)).

> Terminal contents. They are streamed to your browser and are not recorded. If an instructor
> observes a session, the learner sees a banner and the observation is logged.

> Billing. For paid use we process your plan, the compute minutes your labs use, invoices and
> payment status. Stripe collects and keeps your card details; we receive a customer reference, the
> plan and payment status, and invoice data. The legal bases are contract (Art. 6(1)(b)) and our
> legal obligations on accounting and tax records (Art. 6(1)(c)).

> Service emails. When email sending is enabled, we send messages the service needs, such as a
> registration or sign-in confirmation, invitations and billing notices. They are not marketing. The
> legal basis is contract (Art. 6(1)(b)).

> Security and audit logs. We keep an audit log of administrative actions and security logs of
> access and deletion events, which include account identifiers and IP addresses. We use them to keep
> the service secure and to investigate abuse. The legal basis is our legitimate interest in the
> security of the service (Art. 6(1)(f)). You can object to this (see your rights).

Messages to us: add "or, if you are a customer, the contract" after the legitimate interest.

## Who receives your data

> Stripe, which processes payments

> Your organisation's administrators and instructors see the learning data of their members, as
> described above. If you sign in through your organisation's identity provider, such as Microsoft
> Entra ID, that provider knows you signed in to CloudTrain.

## Transfers outside the EU

Name Stripe with Cloudflare and Microsoft among the providers that are or may be based in, or
support their services from, the United States.

## How long we keep it

> Waitlist entries: ... no longer than 24 months after you joined, unless you have become a user.

> Account, lab and exam data: while your account is active, and deleted or anonymised within 90 days
> after the account is closed.

> Billing records: as long as tax and accounting law requires.

The backup line then also has to cover the platform's database.

## Your rights

> If you use CloudTrain through your organisation, your organisation's administrator can help as well.

## Automated decisions

> Labs and exam simulations are graded automatically by checking the state of your environment
> against the objectives. The result and the recommendations that follow are training feedback. They
> have no legal or similarly significant effect on you, and the service issues no certificate or
> qualification. We make no decisions about you based solely on automated processing that have such
> an effect. If your organisation uses results in its own decisions, such as for training or hiring,
> that is the organisation's responsibility and you should ask it.

## Security

> Each lab environment is isolated and destroyed after the session.

## Terms of service

Under "Accounts, plans and payment":

> Payments are processed by Stripe; the service never stores card details.
