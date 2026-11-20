# DataPilot

Enterprise data and operational intelligence platform. This repository holds the web front end, built from the Stitch designs in [`stitch_datapilot_enterprise_design_system/`](stitch_datapilot_enterprise_design_system/).

## Stack

- React 19 + TypeScript, built with Vite
- Tailwind CSS v3. [`tailwind.config.js`](tailwind.config.js) is ported verbatim from the Stitch export, so the class names in the design HTML (`bg-light-primary`, `text-title-md`, `gap-gutter-md`, …) work unchanged.
- React Router v6
- Inter, JetBrains Mono and Material Symbols Outlined via Google Fonts

## Getting started

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check + production build
npm run lint
```

## Project layout

```
src/
  app/router.tsx          route table: shell routes (inside AppShell) and public routes
  components/layout/      AppShell, Sidebar, Topbar, PageHeader, usePageChrome (breadcrumb + title)
  components/ui/          Icon, Button, Badge, Card, Modal, Drawer, Toast
  features/<module>/      one folder per product area (auth, onboarding, connect, …)
  pages/                  placeholders and 404
stitch_datapilot_enterprise_design_system/
  datapilot_design_system.md   design system spec (tokens, type, motion, voice)
  <screen>/code.html           source design for each screen
```

## Design rules

The full spec is in [`datapilot_design_system.md`](stitch_datapilot_enterprise_design_system/datapilot_design_system.md). In short:

- Use semantic colours (success / warning / error) only for health, reliability and validation states.
- Apply `tabular-nums` to every number, date and table column.
- Use sentence case everywhere. Title case is reserved for module names (Command Center, Connect, Trust, …).
- Use specific action labels (`Retry sync`, `Export CSV`), never `OK` or `Submit`.
