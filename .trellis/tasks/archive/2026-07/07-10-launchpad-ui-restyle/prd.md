# Launchpad UI restyle (mockup.html design system)

## Goal

Restyle the entire Strands Studio UI to the **AgentCore Launchpad** design language defined in `mockup.html` (repo root), so it visually belongs when embedded as the "Strands Studio" module inside the Launchpad console (`image.png` shows the host console; its create-agent page opens Strands Studio). Use the frontend-design skill (dataviz skill for any charts) to drive the visual work.

Runs after `07-10-agentcore-direct-deploy` (deploy/invoke panels are AgentCore-only by then — restyle the simplified surface, not the old three-target UI).

## Design language (extracted from mockup.html — the source of truth)

- Tokens: bg `#0B0E0D`, panel `#141816`, panel-2 `#191E1B`, hairline `#232B27`/`#2E3833`, ink `#E9EDEA`/`#A3ACA6`/`#69736C`, brand amber `#FFB000` (chrome only, never a data series), amber-soft `rgba(255,176,0,.13)`, series colors s1 `#3987E5` s2 `#199E70` s3 `#C98500` s5 `#9085E9`, status good/warn/serious/crit
- Type: Archivo (variable width/weight; wide-stretch 800 headings) + IBM Plex Mono for chips/labels/meta/code; uppercase letter-spaced mono micro-labels
- Chrome patterns: 52px sticky topbar (brand `▲ AGENTCORE // LAUNCHPAD`-style, breadcrumb, mono syschips, avatar); left sidebar nav with mono index numbers + amber active state with left border; `.panel` cards with 1px hairline borders and optional amber corner brackets (`.brk`); square corners everywhere (no rounded radii); mono `.chip` status pills with icon+label (never color alone); amber primary buttons with dark text; grid/graph-paper page background + film grain; `rise` entry animations, `pulse` LEDs
- Dark theme only

## Requirements

### R1 — Design token foundation
- Introduce the mockup tokens as CSS variables / Tailwind theme extension; fonts self-hosted or Google Fonts (Archivo, IBM Plex Mono); replace shadcn default light theme — app runs dark-only
- Remove/override rounded-corner defaults (square aesthetic) consistently in shadcn components used

### R2 — App chrome
- Topbar restyled to Launchpad pattern: brand block reading as a Launchpad module (e.g. `▲ AGENTCORE // LAUNCHPAD · STRANDS STUDIO` or per-user copy decision), breadcrumb, region/status syschips
- Main layout, panel headers (Node Palette, Property Panel, Code Panel, Execution Panel, Project Manager) restyled to `.panel`/`.phead` pattern with mono sub-labels

### R3 — Flow canvas & nodes
- XYFlow canvas: dark graph-paper background, hairline grid; edge colors from token palette
- Node cards restyled: panel surface, hairline border, mono type labels, amber selection state (border + soft glow like `.method.sel`), status chips for execution state; distinct accent per node family (agent=amber, tool=s2 aqua, input/output=ink, MCP=s1 blue, swarm/orchestrator=s5 violet) — icon+label, never color alone

### R4 — Functional panels
- Property panel: `.field` label/input styling (mono micro-labels, dark inputs, amber focus)
- Code panel: Monaco dark theme matched to `#0A0D0C` code surface tone
- Execution panel + history: mono log/table styling per mockup `.code`/table patterns; status chips
- Deploy/Invoke panels (AgentCore-only after sibling task): steps pattern (`.steps`/`.pstage` pipeline) for deployment progress
- Chat modal: mockup chat thread pattern (`.msg`, `.toolcard`, amber caret)
- Dialogs/toasts/menus restyled to match

### R5 — Quality gates
- Follow dataviz skill guidance for any charts/sparklines added or restyled
- Contrast: text meets WCAG AA on the dark surfaces (ink scale from mockup is pre-validated; don't introduce new low-contrast combos)
- No functional regressions: all interactions (drag-drop, connect, select, execute, deploy) unchanged in behavior

## Acceptance Criteria

- [ ] All primary surfaces (topbar, palette, canvas, property/code/execution panels, project manager, deploy+invoke, chat modal) use the token system — no leftover light-theme or default-shadcn-styled surfaces
- [ ] Side-by-side screenshot review against mockup.html sections shows consistent tokens/typography/spacing (visual review with user before finalize)
- [ ] Node types visually distinct with icon+label+accent; selected/executing states legible
- [ ] `npm run build` + `npm run lint` pass; no console errors; existing saved projects render correctly on the new canvas
- [ ] App remains usable at 1280px width (Launchpad embeds may not be full-screen)

## Constraints / Non-goals

- Visual/interaction-polish only — no feature additions, no information-architecture rewrites beyond what hiding Lambda/ECS already did
- No light theme
- Actual iframe/module embedding into the Launchpad host app is out of scope (a later integration task); this task only makes the visuals congruent
