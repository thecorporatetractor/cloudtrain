# Contributing to CloudTrain

## Before your first pull request

CloudTrain is source-available under the Business Source License 1.1, and its
lab content under CC BY-NC 4.0 (see [NOTICE](NOTICE)). To keep that model
possible, every contributor signs the [Contributor License Agreement](CLA.md)
once; the CLA check on your first pull request walks you through it.

## Ground rules

- **Original content only.** Labs use fictional organisations, node names,
  namespaces and resources. Never copy tasks or wording from certification
  exams or question banks; `lab-verify` scans for known exam identifiers.
- **Every lab must verify.** A lab is accepted when `labctl verify` passes:
  checks fail before the solution and pass after it, every misconception
  mutation fails its `expectFail` checks, alternatives pass, teardown is clean.
- **Match the surrounding code.** Same naming, comment density and idioms.

## Checks to run

```bash
pnpm -r build && pnpm -r test
node tools/lab-verify/bin/lab-verify.mjs --strict
cd services/lab-orchestrator && go vet ./... && go test ./...
```

Lab changes also need a live run on the local stack
([docs/dev-environment.md](docs/dev-environment.md)):

```bash
task dev:up
task lab:verify -- --only <lab-id> ../../content/packs/kubernetes/labs
```

## Dependencies

Only add dependencies under permissive licenses (MIT, BSD, ISC, Apache-2.0,
MPL-2.0 at file level). No GPL, LGPL or AGPL in anything linked into CloudTrain.
After changing dependencies, regenerate the inventory with
`tools/licenses/inventory.sh`.
