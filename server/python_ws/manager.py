import asyncio
import json
import logging
from typing import Dict, Set, Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, client_id: str):
        """Register a new WebSocket connection"""
        await websocket.accept()
        async with self.lock:
            self.active_connections[client_id] = websocket
        logger.info(f"Client {client_id} connected. Total connections: {len(self.active_connections)}")

    async def disconnect(self, client_id: str):
        """Remove a WebSocket connection"""
        async with self.lock:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
        logger.info(f"Client {client_id} disconnected. Remaining: {len(self.active_connections)}")

    async def send_message(self, client_id: str, message: dict):
        """Send a message to a specific client"""
        if client_id not in self.active_connections:
            logger.warning(f"Attempted to send to non-existent client {client_id}")
            return False
        
        try:
            await self.active_connections[client_id].send_json(message)
            return True
        except Exception as e:
            logger.error(f"Error sending to client {client_id}: {e}")
            await self.disconnect(client_id)
            return False

    async def broadcast(self, message: dict, exclude: Optional[Set[str]] = None):
        """Broadcast a message to all connected clients"""
        exclude = exclude or set()
        tasks = []
        
        async with self.lock:
            for client_id, connection in list(self.active_connections.items()):
                if client_id not in exclude:
                    try:
                        tasks.append(connection.send_json(message))
                    except Exception as e:
                        logger.error(f"Error broadcasting to {client_id}: {e}")
                        await self.disconnect(client_id)
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

# Singleton instance
websocket_manager = WebSocketManager()
