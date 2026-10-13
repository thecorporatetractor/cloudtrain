# CloudTrain web

Learner, instructor, author and admin UI. Vite + React 18 + TypeScript (strict), TanStack Router/Query, Radix primitives, xterm.js, React Flow.

```sh
pnpm install
pnpm --filter web dev        # http://localhost:5173, mock API via MSW
pnpm --filter web build      # typecheck + production bundle
```

## API modes

| Mode | How | What |
|---|---|---|
| mock (default) | `pnpm --filter web dev` or `task dev:web:mock` | Everything runs in the browser (MSW); no backend or cluster. |
| real | `VITE_API_MODE=real`, i.e. `task dev:web` | Vite proxies `/api`, including the terminal WebSocket, to `services/gateway` (`CT_GATEWAY_URL`, default `http://127.0.0.1:8787`). Catalog, labs, sessions, grading and terminals are real; Home and skill states are the gateway's sample learner model; Team and Studio stay in MSW (no backend yet). |

Real mode needs the stack: `task dev:orchestrator`, `task dev:gateway`, `task dev:web`
(see `services/gateway/README.md`). In the workspace the terminals wait behind an
environment panel (per-node progress, or the failure reason) until the session is
Ready, then attach real shells through the gateway (`src/lib/remoteShell.ts`).
Validate shows the grader's per-check results, or a clear state when no grader
answered in time or grading failed. `End lab` deletes the session.

`node apps/web/scripts/smoke-real.mjs` drives that flow headlessly with system
Chromium (playwright-core) and writes `docs/screenshots/real/`.

## Layout

| Path | What |
|---|---|
| `src/styles/tokens.css` | Design tokens. One neutral ramp, one accent, four muted status colours. Themes: `dark` (default), `light`, `cream`, switched with `<html data-theme>` and persisted in `localStorage`. |
| `src/components/ui` | Button, Badge, Card, Meter, Kbd, Dialog, Dropdown, Tooltip, Segmented, Stat, empty/error/skeleton states. |
| `src/components/workspace` | Lab workspace parts: task panel, terminal area (tabs + split panes), xterm wrapper, topology canvas, timer. |
| `src/lib/fakeShell.ts` | Mock-mode in-browser shell and link capture. |
| `src/lib/remoteShell.ts` | Real-mode terminal: xterm.js over the gateway WebSocket. |
| `src/lib/personalize.ts` | Fills a session's `{{params}}` and revealed hints into the lab. |
| `src/api` | Query hooks; types come from `packages/api-types` (shared with the gateway); `mode.ts` picks mock or real. |
| `src/mocks` | MSW handlers and fixtures. Shapes follow `packages/lab-schema` (`cloudtrain.dev/v3`). All names are fictional (Quillmoor Logistics). |
| `src/routes` | One file per screen: Home, Catalog, LabOverview, Workspace, Skills, Studio, StudioDraft, Team. |
| `src/app` | Shell (nav, theme, user menu, toasts), command palette, shortcut cheatsheet. |

## Keyboard

Press `?` anywhere for the cheatsheet. `Ctrl/⌘ K` opens the palette; `g` then `h/c/s/t/a` navigates. In the workspace: `Ctrl/⌘ ↵` validates, `Ctrl/⌘ ⇧ O/X/D` opens, closes and splits consoles, `Ctrl/⌘ ⇧ B` hides the task panel and `Ctrl/⌘ ⇧ ←/→` docks it, `Ctrl/⌘ ⇧ G` toggles the topology, `Ctrl/⌘ ⇧ F` goes full-screen, `Alt [ ]` and `Alt 1–9` switch console tabs.

Workspace shortcuts deliberately avoid keys a shell owns: readline's `Alt B/F/D/T` and `Ctrl K/U/W/A/E/L` all reach the terminal, and `Ctrl K` / `Ctrl /` do not open the palette or cheatsheet while a terminal has focus. Modifier combinations match the physical key (`KeyboardEvent.code`), so they also work with Option on macOS and do not swallow dead keys.

Role gating (`src/app/access.tsx`) applies to the nav, the command palette, the `g t` / `g a` hotkeys and the `/team` and `/studio` routes themselves.

## Mocks

The mock API runs in the browser through a service worker (`public/mockServiceWorker.js`) in dev, or in a production build when `VITE_MOCK_API=1`. Sessions and studio drafts live in memory and reset on reload.

Screenshots of every screen in all three themes are in `docs/screenshots/`.
