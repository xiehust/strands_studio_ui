# Project Structure

## Root Directory
```
├── src/                    # Source code
├── public/                 # Static assets
├── .kiro/                  # Kiro configuration and steering
├── node_modules/           # Dependencies
└── dist/                   # Build output (generated)
```

## Source Organization (`src/`)
```
src/
├── components/             # Reusable React components
│   ├── base-node.tsx      # Core node component with variants
│   └── node-tooltip.tsx   # Tooltip functionality for nodes
├── lib/                   # Utility functions and helpers
│   └── utils.ts           # Common utilities (cn function)
├── assets/                # Static assets (images, icons)
├── App.tsx                # Main application component
├── main.tsx               # Application entry point
├── index.css              # Global styles and Tailwind imports
└── vite-env.d.ts          # Vite type definitions
```

## Component Architecture
- **Base Components**: Foundational UI components (BaseNode, BaseNodeContent, etc.)
- **Composite Components**: Higher-level components combining base components
- **Context-based**: Components use React Context for state management (e.g., tooltip visibility)

## Naming Conventions
- **Components**: PascalCase with descriptive names (`BaseNode`, `NodeTooltip`)
- **Files**: kebab-case for component files (`base-node.tsx`, `node-tooltip.tsx`)
- **Utilities**: camelCase functions (`cn` for className utility)

## Import Patterns
- Use `@/` alias for src imports: `import { cn } from "@/lib/utils"`
- External libraries imported directly: `import { ReactFlow } from '@xyflow/react'`

## Component Structure
Components follow a consistent pattern:
1. forwardRef for DOM element access
2. Proper TypeScript typing with HTMLAttributes extension
3. className merging using `cn()` utility
4. displayName assignment for debugging