# Implementation plan — Launchpad UI restyle

Prereq: `07-10-agentcore-direct-deploy` merged into the shared feature branch (deploy/invoke panels already AgentCore-only). Use the frontend-design skill for the visual pass; dataviz skill for any chart work.

## Checklist

### Step 1 — Tokens & theme foundation
- [ ] `index.html`: Google Fonts (Archivo variable + IBM Plex Mono); `color-scheme: dark`
- [ ] `src/index.css`: mockup token set as CSS vars + Tailwind v4 `@theme` mapping; map shadcn semantic vars to tokens; radius → 0; body graph-paper background + grain
- [ ] Verify app boots dark with no unstyled flashes; `npm run build`

### Step 2 — Shared primitives
- [ ] Restyle shadcn Button/Input/Label/Select/Tabs/Dialog per design Layer 2
- [ ] Add `Chip` component + `Panel`/`PanelHeader` recipe + `Steps` pipeline component
- [ ] Visual check in isolation (temporary story-ish page or in-place)

### Step 3 — Chrome & palette
- [ ] Topbar: brand block, breadcrumb, syschips (region, backend health LED), avatar optional
- [ ] Node palette sidebar: mono index numbers, section labels, active/hover states

### Step 4 — Canvas & nodes
- [ ] XYFlow Background/Controls/MiniMap dark; edge colors; selection amber
- [ ] Each node type in `src/components/nodes/`: surface, accent, label chip, selection glow, execution-state chips

### Step 5 — Panels
- [ ] Property panel fields
- [ ] Code panel Monaco theme (`beforeMount` defineTheme, bg #0A0D0C)
- [ ] Execution panel: log `.code` styling, history table, status chips; swap react-syntax-highlighter theme
- [ ] Deploy panel: steps/pipeline progress; Invoke panel: mono ARN, chips
- [ ] Chat modal: msg/toolcard/chatbar patterns
- [ ] Project manager + dialogs/menus/toasts sweep

### Step 6 — Review gates
- [ ] Screenshot pass of every surface vs mockup.html (render mockup in browser side-by-side)
- [ ] **User visual review checkpoint** — present screenshots, iterate on feedback (prd AC requires it)
- [ ] Functional smoke: drag-drop, connect, select, generate, execute, stream, chat, deploy-panel open, project save/load
- [ ] 1280px width usability check
- [ ] `npm run build` + `npm run lint`; console clean

## Validation commands
```bash
npm run build && npm run lint
./start_all.sh  # visual review at :5173
```

## Rollback points
- Step 1 is isolated (css/theme files) — revertable without touching components
- Steps 3–5 are per-surface commits; each independently revertable
