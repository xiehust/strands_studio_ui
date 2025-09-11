"""
Strands UI Backend Server
FastAPI server for executing Strands agents and managing projects
"""
import asyncio
import json
import logging
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
import uvicorn

# Configure logging
import os
from logging.handlers import RotatingFileHandler

# Create logs directory if it doesn't exist
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)

# Configure root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Create formatter
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# Console handler (existing behavior)
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# File handler for all logs
file_handler = RotatingFileHandler(
    log_dir / "backend.log",
    maxBytes=10*1024*1024,  # 10MB
    backupCount=5
)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)

# Error file handler for errors only
error_handler = RotatingFileHandler(
    log_dir / "backend_errors.log",
    maxBytes=5*1024*1024,  # 5MB
    backupCount=3
)
error_handler.setLevel(logging.ERROR)
error_handler.setFormatter(formatter)

# Add handlers to root logger
root_logger.addHandler(console_handler)
root_logger.addHandler(file_handler)
root_logger.addHandler(error_handler)

# Reduce noise from watchfiles logger
watchfiles_logger = logging.getLogger("watchfiles.main")
watchfiles_logger.setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Strands UI Backend",
    description="Backend API for Strands Agent visual builder",
    version="1.0.0"
)

# Request logging middleware
from fastapi import Request
import time

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    
    # Log incoming request
    logger.info(f"Incoming {request.method} {request.url.path}")
    if request.query_params:
        logger.info(f"Query params: {dict(request.query_params)}")
    
    response = await call_next(request)
    
    # Log response
    process_time = time.time() - start_time
    logger.info(f"Completed {request.method} {request.url.path} - Status: {response.status_code} - Duration: {process_time:.3f}s")
    
    return response

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data models
class NodeData(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]

class EdgeData(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None

class ProjectData(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    nodes: List[NodeData]
    edges: List[EdgeData]
    createdAt: str
    updatedAt: str
    version: str

class ExecutionRequest(BaseModel):
    code: str
    input_data: Optional[str] = None

class ExecutionResult(BaseModel):
    success: bool
    output: str
    error: Optional[str] = None
    execution_time: float
    timestamp: str

# In-memory storage (replace with database in production)
projects_storage: Dict[str, ProjectData] = {}
execution_results: Dict[str, ExecutionResult] = {}

# WebSocket connections for real-time updates
active_connections: List[WebSocket] = []

@app.get("/")
async def root():
    """Health check endpoint"""
    logger.info("Root endpoint accessed")
    return {"message": "Strands UI Backend is running", "version": "1.0.0"}

@app.get("/health")
async def health_check():
    """Detailed health check"""
    logger.debug("Health check requested")
    health_data = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "projects_count": len(projects_storage),
        "active_connections": len(active_connections)
    }
    logger.debug(f"Health status: {health_data}")
    return health_data

# Project Management Endpoints
@app.get("/api/projects")
async def get_projects():
    """Get all projects"""
    return {"projects": list(projects_storage.values())}

@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    """Get a specific project"""
    if project_id not in projects_storage:
        raise HTTPException(status_code=404, detail="Project not found")
    return projects_storage[project_id]

@app.post("/api/projects")
async def create_project(project: ProjectData):
    """Create a new project"""
    logger.info(f"Creating new project: {project.name} (ID: {project.id})")
    
    if project.id in projects_storage:
        logger.warning(f"Project already exists: {project.id}")
        raise HTTPException(status_code=409, detail="Project already exists")
    
    projects_storage[project.id] = project
    logger.info(f"Created project: {project.name} ({project.id}) with {len(project.nodes)} nodes and {len(project.edges)} edges")
    return project

@app.put("/api/projects/{project_id}")
async def update_project(project_id: str, project: ProjectData):
    """Update an existing project"""
    logger.info(f"Updating project: {project_id}")
    
    if project_id not in projects_storage:
        logger.warning(f"Project not found for update: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    project.updatedAt = datetime.now().isoformat()
    projects_storage[project_id] = project
    logger.info(f"Updated project: {project.name} ({project_id}) with {len(project.nodes)} nodes and {len(project.edges)} edges")
    return project

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project"""
    logger.info(f"Deleting project: {project_id}")
    
    if project_id not in projects_storage:
        logger.warning(f"Project not found for deletion: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")
    
    deleted_project = projects_storage.pop(project_id)
    logger.info(f"Deleted project: {deleted_project.name} ({project_id})")
    return {"message": "Project deleted successfully"}

# Code Execution Endpoints
@app.post("/api/execute")
async def execute_code(request: ExecutionRequest):
    """Execute Python code with Strands Agent SDK"""
    execution_id = str(uuid.uuid4())
    start_time = datetime.now()
    
    logger.info(f"Starting code execution - ID: {execution_id}")
    logger.debug(f"Code length: {len(request.code)} characters")
    
    if request.input_data:
        logger.debug(f"Input data provided: {type(request.input_data)}")
    
    try:
        # Create execution environment
        logger.info(f"Executing Strands code - ID: {execution_id}")
        execution_result = await execute_strands_code(request.code, request.input_data)
        
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        logger.info(f"Code execution successful - ID: {execution_id}, Duration: {execution_time:.3f}s")
        
        result = ExecutionResult(
            success=True,
            output=execution_result,
            execution_time=execution_time,
            timestamp=start_time.isoformat()
        )
        
        execution_results[execution_id] = result
        
        # Notify WebSocket connections
        await notify_execution_complete(execution_id, result)
        
        logger.info(f"Execution completed successfully - ID: {execution_id}")
        return {"execution_id": execution_id, "result": result}
        
    except Exception as e:
        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()
        
        error_msg = str(e)
        logger.error(f"Code execution failed - ID: {execution_id}, Duration: {execution_time:.3f}s, Error: {error_msg}")
        logger.error(f"Exception details: {traceback.format_exc()}")
        traceback_str = traceback.format_exc()
        
        result = ExecutionResult(
            success=False,
            output="",
            error=f"{error_msg}\n\n{traceback_str}",
            execution_time=execution_time,
            timestamp=start_time.isoformat()
        )
        
        execution_results[execution_id] = result
        logger.error(f"Code execution failed: {error_msg}")
        
        # Notify WebSocket connections
        await notify_execution_complete(execution_id, result)
        
        return {"execution_id": execution_id, "result": result}

@app.post("/api/execute/stream")
async def execute_code_stream(request: ExecutionRequest):
    """Execute Python code with streaming response using Strands Agent SDK"""
    execution_id = str(uuid.uuid4())
    logger.info(f"Starting streaming execution - ID: {execution_id}")
    
    async def generate_stream():
        try:
            logger.info(f"Setting up streaming environment - ID: {execution_id}")
            
            # Extract the agent and user input from the generated code
            code_lines = request.code.strip().split('\n')
            
            # Find the global agent variable line to get agent name
            agent_name = None
            user_input = "Hello, how can you help me?"
            
            for line in code_lines:
                if "global " in line and "_agent" in line:
                    # Extract agent name from global declaration
                    parts = line.split("global ")[1].strip()
                    agent_name = parts.split(',')[0].strip()
                    break
                elif "user_input = " in line and '"' in line:
                    # Extract user input
                    user_input = line.split('"')[1]
            
            if not agent_name:
                agent_name = "test_agent"  # fallback
                
            logger.info(f"Detected agent: {agent_name}, input: {user_input[:50]}... - ID: {execution_id}")
            
            # Create the execution environment
            global_vars = {}
            local_vars = {}
            
            # Execute the code to create the agent
            logger.info(f"Executing agent setup code - ID: {execution_id}")
            exec(request.code, global_vars, local_vars)
            
            # Get the agent from the execution environment
            agent = local_vars.get(agent_name) or global_vars.get(agent_name)
            
            if not agent:
                logger.error(f"Agent '{agent_name}' not found in execution environment - ID: {execution_id}")
                yield f"data: Error: Could not find agent '{agent_name}' in execution environment\n\n"
                return
            
            logger.info(f"Agent found: {type(agent).__name__} - ID: {execution_id}")
            
            # Check if agent has streaming capability
            if hasattr(agent, 'stream_async'):
                logger.info(f"Starting streaming response - ID: {execution_id}")
                yield f"data: Starting streaming response...\n\n"
                
                chunk_count = 0
                async for event in agent.stream_async(user_input):
                    if "data" in event:
                        # Send the streaming chunk
                        chunk = event["data"]
                        chunk_count += 1
                        yield f"data: {chunk}\n\n"
                    elif "tool" in event:
                        # Send tool usage information
                        tool_info = event.get("tool", {})
                        tool_name = tool_info.get("name", "unknown")
                        logger.info(f"Tool used: {tool_name} - ID: {execution_id}")
                        yield f"data: [Using tool: {tool_name}]\n\n"
                
                logger.info(f"Streaming completed - {chunk_count} chunks sent - ID: {execution_id}")
                yield f"data: [STREAM_COMPLETE]\n\n"
            else:
                # Fallback to regular execution if streaming not available
                logger.info(f"Using fallback execution (no streaming) - ID: {execution_id}")
                response = agent(user_input)
                yield f"data: {str(response)}\n\n"
                yield f"data: [STREAM_COMPLETE]\n\n"
                
        except Exception as e:
            error_msg = f"Streaming execution failed: {str(e)}"
            logger.error(f"Streaming execution error - ID: {execution_id}: {error_msg}")
            logger.error(f"Full traceback - ID: {execution_id}: {traceback.format_exc()}")
            yield f"data: Error: {error_msg}\n\n"
            yield f"data: [STREAM_COMPLETE]\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

@app.get("/api/execution/{execution_id}")
async def get_execution_result(execution_id: str):
    """Get execution result by ID"""
    logger.info(f"Retrieving execution result - ID: {execution_id}")
    
    if execution_id not in execution_results:
        logger.warning(f"Execution result not found - ID: {execution_id}")
        raise HTTPException(status_code=404, detail="Execution result not found")
    
    logger.info(f"Execution result found - ID: {execution_id}")
    return execution_results[execution_id]

# WebSocket for real-time updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time execution updates"""
    await websocket.accept()
    active_connections.append(websocket)
    logger.info(f"WebSocket connected. Total connections: {len(active_connections)}")
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(active_connections)}")

async def notify_execution_complete(execution_id: str, result: ExecutionResult):
    """Notify all WebSocket connections about execution completion"""
    logger.info(f"Notifying WebSocket connections about execution completion - ID: {execution_id}")
    
    message = {
        "type": "execution_complete",
        "execution_id": execution_id,
        "result": result.dict()
    }
    
    # Remove disconnected connections
    disconnected = []
    sent_count = 0
    
    for connection in active_connections:
        try:
            await connection.send_text(json.dumps(message))
            sent_count += 1
        except Exception as e:
            logger.warning(f"Failed to send WebSocket message: {e}")
            disconnected.append(connection)
    
    logger.info(f"WebSocket notification sent to {sent_count} connections - ID: {execution_id}")
    
    for conn in disconnected:
        active_connections.remove(conn)

async def execute_strands_code(code: str, input_data: Optional[str] = None) -> str:
    """Execute Python code with Strands Agent SDK integration"""
    logger.info("Starting execute_strands_code function")
    logger.debug(f"Code length: {len(code)} characters")
    
    try:
        # Import Strands Agent SDK
        logger.info("Importing Strands Agent SDK")
        from strands import Agent, tool
        from strands.models import BedrockModel
        from strands_tools import calculator, file_read, shell, current_time
        
        # Import MCP dependencies if needed
        mcp_imports = {}
        if 'MCPClient' in code:
            logger.info("MCP Client detected in code, importing MCP dependencies")
            try:
                from strands.tools.mcp import MCPClient
                from mcp import stdio_client, StdioServerParameters
                from mcp.client.streamable_http import streamablehttp_client
                from mcp.client.sse import sse_client
                
                mcp_imports.update({
                    'MCPClient': MCPClient,
                    'stdio_client': stdio_client,
                    'streamablehttp_client': streamablehttp_client,
                    'sse_client': sse_client,
                    'StdioServerParameters': StdioServerParameters,
                })
            except ImportError as e:
                logger.warning(f"MCP dependencies not available: {e}")
                # MCP imports are optional
        
        # Create a safe execution environment
        globals_dict = {
            '__builtins__': __builtins__,
            'Agent': Agent,
            'tool': tool,
            'BedrockModel': BedrockModel,
            'calculator': calculator,
            'file_read': file_read,
            'shell': shell,
            'current_time': current_time,
            'print': print,
            'str': str,
            'int': int,
            'float': float,
            'list': list,
            'dict': dict,
            'len': len,
            'range': range,
            'json': json,
            'input_data': input_data,  # Make input data available to executed code
            **mcp_imports,  # Add MCP imports if available
        }
        
        locals_dict = {}
        
        # Capture output
        import io
        import sys
        output_buffer = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = output_buffer
        
        try:
            # Execute the code
            logger.info("Executing user code")
            exec(code, globals_dict, locals_dict)
            
            # Make globals available to locals for function access
            for key, value in globals_dict.items():
                if key not in locals_dict:
                    locals_dict[key] = value
            
            # Also make all local definitions available as globals for main function
            for key, value in locals_dict.items():
                if key not in globals_dict:
                    globals_dict[key] = value
            
            # If there's a main function, call it
            if 'main' in locals_dict and callable(locals_dict['main']):
                logger.info("Calling main function")
                result = locals_dict['main']()
                if result is not None:
                    logger.info(f"Main function returned: {type(result).__name__}")
                    print(f"Main function result: {result}")
        
        finally:
            sys.stdout = old_stdout
        
        output = output_buffer.getvalue()
        logger.info(f"Code execution completed, output length: {len(output)}")
        return output if output else "Code executed successfully (no output)"
        
    except ImportError as e:
        if "strands" in str(e) or "strands_tools" in str(e):
            logger.error(f"Strands SDK import error: {e}")
            return f"Strands Agent SDK not available. Please install strands-agents and strands-agents-tools packages.\nError: {str(e)}"
        else:
            logger.error(f"Import error: {e}")
            raise e
    except Exception as e:
        logger.error(f"Code execution exception: {e}")
        raise e

if __name__ == "__main__":
    logger.info("Starting Strands UI Backend Server")
    logger.info("Server configuration: host=0.0.0.0, port=8000, reload=True")
    
    try:
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=8000,
            reload=True,
            log_level="info"
        )
    except KeyboardInterrupt:
        logger.info("Server shutdown requested by user")
    except Exception as e:
        logger.error(f"Server startup failed: {e}")
        raise