---
name: "DataPilot — Enterprise Intelligence Design System"
description: "Foundational light-first enterprise SaaS design system for DataPilot, built on crisp white and slate-grey surfaces, deep indigo-blue accents, and Inter typography."
---

## Overview

DataPilot is a trusted business intelligence and operational intelligence platform that connects fragmented business data, validates data reliability, produces actionable insights, and enables controlled workflow automation.

The design system embodies **Corporate / Modern Precision**: calm, high-trust, and information-dense without visual clutter. It prioritizes scannability, strict grid alignment, tabular numeric precision, and restrained semantic color usage. Every surface, border, and typographic step is engineered to support long analytical sessions in a default light theme, avoiding decorative gradients, glassmorphism, or consumer-style marketing flourishes.

## Colors

The palette pairs crisp white (`#FFFFFF`) and cool slate-grey (`#F8FAFC`, `#F1F5F9`) canvas surfaces with a deep indigo-blue (`#1E40AF`) primary accent for navigation focus, primary actions, and interactive controls. Semantic status colors—green (`#15803D`), amber (`#B45309`), and red (`#B91C1C`)—are reserved strictly for data reliability, pipeline health, and validation states, always paired with high-contrast container tints and text labels.

- **Primary & Secondary:** Deep indigo-blue establishes authority and clear interactive hierarchy without overwhelming dense data views.
- **Surfaces & Outlines:** White cards sit on a light-grey workspace canvas, separated by subtle 1px slate outlines (`#CBD5E1` and `#E2E8F0`).
- **Status Indicators:** Green (Healthy / Verified), Amber (Degraded / Warning), and Red (Failed / Critical) never appear as purely decorative accents.

```yaml
colors:
  success: "#15803D"
  on-success: "#FFFFFF"
  success-container: "#DCFCE7"
  on-success-container: "#14532D"
  warning: "#B45309"
  on-warning: "#FFFFFF"
  warning-container: "#FEF3C7"
  on-warning-container: "#78350F"
  error: "#B91C1C"
  on-error: "#FFFFFF"
  error-container: "#FEE2E2"
  on-error-container: "#7F1D1D"
  info: "#1D4ED8"
  on-info: "#FFFFFF"
  info-container: "#DBEAFE"
  on-info-container: "#1E3A8A"
  light:
    primary: "#1E40AF"
    on-primary: "#FFFFFF"
    primary-container: "#EEF2FF"
    on-primary-container: "#1E3A8A"
    secondary: "#4338CA"
    on-secondary: "#FFFFFF"
    surface: "#FFFFFF"
    on-surface: "#0F172A"
    surface-variant: "#F8FAFC"
    on-surface-variant: "#475569"
    surface-container-low: "#F8FAFC"
    surface-container: "#F1F5F9"
    surface-container-high: "#E2E8F0"
    outline: "#CBD5E1"
    outline-variant: "#E2E8F0"
  dark:
    primary: "#818CF8"
    on-primary: "#0F172A"
    primary-container: "#1E1B4B"
    on-primary-container: "#E0E7FF"
    secondary: "#A5B4FC"
    on-secondary: "#0F172A"
    surface: "#0F172A"
    on-surface: "#F8FAFC"
    surface-variant: "#1E293B"
    on-surface-variant: "#94A3B8"
    surface-container-low: "#0F172A"
    surface-container: "#1E293B"
    surface-container-high: "#334155"
    outline: "#334155"
    outline-variant: "#1E293B"
```

## Typography

**Inter** serves as both the headline and body typeface, chosen for its neutral geometric clarity, open counters, and native `tabular-nums` support across KPIs, tables, and timestamps. **JetBrains Mono** is used for dataset identifiers, query snippets, and audit log hashes.

All numeric metrics, percentages, dates, and table columns must apply `tabular-nums` so values align vertically across rows and update without layout jitter.

```yaml
typography:
  display-lg:
    fontFamily: "Inter"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 44px
    letterSpacing: -0.75px
  display-lg-mobile:
    fontFamily: "Inter"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 34px
    letterSpacing: -0.5px
  headline-lg:
    fontFamily: "Inter"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.4px
  headline-md:
    fontFamily: "Inter"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.25px
  title-lg:
    fontFamily: "Inter"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.1px
  title-md:
    fontFamily: "Inter"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0px
  body-lg:
    fontFamily: "Inter"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  body-md:
    fontFamily: "Inter"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  body-sm:
    fontFamily: "Inter"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Inter"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
  label-md:
    fontFamily: "Inter"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.1px
  label-sm:
    fontFamily: "Inter"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 14px
    letterSpacing: 0.3px
  mono-sm:
    fontFamily: "JetBrains Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0px
```

## Layout & Spacing

DataPilot is designed desktop-first at **1440px** width with a fixed, collapsible left sidebar (`240px` expanded, `64px` collapsed) and a `56px` sticky top navigation bar. The main content area uses a fluid 12-column CSS Grid with `24px` page padding and `16px`–`24px` grid gutters, capped at a `1440px` max-width container for ultra-wide monitors.

- **Desktop (>= 1024px):** Persistent collapsible left sidebar, full topbar with inline organization switcher, breadcrumbs, global search trigger, notifications, and profile menu. Multi-column KPI grids (4 columns) and split analytical layouts.
- **Tablet (768px – 1023px):** Sidebar collapses to icon-only or slide-over drawer; KPI grids reflow to 2 columns; tables enable horizontal scroll within bordered containers.
- **Mobile (< 768px):** Sidebar moves into a slide-over navigation drawer triggered from the topbar; breadcrumbs condense to the current parent + page; KPI grids stack to 1 column; dialogs and side panels expand to full-width sheets.

```yaml
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 16px
  gutter-lg: 24px
  gutter-xl: 32px
  section: 24px
  page-margin: 24px
```

## Elevation & Depth

Hierarchy relies on **tonal surface layering** and **crisp 1px low-contrast outlines** (`outline-variant` `#E2E8F0` and `outline` `#CBD5E1`) rather than heavy drop shadows.

- **Base Canvas:** `light-surface-variant` (`#F8FAFC`) provides a calm neutral backdrop.
- **Primary Containers (Cards, Tables, Sidebar, Topbar):** `light-surface` (`#FFFFFF`) with a 1px `light-outline-variant` border.
- **Floating Overlays (Dropdowns, Popovers, Side Panels, Confirmation Dialogs, Toasts):** `light-surface` (`#FFFFFF`) with a 1px `light-outline` border and a subtle, crisp shadow (`0 4px 16px -2px rgba(15, 23, 42, 0.08)`). Backdrop overlays use a clean semi-transparent dark scrim (`rgba(15, 23, 42, 0.4)`) with no blur.

## Shapes

Corner radii are restrained and architectural—never pill-heavy on large containers. Interactive controls and cards use tight, consistent radii that nest cleanly.

```yaml
rounded:
  sm: 4px
  DEFAULT: 6px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
```

## Motion & Micro-interaction

Motion is crisp, purposeful, and understated. Interactive state changes (hover, focus rings, sidebar collapse) resolve within `150ms` so the interface feels immediate. Overlays—such as slide-over side panels, notification drawers, and confirmation dialogs—enter with a smooth deceleration curve and exit slightly faster. `prefers-reduced-motion` is respected globally, and only `transform`, `opacity`, and color properties are animated.

```yaml
motion:
  state-change:
    duration: 150ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 220ms
    delay: 0ms
    timingFunction: cubic-bezier(0.16, 1, 0.3, 1)
  surface-exit:
    duration: 140ms
    delay: 0ms
    timingFunction: cubic-bezier(0.3, 0, 1, 1)
```

## Voice & Content Strategy

- **Tone of Voice:** Authoritative, clear, and concise. Avoid marketing buzzwords ("seamlessly", "reimagine", "supercharge") and conversational filler.
- **Capitalisation:** Sentence case for all headings, table headers, button labels, form labels, and toast messages. Title case is reserved only for proper product modules (`Command Center`, `Connect`, `Trust`, `Insights`, `Intelligence`, `Automate`, `Users and Permissions`, `Audit Logs`, `Settings`, `Billing`).
- **Action Labels:** Use specific verb-object phrases (`Export CSV`, `Retry Sync`, `Revoke Access`, `Run Validation`) rather than generic `OK` or `Submit`.
- **Empty, Loading, and Error States:** Empty states explain what is missing and offer one primary next action. Error states state what failed, why (if known), and provide a direct recovery action (`Retry`, `Inspect Logs`).
- **Numbers & Dates:** Use ISO-style or unambiguous short dates (`Nov 20, 2026 · 14:32 UTC`), compact suffixes only where space demands, and `tabular-nums` everywhere.

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html`: `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Input Field** → `@components/input-field.html`: `input-field-text`, `input-field-icon`
- **Modal** → `@components/modal.html`: `modal-standard`, `modal-alert`, `modal-drawer`
- **Skeleton** → `@components/skeleton.html`: `skeleton-text`, `skeleton-card`
- **Table** → `@components/table.html`: `table-standard`, `table-interactive`, `table-selectable`
- **Toast** → `@components/toast.html`: `toast-success`
