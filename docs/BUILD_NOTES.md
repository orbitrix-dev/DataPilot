# DataPilot front end: build notes

This document covers the first implementation of the DataPilot web app from the Stitch designs in [`stitch_datapilot_enterprise_design_system/`](../stitch_datapilot_enterprise_design_system/). All 28 designed screens are built and render without console errors. The backend is not connected yet: every API call is simulated.

## Branches

Each area of work was built on its own branch and merged into `main` with a merge commit, so the history shows one merge per feature.

| Branch | What it adds |
|---|---|
| `feature/foundation` | Vite + React 19 + TypeScript + Tailwind v3 scaffold, design tokens, the app shell (sidebar, top bar, org switcher, notifications, profile menu) and shared UI components |
| `feature/design-system-showcase` | The "Foundational UI System" page |
| `feature/auth` | Login, sign-up, forgot password, reset password, email verification and organization creation |
| `feature/onboarding` | The 8-step guided onboarding wizard |
| `feature/connect` | The Connect module: overview, marketplace, new-connection wizard, upload, connection details, health and sync history |
| `fix/login-divider-and-favicon` | Centres the login "or" divider (the Stitch design had it pushed to the right) and adds a favicon |
| `docs/build-notes` | This document |
| `feature/trust` | The Trust module: overview, quality dashboard, quality rules, freshness, schema changes, lineage, incidents, incident details, root cause analysis and business impact |

## How the design maps to code

- **Design tokens.** [`tailwind.config.js`](../tailwind.config.js) is copied unchanged from the Stitch export; every screen used the same config. Tailwind classes from the design HTML (`bg-light-primary`, `text-title-md`, `gap-gutter-md`, …) therefore work as-is in the components.
- **App shell.** In-app pages render inside [`AppShell`](../src/components/layout/AppShell.tsx), which provides the sidebar, the top bar and the page width. Each page sets its breadcrumb and browser tab title with `usePageChrome(...)`. Full-screen flows (auth and onboarding) render outside the shell.
- **Routing.** [`src/app/router.tsx`](../src/app/router.tsx) combines the route list exported by each feature (`authRoutes`, `onboardingRoutes`, `connectRoutes`, `trustRoutes`, `designSystemRoutes`). Sidebar modules with no design yet (Insights, Intelligence, Automate, admin pages) show a placeholder page.
- **Feature folders.** Each product area lives in `src/features/<area>/` with its own pages, components and mock data. Shared building blocks are in `src/components/ui/` (Icon, Button, Badge, Card, Modal, Drawer, Toast).

## Routes

| Area | Path | Stitch source |
|---|---|---|
| Shell | `/design-system` | `datapilot_application_shell_ui_system` |
| Auth | `/login` | `datapilot_login` |
| | `/signup` | `datapilot_create_account` |
| | `/forgot-password` | `datapilot_forgot_password` |
| | `/reset-password` | `datapilot_reset_password` |
| | `/verify-email` | `datapilot_email_verification` |
| | `/create-organization` | `datapilot_organization_creation` |
| Onboarding | `/onboarding/:step` (welcome, organization, industry, business-size, objectives, data-source, data-scan, complete) | `datapilot_onboarding_wizard_8_steps` |
| Connect | `/connect` | `connect_overview` |
| | `/connect/marketplace` | `connect_data_source_marketplace` |
| | `/connect/new/source` | *not designed, built in the same style* |
| | `/connect/new/details` | `connect_database_connection_wizard` |
| | `/connect/new/access` | `connect_connection_configuration` |
| | `/connect/new/test` | `connect_connection_testing` |
| | `/connect/new/datasets` | *not designed, built in the same style* |
| | `/connect/new/sync` | `connect_sync_progress` |
| | `/connect/new/results` | *not designed, built in the same style* |
| | `/connect/upload` | `connect_upload_files` |
| | `/connect/connections/:connectionId` | `connect_connection_details` |
| | `/connect/health` | `connect_connection_health` |
| | `/connect/history` | `connect_sync_history` |
| Trust | `/trust` | `trust_overview` |
| | `/trust/quality` | `trust_data_quality_dashboard` |
| | `/trust/rules` | `trust_quality_rules` |
| | `/trust/freshness` | `trust_freshness_monitoring` |
| | `/trust/schema` | `trust_schema_change_monitoring` |
| | `/trust/lineage` | `trust_data_lineage_explorer` |
| | `/trust/incidents` | `trust_data_incident_list` |
| | `/trust/incidents/:incidentId` | `trust_incident_details` (designed for INC-204; INC-203 and INC-199 written in the same style) |
| | `/trust/incidents/:incidentId/root-cause` | `trust_root_cause_analysis` (same) |
| | `/trust/impact` | `trust_business_impact_analysis` |

## Changes from the static designs

The designs are static HTML, so some behaviour had to be decided during the build:

- **Forms.** Fields start empty rather than holding the sample values. Validation, loading states and error toasts were added. Errors are announced to screen readers and the first invalid field receives focus.
- **Consent.** The terms checkbox on sign-up starts unchecked and is required.
- **Onboarding.** The objectives step requires at least one goal. The final button reads "Finish and review connections" and opens Connect. Progress survives a page refresh.
- **Connect wizard.** The connection test shows the 4 checks its "4 / 4 checks" label promised; the design only listed 3. The sync and scan progress bars animate instead of showing a fixed percentage.
- **Trust state.** Resolving an incident, refreshing a dataset, creating a rule or notifying report owners updates every Trust page during the session (`src/features/trust/store.ts`). Lineage node states follow INC-204.
- **Trust navigation.** The overview's KPI cards link to their detail pages, because the design gave no route to Freshness or Schema monitoring. "Create rule" opens a side panel (not designed). Freshness "Refresh" runs in place instead of opening the Connect sync wizard, and the S3 row's "Inspect incident" link, which pointed at an incident that does not exist, opens the failing S3 connection in Connect instead.
- **Trust layout.** The six overview KPIs sit in 3 columns below 1536px wide; at 1280px six columns wrapped every label.
- **Connect state.** Retrying a sync, rotating credentials, adding a connection or removing one updates every Connect page during the session.

## Not done yet

- **No real backend.** Simulated calls live in `src/features/auth/api.ts` and `src/features/connect/store.ts` and `src/features/trust/store.ts` and should be replaced with real API calls.
- **No sessions or route protection.** Shell pages are reachable without signing in.
- **Dark mode.** The design spec defines dark tokens, but no dark-mode screens were designed.
- **No automated tests.** Each page was checked in a headless browser, but no test suite exists.

## Running locally

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check + production build
npm run lint
```

## Manual test checklist

1. **Sign-up to Connect.** Go through `/signup` → verify email (any 6 digits) → create organization → the 8 onboarding steps. You should land on `/connect`.
2. **Form errors.** Submit each auth form empty and with bad values. Field errors should appear and focus should move to the first invalid field.
3. **Failing S3 sync.** On `/connect`, retrying the S3 sync fails with a 403. Rotate its credentials, retry, and the source turns Healthy.
4. **New connection.** Add data source → PostgreSQL → wizard steps 2–7 → connection details page.
5. **File upload.** Drag a CSV onto `/connect/upload`. Files of the wrong type or larger than 250 MB are rejected.
6. **Design system page.** On `/design-system`, open and save the side panel, confirm the dialog, and filter the table.
7. **Trust.** On `/trust/incidents/INC-204`, mark it resolved. The overview incident count, lineage nodes and impact table update. Refresh `warehouse.stock_levels` on `/trust/freshness`, and create a rule on `/trust/rules` (submit empty first to see validation).
8. **App shell.** Switch organization, open notifications, collapse the sidebar, check a mobile-width layout, and sign out.
