# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Development Mode
- `npm run dev` - Start frontend development server (localhost:5173)
- `npm run backend:dev` - Start backend development server (uses uv)
- `npm run dev:full` - Run both frontend and backend concurrently
- `npm run build` - Build for production (TypeScript compilation + Vite build)
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

### Production Mode (Recommended)
- `./start_all.sh` - Start all services in production mode (background with logging)
- `./stop_all.sh` - Stop all production services and cleanup processes

### Backend Management
- `npm run backend:install` - Install backend dependencies
- `npm run setup:backend` - Create virtual environment and install dependencies
- `npm run backend:prod` - Start backend in production mode

### Backend Direct Commands
- `cd backend && uv run main.py` - Start backend server directly
- `cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload` - Start with uvicorn directly
- `cd backend && uv run uvicorn main:app --host 0.0.0.0 --port 8000` - Start backend in production mode
- `cd backend && uv pip install -r requirements.txt` - Install backend deps directly

## Architecture Overview

This is a **visual agent flow builder** that allows users to create, configure, and execute AI agent workflows through a drag-and-drop interface. The application generates Python code using the Strands Agent SDK and executes it with both regular and streaming capabilities.

### Core Functionality
- **Visual Flow Editor**: Drag-and-drop interface for building agent workflows using XYFlow/React
- **Code Generation**: Automatically generates Python code from visual flows using the Strands Agent SDK
- **Agent Execution**: Supports both regular and streaming execution of generated agent code
- **Graph Mode**: DAG-based multi-agent orchestration using GraphBuilder for complex workflows with dependencies
- **Project Management**: Save, load, and manage multiple agent projects with persistent storage
- **Execution History**: Track and replay previous agent executions with artifact storage

### Frontend Stack
- **React 19** with TypeScript
- **Vite** for build tooling and development server
- **Tailwind CSS v4** with the new Vite plugin
- **shadcn/ui** component system (New York style, configured via `components.json`)
- **XYFlow/React** for node-based flow diagrams
- **Monaco Editor** for code editing capabilities
- **Lucide React** for icons

### Backend Stack
- **FastAPI** web framework with streaming support
- **Uvicorn** ASGI server
- **Pydantic** for data validation
- **WebSockets** for real-time execution updates
- **File-based storage system** for projects and execution artifacts
- **strands-agents** and **strands-agents-tools** packages for AI agent functionality

### Key Application Components

#### Node Types
- **Agent Node**: Core AI agent with configurable LLM (AWS Bedrock Claude models)
- **Orchestrator Agent Node**: Coordinates multiple sub-agents
- **Input Node**: Provides user input or data to agents
- **Output Node**: Displays agent results
- **Tool Nodes**: Built-in tools (calculator, file_read, shell, current_time)
- **Custom Tool Node**: User-defined Python functions with @tool decorator
- **MCP Tool Node**: Model Context Protocol tool integration

#### Core Panels
- **Flow Editor**: Main visual canvas for building agent workflows
- **Property Panel**: Configure selected node properties (model, prompts, streaming, etc.)
- **Code Panel**: Generated Python code with Monaco editor
- **Execution Panel**: Execute agents with real-time output and execution history
- **Chat Modal**: Interactive conversation interface with agents using full conversation history
- **Node Palette**: Drag-and-drop node library
- **Project Manager**: Save/load projects with localStorage persistence

#### Backend Architecture
- **Execution Endpoints**: `/api/execute` (regular) and `/api/execute/stream` (streaming)
- **Conversation Endpoints**: `/api/conversations` for chat-based agent interaction with full conversation history
- **Storage System**: File-based artifact storage in `backend/storage/` directory
- **Project Structure**: `storage/{project_id}/{version}/{execution_id}/` with artifacts:
  - `generate.py` - Generated agent code
  - `result.json` - Execution results
  - `flow.json` - Visual flow configuration
  - `metadata.json` - Execution metadata

### Project Structure
- `/src/components/` - React components organized by functionality
  - `/nodes/` - Node type implementations (agent, tool, input, output)
  - `flow-editor.tsx` - Main XYFlow canvas
  - `execution-panel.tsx` - Agent execution interface
  - `code-panel.tsx` - Code generation and editing
  - `property-panel.tsx` - Node configuration
- `/src/lib/` - Utility functions and core logic
  - `code-generator.ts` - Converts visual flows to Python code with MCP support and streaming detection
  - `graph-code-generator.ts` - Specialized code generation for Graph Mode using GraphBuilder
  - `graph-validator.ts` - Validation logic for DAG structures, cycle detection, and entry point analysis
  - `api-client.ts` - Backend communication and WebSocket handling with streaming chunk processing
  - `connection-validator.ts` - Node connection rules and validation logic (includes Graph Mode constraints)
  - `validation.ts` - Data validation utilities
- `/backend/` - Python FastAPI server
  - `main.py` - FastAPI application with execution endpoints
  - `/app/models/` - Pydantic data models
  - `/app/services/` - Storage and business logic services
  - `/storage/` - File-based artifact storage (generated at runtime)

### Configuration Files
- `vite.config.ts` - Vite configuration with React and Tailwind plugins
- `components.json` - shadcn/ui configuration (New York style)
- `eslint.config.js` - ESLint with TypeScript and React plugins
- `tailwind.config.js` - Tailwind CSS configuration
- `tsconfig.json` - TypeScript configuration with path aliases (@/ -> ./src)

### Development Notes
- Uses path alias `@/` for src directory imports
- Backend expects CORS origins on localhost:3000 and localhost:5173
- No test framework is currently configured
- Backend managed by **uv** (not pip/venv directly)
- Frontend uses localStorage for project persistence
- Backend uses file-based storage for execution artifacts
- Supports both sync and streaming agent execution
- Agent streaming requires enabling "Enable Streaming" checkbox in property panel

### Production Deployment
- **Production Scripts**: Use `./start_all.sh` and `./stop_all.sh` for production deployment
- **Logging**: Production logs are stored in `logs/frontend.log` and `logs/backend.log`
- **Process Management**: Scripts handle PID files, graceful shutdown, and cleanup
- **Health Checks**: Automatic verification that services started successfully
- **Secure Proxy Architecture**: Backend (port 8000) only accessible internally
- **Single Port Exposure**: Only frontend port (5173) needs to be exposed externally
- **Background Execution**: Services run as background processes with proper logging
- **Cloud Compatibility**: Auto-detects EC2 public IP for cloud deployment
- **ALB Support**: Compatible with AWS Application Load Balancer deployments

### Proxy Architecture

The application uses **Vite's built-in proxy** for secure backend communication:

```typescript
// vite.config.ts
preview: {
  proxy: {
    '/api': { target: 'http://localhost:8000' },
    '/health': { target: 'http://localhost:8000' },
    '/ws': { target: 'ws://localhost:8000', ws: true }
  }
}
```

**Benefits:**
- **Security**: Backend not exposed to internet
- **Simplified Networking**: Only one port to manage
- **CORS Elimination**: No cross-origin issues
- **Unified Access**: All endpoints available through frontend URL

### Cloud Deployment Options

#### Local Development
```bash
./start_all.sh
# Access: http://localhost:5173
# API Docs: http://localhost:5173/docs (proxied to backend)
```

#### Direct EC2 Deployment
```bash
./start_all.sh
# Access: http://PUBLIC_IP:5173
# API Docs: http://PUBLIC_IP:5173/docs (proxied to backend)
# Backend: 127.0.0.1:8000 (internal only)
```

#### AWS ALB (Application Load Balancer) Deployment
```bash
export ALB_HOSTNAME=your-alb-hostname.us-west-2.elb.amazonaws.com
./start_all.sh
# Access: http://ALB_HOSTNAME:5173
# API Docs: http://ALB_HOSTNAME:5173/docs (proxied to backend)
# Backend: 127.0.0.1:8000 (internal only)
```

### Environment Configuration
- **Vite Proxy**: All API requests automatically routed through frontend
- **Backend Binding**: Backend bound to 127.0.0.1 (localhost only) for security
- **Environment Variable Override**: Set `VITE_API_BASE_URL` for external backend scenarios
- **ALB Hostname Support**: Use `ALB_HOSTNAME` environment variable for load balancer deployments
- **Host Configuration**: Preview server configured with `allowedHosts: true` for ALB compatibility

### Network Security
- **Firewall/Security Groups**: Only allow inbound port 5173
- **Backend Isolation**: Port 8000 not accessible from external networks
- **Internal Communication**: Frontend-to-backend communication via localhost

### Important Implementation Details
- **Streaming Detection**: Frontend detects streaming by checking for `yield` statements in generated code OR agents with `streaming: true` property
- **Code Generation**: Generates different code paths for regular vs streaming execution
- **State Management**: Uses React state with WebSocket updates for real-time execution status
- **Execution Flow**: Visual nodes → Code generation → Backend execution → Results display
- **Error Handling**: Comprehensive error handling for validation, execution, and storage operations
- **Connection Validation**: Enforces node connection rules via `connection-validator.ts` - prevents invalid connections and provides user feedback
- **MCP Integration**: Each MCP server node can only connect to one agent node to prevent resource conflicts
- **MCP Client Configuration**: Timeout values from MCP node properties are passed as `startup_timeout` parameter to MCPClient
- **Execution History Optimization**: Uses single API call (`/api/execution-history`) instead of multiple requests for better performance

### Graph Mode Implementation

**Graph Mode** is a specialized orchestration mode that enables DAG-based (Directed Acyclic Graph) multi-agent workflows using the Strands Agent SDK's `GraphBuilder`. This mode allows complex agent dependencies and execution ordering.

#### Key Components
- **Toggle Control**: Located in flow-editor.tsx (top-right corner) with Network icon and purple styling when active
- **Code Generator**: `graph-code-generator.ts` - Generates GraphBuilder-based Python code instead of sequential execution
- **Validator**: `graph-validator.ts` - Validates DAG structure, detects cycles, finds entry points and disconnected nodes
- **Connection Rules**: Enhanced `connection-validator.ts` with Graph Mode-specific connection constraints

#### How Graph Mode Works
1. **Agent Dependencies**: Agents connect via output→user-input connections to define execution dependencies
2. **Entry Points**: Agents with no incoming dependencies from other agents become entry points
3. **Execution Order**: GraphBuilder automatically determines optimal execution order based on dependencies
4. **Input Routing**: Input nodes can ONLY connect to entry point agents (prevents mid-graph injection)

#### Generated Code Structure
```python
# Uses GraphBuilder instead of sequential execution
from strands.multiagent import GraphBuilder

builder = GraphBuilder()
builder.add_node(agent1, "agent1")
builder.add_node(agent2, "agent2")
builder.add_edge("agent1", "agent2")  # agent2 depends on agent1
builder.set_entry_point("agent1")
graph = builder.build()
result = graph(user_input)  # Returns GraphResult with execution details
```

#### Validation Rules
- **No Cycles**: Circular dependencies are detected and blocked
- **Entry Points Required**: At least one agent must have no incoming dependencies
- **Input Constraints**: Input nodes can only connect to entry point agents
- **Reachability**: Warns about disconnected agents unreachable from entry points
- **DAG Structure**: Ensures valid directed acyclic graph topology

#### UI Integration
- **Visual Toggle**: Network icon in flow editor with tooltip "Toggle Graph Mode: Enable DAG-based multi-agent orchestration"
- **Connection Validation**: Real-time validation prevents invalid connections with user feedback
- **Project Persistence**: Graph mode state is saved in project files and auto-save
- **Code Generation**: Automatically switches between regular and graph code generation based on mode

#### Technical Architecture
- **State Management**: `graphMode` boolean state tracked in main-layout.tsx and flow-editor.tsx
- **Code Branching**: `generateStrandsAgentCode()` routes to `generateGraphCode()` when `graphMode=true`
- **Validation Integration**: `isValidConnection()` accepts `graphMode` parameter for enhanced validation
- **MCP Support**: Full MCP tool integration in Graph Mode with proper context manager handling

### Deployment Features
- **AWS Bedrock AgentCore Deployment**: Deploy agents to AWS Bedrock AgentCore for managed, serverless AI agent execution
- **AWS Lambda Deployment**: Deploy agents to AWS Lambda with CloudFormation stack management
- **AWS ECS Fargate Deployment**: Deploy agents to AWS ECS Fargate for containerized, scalable agent execution with CloudFormation-based infrastructure
- **Deployment History**: Unified storage system for AgentCore, Lambda, and ECS deployments in backend (`/api/deployment-history`)
- **Cross-Browser Persistence**: All deployments stored in backend API, with localStorage as fallback
- **Deployment Invoke Panel**: Unified interface in `invoke-panel.tsx` for invoking AgentCore, Lambda, and ECS agents

### Critical Architecture Rules
1. **MCP Connection Constraints**: Each MCP server node can only connect to one agent node. This prevents resource conflicts and ensures proper context management in generated code.

2. **Streaming Implementation**:
   - Frontend detects streaming by checking `yield` statements in generated code OR `streaming: true` in agent properties
   - Empty SSE chunks (`data: `) represent newlines and must be converted to `\n` characters
   - MCP clients are only started in context managers when directly connected to the execution agent

3. **Code Generation Context**:
   - MCP clients use proper indentation (4 spaces base, 8 spaces inside context managers)
   - Timeout values from MCP node properties are passed as `startup_timeout` parameter
   - Only connected tools are included in agent initialization
   - **CRITICAL**: All Agent initializations must include `callback_handler=None` to prevent streaming duplication

4. **Conversation Management**:
   - Generated code supports both `--user-input` and `--messages` parameters with `--messages` taking priority
   - Conversation history uses schema: `[{"role":"user","content":[{"text": "..."}]}, {"role":"assistant","content":[{"text": "..."}]}]`
   - Backend conversation service constructs full message history and passes via `--messages` parameter
   - Chat modal provides interactive conversation interface with semi-transparent backdrop

5. **Deployment Storage Architecture**:
   - AgentCore, Lambda, and ECS deployments are saved to backend via `/api/deployment-history`
   - Frontend `invoke-panel.tsx` loads all deployments from backend API (not localStorage)
   - localStorage is used only as fallback if backend API fails or returns no data
   - Deployment history save operations are non-blocking and use `Promise.resolve().then()` to prevent save failures from affecting deployment success
   - AgentCore deployment outputs are extracted from `deployment_result.status.deployment_outputs`
   - ECS deployments use CloudFormation for infrastructure provisioning (VPC, ALB, ECS cluster, Fargate service)

### Development Rules
1. Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

2. The python virtual env is managed by uv, use `uv run` instead of using `python` directly 

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.