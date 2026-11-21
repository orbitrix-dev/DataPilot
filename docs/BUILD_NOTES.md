# DataPilot front end: build notes

This document covers the first implementation of the DataPilot web app from the Stitch designs in [`stitch_datapilot_enterprise_design_system/`](../stitch_datapilot_enterprise_design_system/). All 75 designed screens are built and render without console errors. The backend is not connected yet: every API call is simulated.

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
| `feature/automate` | The Automate module: overview, workflow marketplace, builder, trigger / condition / action configuration, workflow details, approval center, scheduled workflows, execution history and execution logs |
| `feature/command-center` | The Command Center: executive overview, business performance, business & data health, risk overview, alerts & notifications, recommended actions and recent activity |
| `feature/admin` | Administration: user management, invite users, roles, permission matrix, audit logs, organization / security / API key / notification settings, subscription & billing and usage |

## How the design maps to code

- **Design tokens.** [`tailwind.config.js`](../tailwind.config.js) is copied unchanged from the Stitch export; every screen used the same config. Tailwind classes from the design HTML (`bg-light-primary`, `text-title-md`, `gap-gutter-md`, …) therefore work as-is in the components.
- **App shell.** In-app pages render inside [`AppShell`](../src/components/layout/AppShell.tsx), which provides the sidebar, the top bar and the page width. Each page sets its breadcrumb and browser tab title with `usePageChrome(...)`. Full-screen flows (auth and onboarding) render outside the shell.
- **Routing.** [`src/app/router.tsx`](../src/app/router.tsx) combines the route list exported by each feature (`authRoutes`, `onboardingRoutes`, `commandCenterRoutes`, `connectRoutes`, `trustRoutes`, `insightsRoutes`, `intelligenceRoutes`, `automateRoutes`, `adminRoutes`, `designSystemRoutes`). A sidebar entry with no feature route shows a placeholder page; since the Admin module, every entry has one.
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
| Automate | `/automate` | `automate_overview` |
| | `/automate/marketplace` | `automate_workflow_marketplace` |
| | `/automate/workflows/:workflowId` | `automate_workflow_details` |
| | `/automate/workflows/:workflowId/builder` | `automate_workflow_builder` |
| | `/automate/workflows/:workflowId/trigger` | `automate_trigger_configuration` |
| | `/automate/workflows/:workflowId/conditions` | `automate_condition_configuration` |
| | `/automate/workflows/:workflowId/action` | `automate_action_configuration` |
| | `/automate/approvals` | `automate_approval_center` |
| | `/automate/scheduled` | `automate_scheduled_workflows` |
| | `/automate/history` | `automate_execution_history` |
| | `/automate/runs/:runId` | `automate_execution_logs` (designed for RUN-8842; every run has its own trace) |
| Command Center | `/command-center` | `command_center_overview` |
| | `/command-center/performance` | `command_center_business_performance` |
| | `/command-center/health` | `command_center_business_health` |
| | `/command-center/risks` | `command_center_business_risk_overview` |
| | `/command-center/alerts` | `command_center_alerts_notifications` |
| | `/command-center/actions` | `command_center_recommended_actions` |
| | `/command-center/activity?type=` | `command_center_recent_activity` |
| Admin | `/users-permissions?role=` | `admin_user_management` |
| | `/users-permissions/invite` | `admin_invite_users` |
| | `/users-permissions/roles` | `admin_role_management` |
| | `/users-permissions/permissions` | `admin_permission_configuration` |
| | `/audit-logs?type=&q=` | `admin_audit_logs` |
| | `/settings` | `admin_organization_settings` |
| | `/settings/security` | `admin_security_settings` |
| | `/settings/api-keys` | `admin_api_keys` |
| | `/settings/notifications` | `admin_notification_preferences` |
| | `/billing` | `admin_subscription_billing` |
| | `/billing/usage` | `admin_usage_overview` |

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
- **Automate state.** Creating a workflow (blank or from a template), saving each step, renaming, testing, publishing, pausing, approving, rejecting and retrying update every Automate page during the session (`src/features/automate/store.ts`). Nothing is sent anywhere: an approved action becomes a run that "executes" after a short delay.
- **Automate behaviour.** Conditions are evaluated against sample rows (`src/features/automate/evaluate.ts`), so the live preview, the dry run and the run traces are computed rather than fixed text. A numeric condition can compare against another field (`days_of_cover < lead_time_days`). Every form validates, and the builder blocks testing and publishing until the trigger, conditions and action are set. Publishing asks for confirmation and bumps the version; editing a published workflow marks it "Unpublished changes". Rejecting asks for an optional reason and appears in execution history. "Retry action now" re-uses the existing approval. The step indicator, the rename control, the recent-runs list on workflow details and the history filters/search were not designed.
- **Automate ↔ Trust.** The Trust freshness gate is live: while INC-204 is open, the builder's dry run for the overdue-invoice workflow is held and says why; resolving INC-204 lets it pass. Approval requests show a Trust warning while their source data has an issue, and approving one asks for confirmation and records the warning in the audit trail. The paused sync-failure workflow warns that Amazon S3 — Raw Orders is failing in Connect.
- **Automate data fixes.** The designs' `ar_invoices`, `wms_inventory_snapshot` and `connect_sync_jobs` became `public.invoices`, `warehouse.stock_levels` and `connect.sync_runs`. The stale warehouse feed is INC-203 (the design said INC-204). The overdue customers are existing ones (Great Lakes Builders Co. and Summit Contractors Supply, $11,200 + $7,200 = $18,400) instead of the new "Northstar Supply" and "Valley Wholesale"; each customer's sample invoices add up to its Insights overdue figure. "Midwest Distributors" was dropped. The low-inventory rule is "days of cover < supplier lead time" (as the marketplace described), which matches SKU-4410 and SKU-2108 with the Insights lead times; the design's "< 7 days" would not have matched SKU-2108 (11 days). Times are UTC, like Trust, and "today" is Friday Nov 20, so next Monday is Nov 23 (the design said Nov 24) and the last weekly report ran Mon Nov 16 (not Wed Nov 18). The weekly-report approval is an ad-hoc run, since that workflow only runs on Mondays. KPIs are counted from the runs (8 approved runs in 7 days, 7 succeeded) instead of the design's 42 / 97.6%, which four workflows could not produce. RUN-8842 has used all 3 automatic retries and waits for a manual retry, because its 08:15 failure was hours old. The "follow-up task" workflow is a draft, so the design's executed run for it was removed. Email addresses use `acme.io`, like the profile menu.
- **Automate roles.** Approver roles are shown but not enforced: the signed-in mock user can approve everything.
- **Command Center data.** The Command Center adds no data of its own: every figure is read from the Insights, Intelligence, Trust, Connect and Automate data and stores (`src/features/command-center/signals.ts`), so it agrees with the pages it links to. Where the designs disagreed, the existing data was kept. Revenue is the 30-day $2,841,920 (+11.4% vs prior 30 days), not an MTD $1,284,500; the design's "+8.2% MoM" is the order growth (1,942 vs 1,795). This week's decline is the Intelligence anomaly figure, -12.4% (-$38,400 against the $308,600 Mon–Fri baseline), not -11.4%. Receivables are $412,680 outstanding with $70,380 over 60 days (the design said $318,400 and $42,800 over 15 days). Inventory is $1,184,500, and the at-risk SKUs are SKU-4410 (5 days vs 8) and SKU-2108 (11 days vs 12), as in the stock-out recommendation (the design said 5d and 7d). The overdue follow-up names Great Lakes Builders Co. and Summit Contractors Supply from REQ-9040, not "Northstar Supply" and "Valley Wholesale". Slow-moving stock is the 39 slow-moving SKUs and SKU-9021's 118 days of cover; there is no inventory-value-by-age data for the design's "$64,200 >90d". Gross margin is 24.8%, not 28.4%. Reliability is Trust's indicative ~94%, not 98.4%.
- **Command Center ↔ other modules.** Alerts, risks and actions are live. Technical alerts list every open Trust incident (INC-204 duplicate invoices and INC-203 stale warehouse feed; the design merged them into one "INC-204 warehouse" incident), every failing Connect source (Amazon S3) and every failed Automate run (RUN-8842, which has used all its retries; the design said "retry #2 queued"). Business alerts and KPIs carry the live Trust chip of their source data. Approving or rejecting REQ-9040, creating the PO draft, resolving incidents and fixing sources mark the matching actions Done, and alert counts follow. Nothing is executed from the Command Center: every action links to the page where the human review happens.
- **Command Center behaviour.** A sub-navigation across the seven pages, the source connections list on the health page, the gross margin, order and weekly rows on the performance page, a fifth action (reorder the two at-risk SKUs, from the stock-out recommendation), and the activity category filter were not designed. Activity is built from Connect sync runs, Trust incident history, Intelligence questions and PO drafts, Automate runs, approval requests and workflow audit entries. Times are absolute ("Today, 14:28") rather than "12m ago"; things done during the session are listed first under "This session".
- **Admin state.** Inviting, changing roles, revoking access, saving the permission matrix, policy and notification changes, creating or revoking API keys, revoking sessions, saving organization settings and plan requests update every Admin page during the session and each writes an audit event (`src/features/admin/store.ts`). Weakening a control (disabling MFA or SSO, turning a notification off, revoking a key, session or user) asks for confirmation first.
- **Admin ↔ other modules.** Audit Logs also reads workflow approvals and rejections from Automate and credential rotations from Connect (`src/features/admin/audit.ts`), so approving a request or rotating the S3 key appears there. Connections now record when their credential was last rotated (`Connection.rotated`). Security and Usage count sources and rows from Connect (4 sources, file uploads excluded; 1,428,910 rows, shown as 1.43M where the design said 1.42M). Seats count users plus pending invitations. Renaming the organization renames it in the org switcher. The profile menu says "Administrator" (was "Platform Admin") and its "API tokens" link opens API Keys.
- **Admin permissions.** The signed-in user, Elena Vance, is an Administrator. Under the designed matrix that gives "None" for billing and workspace deletion, so Delete Workspace is disabled with the reason, and Upgrade / Downgrade send a request to the Owner (Marcus Chen) instead of changing the plan. Granting Administrators "Full" there in the matrix enables both: deletion is then scheduled 7 days out behind a typed-name confirmation and can be cancelled; a plan change is applied, and a downgrade is blocked while usage exceeds the smaller plan. Other matrix rows are shown but not enforced in the other modules, as with Automate's approver roles.
- **Admin data fixes.** People who already existed keep their names and titles: emails use `acme.io` (not `acmeglobal.com`), Priya is Priya Raman, Operations Lead and Business Manager (the design said "Priya Patel", Analyst, but she approves Automate runs), and Elena is Administrator with the job title Finance Manager. Job titles such as "Workspace Owner" and "Operations Lead" in Automate are shown under each user's name, separate from the five roles. The design listed 5 of 12 users; the other 7 were added so the role counts match Role Management (1 / 2 / 3 / 4 / 2). The audit events follow the shared clock (Friday Nov 20, 14:32 UTC): the RUN-8842 approval is REQ-9036 at Nov 20 08:15 (the design said Nov 21), and David Park's role change moved to Nov 19 17:02 (Nov 20 17:02 was in the future). The reporting timezone defaults to UTC, which every other module uses (the design said America/Los_Angeles).
- **Admin, not designed.** The role filter on Users, Edit Role / Revoke / Resend / Cancel invite actions, the editable matrix with Discard and Reset, audit search / type filter / CSV export, the session timeout selector, the recent-logins list, the API key create panel (name, read-only scopes, MFA code; any 6 digits work) with a show-once secret, the Team and Enterprise Scale plans and their limits, the plan comparison dialog, two more past invoices and the usage notes. Storage (18.4 GB) is kept from the design; nothing else tracks it.
- **Sidebar status.** The sidebar footer showed "All systems operational" on every page. It now shows the open Trust incidents (or failing Connect sources) and links to Command Center alerts, as the Command Center design showed.
- **Connect state.** Retrying a sync, rotating credentials, adding a connection or removing one updates every Connect page during the session.

## Not done yet

- **No real backend.** Simulated calls live in `src/features/auth/api.ts` and `src/features/connect/store.ts` `src/features/trust/store.ts` the static data in `src/features/insights/data.ts`, `src/features/intelligence/data.ts` and `src/features/automate/data.ts`, and should be replaced with real API calls.
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
10. **Command Center.** On `/command-center`, check that Alerts shows 7 (3 business, 4 technical). Approve REQ-9040 in Automate, create the PO draft from the stock-out answer, retry RUN-8842, resolve INC-204 and INC-203 and refresh `warehouse.stock_levels`. Back on the Command Center, the Trust chips read Verified, only the S3 sync failure remains, two actions are Done, and `/command-center/activity` lists those steps under "This session".
11. **Automate.** On `/automate/approvals`, approve REQ-9041, approve REQ-9040 (confirm the Trust warning) and reject REQ-9038 with a reason; the overview and history update. Retry RUN-8842 from its log. Test the overdue-invoice workflow in the builder (held by INC-204), resolve INC-204 in Trust and test again. Build a blank workflow: submit each step empty to see validation, then finish and publish it.
12. **App shell.** Switch organization, open notifications, collapse the sidebar, check a mobile-width layout, and sign out.
13. **Admin.** On `/users-permissions/invite`, submit empty, then an existing email, then a new one: Users shows 13 of 25 seats. Change David Park's role and check Role Management. On `/users-permissions/permissions` set Administrator → Billing to Full and save; Delete Workspace and plan changes unlock, and Downgrade is blocked by usage. Create an API key and copy the secret, revoke a session and disable MFA on Security, rename the organization (the org switcher follows). Approve REQ-9041 in Automate and rotate the S3 key in Connect. `/audit-logs` lists all of it under "This session".
