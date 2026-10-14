# CloudTrain web

Learner, manager, instructor, author, org-admin and platform-admin UI. Vite + React 18 + TypeScript (strict), TanStack Router/Query, Radix primitives, xterm.js, React Flow.

```sh
pnpm install
pnpm --filter web dev        # http://localhost:5173, mock API via MSW
pnpm --filter web build      # typecheck + production bundle
```

## API modes

| Mode | How | What |
|---|---|---|
| mock (default) | `pnpm --filter web dev` or `task dev:web:mock` | Everything runs in the browser (MSW); no backend or cluster. Two fictional organisations with people in every role; a **persona switcher** in the navigation footer signs you in as any of them. |
| real | `VITE_API_MODE=real`, i.e. `task dev:web` | Vite proxies `/api`, including the terminal and observe WebSockets, to `services/gateway` (`CT_GATEWAY_URL`, default `http://127.0.0.1:8787`). Identity, assignments, teams, cohorts, admin and platform calls go to the gateway endpoints in `docs/api/platform.md`; Home and skill states are the gateway's learner model; only Scenario Studio stays in MSW (no backend yet). |

Real mode needs the stack: `task dev:orchestrator`, `task dev:gateway`, `task dev:web`
(see `services/gateway/README.md`). In the workspace the terminals wait behind an
environment panel (per-node progress, or the failure reason) until the session is
Ready, then attach real shells through the gateway (`src/lib/remoteShell.ts`).
Validate shows the grader's per-check results, or a clear state when no grader
answered in time or grading failed. `End lab` deletes the session.

`node apps/web/scripts/smoke-real.mjs` drives that flow headlessly with system
Chromium (playwright-core) and writes `docs/screenshots/real/`.

## Identity and roles

Sign-in is identity-first (`/sign-in`): the email's domain decides between the
organisation's identity provider ("Continue with Microsoft Entra ID") and a
CloudTrain password. In real mode the browser is handed to `/api/auth/login`,
which starts the OIDC flow at Keycloak; mock mode completes the login in place
(any password of four characters or more). A 401 on any request sends the user
back to sign-in with `returnTo` and, when they had a session, `reason=expired`.
The user menu switches organisation (`POST /api/me/org`) and signs out.

Navigation, the command palette, the `g …` hotkeys and the routes are gated by
the **permission list** on `/api/me` (`src/app/access.tsx`, `ROUTE_ACCESS`);
components never look at role names. Direct URLs to forbidden screens render a
403 state. Areas:

| Who | Screens |
|---|---|
| Learner | Home (recommendations + assignments due), Catalog, Lab, Workspace (with the "an instructor is observing" banner and cohort hints), Skills, My assignments, History, Exams (reserved for the exam engine). |
| Manager | Team dashboard (team selector, members × competencies heatmap, framework readiness, minutes, at-risk list, CSV export), member drill-down, Assign flow, Assignments list, team exam readiness (reserved). |
| Instructor | Cohorts (list, create), live board (phase, checks, time on task, hints, stuck signal, 5 s refresh), read-only shadow terminal (`?observe=1` WebSocket; scripted in mock mode), extend / reset / terminate with confirmations, broadcast. |
| Author | Scenario Studio. |
| Org admin | `/admin`: Overview, Users (search, filters, invite, roles and teams, deactivate with its effects spelled out), Teams (tree, members, managers), Single sign-on (connections, OIDC/SAML wizard, domain verification with the DNS TXT record, group → role/team mapping, test, enforce), Content (packs, labs, pinned paths), Sessions (terminate), Usage & quotas, Audit log (filters, detail drawer, CSV), Settings. |
| Platform admin | `/platform`: Organisations (create, suspend, quotas), Capacity (nodes, VMs, warm pools, sessions by org), Global content. |

Mock accounts live in `src/mocks/fixtures/platform.ts` (Quillmoor Logistics,
SSO enforced; Acme Freight, passwords). Gaps against the shared contract are
listed in `docs/api-requests.md`.

## Layout

| Path | What |
|---|---|
| `src/styles/tokens.css` | Design tokens. One neutral ramp, one accent, four muted status colours. Themes: `dark` (default), `light`, `cream`, switched with `<html data-theme>` and persisted in `localStorage`. |
| `src/components/ui` | Button, Badge, Card, Meter, Kbd, Dialog, Dropdown, Tooltip, Segmented, Stat, empty/error/skeleton states; `forms.tsx` adds Field, Input, Select, Checkbox, Switch, ChipSelect, ConfirmDialog, Drawer, Pager, TabNav, Toolbar, table helpers. |
| `src/components/platform.tsx` | Assignment/outcome/phase badges, due dates, user cells and other bits shared by the role areas. |
| `src/components/workspace` | Lab workspace parts: task panel, terminal area (tabs + split panes), xterm wrapper, topology canvas, timer, read-only observe terminal. |
| `src/lib/fakeShell.ts` | Mock-mode in-browser shell and link capture. |
| `src/lib/remoteShell.ts` | Real-mode terminal: xterm.js over the gateway WebSocket. `observeShell.ts` is the instructor's read-only mirror (and its mock-mode replay). |
| `src/lib/personalize.ts` | Fills a session's `{{params}}` and revealed hints into the lab. |
| `src/api` | Query hooks (`client.ts` for labs and sessions, `platform.ts` for identity, assignments, teams, cohorts, admin, platform); types come from `packages/api-types` (shared with the gateway); `mode.ts` picks mock or real. Mutating requests carry the CSRF token from `/api/me`. |
| `src/mocks` | MSW handlers (`handlers.ts`, `platformHandlers.ts`) and fixtures. Lab shapes follow `packages/lab-schema` (`cloudtrain.dev/v3`). All names are fictional (Quillmoor Logistics, Acme Freight). |
| `src/routes` | One file per screen; `admin/` and `platform/` hold the two areas with their tab layouts. |
| `src/app` | Shell (nav sections, theme, user menu with org switcher, persona switcher, toasts), auth gate, permission map, command palette, shortcut cheatsheet. |

## Keyboard

Press `?` anywhere for the cheatsheet. `Ctrl/⌘ K` opens the palette; `g` then `h/c/s/m/y/e/t/o/a/d/p` navigates (home, catalog, skills, my assignments, history, exams, team, cohorts, studio, admin, platform; only the destinations you may open). In the workspace: `Ctrl/⌘ ↵` validates, `Ctrl/⌘ ⇧ O/X/D` opens, closes and splits consoles, `Ctrl/⌘ ⇧ B` hides the task panel and `Ctrl/⌘ ⇧ ←/→` docks it, `Ctrl/⌘ ⇧ G` toggles the topology, `Ctrl/⌘ ⇧ F` goes full-screen, `Alt [ ]` and `Alt 1–9` switch console tabs.

Workspace shortcuts deliberately avoid keys a shell owns: readline's `Alt B/F/D/T` and `Ctrl K/U/W/A/E/L` all reach the terminal, and `Ctrl K` / `Ctrl /` do not open the palette or cheatsheet while a terminal has focus. Modifier combinations match the physical key (`KeyboardEvent.code`), so they also work with Option on macOS and do not swallow dead keys.

Permission gating (`src/app/access.tsx`) applies to the nav, the command palette, the `g …` hotkeys and the routes themselves. Tables are usable at 1280 px (horizontal scroll inside the card below that); list rows that open a drawer are focusable and respond to Enter/Space.

## Mocks

The mock API runs in the browser through a service worker (`public/mockServiceWorker.js`) in dev, or in a production build when `VITE_MOCK_API=1`. Sessions, studio drafts and every admin mutation live in memory and reset on reload; the signed-in persona is kept in `localStorage` (`ct.mock.session`). Every endpoint in `docs/api/platform.md` has a handler, including the CSV exports and 401/403/409/422 answers.

Screenshots of every screen in all three themes are in `docs/screenshots/`; the role-based views are under `docs/screenshots/platform/` (`node apps/web/scripts/platform-shots.mjs` against a dev server on port 5199).
