# Design — Launchpad UI restyle

## Approach

Token-first restyle: port mockup.html's design tokens into the Tailwind v4 theme, restyle shared primitives (shadcn components, panel/chip/button/field patterns), then sweep feature surfaces. Behavior, component tree, and state management untouched — this is CSS/classname/markup-level work plus small presentational components (chips, panel headers, steps).

Execution uses the frontend-design skill for the visual pass and the dataviz skill if any chart/sparkline work appears.

## Layer 1 — Tokens & theme

- `src/index.css` (Tailwind v4 `@theme` / CSS vars): define the full mockup token set — bg/panel/panel-2/line/line-2/ink/ink-2/ink-3/amber/amber-soft/s1/s2/s3/s5/good/warn/serious/crit/grid; font stacks `--sans: Archivo`, `--mono: IBM Plex Mono`
- Fonts: Google Fonts link in `index.html` (same as mockup: Archivo variable wdth/wght + IBM Plex Mono 400/500/600); consider self-hosting later (Launchpad embed) — out of scope
- Map shadcn semantic vars (background, foreground, card, border, primary, ring, …) onto the tokens so existing shadcn components inherit the dark scheme automatically; `radius: 0` (square corners)
- Page background: graph-paper repeating gradients + amber radial glow + film-grain overlay (body::after), copied from mockup
- Dark-only: remove theme toggling if any; set `color-scheme: dark`

## Layer 2 — Shared primitives (new small components or class recipes)

- `Panel` / `PanelHeader` recipe: `bg-panel border border-line`, header with `.phead`-style mono sub-label; optional amber corner-bracket variant (`.brk` via ::before/::after)
- `Chip` status component: mono 10px uppercase, icon+label, color variants (good/warn/crit/amber/blue/aqua/muted) — used for execution status, deployment status, node badges
- Buttons: restyle shadcn `Button` — mono uppercase letterspaced; `primary` = amber bg dark text; default = transparent + hairline border
- Form fields: mono micro-label (9.5px, letterspacing .18em, ink-3) + dark input (`#0E1210`, hairline, amber focus) — applied via shadcn Input/Select/Label styling
- Tabs: mockup `.tab` pattern (mono, amber underline active)
- Steps/pipeline component for deployment progress (`.steps` + `.pstage` circles/connectors)

## Layer 3 — Surface sweep (order)

1. App chrome: topbar (brand `▲ AGENTCORE // LAUNCHPAD · STRANDS STUDIO`, breadcrumb, syschips: region + backend health LED), main layout grid
2. Node palette (sidebar): mockup sidebar pattern — mono index numbers, section labels, amber active/hover
3. Flow canvas: XYFlow `Background` → dark grid (gap/size tuned to 56px feel, color `--grid`); Controls/MiniMap dark; edge stroke colors + selected-edge amber
4. Node components (`src/components/nodes/*`): panel surface, accent per family (agent=amber, tool=s2, MCP=s1, input/output=ink neutral, swarm/orchestrator=s5), mono type label chip, selection = amber border + soft glow, execution states via Chip
5. Property panel: field recipes; section headers
6. Code panel: Monaco `vs-dark` customized to `#0A0D0C` bg + token syntax colors (defineTheme)
7. Execution panel + history: log area as `.code` block styling; history table per mockup table pattern; status chips
8. Deploy + Invoke panels (AgentCore-only post-sibling-task): steps/pipeline progress, ARN display in mono `.arn` style
9. Chat modal: `.msg/.toolcard/.chatbar` patterns, amber caret animation
10. Dialogs, dropdown menus, toasts: inherit via shadcn var mapping; spot-fix stragglers

## Key files

- `src/index.css`, `index.html`, `components.json` (if radius/theme config), `tailwind.config.js`
- `src/components/ui/*` (shadcn primitives), `src/components/nodes/*`, `flow-editor.tsx`, `main-layout.tsx` (or equivalent), `property-panel.tsx`, `code-panel.tsx`, `execution-panel.tsx`, `invoke-panel.tsx`, chat modal, project manager

## Risks

- XYFlow default styles (`@xyflow/react/dist/style.css`) fight the theme → override via CSS layer after import
- Monaco theme needs `monaco.editor.defineTheme` before mount — use `@monaco-editor/react` `beforeMount`
- react-syntax-highlighter theme (execution panel?) must be swapped to a dark scheme matching `#0A0D0C`
- Contrast regressions: stick to mockup's pre-validated ink scale; chips always icon+label

## Verification

Screenshot-driven: run app, capture each surface, compare against mockup.html rendered in browser; user visual review checkpoint before finalize (prd AC). Functional smoke: build a flow, execute, deploy-panel open, chat — all interactions intact.
