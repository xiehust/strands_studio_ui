export interface ConversationSession {
  session_id: string;
  project_id: string;
  version: string;
  agent_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ChatMessage {
  message_id: string;
  session_id: string;
  sender: 'user' | 'agent';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CreateConversationRequest {
  project_id: string;
  version: string;
  flow_data: {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  generated_code: string;
  openai_api_key?: string;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  stream?: boolean;
}

export interface ChatResponse {
  message_id: string;
  content: string;
  timestamp: string;
  streaming_complete?: boolean;
}

export interface ConversationListResponse {
  sessions: ConversationSession[];
}

export interface ConversationHistoryResponse {
  session: ConversationSession;
  messages: ChatMessage[];
}