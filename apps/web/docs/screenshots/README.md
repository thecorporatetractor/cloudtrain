# Screenshots

Captured headlessly at 1440×900 (and a few at 1280×900, suffixed `-1280`) against the MSW mock API, one file per screen and theme: `<screen>-<dark|light|cream>.png`.

Screens: `home`, `catalog`, `catalog-path`, `lab-overview`, `workspace`, `workspace-validated` (second console, link capture and a validation run), `workspace-fullscreen` (task panel docked right, topology hidden), `skills`, `studio`, `studio-draft` (failed gate), `studio-review` (diff + publish), `team`, `palette`, `shortcuts`, `notfound`.

## Platform views (`platform/`)

Captured by `scripts/platform-shots.mjs` with one mock persona per area. The public website (signed out): `landing` (+ `-phone`, `-tablet`), `site-menu-phone`, `catalog-public` (+ `-domain`, `-phone`), `catalog-path-public`, `catalog-exam-public`, `pricing`, `about`, `faq`, `contact`, `legal-terms`, and `site-signed-in` (the website header once signed in). Then: `sign-in` (+ `-sso`, `-password`, `-expired`), `forbidden`, `home-learner`, `assignments`, `history` (+ `-attempt`), `exams`, `user-menu`, `persona-switcher`, `team-dashboard`, `team-member`, `team-assign`, `team-assignments` (+ `-detail`), `team-exams`, `cohorts`, `cohort-board`, `cohort-terminate`, `observe`, `workspace-observed`, `studio-author`, `admin-overview`, `admin-users`, `admin-user-edit`, `admin-invite`, `admin-deactivate`, `admin-teams`, `admin-sso` (+ `-connection`, `-wizard`), `admin-content`, `admin-sessions`, `admin-usage`, `admin-audit` (+ `-detail`), `admin-settings`, `platform-orgs`, `platform-org`, `platform-capacity`, `platform-content`. Dark for all; light and cream for landing, catalog-public, sign-in, team dashboard, cohort board, admin users and SSO; `-1280` variants for the three widest tables.
