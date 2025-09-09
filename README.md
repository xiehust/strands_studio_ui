# Agent Builder

A visual agent builder application using React Flow and FastAPI that enables developers to create and configure agents using the Strands Agent SDK through a drag-and-drop interface.

## Features

- Visual workflow designer with React Flow
- Component palette with Strands Agent SDK components
- Properties panel for node configuration
- Python code generation from visual workflows
- Local agent execution and testing
- Workflow save/load functionality

## Tech Stack

### Frontend
- React 19.1.1 with TypeScript
- Vite for build tooling
- React Flow for visual canvas
- Tailwind CSS for styling
- Monaco Editor for code editing

### Backend
- FastAPI for REST API
- WebSocket support for real-time updates
- Python virtual environment management
- Strands Agent SDK integration

## Development Setup

### Prerequisites
- Node.js 18+ and npm
- Python 3.12+
- Git

### Quick Start

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd agent-builder
npm install
```

2. **Set up the backend:**
```bash
npm run setup:backend
```

3. **Start both frontend and backend:**
```bash
npm run dev:full
```

This will start:
- Frontend dev server at http://localhost:5173
- Backend API server at http://localhost:8000

### Individual Services

**Frontend only:**
```bash
npm run dev
```

**Backend only:**
```bash
npm run backend:dev
```

**Backend setup:**
```bash
npm run setup:backend
npm run backend:install
```

## Project Structure

```
├── src/                    # React frontend source
│   ├── components/         # React components
│   ├── lib/               # Utilities and helpers
│   └── assets/            # Static assets
├── backend/               # FastAPI backend
│   ├── app/              # Application modules
│   │   ├── api/          # API routes
│   │   ├── core/         # Configuration
│   │   ├── models/       # Data models
│   │   ├── services/     # Business logic
│   │   └── utils/        # Utilities
│   ├── venv/             # Python virtual environment
│   ├── requirements.txt  # Python dependencies
│   └── main.py           # FastAPI application
└── .kiro/                # Kiro configuration and specs
```

## Available Scripts

- `npm run dev` - Start frontend development server
- `npm run build` - Build frontend for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build
- `npm run backend:dev` - Start backend development server
- `npm run backend:install` - Install backend dependencies
- `npm run dev:full` - Start both frontend and backend
- `npm run setup:backend` - Set up Python virtual environment

## API Endpoints

- `GET /` - Health check
- `GET /api/health` - Detailed health status
- More endpoints will be added as development progresses

## Environment Variables

Backend environment variables (in `backend/.env`):
- `PORT` - Backend server port (default: 8000)
- `DEBUG` - Enable debug mode
- `LOG_LEVEL` - Logging level
- `CORS_ORIGINS` - Allowed CORS origins