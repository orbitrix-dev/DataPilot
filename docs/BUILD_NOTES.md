# DataPilot front end: build notes

This document covers the first implementation of the DataPilot web app from the Stitch designs in [`stitch_datapilot_enterprise_design_system/`](../stitch_datapilot_enterprise_design_system/). All 46 designed screens are built and render without console errors. The backend is not connected yet: every API call is simulated.

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
| `feature/insights` | The Insights module: executive dashboard, sales, customer, product, inventory, purchase and receivables analytics, metric explorer, reports library and report details |
| `feature/intelligence` | The Intelligence module: assistant home, evidence-backed answers (conversation, chart, anomaly and recommendation layouts), forecasting workspace, explanation & evidence, and conversation history |

## How the design maps to code

- **Design tokens.** [`tailwind.config.js`](../tailwind.config.js) is copied unchanged from the Stitch export; every screen used the same config. Tailwind classes from the design HTML (`bg-light-primary`, `text-title-md`, `gap-gutter-md`, …) therefore work as-is in the components.
- **App shell.** In-app pages render inside [`AppShell`](../src/components/layout/AppShell.tsx), which provides the sidebar, the top bar and the page width. Each page sets its breadcrumb and browser tab title with `usePageChrome(...)`. Full-screen flows (auth and onboarding) render outside the shell.
- **Routing.** [`src/app/router.tsx`](../src/app/router.tsx) combines the route list exported by each feature (`authRoutes`, `onboardingRoutes`, `connectRoutes`, `trustRoutes`, `insightsRoutes`, `intelligenceRoutes`, `designSystemRoutes`). Sidebar modules with no design yet (Automate, admin pages) show a placeholder page.
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
| Insights | `/insights` | `insights_executive_dashboard` |
| | `/insights/sales` | `insights_sales_analytics` |
| | `/insights/customers` | `insights_customer_analytics` |
| | `/insights/products` | `insights_product_analytics` |
| | `/insights/inventory` | `insights_inventory_analytics` |
| | `/insights/purchases` | `insights_purchase_analytics` |
| | `/insights/receivables` | `insights_receivables_analytics` |
| | `/insights/metrics?metric=&by=` | `insights_metric_explorer` |
| | `/insights/reports` | `insights_reports_library` |
| | `/insights/reports/:reportId` | `insights_report_details` (designed for the gross margin report; the other three use the same layout) |
| Intelligence | `/intelligence` | `intelligence_home` |
| | `/intelligence/ask?q=` | *no screen: records the question, then opens the matching answer or a "no grounded answer" reply* |
| | `/intelligence/answers/overdue-customers` | `intelligence_ai_assistant_conversation` |
| | `/intelligence/answers/sales-comparison` | `intelligence_query_result_with_charts` (top-products and growth-customers use the same layout) |
| | `/intelligence/answers/revenue-decline` | `intelligence_anomaly_explanation` |
| | `/intelligence/answers/stockout-risk` | `intelligence_recommendation_details` |
| | `/intelligence/forecast` | `intelligence_forecasting_workspace` |
| | `/intelligence/evidence/:answerId` | `intelligence_explanation_evidence_panel` (designed for the sales comparison; every answer has its own evidence) |
| | `/intelligence/history` | `intelligence_conversation_history` |

## Changes from the static designs

The designs are static HTML, so some behaviour had to be decided during the build:

- **Forms.** Fields start empty rather than holding the sample values. Validation, loading states and error toasts were added. Errors are announced to screen readers and the first invalid field receives focus.
- **Consent.** The terms checkbox on sign-up starts unchecked and is required.
- **Onboarding.** The objectives step requires at least one goal. The final button reads "Finish and review connections" and opens Connect. Progress survives a page refresh.
- **Connect wizard.** The connection test shows the 4 checks its "4 / 4 checks" label promised; the design only listed 3. The sync and scan progress bars animate instead of showing a fixed percentage.
- **Trust state.** Resolving an incident, refreshing a dataset, creating a rule or notifying report owners updates every Trust page during the session (`src/features/trust/store.ts`). Lineage node states follow INC-204.
- **Trust navigation.** The overview's KPI cards link to their detail pages, because the design gave no route to Freshness or Schema monitoring. "Create rule" opens a side panel (not designed). Freshness "Refresh" runs in place instead of opening the Connect sync wizard, and the S3 row's "Inspect incident" link, which pointed at an incident that does not exist, opens the failing S3 connection in Connect instead.
- **Trust layout.** The six overview KPIs sit in 3 columns below 1536px wide; at 1280px six columns wrapped every label.
- **Insights ↔ Trust.** Insights reads the Trust store. While INC-204 is open, the receivables KPI, the receivables banner, the DSO metric and the aging report are flagged; resolving it in Trust clears them. The "3h stale" chips follow `warehouse.stock_levels` and turn on-time after a Freshness refresh.
- **Insights data.** The designs show 2–3 sample rows per table. More rows were added so the totals agree across pages: regions sum to $2,841,920, category margins average to 24.8%, aging buckets sum to $412,680, and order counts sum to 1,942. Two reports (Receivables Aging, Supplier Delivery Scorecard) were added to the library.
- **Insights behaviour.** The date range is shown as a fixed label (only 30-day data exists). The metric explorer computes its breakdown from the same data, keeps the selection in the URL, and explains when a split is not meaningful (e.g. AOV by category). The sales trend badge reads "vs prior 30d" (the design said "YoY", which contradicted the dashboard). Export CSV downloads the report table. Customer and product tables sort; the inventory table filters. "Explore by domain" also links Customers and Products, which the design only reached through Sales.
- **Intelligence answers.** There is no language model behind the mock. Each question type has a fixed answer built from the Insights data, and typed questions are matched by keyword (`src/features/intelligence/match.ts`). Anything unmatched gets an explicit "no grounded answer" reply instead of a guess. Example questions and follow-up chips go through `/intelligence/ask`, so they show up in Conversation History along with the Trust status at the time they were asked.
- **Intelligence ↔ Trust.** The overdue-payments answer is qualified while INC-204 is open. The anomaly and stock-out answers are qualified while `warehouse.stock_levels` is stale. Resolving the incident or refreshing the feed in Trust turns them Verified. History rows keep the status from when the question was asked.
- **Intelligence data fixes.** The designs contradicted the existing data in places, and the existing data was kept. The stale warehouse feed is INC-203 (the design said INC-204, the duplicate-invoice incident). SKU-4410 and SKU-2108 use their Insights names, stock levels and days of cover, so suggested orders are computed (620 cases, 90 units) instead of 600/350. "Apex accounts for 40%" refers to the $70,380 balance over 60 days, not the 90+ bucket (where Apex is 100%). The anomaly answer compares this week's Mon–Fri wholesale invoices (Nov 16–20, not Nov 11–15) with a Mon–Fri baseline of $308,600, because the design's $336,600 baseline was higher than the forecast's observed full weeks. Forecast horizons of 30/60/90 days are 4/8/12 forecast weeks. Growth figures are measured against the same number of observed weeks (the design's 60-day +7.2% works out to +7.0%), and the disclosure names the weeks actually shown. Dataset names follow Trust (`public.orders`, `public.invoices`, `warehouse.stock_levels`) instead of the designs' `erp_*`/`wms_*` names. The forecast's "Trust score 98.4%" became the Sales & Orders check count, since Trust shows ~94% overall.
- **Intelligence behaviour.** "Create PO draft" stores the draft for the session (it can be discarded) and says nothing was sent to suppliers. The evidence page has an answer picker and a sources table with live Trust freshness. Follow-ups that pointed at unrelated screens (e.g. "Draft reminder schedule" opening the stock-out recommendation) were replaced with ones that have real answers or Insights pages.
- **Connect state.** Retrying a sync, rotating credentials, adding a connection or removing one updates every Connect page during the session.

## Not done yet

- **No real backend.** Simulated calls live in `src/features/auth/api.ts` and `src/features/connect/store.ts` `src/features/trust/store.ts` the static data in `src/features/insights/data.ts` and `src/features/intelligence/data.ts`, and should be replaced with real API calls.
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
8. **Insights.** On `/insights/receivables`, follow "Inspect incident", mark INC-204 resolved, then return via the sidebar: the banner and the dashboard's Trust chip are gone. Refresh `warehouse.stock_levels` on `/trust/freshness` and the inventory chips turn on-time. Try every metric/dimension pair in `/insights/metrics` and export a CSV from a report.
9. **Intelligence.** Ask each example question on `/intelligence`, then type something unsupported (e.g. "employee churn") to see the no-answer reply. Switch forecast horizons, create and discard a PO draft, and filter or search `/intelligence/history`. Resolve INC-204 and refresh `warehouse.stock_levels` in Trust. The overdue, anomaly and stock-out answers should turn Verified.
10. **App shell.** Switch organization, open notifications, collapse the sidebar, check a mobile-width layout, and sign out.
