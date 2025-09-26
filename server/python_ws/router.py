from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter
import json
import logging
from server.python_ws.manager import websocket_manager
from server.python_ws.tts_service import tts_service

logger = logging.getLogger(__name__)
router = APIRouter()

@router.websocket("/ws/tts")
async def tts_websocket(websocket: WebSocket):
    """WebSocket endpoint for TTS streaming"""
    client_id = str(id(websocket))
    
    try:
        await websocket_manager.connect(websocket, client_id)
        
        while True:
            # Wait for message from client
            data = await websocket.receive_text()
            if not data:
                continue
                
            try:
                message = json.loads(data)
                text = message.get("text", "").strip()
                voice = message.get("voice", "en-us_ljspeech")
                speed = float(message.get("speed", 1.0))
                
                if not text:
                    await websocket_manager.send_message(
                        client_id,
                        {"error": "No text provided", "type": "error"}
                    )
                    continue
                
                # Send initial processing message
                await websocket_manager.send_message(
                    client_id,
                    {"type": "status", "message": "Processing TTS..."}
                )
                
                # Stream TTS audio
                async for audio_chunk in tts_service.stream_tts(text, voice, speed):
                    await websocket_manager.send_message(
                        client_id,
                        {
                            "type": "audio_chunk",
                            "data": audio_chunk.hex(),  # Convert bytes to hex string
                            "voice": voice,
                            "text_length": len(text)
                        }
                    )
                
                # Send completion message
                await websocket_manager.send_message(
                    client_id,
                    {"type": "complete", "message": "TTS generation complete"}
                )
                
            except json.JSONDecodeError:
                await websocket_manager.send_message(
                    client_id,
                    {"type": "error", "message": "Invalid JSON format"}
                )
            except Exception as e:
                logger.error(f"Processing error: {e}", exc_info=True)
                await websocket_manager.send_message(
                    client_id,
                    {"type": "error", "message": str(e)}
                )
                
    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
    finally:
        await websocket_manager.disconnect(client_id)
