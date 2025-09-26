"""FastAPI server for Kokoro TTS WebSocket interface"""

import asyncio
import json
import logging
import os
import sys
import traceback
import numpy as np
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import Kokoro components
try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.tokenizer import Tokenizer
except ImportError as e:
    logger.error(f"Could not import Kokoro TTS components: {e}")
    sys.exit(1)

app = FastAPI(title="Boudi AI WebSocket Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSEngine:
    """Handles TTS model loading and audio streaming"""
    
    def __init__(self, model_dir: str):
        self.kokoro = None
        self.model_dir = model_dir

    def load(self):
        """Load TTS model and voices"""
        logger.info(f"Loading models from: {self.model_dir}")
        try:
            model_path = os.path.join(self.model_dir, "kokoro-v1.0.onnx")
            voices_path = os.path.join(self.model_dir, "voices-v1.0.bin")
            
            if not os.path.exists(voices_path):
                logger.error(f"Voices file not found at {voices_path}")
                raise FileNotFoundError(f"Voices file not found at {voices_path}")
                
            if not os.path.exists(model_path):
                logger.error(f"Model file not found at {model_path}")
                raise FileNotFoundError(f"Model file not found at {model_path}")
                logger.error("Model files not found in the specified directory.")
                return

            logger.info("Initializing tokenizer...")
            tokenizer = Tokenizer()
            logger.info("Tokenizer initialized. Loading Kokoro model...")
            self.kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
            logger.info("Model loaded successfully.")
        except Exception as e:
            logger.error(f"FATAL: Failed to load model: {e}")
            logger.error(traceback.format_exc())
            self.kokoro = None

    async def stream_tts(self, text: str, voice: str, lang: str, speed: float, websocket: WebSocket):
        """Stream TTS audio to WebSocket client
        
        Args:
            text: Text to convert to speech
            voice: Voice to use (e.g., 'en-us_ljspeech')
            lang: Language code (e.g., 'en')
            speed: Speech rate (0.5 to 3.0)
            websocket: WebSocket connection to send audio to
        """
        if not self.kokoro:
            logger.error("TTS engine not loaded.")
            await websocket.send_json({"error": "TTS engine not loaded"})
            return

        try:
            async for samples, _ in self.kokoro.create_stream(
                text=text,
                voice=voice or 'en-us_ljspeech',
                speed=speed or 1.0,
                lang=lang or 'en-us',
                trim=False
            ):
                # Ensure samples are float32 in range [-1, 1]
                if not isinstance(samples, np.ndarray):
                    samples = np.asarray(samples, dtype=np.float32)
                else:
                    samples = samples.astype(np.float32, copy=False)
                
                # Convert to 16-bit PCM
                pcm16 = np.clip(samples, -1.0, 1.0)
                pcm16 = (pcm16 * 32767.0).astype(np.int16)
                
                # Send audio chunk
                await websocket.send_bytes(pcm16.tobytes())
                
        except Exception as e:
            logger.error(f"TTS streaming error: {e}")
            logger.error(traceback.format_exc())
            await websocket.send_json({"error": f"TTS error: {str(e)}"})
            raise

# --- Globals --- 
tts_engine = None

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on startup"""
    global tts_engine
    try:
        # Resolve model path relative to the script's location
        model_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'python-tts'))
        tts_engine = TTSEngine(model_dir)
        tts_engine.load()
        logger.info("TTS engine loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load TTS engine: {e}")
        logger.error(traceback.format_exc())
        tts_engine = None

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for TTS streaming."""
    global tts_engine
    
    # Accept the WebSocket connection
    await websocket.accept()
    
    if not tts_engine or not tts_engine.kokoro:
        await websocket.close(code=1011, reason="TTS engine not ready")
        return

    try:
        while True:
            # Wait for a message from the client
            data = await websocket.receive_text()
            if not data:
                continue
                
            try:
                # Parse the incoming message
                message = json.loads(data)
                text = message.get("text", "").strip()
                voice = message.get("voice", "en-us_ljspeech")
                speed = max(0.5, min(3.0, float(message.get("speed", 1.0))))  # Clamp speed
                
                if not text:
                    await websocket.send_json({"error": "No text provided"})
                    continue
                
                # Stream TTS audio
                await tts_engine.stream_tts(text, voice, "en", speed, websocket)
                
                # Send completion message
                await websocket.send_json({"status": "complete"})
                
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON format"})
            except ValueError as e:
                await websocket.send_json({"error": f"Invalid parameter: {str(e)}"})
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                logger.error(traceback.format_exc())
                await websocket.send_json({"error": f"Processing error: {str(e)}"})
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        logger.error(traceback.format_exc())
    finally:
        await websocket.close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8899"))
    host = os.getenv("HOST", "0.0.0.0")
    
    logger.info(f"Starting TTS WebSocket service on {host}:{port}")
    
    import uvicorn
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info"
    )