# CloudTrain web

Learner, instructor, author and admin UI. Vite + React 18 + TypeScript (strict), TanStack Router/Query, Radix primitives, xterm.js, React Flow.

```sh
pnpm install
pnpm --filter web dev        # http://localhost:5173, mock API via MSW
pnpm --filter web build      # typecheck + production bundle
```

## Layout

| Path | What |
|---|---|
| `src/styles/tokens.css` | Design tokens. One neutral ramp, one accent, four muted status colours. Themes: `dark` (default), `light`, `cream`, switched with `<html data-theme>` and persisted in `localStorage`. |
| `src/components/ui` | Button, Badge, Card, Meter, Kbd, Dialog, Dropdown, Tooltip, Segmented, Stat, empty/error/skeleton states. |
| `src/components/workspace` | Lab workspace parts: task panel, terminal area (tabs + split panes), xterm wrapper, topology canvas, timer. |
| `src/lib/fakeShell.ts` | Dev-only in-browser shell and link capture. Replaced by `services/terminal-gateway` later. |
| `src/mocks` | MSW handlers and fixtures. Shapes follow `packages/lab-schema` (`cloudtrain.dev/v3`). All names are fictional (Tessera Freight). |
| `src/routes` | One file per screen: Home, Catalog, LabOverview, Workspace, Skills, Studio, StudioDraft, Team. |
| `src/app` | Shell (nav, theme, user menu, toasts), command palette, shortcut cheatsheet. |

## Keyboard

Press `?` anywhere for the cheatsheet. `Ctrl/⌘ K` opens the palette; `g` then `h/c/s/t/a` navigates. In the workspace: `Ctrl/⌘ ↵` validates, `Ctrl/⌘ ⇧ O/X/D` opens, closes and splits consoles, `Ctrl/⌘ ⇧ B` hides the task panel and `Ctrl/⌘ ⇧ ←/→` docks it, `Ctrl/⌘ ⇧ G` toggles the topology, `Ctrl/⌘ ⇧ F` goes full-screen, `Alt [ ]` and `Alt 1–9` switch console tabs.

Workspace shortcuts deliberately avoid keys a shell owns: readline's `Alt B/F/D/T` and `Ctrl K/U/W/A/E/L` all reach the terminal, and `Ctrl K` / `Ctrl /` do not open the palette or cheatsheet while a terminal has focus. Modifier combinations match the physical key (`KeyboardEvent.code`), so they also work with Option on macOS and do not swallow dead keys.

Role gating (`src/app/access.tsx`) applies to the nav, the command palette, the `g t` / `g a` hotkeys and the `/team` and `/studio` routes themselves.

## Mocks

The mock API runs in the browser through a service worker (`public/mockServiceWorker.js`) in dev, or in a production build when `VITE_MOCK_API=1`. Sessions and studio drafts live in memory and reset on reload.

Screenshots of every screen in all three themes are in `docs/screenshots/`.
