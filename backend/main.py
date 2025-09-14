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
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
import uvicorn

# Import storage components
from app.models.storage import (
    ArtifactRequest,
    ArtifactResponse,
    RetrieveArtifactRequest,
    ArtifactContent,
    ProjectInfo,
    VersionInfo,
    ExecutionInfo,
    StorageStats
)
from app.services.storage_service import StorageService

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
    allow_origins=["*"],
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
    project_id: Optional[str] = "default-project"
    version: Optional[str] = "1.0.0"
    flow_data: Optional[dict] = None
    # API Keys for secure environment variable handling
    openai_api_key: Optional[str] = None

class ExecutionResult(BaseModel):
    success: bool
    output: str
    error: Optional[str] = None
    execution_time: float
    timestamp: str

class ExecutionHistoryItem(BaseModel):
    execution_id: str
    project_id: Optional[str] = None
    version: Optional[str] = None
    result: ExecutionResult
    code: Optional[str] = None
    input_data: Optional[str] = None
    created_at: str

# In-memory storage (replace with database in production)
projects_storage: Dict[str, ProjectData] = {}
execution_results: Dict[str, ExecutionResult] = {}

# Initialize storage service
storage_service = StorageService("storage")

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
        execution_result = await execute_strands_code(request.code, request.input_data, request.openai_api_key)
        
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
        
        # Save to execution history
        await save_to_execution_history(execution_id, result, request.code, request.input_data, request.project_id, request.version, request.flow_data)
        
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
        
        # Save to execution history (even failed executions)
        await save_to_execution_history(execution_id, result, request.code, request.input_data, request.project_id, request.version, request.flow_data)
        
        # Notify WebSocket connections
        await notify_execution_complete(execution_id, result)
        
        return {"execution_id": execution_id, "result": result}

@app.post("/api/execute/stream")
async def execute_code_stream(request: ExecutionRequest):
    """Execute Python code with streaming response using Strands Agent SDK"""
    execution_id = str(uuid.uuid4())
    start_time = datetime.now()
    logger.info(f"Starting streaming execution - ID: {execution_id}")
    
    async def generate_stream():
        try:
            logger.info(f"Setting up streaming environment - ID: {execution_id}")
            
            # Set API keys as environment variables for security
            if request.openai_api_key:
                os.environ["OPENAI_API_KEY"] = request.openai_api_key
                logger.info("OpenAI API key set in environment for streaming")
            
            # Import Strands Agent SDK
            logger.info("Importing Strands Agent SDK for streaming")
            from strands import Agent, tool
            from strands.models import BedrockModel
            from strands_tools import calculator, file_read, shell, current_time
            
            # Import OpenAI model if needed
            openai_imports = {}
            if 'OpenAIModel' in request.code:
                logger.info("OpenAI model detected in streaming code, importing OpenAI dependencies")
                try:
                    from strands.models.openai import OpenAIModel
                    openai_imports['OpenAIModel'] = OpenAIModel
                except ImportError as e:
                    logger.warning(f"OpenAI model not available: {e}")
            
            # Import MCP dependencies if needed
            mcp_imports = {}
            if 'MCPClient' in request.code:
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
                'os': os,  # Add os module for environment variables
                'asyncio': asyncio,
                'input_data': request.input_data,  # Make input data available to executed code
                **mcp_imports,  # Add MCP imports if available
                **openai_imports,  # Add OpenAI imports if available
            }
            
            locals_dict = {}
            
            # Execute the setup code (imports, agent configuration, main function definition)
            logger.info(f"Executing setup code - ID: {execution_id}")
            exec(request.code, globals_dict, locals_dict)
            
            # Make globals available to locals for function access
            for key, value in globals_dict.items():
                if key not in locals_dict:
                    locals_dict[key] = value
            
            # Also make all local definitions available as globals for main function
            for key, value in locals_dict.items():
                if key not in globals_dict:
                    globals_dict[key] = value
            
            # Check if there's a main function and if it's async
            main_func = locals_dict.get('main') or globals_dict.get('main')
            if not main_func or not callable(main_func):
                logger.error(f"No callable main function found - ID: {execution_id}")
                yield f"data: Error: No callable main function found in the code\n\n"
                yield f"data: [STREAM_COMPLETE]\n\n"
                return
            
            import inspect
            logger.info(f"Main function type: {type(main_func).__name__} - ID: {execution_id}")
            logger.info(f"Is coroutine function: {inspect.iscoroutinefunction(main_func)} - ID: {execution_id}")
            logger.info(f"Is async gen function: {inspect.isasyncgenfunction(main_func)} - ID: {execution_id}")
            
            if not (inspect.iscoroutinefunction(main_func) or inspect.isasyncgenfunction(main_func)):
                logger.error(f"Main function is not async - ID: {execution_id}")
                yield f"data: Error: Main function must be async for streaming\n\n"
                yield f"data: [STREAM_COMPLETE]\n\n"
                return
            
            logger.info(f"Found async main function, starting streaming execution - ID: {execution_id}")
            
            # Create a custom async generator that captures the streaming
            async def stream_main():
                # Set up the execution context for the main function
                try:
                    # Check if the main function is a generator (has yield statements)
                    import inspect
                    if inspect.isasyncgenfunction(main_func):
                        # The main function is an async generator, stream from it directly
                        logger.info(f"Main function is an async generator, streaming directly - ID: {execution_id}")
                        async for chunk in main_func():
                            if chunk is not None:
                                yield chunk
                    elif 'yield' in request.code:
                        # The main function contains yield statements but may not be detected as generator
                        # This happens when the yield is conditional or inside try/except
                        logger.info(f"Detected yield in code, attempting to stream from main function - ID: {execution_id}")
                        try:
                            # Try to call main as a generator
                            result = main_func()
                            if hasattr(result, '__aiter__'):
                                # It's an async iterator/generator
                                async for chunk in result:
                                    if chunk is not None:
                                        yield chunk
                            elif hasattr(result, '__await__'):
                                # It's a coroutine, await it
                                final_result = await result
                                if final_result is not None:
                                    yield str(final_result)
                            elif inspect.isgenerator(result) or inspect.isasyncgen(result):
                                # It's a generator or async generator
                                if inspect.isasyncgen(result):
                                    async for chunk in result:
                                        if chunk is not None:
                                            yield chunk
                                else:
                                    for chunk in result:
                                        if chunk is not None:
                                            yield chunk
                            else:
                                # It's some other object, convert to string
                                yield str(result)
                        except Exception as e:
                            logger.warning(f"Failed to stream from main function, falling back - ID: {execution_id}: {e}")
                            # Fallback to regular execution
                            try:
                                result = await main_func()
                                if result is not None:
                                    # Check if the result is an async generator
                                    if inspect.isasyncgen(result):
                                        async for chunk in result:
                                            if chunk is not None:
                                                yield chunk
                                    else:
                                        yield str(result)
                            except Exception as fallback_error:
                                logger.error(f"Fallback execution also failed - ID: {execution_id}: {fallback_error}")
                                yield f"Error: {str(fallback_error)}"
                    else:
                        # Regular async function - check if it's a streaming agent by looking for stream_async in code
                        if 'stream_async' in request.code:
                            logger.info(f"Detected streaming agent code, setting up real-time print capture - ID: {execution_id}")
                            
                            # Create an async queue to capture print output in real-time
                            import asyncio
                            output_queue = asyncio.Queue()
                            execution_done = asyncio.Event()
                            original_print = print
                            
                            def streaming_print(*args, **kwargs):
                                # Capture the output for streaming
                                if args:
                                    logger.info(f"args:{args[0]}")
                                    # output = ' '.join(str(arg) for arg in args)
                                    output = args[0]
                                    # Check if this looks like streaming data (not debug messages)
                                    if output and output != "Starting streaming response...":
                                        # Put the output in the queue (non-blocking)
                                        try:
                                            output_queue.put_nowait(output)
                                        except asyncio.QueueFull:
                                            pass  # Skip if queue is full
                            
                            # Replace print function in globals for the main function
                            globals_dict['print'] = streaming_print
                            
                            # Run the main function in a separate task
                            async def run_main():
                                try:
                                    result = await main_func()
                                    if result is not None:
                                        output_queue.put_nowait(str(result))
                                except Exception as e:
                                    output_queue.put_nowait(f"Error: {str(e)}")
                                finally:
                                    execution_done.set()
                            
                            # Start the main function
                            main_task = asyncio.create_task(run_main())
                            
                            # Stream output as it becomes available
                            while not execution_done.is_set() or not output_queue.empty():
                                try:
                                    # Wait for output with a timeout
                                    output = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                                    if output:
                                        yield output
                                        logger.info(f"output:{output}")
                                except asyncio.TimeoutError:
                                    # Check if execution is done
                                    if execution_done.is_set():
                                        break
                                    continue
                            
                            # Wait for the main task to complete
                            await main_task
                        else:
                            # Regular async function without streaming
                            logger.info(f"Regular async function, executing once - ID: {execution_id}")
                            result = await main_func()
                            if result is not None:
                                # Check if the result is an async generator
                                if inspect.isasyncgen(result):
                                    async for chunk in result:
                                        if chunk is not None:
                                            yield chunk
                                else:
                                    yield str(result)
                    
                except Exception as e:
                    logger.error(f"Error in stream_main - ID: {execution_id}: {e}")
                    yield f"Error in main function: {str(e)}"
            
            # Start streaming from the main function
            chunk_count = 0
            try:
                async for stream_data in stream_main():
                    # Ensure proper SSE format and preserve newlines
                    if stream_data:
                        # Convert stream_data to string and ensure it preserves formatting
                        chunk_str = str(stream_data)
                        if not chunk_str.startswith("data: "):
                            # Properly escape newlines in SSE data by splitting into multiple data: lines
                            lines = chunk_str.split('\n')
                            sse_data = '\n'.join(f'data: {line}' for line in lines)
                            yield f"{sse_data}\n\n"
                        else:
                            yield f"{chunk_str}\n\n" if not chunk_str.endswith("\n\n") else chunk_str
                    chunk_count += 1
                
                end_time = datetime.now()
                execution_time = (end_time - start_time).total_seconds()
                logger.info(f"Streaming completed - {chunk_count} chunks sent - ID: {execution_id}, Duration: {execution_time:.3f}s")
                yield f"data: [STREAM_COMPLETE:{execution_time}]\n\n"
                
            except Exception as e:
                end_time = datetime.now()
                execution_time = (end_time - start_time).total_seconds()
                logger.error(f"Streaming error in main execution - ID: {execution_id}: {e}")
                yield f"data: Error: {str(e)}\n\n"
                yield f"data: [STREAM_COMPLETE:{execution_time}]\n\n"
                
        except ImportError as e:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            if "strands" in str(e) or "strands_tools" in str(e):
                error_msg = f"Strands Agent SDK not available. Please install strands-agents and strands-agents-tools packages. Error: {str(e)}"
                logger.error(f"Strands SDK import error - ID: {execution_id}: {error_msg}")
                yield f"data: Error: {error_msg}\n\n"
                yield f"data: [STREAM_COMPLETE:{execution_time}]\n\n"
            else:
                logger.error(f"Import error - ID: {execution_id}: {e}")
                yield f"data: Error: Import error: {str(e)}\n\n"
                yield f"data: [STREAM_COMPLETE:{execution_time}]\n\n"
        except Exception as e:
            end_time = datetime.now()
            execution_time = (end_time - start_time).total_seconds()
            error_msg = f"Streaming execution failed: {str(e)}"
            logger.error(f"Streaming execution error - ID: {execution_id}: {error_msg}")
            logger.error(f"Full traceback - ID: {execution_id}: {traceback.format_exc()}")
            yield f"data: Error: {error_msg}\n\n"
            yield f"data: [STREAM_COMPLETE:{execution_time}]\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
            "Transfer-Encoding": "chunked",
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

# Execution History Endpoints
@app.post("/api/execution-history")
async def save_execution_history(item: ExecutionHistoryItem):
    """Save execution result to persistent storage (delegates to storage service)"""
    logger.info(f"Saving execution to persistent storage - ID: {item.execution_id}")
    
    # Set created_at if not provided
    if not item.created_at:
        item.created_at = datetime.now().isoformat()
    
    # Use the save_to_execution_history function which saves to file storage
    await save_to_execution_history(
        execution_id=item.execution_id,
        result=item.result,
        code=item.code,
        input_data=item.input_data,
        project_id=item.project_id,
        version=item.version
    )
    
    logger.info(f"Execution saved to persistent storage - ID: {item.execution_id}")
    return {"message": "Execution saved to persistent storage", "execution_id": item.execution_id}

@app.get("/api/execution-history")
async def get_execution_history(
    project_id: Optional[str] = None,
    version: Optional[str] = None,
    limit: Optional[int] = 50
):
    """Get execution history from persistent storage"""
    logger.info(f"Retrieving execution history from storage - project_id: {project_id}, version: {version}, limit: {limit}")
    
    try:
        # If project_id is specified, get executions from that project
        if project_id:
            # Get project versions first
            versions_to_check = []
            if version:
                versions_to_check = [version]
            else:
                # Get all versions for the project
                try:
                    project_versions = await storage_service.get_project_versions(project_id)
                    versions_to_check = [v.version for v in project_versions]
                except Exception:
                    logger.warning(f"Could not get versions for project {project_id}")
                    versions_to_check = ["1.0.0"]  # Default fallback
            
            # Collect executions from all versions and convert to ExecutionHistoryItem format
            all_executions = []
            for ver in versions_to_check:
                try:
                    version_infos = await storage_service.get_project_versions(project_id)
                    for version_info in version_infos:
                        if version_info.version == ver:
                            # Get detailed execution info for each execution ID
                            for execution_id in version_info.executions:
                                try:
                                    execution_info = await storage_service.get_execution_info(
                                        project_id, ver, execution_id
                                    )
                                    # Convert ExecutionInfo to ExecutionHistoryItem by loading result.json
                                    history_item = await _convert_execution_info_to_history_item(execution_info)
                                    if history_item:
                                        all_executions.append(history_item)
                                except Exception as e:
                                    logger.warning(f"Could not get execution info for {project_id}/{ver}/{execution_id}: {e}")
                            break
                except Exception as e:
                    logger.warning(f"Error getting executions for {project_id}/{ver}: {e}")
            
            # Sort by timestamp (newest first) and apply limit
            all_executions.sort(key=lambda x: x.created_at, reverse=True)
            if limit:
                all_executions = all_executions[:limit]
                
            logger.info(f"Returning {len(all_executions)} execution history items from storage")
            return {"executions": all_executions}
        else:
            # Get all projects and their executions
            projects = await storage_service.list_projects()
            all_executions = []
            
            for project in projects:
                # project.versions is List[str], so we need to get VersionInfo for each version
                for version_str in project.versions:
                    try:
                        # Get version info which contains the execution IDs
                        version_infos = await storage_service.get_project_versions(project.project_id)
                        for version_info in version_infos:
                            if version_info.version == version_str:
                                # Now get detailed execution info for each execution ID
                                for execution_id in version_info.executions:
                                    try:
                                        execution_info = await storage_service.get_execution_info(
                                            project.project_id, version_str, execution_id
                                        )
                                        # Convert ExecutionInfo to ExecutionHistoryItem by loading result.json
                                        history_item = await _convert_execution_info_to_history_item(execution_info)
                                        if history_item:
                                            all_executions.append(history_item)
                                    except Exception as e:
                                        logger.warning(f"Could not get execution info for {project.project_id}/{version_str}/{execution_id}: {e}")
                                break
                    except Exception as e:
                        logger.warning(f"Could not get version info for {project.project_id}/{version_str}: {e}")
            
            # Sort by timestamp (newest first) and apply limit
            all_executions.sort(key=lambda x: x.created_at, reverse=True)
            if limit:
                all_executions = all_executions[:limit]
                
            logger.info(f"Returning {len(all_executions)} execution history items from storage")
            return {"executions": all_executions}
            
    except Exception as e:
        logger.error(f"Error retrieving execution history: {e}")
        return {"executions": []}

@app.get("/api/execution-history/{execution_id}")
async def get_execution_history_item(execution_id: str):
    """Get a specific execution from persistent storage"""
    logger.info(f"Retrieving execution history item from storage - ID: {execution_id}")
    
    try:
        # Search through all projects and versions to find the execution
        projects = await storage_service.list_projects()
        
        for project in projects:
            for version in project.versions:
                for execution in version.executions:
                    if execution.execution_id == execution_id:
                        logger.info(f"Execution history item found - ID: {execution_id}")
                        return execution
        
        # If not found in any project/version
        logger.warning(f"Execution history item not found in storage - ID: {execution_id}")
        raise HTTPException(status_code=404, detail="Execution history item not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving execution history item - ID: {execution_id}, Error: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving execution history item")

@app.delete("/api/execution-history/{execution_id}")
async def delete_execution_history_item(execution_id: str):
    """Delete an execution from persistent storage"""
    logger.info(f"Deleting execution history item from storage - ID: {execution_id}")
    
    try:
        # Search through all projects and versions to find and delete the execution
        projects = await storage_service.list_projects()
        
        for project in projects:
            for version in project.versions:
                for execution in version.executions:
                    if execution.execution_id == execution_id:
                        # Found the execution, delete its artifacts
                        try:
                            # Delete all artifact types for this execution
                            for file_type in ["generate.py", "result.json", "flow.json", "metadata.json"]:
                                try:
                                    await storage_service.delete_artifact(
                                        project.project_id, 
                                        version.version, 
                                        execution.execution_id, 
                                        file_type
                                    )
                                except Exception as e:
                                    logger.warning(f"Could not delete {file_type} for execution {execution_id}: {e}")
                            
                            logger.info(f"Deleted execution history item from storage - ID: {execution_id}")
                            return {"message": "Execution history item deleted successfully"}
                        except Exception as e:
                            logger.error(f"Error deleting execution artifacts - ID: {execution_id}, Error: {e}")
                            raise HTTPException(status_code=500, detail="Error deleting execution artifacts")
        
        # If not found in any project/version
        logger.warning(f"Execution history item not found for deletion - ID: {execution_id}")
        raise HTTPException(status_code=404, detail="Execution history item not found")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting execution history item - ID: {execution_id}, Error: {e}")
        raise HTTPException(status_code=500, detail="Error deleting execution history item")

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

async def _convert_execution_info_to_history_item(execution_info: ExecutionInfo) -> Optional[ExecutionHistoryItem]:
    """Convert ExecutionInfo to ExecutionHistoryItem by loading result.json"""
    try:
        # Look for result.json artifact
        result_artifact = None
        for artifact in execution_info.artifacts:
            if artifact.file_type == "result.json":
                result_artifact = artifact
                break
        
        if not result_artifact:
            logger.warning(f"No result.json found for execution {execution_info.execution_id}")
            return None
        
        # Load the result data from storage
        try:
            artifact_content = await storage_service.retrieve_artifact(
                execution_info.project_id,
                execution_info.version,
                execution_info.execution_id,
                "result.json"
            )
            result_data = json.loads(artifact_content.content)
            
            # Create ExecutionResult from the loaded data
            execution_result = ExecutionResult(
                success=result_data.get("success", False),
                output=result_data.get("output", ""),
                error=result_data.get("error"),
                execution_time=result_data.get("execution_time", 0.0),
                timestamp=result_data.get("timestamp", execution_info.created_at.isoformat())
            )
            
            # Try to load code from generate.py if available
            code = None
            try:
                code_artifact = await storage_service.retrieve_artifact(
                    execution_info.project_id,
                    execution_info.version,
                    execution_info.execution_id,
                    "generate.py"
                )
                code = code_artifact.content
            except Exception:
                pass  # Code is optional
            
            # Try to load metadata for input_data if available
            input_data = None
            try:
                metadata_artifact = await storage_service.retrieve_artifact(
                    execution_info.project_id,
                    execution_info.version,
                    execution_info.execution_id,
                    "metadata.json"
                )
                metadata = json.loads(metadata_artifact.content)
                # input_data might be stored in metadata (legacy) but we don't have it in current structure
                input_data = metadata.get("input_data")
            except Exception:
                pass  # Input data is optional
            
            # Create ExecutionHistoryItem
            return ExecutionHistoryItem(
                execution_id=execution_info.execution_id,
                project_id=execution_info.project_id,
                version=execution_info.version,
                result=execution_result,
                code=code,
                input_data=input_data,
                created_at=execution_info.created_at.isoformat()
            )
            
        except Exception as e:
            logger.warning(f"Failed to load result data for execution {execution_info.execution_id}: {e}")
            return None
            
    except Exception as e:
        logger.error(f"Error converting ExecutionInfo to ExecutionHistoryItem: {e}")
        return None

async def save_to_execution_history(
    execution_id: str, 
    result: ExecutionResult, 
    code: str, 
    input_data: Optional[str] = None,
    project_id: Optional[str] = None,
    version: Optional[str] = None,
    flow_data: Optional[dict] = None
):
    """Save execution result as artifacts to persistent storage"""
    try:
        # Use default values if not provided
        project_id = project_id or "default-project"
        version = version or "1.0.0"
        
        # Create execution timestamp for directory name
        execution_time = datetime.now().strftime("%Y%m%d_%H%M%S")
        execution_dir = f"exec-{execution_time}_{execution_id[:8]}"
        
        # Save generated code artifact
        if code:
            code_request = ArtifactRequest(
                project_id=project_id,
                version=version,
                execution_id=execution_dir,
                content=code,
                file_type="generate.py"
            )
            await storage_service.save_artifact(code_request)
            logger.info(f"Saved generate.py artifact - Project: {project_id}, Version: {version}, Execution: {execution_dir}")
        
        # Save execution result artifact
        result_data = {
            "success": result.success,
            "output": result.output,
            "error": result.error,
            "execution_time": result.execution_time,
            "timestamp": result.timestamp
        }
        result_request = ArtifactRequest(
            project_id=project_id,
            version=version,
            execution_id=execution_dir,
            content=json.dumps(result_data, indent=2),
            file_type="result.json"
        )
        await storage_service.save_artifact(result_request)
        logger.info(f"Saved result.json artifact - Project: {project_id}, Version: {version}, Execution: {execution_dir}")
        
        # Save metadata artifact
        metadata = {
            "execution_id": execution_id,
            "project_id": project_id,
            "version": version,
            "timestamp": datetime.now().isoformat(),
            "has_input_data": input_data is not None,
            "code_length": len(code) if code else 0,
            "success": result.success
        }
        metadata_request = ArtifactRequest(
            project_id=project_id,
            version=version,
            execution_id=execution_dir,
            content=json.dumps(metadata, indent=2),
            file_type="metadata.json"
        )
        await storage_service.save_artifact(metadata_request)
        logger.info(f"Saved metadata.json artifact - Project: {project_id}, Version: {version}, Execution: {execution_dir}")
        
        # Save flow data if available
        if flow_data is None:
            flow_data = {"nodes": [], "edges": [], "note": "Flow data not provided by frontend"}
        flow_request = ArtifactRequest(
            project_id=project_id,
            version=version,
            execution_id=execution_dir,
            content=json.dumps(flow_data, indent=2),
            file_type="flow.json"
        )
        await storage_service.save_artifact(flow_request)
        logger.info(f"Saved flow.json artifact - Project: {project_id}, Version: {version}, Execution: {execution_dir}")
        
        logger.info(f"Successfully saved all execution artifacts - ID: {execution_id}")
    except Exception as e:
        logger.error(f"Failed to save execution artifacts - ID: {execution_id}, Error: {e}")

async def execute_strands_code(code: str, input_data: Optional[str] = None, openai_api_key: Optional[str] = None) -> str:
    """Execute Python code with Strands Agent SDK integration"""
    logger.info("Starting execute_strands_code function")
    logger.debug(f"Code length: {len(code)} characters")
    
    try:
        # Set API keys as environment variables for security
        if openai_api_key:
            os.environ["OPENAI_API_KEY"] = openai_api_key
            logger.info("OpenAI API key set in environment")
        
        # Import Strands Agent SDK
        logger.info("Importing Strands Agent SDK")
        from strands import Agent, tool
        from strands.models import BedrockModel
        from strands_tools import calculator, file_read, shell, current_time
        
        # Import OpenAI model if needed
        openai_imports = {}
        if 'OpenAIModel' in code:
            logger.info("OpenAI model detected in code, importing OpenAI dependencies")
            try:
                from strands.models.openai import OpenAIModel
                openai_imports['OpenAIModel'] = OpenAIModel
            except ImportError as e:
                logger.warning(f"OpenAI model not available: {e}")
        
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
            'os': os,  # Add os module for environment variables
            'input_data': input_data,  # Make input data available to executed code
            **mcp_imports,  # Add MCP imports if available
            **openai_imports,  # Add OpenAI imports if available
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
                import inspect
                import asyncio
                
                # Check if main function is async
                if inspect.iscoroutinefunction(locals_dict['main']):
                    logger.info("Main function is async, awaiting result")
                    result = await locals_dict['main']()
                else:
                    logger.info("Main function is sync, calling directly")
                    result = locals_dict['main']()
                
                if result is not None:
                    logger.info(f"Main function returned: {type(result).__name__}")
                    logger.info(f"Main function result: {result}")
        
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

# Storage API Endpoints
@app.post("/api/storage/artifacts", response_model=ArtifactResponse)
async def save_artifact(request: ArtifactRequest):
    """Save an artifact to storage"""
    # logger.info(f"Saving artifact: {request.project_id}/{request.version}/{request.execution_id}/{request.file_type}")
    try:
        result = await storage_service.save_artifact(request)
        if result.success:
            # logger.info(f"Artifact saved successfully: {result.file_path}")
            pass
        else:
            logger.error(f"Failed to save artifact: {result.message}")
        return result
    except Exception as e:
        logger.error(f"Error in save_artifact endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/storage/artifacts/{project_id}/{version}/{execution_id}/{file_type}", response_model=ArtifactContent)
async def retrieve_artifact(project_id: str, version: str, execution_id: str, file_type: str):
    """Retrieve an artifact from storage"""
    logger.info(f"Retrieving artifact: {project_id}/{version}/{execution_id}/{file_type}")
    try:
        result = await storage_service.retrieve_artifact(project_id, version, execution_id, file_type)
        # logger.info(f"Artifact retrieved successfully")
        return result
    except Exception as e:
        logger.error(f"Error in retrieve_artifact endpoint: {e}")
        raise

@app.get("/api/storage/artifacts/{project_id}/{version}/{execution_id}/{file_type}/download")
async def download_artifact(project_id: str, version: str, execution_id: str, file_type: str):
    """Download an artifact file directly"""
    logger.info(f"Downloading artifact: {project_id}/{version}/{execution_id}/{file_type}")
    try:
        # Use the storage service to get the file path
        storage_path = storage_service.base_dir
        from app.utils.path_utils import build_storage_path, get_file_extension
        
        artifact_path = build_storage_path(storage_path, project_id, version, execution_id)
        file_name = file_type
        if not file_name.endswith(get_file_extension(file_type)):
            file_name += get_file_extension(file_type)
        
        file_path = artifact_path / file_name
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Artifact not found")
        
        # Determine content type based on file extension
        content_type_map = {
            '.py': 'text/x-python',
            '.json': 'application/json',
            '.txt': 'text/plain'
        }
        
        extension = get_file_extension(file_type)
        content_type = content_type_map.get(extension, 'text/plain')
        
        logger.info(f"Serving file: {file_path}")
        return FileResponse(
            path=str(file_path),
            filename=file_name,
            media_type=content_type
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in download_artifact endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/storage/artifacts/{project_id}/{version}/{execution_id}/{file_type}")
async def delete_artifact(project_id: str, version: str, execution_id: str, file_type: str):
    """Delete an artifact from storage"""
    logger.info(f"Deleting artifact: {project_id}/{version}/{execution_id}/{file_type}")
    try:
        success = await storage_service.delete_artifact(project_id, version, execution_id, file_type)
        if success:
            logger.info(f"Artifact deleted successfully")
            return {"message": "Artifact deleted successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete artifact")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in delete_artifact endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/storage/projects", response_model=List[ProjectInfo])
async def list_projects():
    """List all projects in storage"""
    logger.info("Listing all projects")
    try:
        projects = await storage_service.list_projects()
        logger.info(f"Found {len(projects)} projects")
        return projects
    except Exception as e:
        logger.error(f"Error in list_projects endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/storage/projects/{project_id}/versions", response_model=List[VersionInfo])
async def get_project_versions(project_id: str):
    """Get all versions for a project"""
    logger.info(f"Getting versions for project: {project_id}")
    try:
        versions = await storage_service.get_project_versions(project_id)
        logger.info(f"Found {len(versions)} versions for project {project_id}")
        return versions
    except Exception as e:
        logger.error(f"Error in get_project_versions endpoint: {e}")
        raise

@app.get("/api/storage/projects/{project_id}/versions/{version}/executions/{execution_id}", response_model=ExecutionInfo)
async def get_execution_info(project_id: str, version: str, execution_id: str):
    """Get information about a specific execution"""
    logger.info(f"Getting execution info: {project_id}/{version}/{execution_id}")
    try:
        execution_info = await storage_service.get_execution_info(project_id, version, execution_id)
        logger.info(f"Found {len(execution_info.artifacts)} artifacts for execution {execution_id}")
        return execution_info
    except Exception as e:
        logger.error(f"Error in get_execution_info endpoint: {e}")
        raise

@app.get("/api/storage/stats", response_model=StorageStats)
async def get_storage_stats():
    """Get storage system statistics"""
    logger.info("Getting storage statistics")
    try:
        stats = await storage_service.get_storage_stats()
        logger.info(f"Storage stats: {stats.total_projects} projects, {stats.total_artifacts} artifacts")
        return stats
    except Exception as e:
        logger.error(f"Error in get_storage_stats endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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