# Telemetry estate: hand-run apply runbook (to be retired)

Saltmarsh runs the same four root modules for every region and environment.
Today an engineer copies `~/estate/<env>/<region>/<module>` directories and
applies them by hand, region by region.

## Root modules (sources in ~/estate/modules)

| Module       | Source                 | Reads outputs of            |
|--------------|------------------------|-----------------------------|
| network      | ./modules/network      | (nothing)                   |
| cluster      | ./modules/cluster      | network (subnet ids)        |
| telemetry    | ./modules/telemetry    | cluster (endpoint), network (vpc id) |
| dashboards   | ./modules/dashboards   | {{dashsrc}} |

Apply order used today: network, cluster, telemetry, dashboards (each waits
for the previous one to finish, even where it reads nothing from it).

## Where it runs

- Environments: `staging`, `prod`
- Regions: `north-sea`, `irish-sea`, `celtic-sea`, `fens`, `pennines`, `highlands`
- Every environment runs in every region (12 copies of each module today).

## Change rules

1. Staging applies without a human review.
2. Production applies only after a human approves the plan.
