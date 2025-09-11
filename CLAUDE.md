# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend (React + Vite)
- `npm run dev` - Start development server (localhost:5173)
- `npm run build` - Build for production (TypeScript compilation + Vite build)
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

### Backend (FastAPI + Python)
- `npm run backend:dev` - Start backend development server (uses venv)
- `npm run backend:install` - Install backend dependencies
- `npm run setup:backend` - Create virtual environment and install dependencies
- `npm run dev:full` - Run both frontend and backend concurrently

### Backend Direct Commands
- `cd backend && ./venv/bin/python main.py` - Start backend server directly
- `cd backend && ./venv/bin/pip install -r requirements.txt` - Install backend deps directly

## Architecture Overview

### Frontend Stack
- **React 19** with TypeScript
- **Vite** for build tooling and development server
- **Tailwind CSS v4** with the new Vite plugin
- **shadcn/ui** component system (New York style, configured via `components.json`)
- **XYFlow/React** for node-based flow diagrams
- **Monaco Editor** for code editing capabilities
- **Lucide React** for icons

### Backend Stack
- **FastAPI** web framework
- **Uvicorn** ASGI server
- **Pydantic** for data validation
- **WebSockets** support
- **Custom strands-agents packages** (strands-agents, strands-agents-tools)

### Project Structure
- `/src` - React frontend source code
  - `/components` - Custom React components (BaseNode, NodeTooltip)
  - `/lib` - Utility functions (uses shadcn/ui utils pattern)
- `/backend` - Python FastAPI backend
  - Uses Python virtual environment in `backend/venv/`
  - Configuration via `.env` (see `.env.example`)
- `/public` - Static assets
- `/dist` - Production build output

### Key Components
The application appears to be focused on node-based UI interactions:
- **BaseNode** - Core node component with header, content, and footer sections
- **NodeTooltip** - Tooltip system for nodes with positioning support
- **ReactFlow integration** - Node-based visual interface

### Configuration Files
- `vite.config.ts` - Vite configuration with React and Tailwind plugins
- `components.json` - shadcn/ui configuration
- `eslint.config.js` - ESLint with TypeScript and React plugins
- `tailwind.config.js` - Tailwind CSS configuration
- `tsconfig.json` - TypeScript configuration with path aliases (@/ -> ./src)

### Development Notes
- Uses path alias `@/` for src directory imports
- Backend expects CORS origins on localhost:3000 and localhost:5173
- No test framework is currently configured
- Backend uses custom strands-agents packages (external dependencies)


### rules
1. Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

2. The python virtual env is managemend by uv, use `uv run` instead of using `python` directly 
