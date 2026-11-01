# Licensing

> This page explains CloudTrain's licensing model in plain
> language. It is not legal advice and it is not the license: the binding texts are
> [LICENSE](../LICENSE) (software, Business Source License 1.1),
> [content/LICENSE](../content/LICENSE) (lab content, CC BY-NC 4.0) and
> [content/LICENSE-ADDITIONAL-PERMISSION.md](../content/LICENSE-ADDITIONAL-PERMISSION.md).
> Where this page and those texts differ, the texts apply. Ask your own counsel
> about your situation.

CloudTrain is **source-available**, not open source. In short:

1. **Self-hosting is free for everyone, for any purpose except selling it or
   offering it to others as a service.** That includes companies training their
   own staff.
2. **Premium enterprise features need a license key** (a paid subscription),
   whether you self-host or use the hosted service.
3. **The hosted service** run by CloudTrain is paid per compute used, plus
   subscription tiers for the premium features.

## What is free, what needs a key, what is paid hosting

| | Free (self-hosted) | Needs a license key | Paid hosting (CloudTrain) |
| --- | --- | --- | --- |
| Run the platform on your own infrastructure | yes, any purpose except offering it to third parties as a service or reselling it | no | not needed |
| Train your own employees, contractors and affiliates' staff, including in a commercial company | yes (software and content) | no | optional |
| Labs, grading, skill graph, paths, assessments for your own people | yes | no | included |
| Local accounts in the bundled identity provider, roles, teams, standard progress reports, the audit log in the UI | yes | no | included |
| Premium features (see the [table below](#premium-features)) | no | yes, in production | subscription tier |
| Evaluate, develop, test or modify the code, including premium features | yes (non-production use) | no | not applicable |
| Lab compute | your own infrastructure, your cost | no | per compute consumed |
| Offer CloudTrain, its labs or assessments to third parties as a hosted, managed, embedded or commercial service, or resell it | no | a key is not enough: needs a separate commercial license | CloudTrain's own service |

The Business Source License does not define "production use". As it is commonly
read, running the platform for real users and real training is production use;
evaluating, developing and testing it is not.

## Premium features

These features are designated as requiring a license key ("Licensed Features" in
the [LICENSE](../LICENSE) Additional Use Grant). They are enforced in code by the
license-key system. **This table is the list the license refers to**; it is kept in
one place so the code and the docs can be updated together. A feature added here
applies from the version that adds it; it does not change versions already
published.

| Feature | What it covers | Entitlement (in the license key) |
| --- | --- | --- |
| SSO with external identity providers | Signing in through your own OpenID Connect or SAML identity provider (Entra ID, Okta, Google Workspace, Keycloak and others), group-to-role mapping from that provider | `sso` |
| SCIM provisioning | Creating, updating and deactivating users and groups from your identity provider over SCIM | `scim` |
| Audit log export | Exporting or streaming the audit log to an external system (SIEM, object storage) | `audit_export` |
| Advanced manager analytics | Team and cohort analytics beyond the standard progress views: readiness trends and skill-gap reports across teams and cohorts | `advanced_analytics` |
| Exam-simulation certificates | Issuing certificates of completion for exam simulations | `exam_certificates` |
| Custom branding | Your own logo, colours, domain and email templates | `custom_branding` |
| Multiple organisations per installation | More than one organisation (tenant) on a single installation | `multi_org` |

The entitlement names are provisional until the license-key system ships; the
code is the source of truth for them.

Without a valid key these features stay off. You may still read, build, modify and
test their code in non-production use. You may not remove, disable or work around
the license-key checks (see the next section).

## The rules in more detail

### Software (Business Source License 1.1)

The [LICENSE](../LICENSE) lets you copy, modify, redistribute and make
non-production use of CloudTrain. Its **Additional Use Grant** also allows
production use **for any purpose**, as long as you do not:

- **(a)** provide CloudTrain, or substantially its functionality, to third parties
  as a hosted, managed, embedded or other commercial training, lab-environment or
  assessment offering, or sell, resell, rent or sublicense it; or
- **(b)** use the premium features above in production without a valid license key
  from CloudTrain, or move, change, disable or circumvent the license-key
  functionality, or remove or obscure functionality the key protects.

"Your organization" includes your affiliates (entities under common control).
Anyone outside your organization and its personnel is a third party.

### Lab content (CC BY-NC 4.0 plus an additional permission)

The lab content in `content/` is under [CC BY-NC 4.0](../content/LICENSE),
unchanged. CC licenses let the licensor grant more than the license does, so
CloudTrain adds a separate
[additional permission](../content/LICENSE-ADDITIONAL-PERMISSION.md): you may use
and adapt the content on a self-hosted installation to train your own
organization's personnel, **even in a commercial organization**. Using the
content to train third parties commercially still needs a commercial license.
When you share the content or adaptations, credit "CloudTrain", link
to the license and indicate changes.

### Hosted service

CloudTrain's hosted service is paid per compute consumed (lab minutes, by compute
tier), plus subscription tiers that include the premium features. Its terms of
service govern use of the service; see [billing.md](billing.md) for how metering
works.

## Already-published versions

Each version of CloudTrain is licensed under the terms it was published with.
**Versions published before this change keep their earlier terms**, including their
earlier Additional Use Grant and their own Change Date; this change applies to the
version that introduces it and later versions. The same holds for the content.

## FAQ

**Can my company use CloudTrain internally?**
Yes, free, including a commercial company training its own employees, contractors
and affiliates' staff on its own installation. You need a license key only if you
want the premium features in production (for example SSO with your corporate
identity provider or SCIM).

**Can I sell training with it?**
Not under the free terms. Running paid courses, bootcamps, certification
preparation or assessments for other people or companies, offering CloudTrain as a
hosted or managed service, embedding it in a product you sell, or reselling it
needs a separate commercial license from CloudTrain. A license key for premium
features does not grant this. Contact CloudTrain (hello@cloudtrain.app).

**Can I train a customer's staff on my installation?**
A customer's staff are third parties, so this is a third-party offering and needs a
commercial license. Training your own contractors who work for your organization is
fine.

**Can I fork it?**
Yes. You may fork, modify and redistribute the code. Forks stay under the
Business Source License with the same Additional Use Grant, so the same limits
apply to anyone who runs them in production: no selling it as a service, and no
removing or bypassing the license-key checks. Keep the LICENSE and NOTICE files.
Forks of the content stay under CC BY-NC 4.0 with attribution.

**Can I use the premium features to evaluate them?**
Yes, in non-production use (evaluation, development, testing). For production
use you need a valid key.

**What happens at the Change Date?**
Four years after a version is first publicly distributed, that version (and only
that version) becomes available under the Apache License, Version 2.0. From then
on the Additional Use Grant's limits, including the license-key condition, no
longer apply to that version under copyright. Newer versions keep their own,
later Change Dates. The Change Date does not affect the lab content (CC BY-NC 4.0),
trademarks, or the hosted service, which remains a paid service.

**What does "license key" mean if I self-host?**
A key issued by CloudTrain with a paid subscription. The platform checks it and
turns on the premium features it covers.

**Can I contribute?**
Yes, see [CONTRIBUTING.md](../CONTRIBUTING.md). Contributors sign the
[CLA](../CLA.md) (draft), which lets CloudTrain keep offering this model.
