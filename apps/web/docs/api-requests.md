# API requests from the web app

Things the web app needs from the gateway / `packages/api-types/platform.d.ts`
that are not in the contract yet, or where the web uses a local extension in the
meantime. The coordinator relays these to the platform-api stream; the web does
not edit the shared types divergently.

| # | Request | Why | Interim in the web |
|---|---|---|---|
| 1 | `POST /sessions/:id/observe` and `DELETE /sessions/:id/observe` (or an equivalent signal) in **mock mode only**; in real mode the observe WebSocket (`?observe=1`) is the source of truth. No type change needed. | MSW cannot serve WebSockets, so the shadow terminal registers the observer over HTTP to drive `BoardSession.observedBy` and the learner's `observed` notice. | Implemented in the mock only (`src/mocks/platformHandlers.ts`); `useObserveRegistration` swallows 404s in real mode. |
| 2 | `GET /platform/content` → `PlatformPack[]` (`{ id, title, domain, version, labs, orgsEnabled, global, updatedAt }`). | docs/platform-identity.md lists "global content packs" under platform admin, but the API doc has no endpoint for it. | Local type `PlatformPack` in `src/api/platform.ts`; mock handler serves it. |
| 3 | `Me.auth.idp` should carry a display name (or the sign-in page needs `AuthDiscovery.idpDisplayName` persisted on `Me`). | The user menu says "signed in through quillmoor-entra" (the alias); a display name reads better. | Shows the alias. |
| 4 | `GET /admin/users` as used by **instructors** when creating a cohort (people picker) needs a permission the instructor role lacks (`user.manage`). Either a lighter `GET /org/people` (id, name, title, teams) for `cohort.manage` / `assignment.manage` holders, or let `GET /admin/teams/:id` be readable with `progress.read.team`. | Cohort creation and the assign flow need a directory of org members. | The cohort dialog explains that learners can be added later when the users call is forbidden; the assign flow uses the team dashboard's member list. |
| 5 | `TeamDashboard.competencies` should also be available on `MemberDetail` (or `MemberDetail.mastery` keyed by `CompetencyRef`). | The member drill-down shows competency names; today it fetches the team dashboard just for the names. | Fetches `GET /teams/:id/dashboard` alongside `GET /teams/:id/members/:userId`. |
| 6 | `AssignmentDetail.statuses` for newly created assignments: the mock returns an empty list until the view materialises. Confirm the gateway returns one `not_started` row per covered user right after `POST /assignments`. | The assignment drawer shows "People" from these rows. | Shows a note when empty. |
| 7 | `Attempt`/`CheckResultRecord`: a human-readable `message`/description per check would help History; the web currently shows `message ?? checkId`. | Learners do not know check ids. | Mock fills `message` from the lab's check description. |
| 8 | `Usage.byDay` for ranges over ~45 days: the web buckets by week client-side; a `granularity=week` query param would avoid shipping 90 rows. | Usage chart readability. | Client-side bucketing. |
| 9 | `GET /auth/discover` for an unknown domain: the web expects `method: 'unknown'` (not a 404) so it can show "we do not recognise that domain". | Identity-first sign-in UX. | Mock returns `unknown`. |
| 10 | Exam engine: the web reserves `/exams` (learner) and `/team/exams` (manager) and a nav entry gated on `lab.run`. When the exam types land, the web needs: available simulations, my attempts with results, team exam readiness per framework. | New requirement from the user; UI belongs to the exam stream. | Placeholder screens (`src/routes/Exams.tsx`). |
