"""
Server-Sent Events (SSE) formatting utilities
"""
import json
from typing import Any, Dict, Optional


class SSEFormatter:
    """Utility class for formatting Server-Sent Events"""
    
    @staticmethod
    def format_data(data: str, event_type: str = "message", event_id: Optional[str] = None) -> str:
        """
        Format data as SSE format
        
        Args:
            data: The data to send
            event_type: The event type (default: "message")
            event_id: Optional event ID
            
        Returns:
            SSE formatted string
        """
        sse_lines = []
        
        if event_id:
            sse_lines.append(f"id: {event_id}")
        
        sse_lines.append(f"event: {event_type}")
        sse_lines.append(f"data: {data}")
        sse_lines.append("")  # Empty line to end the event
        
        return "\n".join(sse_lines) + "\n"
    
    @staticmethod
    def format_json_data(data: Dict[str, Any], event_type: str = "message", event_id: Optional[str] = None) -> str:
        """
        Format JSON data as SSE format
        
        Args:
            data: The JSON data to send
            event_type: The event type (default: "message")
            event_id: Optional event ID
            
        Returns:
            SSE formatted string
        """
        json_data = json.dumps(data, ensure_ascii=False)
        return SSEFormatter.format_data(json_data, event_type, event_id)
    
    @staticmethod
    def format_error(error_message: str, error_code: Optional[str] = None) -> str:
        """
        Format error message as SSE format
        
        Args:
            error_message: The error message
            error_code: Optional error code
            
        Returns:
            SSE formatted error event
        """
        error_data = {
            "error": error_message
        }
        
        if error_code:
            error_data["code"] = error_code
        
        return SSEFormatter.format_json_data(error_data, "error")
    
    @staticmethod
    def format_end_event() -> str:
        """
        Format end event to signal completion
        
        Returns:
            SSE formatted end event
        """
        return SSEFormatter.format_data("", "end")
    
    @staticmethod
    def format_heartbeat() -> str:
        """
        Format heartbeat event to keep connection alive
        
        Returns:
            SSE formatted heartbeat event
        """
        return SSEFormatter.format_data("ping", "heartbeat")


class StreamingError(Exception):
    """Exception raised during streaming operations"""
    pass


class StreamTimeoutError(StreamingError):
    """Exception raised when streaming operation times out"""
    pass


class StreamParsingError(StreamingError):
    """Exception raised when parsing streaming data fails"""
    pass
