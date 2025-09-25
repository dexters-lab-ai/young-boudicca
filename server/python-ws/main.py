# """FastAPI server for Kokoro TTS"""
# --- Original code --- #

import asyncio
import os
import logging
import traceback
import hashlib
import time
import requests
from typing import Optional, Dict, Any, List, Union
import json
import struct
import sys
import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from kokoro_onnx import Kokoro
from kokoro_onnx.tokenizer import Tokenizer

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Boudi AI WebSocket Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Globals --- 
tts_engine = None

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on startup"""
    global tts_engine
    try:
        model_path = os.getenv('KOKORO_MODEL_PATH', '/app/models/kokoro-v1.0.onnx')
        voices_path = os.getenv('KOKORO_VOICES_PATH', '/app/models/voices-v1.0.bin')
        
        logger.info(f"Initializing TTS engine with model: {model_path}")
        tokenizer = Tokenizer()
        tts_engine = Kokoro(model_path, voices_path, tokenizer=tokenizer)
        logger.info("TTS engine initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to initialize TTS engine: {e}")
        raise

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for TTS streaming."""
    global tts_engine
    await websocket.accept()
    
    if not tts_engine or not tts_engine.kokoro:
        await websocket.close(code=1011, reason="TTS engine not ready")
        return

    try:
        while True:
            data = await websocket.receive_text()
            if not data:
                continue
                
            try:
                message = json.loads(data)
                text = message.get("text", "").strip()
                voice = message.get("voice", "en-us_ljspeech")
                speed = max(0.5, min(3.0, float(message.get("speed", 1.0))))  # Clamp speed
                
                if not text:
                    await websocket.send_json({"error": "No text provided"})
                    continue
                
                # Stream TTS audio
                await tts_engine.stream_tts(text, voice, "en", speed, websocket)
                await websocket.send_json({"status": "complete"})
                
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
            except Exception as e:
                logger.error(f"Error: {e}")
                await websocket.send_json({"error": str(e)})
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await websocket.close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8899"))
    host = os.getenv("HOST", "0.0.0.0")
    
    logger.info(f"Starting TTS service on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info"
    )
                    raise RuntimeError("Failed to download voices-v1.0.bin")

            # Initialize model
            from kokoro import Kokoro, Tokenizer
            tokenizer = Tokenizer()
            self.kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
            logger.info("TTS model loaded")
            
        except Exception as e:
            self.kokoro = None
            logger.error(f"Failed to load TTS: {e}")
            raise

    async def stream_tts(self, text: str, voice: str, lang: str, speed: float):
        if not self.kokoro:
            logger.error("TTS engine not loaded.")
            return

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
            # Clip and convert to 16-bit PCM little-endian
            pcm16 = np.clip(samples, -1.0, 1.0)
            pcm16 = (pcm16 * 32767.0).astype(np.int16)
            audio_bytes = pcm16.tobytes()
            yield audio_bytes

# --- Globals --- 
tts_engine = None

@app.on_event("startup")
async def startup_event():
    global tts_engine
    try:
        # Resolve model path relative to the script's location
        model_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'python-tts'))
        tts_engine = TTSEngine(model_dir)
        tts_engine.load()
        logger.info("TTS engine loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load TTS engine: {e}")
        tts_engine = None

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for TTS streaming."""
    global tts_engine
    await websocket.accept()
    
    if not tts_engine or not tts_engine.kokoro:
        await websocket.close(code=1011, reason="TTS engine not ready")
        return

    try:
        while True:
            data = await websocket.receive_text()
            if not data:
                continue
                
            try:
                message = json.loads(data)
                text = message.get("text", "").strip()
                voice = message.get("voice", "en-us_ljspeech")
                speed = max(0.5, min(3.0, float(message.get("speed", 1.0))))  # Clamp speed
                
                if not text:
                    await websocket.send_json({"error": "No text provided"})
                    continue
                
                # Stream TTS audio
                await tts_engine.stream_tts(text, voice, "en", speed, websocket)
                await websocket.send_json({"status": "complete"})
                
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
            except Exception as e:
                logger.error(f"Error: {e}")
                await websocket.send_json({"error": str(e)})
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await websocket.close()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8899"))
    host = os.getenv("HOST", "0.0.0.0")
    
    logger.info(f"Starting TTS service on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info"
    )
