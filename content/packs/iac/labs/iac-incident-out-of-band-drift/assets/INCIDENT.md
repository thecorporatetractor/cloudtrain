# INC-2291: trading desk outage (2026-10-12) - security group follow-up

During the outage three ingress rules were added by hand to `trading-desk-app`:

| Port | Source         | Status                                              |
|------|----------------|-----------------------------------------------------|
| {{port}} | 10.47.32.0/20 | APPROVED (CHG-{{chg}}, market data feed) - keep, description "Market data feed (CHG-{{chg}})" |
| 3389 | 0.0.0.0/0      | not approved - remove                               |
| 9229 | 10.0.0.0/8     | not approved - remove                               |

Terraform does not know about any of them: separate rule resources are only managed
when they are in state.
