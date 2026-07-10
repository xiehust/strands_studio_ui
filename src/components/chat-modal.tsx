import { useState, useEffect, useRef } from 'react';
import { X, MessageSquare, User, Bot, Send, Loader, Zap, AlertTriangle } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import type { ConversationSession, ChatMessage, CreateConversationRequest } from '../lib/conversation-types';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  flowData: {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  generatedCode: string;
  projectId: string;
  projectVersion: string;
  openaiApiKey?: string;
}

export function ChatModal({
  isOpen,
  onClose,
  flowData,
  generatedCode,
  projectId,
  projectVersion,
  openaiApiKey
}: ChatModalProps) {
  const [session, setSession] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if the agent has streaming enabled
  const isStreamingAgent = flowData?.nodes?.some(node =>
    (node.type === 'agent' || node.type === 'orchestrator-agent') &&
    (node.data as Record<string, unknown>)?.streaming === true
  ) || generatedCode.includes('stream_async') || generatedCode.includes('yield');

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Initialize session when modal opens
  useEffect(() => {
    if (isOpen && !session) {
      initializeSession();
    }
  }, [isOpen, session]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSession(null);
      setMessages([]);
      setInputMessage('');
      setError(null);
      setStreamingContent('');
      setIsStreaming(false);
    }
  }, [isOpen]);

  const initializeSession = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const request: CreateConversationRequest = {
        project_id: projectId,
        version: projectVersion,
        flow_data: flowData,
        generated_code: generatedCode,
        openai_api_key: openaiApiKey,
      };

      const newSession = await apiClient.createConversationSession(request);
      setSession(newSession);
    } catch (error) {
      console.error('Failed to create conversation session:', error);
      setError(error instanceof Error ? error.message : 'Failed to initialize chat session');
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !session || isStreaming) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setError(null);

    // Add user message to local state
    const userChatMessage: ChatMessage = {
      message_id: `temp_${Date.now()}`,
      session_id: session.session_id,
      sender: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userChatMessage]);

    try {
      if (isStreamingAgent) {
        // Use streaming
        setIsStreaming(true);
        setStreamingContent('');

        await apiClient.sendChatMessageStream(
          {
            session_id: session.session_id,
            message: userMessage,
            stream: true,
          },
          (chunk: string) => {
            setStreamingContent(prev => prev + chunk);
          },
          (finalOutput: string, messageId: string) => {
            setIsStreaming(false);

            const agentMessage: ChatMessage = {
              message_id: messageId || `msg_${Date.now()}`,
              session_id: session.session_id,
              sender: 'agent',
              content: finalOutput,
              timestamp: new Date().toISOString(),
            };

            setMessages(prev => [...prev, agentMessage]);
            setStreamingContent('');
          },
          (error: string, partialOutput: string) => {
            setIsStreaming(false);
            setError(`Chat error: ${error}`);

            if (partialOutput) {
              const errorMessage: ChatMessage = {
                message_id: `error_${Date.now()}`,
                session_id: session.session_id,
                sender: 'agent',
                content: partialOutput,
                timestamp: new Date().toISOString(),
              };
              setMessages(prev => [...prev, errorMessage]);
            }
            setStreamingContent('');
          }
        );
      } else {
        // Use regular message sending
        setIsLoading(true);
        const response = await apiClient.sendChatMessage({
          session_id: session.session_id,
          message: userMessage,
        });

        const agentMessage: ChatMessage = {
          message_id: response.message_id,
          session_id: session.session_id,
          sender: 'agent',
          content: response.content,
          timestamp: response.timestamp,
        };

        setMessages(prev => [...prev, agentMessage]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setError(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="lp-panel brk lp-rise w-full max-w-4xl h-3/4 flex flex-col m-4">
        {/* Header */}
        <div className="lp-phead">
          <MessageSquare className="w-4 h-4 text-amber" />
          <h2 className="lp-ptitle">Chat Playground</h2>
          {session && (
            <span className="lp-chip good"><i>●</i>ACTIVE</span>
          )}
          {isStreamingAgent && (
            <span className="lp-chip blue"><Zap className="w-3 h-3" />STREAMING</span>
          )}
          <button
            onClick={onClose}
            className="ml-auto text-ink-3 hover:text-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Session Info */}
        {session && (
          <div className="px-4 py-2 border-b border-grid bg-panel2">
            <div className="flex items-center justify-between font-mono text-[10px] text-ink-3 tracking-wider">
              <span>SESSION {session.session_id.substring(0, 8)}…</span>
              <span>PROJECT {session.project_id} · v{session.version}</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-crit/10 border border-crit/40">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-crit mr-2 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="font-mono text-[10px] uppercase tracking-wider text-crit hover:text-red-700 mt-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {isLoading && !session && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <Loader className="w-6 h-6 animate-spin mx-auto mb-2 text-amber" />
                <p className="font-mono text-[11px] text-ink-3">Initializing chat session…</p>
              </div>
            </div>
          )}

          {session && messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-ink-3" />
                <p className="text-sm text-ink-2">Start a conversation with your agent</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3 mt-1">
                  {isStreamingAgent ? 'Streaming responses enabled' : 'Regular responses'}
                </p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.message_id}
              className={`flex items-start gap-3 ${
                message.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.sender === 'agent' && (
                <div className="flex-shrink-0 pt-4">
                  <Bot className="w-5 h-5 text-amber" />
                </div>
              )}

              <div
                className={`${
                  message.sender === 'user'
                    ? 'max-w-xs lg:max-w-md text-right'
                    : 'max-w-sm lg:max-w-2xl'
                }`}
              >
                <div className="lp-who">
                  {message.sender === 'user' ? 'YOU' : 'AGENT'} · {new Date(message.timestamp).toLocaleTimeString()}
                </div>
                <div className={`lp-bub ${message.sender === 'user' ? 'user text-left' : ''}`}>
                  <pre className="whitespace-pre-wrap text-[13.5px] break-words font-sans">
                    {message.content}
                  </pre>
                </div>
              </div>

              {message.sender === 'user' && (
                <div className="flex-shrink-0 pt-4">
                  <User className="w-5 h-5 text-ink-3" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming response */}
          {isStreaming && (
            <div className="flex items-start gap-3 justify-start">
              <div className="flex-shrink-0 pt-4">
                <Bot className="w-5 h-5 text-amber" />
              </div>
              <div className="max-w-sm lg:max-w-2xl">
                <div className="lp-who flex items-center gap-1.5">
                  AGENT · STREAMING <Zap className="w-3 h-3 text-s1" />
                </div>
                <div className="lp-bub">
                  <pre className="whitespace-pre-wrap text-[13.5px] break-words font-sans">
                    {streamingContent}
                    <span className="lp-caret" />
                  </pre>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {session && (
          <div className="border-t border-line p-4">
            <div className="flex gap-2.5">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message your agent…"
                className="lp-input flex-1 resize-none"
                rows={1}
                disabled={isLoading || isStreaming}
              />
              <button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || isLoading || isStreaming}
                className="lp-btn primary"
              >
                {isLoading || isStreaming ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    SEND ▸
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 font-mono text-[9.5px] uppercase tracking-wider text-ink-3">
              <span>Enter to send · Shift+Enter for new line</span>
              {isStreamingAgent && (
                <div className="flex items-center gap-1 text-s1">
                  <Zap className="w-3 h-3" />
                  <span>Streaming enabled</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}