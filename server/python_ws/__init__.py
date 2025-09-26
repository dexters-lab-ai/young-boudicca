""
Boudi AI WebSocket Server

This module provides WebSocket-based TTS (Text-to-Speech) functionality
using the Kokoro TTS engine.
"""

__version__ = "1.0.0"
__all__ = ["websocket_manager", "tts_service"]

# Import main components
from .manager import websocket_manager
from .tts_service import tts_service
