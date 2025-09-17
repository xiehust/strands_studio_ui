from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Literal
from datetime import datetime
import uuid

class ConversationSession(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    project_id: str
    version: str
    agent_config: Dict[str, Any]
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    message_count: int = 0
    openai_api_key: Optional[str] = None

class ChatMessage(BaseModel):
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    sender: Literal["user", "agent"]
    content: str
    timestamp: datetime = Field(default_factory=datetime.now)
    metadata: Optional[Dict[str, Any]] = None

class CreateConversationRequest(BaseModel):
    project_id: str
    version: str
    flow_data: Dict[str, Any]
    generated_code: str
    openai_api_key: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    stream: bool = False

class ChatResponse(BaseModel):
    message_id: str
    content: str
    timestamp: datetime
    streaming_complete: bool = True

class ConversationListResponse(BaseModel):
    sessions: List[ConversationSession]

class ConversationHistoryResponse(BaseModel):
    session: ConversationSession
    messages: List[ChatMessage]

class MessageListResponse(BaseModel):
    messages: List[ChatMessage]