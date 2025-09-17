import asyncio
import json
import os
import subprocess
import tempfile
import uuid
from datetime import datetime
from typing import Dict, List, Optional, AsyncGenerator, Any
from pathlib import Path

from ..models.conversation import (
    ConversationSession,
    ChatMessage,
    CreateConversationRequest,
    ChatResponse,
    ConversationListResponse,
    ConversationHistoryResponse,
    MessageListResponse
)
from .storage_service import StorageService
import logging
logger = logging.getLogger(__name__)

class ConversationService:
    def __init__(self):
        self.sessions: Dict[str, ConversationSession] = {}
        self.messages: Dict[str, List[ChatMessage]] = {}  # session_id -> messages
        self.agent_processes: Dict[str, Any] = {}  # session_id -> agent process info
        self.storage_service = StorageService()

    async def create_session(self, request: CreateConversationRequest) -> ConversationSession:
        """Create a new conversation session with an agent."""
        session = ConversationSession(
            project_id=request.project_id,
            version=request.version,
            agent_config=request.flow_data,
            openai_api_key=request.openai_api_key,
        )

        # Store session
        self.sessions[session.session_id] = session
        self.messages[session.session_id] = []

        # Initialize agent environment
        await self._initialize_agent(session.session_id, request.generated_code)

        return session

    async def _initialize_agent(self, session_id: str, generated_code: str) -> None:
        """Initialize the agent code for this session."""
        try:
            # Create a temporary directory for this session
            session_dir = Path(tempfile.mkdtemp(prefix=f"agent_session_{session_id}_"))

            # Write the generated code to a Python file
            agent_file = session_dir / "agent.py"
            agent_file.write_text(generated_code)

            # Store agent information
            self.agent_processes[session_id] = {
                'session_dir': session_dir,
                'agent_file': agent_file,
                'initialized': True
            }

        except Exception as e:
            print(f"Failed to initialize agent for session {session_id}: {e}")
            raise

    async def send_message(
        self,
        session_id: str,
        message: str,
        stream: bool = False
    ) -> ChatResponse:
        """Send a message to the agent and get response."""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        # Add user message
        user_message = ChatMessage(
            session_id=session_id,
            sender="user",
            content=message
        )
        self.messages[session_id].append(user_message)

        # Get agent response
        if stream:
            # For now, return a placeholder - streaming will be handled by the endpoint
            agent_response = ChatMessage(
                session_id=session_id,
                sender="agent",
                content="",  # Will be populated by streaming
            )
        else:
            response_content = await self._execute_agent(session_id, message)
            agent_response = ChatMessage(
                session_id=session_id,
                sender="agent",
                content=response_content,
            )
            self.messages[session_id].append(agent_response)

        # Update session
        session = self.sessions[session_id]
        session.message_count += 1 if not stream else 0  # Count will be updated after streaming
        session.updated_at = datetime.now()

        return ChatResponse(
            message_id=agent_response.message_id,
            content=agent_response.content,
            timestamp=agent_response.timestamp,
            streaming_complete=not stream
        )

    async def _execute_agent(self, session_id: str, user_input: str) -> str:
        """Execute the agent with user input and return response."""
        if session_id not in self.agent_processes:
            raise ValueError(f"Agent not initialized for session {session_id}")

        agent_info = self.agent_processes[session_id]
        agent_file = agent_info['agent_file']

        try:
            # Get session and API key
            session = self.sessions[session_id]

            # Construct full conversation history
            messages_list = self._construct_messages_list(session_id, user_input)
            logger.info(messages_list)
            messages_json = json.dumps(messages_list)

            # Prepare environment with API key
            env = os.environ.copy()
            if session.openai_api_key:
                env["OPENAI_API_KEY"] = session.openai_api_key
                logger.info("OpenAI API key set in environment for conversation")

            # Execute the agent Python script with full conversation history
            result = subprocess.run([
                'uv', 'run', 'python', str(agent_file),
                '--messages', messages_json
            ],
            capture_output=True,
            text=True,
            timeout=60,  # 60 second timeout
            cwd=agent_file.parent,
            env=env  # Pass environment variables including API key
            )

            if result.returncode == 0:
                return result.stdout.strip()
            else:
                error_msg = result.stderr.strip() or "Agent execution failed"
                logger.error(f"Agent execution error for session {session_id}: {error_msg}")
                return f"Error: {error_msg}"

        except subprocess.TimeoutExpired:
            return "Error: Agent execution timed out"
        except Exception as e:
            print(f"Exception during agent execution for session {session_id}: {e}")
            return f"Error: {str(e)}"

    def _construct_messages_list(self, session_id: str, new_user_input: str) -> list:
        """Construct messages list according to the schema:
        [{"role":"user","content":[{"text": "..."}]}, {"role":"assistant","content":[{"text": "..."}]}, ...]
        """
        messages_list = []

        # Get existing messages for this session
        existing_messages = self.messages.get(session_id, [])

        # Convert existing messages to the required schema
        for message in existing_messages:
            role = "user" if message.sender == "user" else "assistant"
            messages_list.append({
                "role": role,
                "content": [{"text": message.content}]
            })

        # Add the new user input to the messages list
        messages_list.append({
            "role": "user",
            "content": [{"text": new_user_input}]
        })

        return messages_list

    async def stream_message(
        self,
        session_id: str,
        message: str
    ) -> AsyncGenerator[str, None]:
        """Stream a message to the agent and yield response chunks."""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        # Add user message
        user_message = ChatMessage(
            session_id=session_id,
            sender="user",
            content=message
        )
        self.messages[session_id].append(user_message)

        # Stream agent response
        full_response = ""
        agent_message_id = str(uuid.uuid4())

        try:
            async for chunk in self._execute_agent_stream(session_id, message):
                full_response += chunk
                yield chunk

            # Add completed agent message
            agent_message = ChatMessage(
                message_id=agent_message_id,
                session_id=session_id,
                sender="agent",
                content=full_response,
            )
            self.messages[session_id].append(agent_message)

            # Update session
            session = self.sessions[session_id]
            session.message_count += 2  # user + agent message
            session.updated_at = datetime.now()

            # Send completion signal with message ID
            yield f"[CHAT_COMPLETE:{agent_message_id}]"

        except Exception as e:
            error_msg = f"Error: {str(e)}"
            yield error_msg

            # Add error message
            error_message = ChatMessage(
                message_id=agent_message_id,
                session_id=session_id,
                sender="agent",
                content=error_msg,
            )
            self.messages[session_id].append(error_message)

            yield f"[CHAT_COMPLETE:{agent_message_id}]"

    async def _execute_agent_stream(
        self,
        session_id: str,
        user_input: str
    ) -> AsyncGenerator[str, None]:
        """Execute the agent with streaming and yield response chunks."""
        if session_id not in self.agent_processes:
            raise ValueError(f"Agent not initialized for session {session_id}")

        agent_info = self.agent_processes[session_id]
        agent_file = agent_info['agent_file']

        try:
            # Get session and API key
            session = self.sessions[session_id]

            # Construct full conversation history
            messages_list = self._construct_messages_list(session_id, user_input)
            messages_json = json.dumps(messages_list)

            # Prepare environment with API key
            env = {**os.environ, 'PYTHONUNBUFFERED': '1'}
            if session.openai_api_key:
                env["OPENAI_API_KEY"] = session.openai_api_key
                logger.info("OpenAI API key set in environment for streaming conversation")

            # Execute the agent Python script with full conversation history (unbuffered)
            process = await asyncio.create_subprocess_exec(
                'uv', 'run', 'python', '-u', str(agent_file),  # -u for unbuffered
                '--messages', messages_json,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=agent_file.parent,
                env=env  # Pass environment variables including API key
            )

            # Read output in chunks
            while True:
                chunk = await process.stdout.read(1024)
                if not chunk:
                    break

                text_chunk = chunk.decode('utf-8', errors='ignore')
                if text_chunk:
                    yield text_chunk

            # Wait for process to complete
            await process.wait()

            if process.returncode != 0:
                stderr_output = await process.stderr.read()
                error_msg = stderr_output.decode('utf-8', errors='ignore').strip()
                if error_msg:
                    yield f"\nError: {error_msg}"

        except Exception as e:
            yield f"Error: {str(e)}"

    async def get_sessions(self) -> ConversationListResponse:
        """Get all conversation sessions."""
        sessions = list(self.sessions.values())
        # Sort by updated_at descending
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return ConversationListResponse(sessions=sessions)

    async def get_session_history(self, session_id: str) -> ConversationHistoryResponse:
        """Get conversation history for a session."""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        session = self.sessions[session_id]
        messages = self.messages.get(session_id, [])

        return ConversationHistoryResponse(
            session=session,
            messages=messages
        )

    async def get_session_messages(self, session_id: str) -> MessageListResponse:
        """Get messages for a session."""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        messages = self.messages.get(session_id, [])
        return MessageListResponse(messages=messages)

    async def delete_session(self, session_id: str) -> dict:
        """Delete a conversation session."""
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found")

        # Clean up agent process resources
        if session_id in self.agent_processes:
            agent_info = self.agent_processes[session_id]
            session_dir = agent_info.get('session_dir')
            if session_dir and session_dir.exists():
                # Clean up temporary directory
                import shutil
                shutil.rmtree(session_dir, ignore_errors=True)
            del self.agent_processes[session_id]

        # Remove from memory
        del self.sessions[session_id]
        if session_id in self.messages:
            del self.messages[session_id]

        return {"message": f"Session {session_id} deleted successfully"}

    async def cleanup_expired_sessions(self, max_age_hours: int = 24) -> int:
        """Clean up expired sessions."""
        from datetime import timedelta

        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        expired_sessions = [
            session_id for session_id, session in self.sessions.items()
            if session.updated_at < cutoff_time
        ]

        for session_id in expired_sessions:
            try:
                await self.delete_session(session_id)
            except Exception as e:
                print(f"Failed to cleanup session {session_id}: {e}")

        return len(expired_sessions)


# Global instance
conversation_service = ConversationService()