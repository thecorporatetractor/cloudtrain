# gateway

Backend-for-frontend for `apps/web`. TypeScript, Node 22, Fastify. It serves the
paths and shapes the web app's mock API defines (`packages/api-types`, mirrored by
`apps/web/src/mocks/handlers.ts`), backed by the real content and the real lab
runtime:

| Area | Source |
|---|---|
| Catalog, labs, skills, frameworks | `content/` (`skills.yaml`, `frameworks/*.yaml`, `packs/*/pack.yaml` + `labs/*/lab.yaml`), read once at startup and validated with `@cloudtrain/lab-schema` |
| Sessions | `LabTemplate` + `LabSession` objects (`labs.cloudtrain.dev/v1alpha1`) in the cluster, reconciled by `services/lab-orchestrator` |
| Grading | the LabSession validation contract (`spec.validateRequest` / `status.validation`, see `docs/k8s-readiness.md`) |
| Terminal | WebSocket -> Kubernetes exec into the node's `k8s-exec` endpoint, with TTY and resize |
| Learner model (Home, mastery numbers, skill states) | **sample data** computed in `src/learner/sample.ts`; no backend exists yet |
| Team, Scenario Studio | **not served**; the web app keeps them in MSW even in real mode |

## Run

```sh
task dev:orchestrator   # CRDs if absent + local manager, scoped to CT_NAMESPACE
task dev:gateway        # builds labctl and lab-schema, creates CT_NAMESPACE, listens on 127.0.0.1:8787
task dev:web            # apps/web with VITE_API_MODE=real, proxied to the gateway
```

To also serve the container-only smoke lab (`test/fixtures/labs/gateway-smoke`,
the one lab the current orchestrator can run without the vm/k8s-cluster drivers):

```sh
CT_EXTRA_LAB_DIRS=services/gateway/test/fixtures/labs task dev:gateway
```

| Variable | Default | |
|---|---|---|
| `CT_HOST` / `CT_PORT` | `127.0.0.1` / `8787` | listen address |
| `CT_KUBE_CONTEXT` | `kind-cloudtrain-dev` | kubeconfig context, selected in memory only; the kubeconfig's current-context is never changed |
| `CT_NAMESPACE` | `cloudtrain-sessions` | namespace for LabTemplates and LabSessions (must exist) |
| `CT_CONTENT_DIR` | `content` | content root |
| `CT_EXTRA_LAB_DIRS` | | extra lab directories (`:`-separated), e.g. test fixtures |
| `CT_LABCTL` | `services/lab-orchestrator/bin/labctl` | Go compiler binary (`task gateway:labctl`) |
| `CT_VALIDATE_TIMEOUT_MS` | `60000` | how long `POST /validate` waits for the grader |
| `CT_SESSION_TTL_MINUTES` | controller default | sets `spec.ttl` on new sessions |
| `CT_DEV_USER_ID`, `CT_DEV_USER_NAME`, `CT_DEV_USER_EMAIL`, `CT_DEV_ORG_ID`, `CT_DEV_ORG_NAME` | `dev-learner`, ... | the dev stub user |
| `CT_LOG_LEVEL` | `info` | |

Relative paths are relative to the repository root.

## API

All under `/api`; errors are `{ "error": "..." }` with an HTTP status.

| Method + path | |
|---|---|
| `GET /health` | no auth; lab count and content issues |
| `GET /me`, `GET /home` | stub user; Home is sample data over real lab ids |
| `GET /catalog` | domains, paths (pack courses + pack paths), lab summaries |
| `GET /labs/:id` | learner view of a lab (see below) |
| `GET /skills[?member=]` | real skill graph and frameworks, sample skill states |
| `POST /labs/:id/sessions` | compile (labctl) + create the LabTemplate if missing, create a LabSession -> `201 LabSession` |
| `GET /labs/:id/sessions`, `GET /sessions` | the caller's sessions |
| `GET /sessions/:id` | maps `status.phase`, `nodes`, `endpoints`, `expiresAt`, `resolvedParams`, `validation` |
| `DELETE /sessions/:id` | deletes the LabSession (the orchestrator's finalizer tears down) -> `204` |
| `POST /sessions/:id/validate` | bumps `spec.validateRequest`, waits for `status.validation.observedRequest` to match with phase Complete/Failed -> `ValidateResponse` (per-check results with skills, score); `grading.state` is `timeout` when no grader answered, `failed` when grading broke; `409` unless the session is Ready |
| `POST /sessions/:id/hints/:index` | records the reveal in the `cloudtrain.dev/revealed-hints` annotation, returns the session with the hint content |
| `GET /sessions/:id/terminal?node=&cols=&rows=` | WebSocket terminal (below) |

What leaves the gateway is the learner's view only: expected values, check
commands and queries, setup/teardown, solutions and misconceptions are never sent;
hint text is withheld until revealed; grader `output` (author-only) is dropped.
`{{params}}` stay in the lab text; the session carries `params` and the web app
fills them in.

Every session call checks `spec.learner.id` against the caller; another learner's
session is a 404.

### Terminal

One WebSocket per console tab. With no `node` (or the entry node) the gateway
execs a login shell in the entry node's `k8s-exec` target (`namespace/pod/container`):
the jumphost image already runs as `learner`; an image running as root with a
`learner` account switches with `su - learner`. Any other topology node, or a
kubeadm cluster member, without its own exec endpoint is reached by running
`ssh <node>` in the entry pod (as the learner).

```
client -> gateway  text   {"t":"i","d":"<keystrokes>"}   {"t":"r","c":cols,"r":rows}
gateway -> client  binary terminal output
                   text   {"t":"ready","via":"..."}  {"t":"exit","code":n}  {"t":"error","m":"..."}
```

## Auth

`src/auth.ts`: an `Authenticator` resolves each request to a `Principal`
(`sub`, `name`, `email`, `orgId`, roles, the claim set Keycloak will issue).
`DevAuthenticator` returns one stub user. OIDC slots in as another
`Authenticator` (verify the bearer token or session cookie); handlers only read
`req.principal`. Sessions are labelled with the learner and org.

## Layout

```
src/app.ts                 routes (HTTP + WebSocket)
src/auth.ts                Principal, Authenticator, dev stub
src/content/               content loader, learner view of a lab
src/kube/                  LabCluster interface, client-node implementation, labctl compiler, CRD types
src/sessions/              SessionService, LabSession -> web mapping
src/terminal/              exec target planning, WebSocket <-> exec bridge
src/learner/sample.ts      sample learner model (placeholder)
test/                      vitest; FakeCluster plays the orchestrator, grader and pod
test/fixtures/labs/        container-only smoke lab (not catalog content)
```

LabTemplates are named `<lab>-v<version>-<digest>` so an edited lab never
collides with an immutable older template.

## Test

```sh
pnpm --filter @cloudtrain/gateway test        # unit + HTTP + WebSocket against fakes; labctl tests run when the binary exists
pnpm --filter @cloudtrain/gateway typecheck
node apps/web/scripts/smoke-real.mjs          # headless browser run of the real-mode flow (stack must be running)
```
