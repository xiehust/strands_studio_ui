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
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white bg-opacity-90 rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col ">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-100">
          <div className="flex items-center space-x-2 ">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Chat with Agent</h2>
            {session && (
              <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                active
              </span>
            )}
            {isStreamingAgent && (
              <div className="flex items-center space-x-1 text-xs text-blue-600">
                <Zap className="w-3 h-3" />
                <span>Streaming</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Session Info */}
        {session && (
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>Session: {session.session_id.substring(0, 8)}...</span>
              <span>Project: {session.project_id} v{session.version}</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 text-red-500 mr-2" />
              <div className="flex-1">
                <p className="text-sm text-red-700">{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="text-xs text-red-500 hover:text-red-700 mt-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && !session && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <Loader className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                <p className="text-sm text-gray-600">Initializing chat session...</p>
              </div>
            </div>
          )}

          {session && messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">Start a conversation with your agent</p>
                <p className="text-xs text-gray-500 mt-1">
                  {isStreamingAgent ? 'Streaming responses enabled' : 'Regular responses'}
                </p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.message_id}
              className={`flex items-start space-x-3 ${
                message.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.sender === 'agent' && (
                <div className="flex-shrink-0">
                  <Bot className="w-6 h-6 text-blue-600" />
                </div>
              )}

              <div
                className={`${
                  message.sender === 'user'
                    ? 'max-w-xs lg:max-w-md'
                    : 'max-w-sm lg:max-w-2xl'
                } px-4 py-2 rounded-lg ${
                  message.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <pre className="whitespace-pre-wrap text-sm break-words font-sans">
                  {message.content}
                </pre>
                <div className="text-xs opacity-70 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </div>

              {message.sender === 'user' && (
                <div className="flex-shrink-0">
                  <User className="w-6 h-6 text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {/* Streaming response */}
          {isStreaming && (
            <div className="flex items-start space-x-3 justify-start">
              <div className="flex-shrink-0">
                <Bot className="w-6 h-6 text-blue-600" />
              </div>
              <div className="max-w-sm lg:max-w-2xl px-4 py-2 rounded-lg bg-gray-100 text-gray-900">
                <pre className="whitespace-pre-wrap text-sm break-words font-sans">
                  {streamingContent}
                  <span className="animate-pulse">█</span>
                </pre>
                <div className="text-xs opacity-70 mt-1 flex items-center">
                  <Zap className="w-3 h-3 mr-1" />
                  Streaming...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {session && (
          <div className="border-t border-gray-200 p-4">
            <div className="flex space-x-2">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={1}
                disabled={isLoading || isStreaming}
              />
              <button
                onClick={sendMessage}
                disabled={!inputMessage.trim() || isLoading || isStreaming}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center"
              >
                {isLoading || isStreaming ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
              <span>Press Enter to send, Shift+Enter for new line</span>
              {isStreamingAgent && (
                <div className="flex items-center space-x-1 text-blue-600">
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