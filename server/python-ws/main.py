# This will be the new unified WebSocket server, inspired by RealtimeVoiceChat-main.

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

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add project root to path to allow imports from other directories
try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import SAMPLE_RATE
    from kokoro_onnx.tokenizer import Tokenizer
except ImportError as e:
    logger.error(f"Could not import Kokoro TTS components: {e}")
    sys.exit(1)


app = FastAPI(title="Boudi AI WebSocket Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def download_with_retry(url: str, local_path: str, expected_hash: str = None, max_retries: int = 3):
    """Download a file with retry and hash verification."""
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    temp_path = f"{local_path}.download"
    
    for attempt in range(max_retries):
        try:
            with requests.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                with open(temp_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:  # filter out keep-alive new chunks
                            f.write(chunk)
            
            # Verify hash if provided
            if expected_hash:
                file_hash = hashlib.sha256()
                with open(temp_path, 'rb') as f:
                    for chunk in iter(lambda: f.read(8192), b''):
                        file_hash.update(chunk)
                if file_hash.hexdigest() != expected_hash:
                    raise ValueError(f"Hash mismatch for {os.path.basename(local_path)}")
            
            os.replace(temp_path, local_path)
            return True
            
        except Exception as e:
            logging.warning(f"Attempt {attempt + 1} failed: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            if attempt < max_retries - 1:
                time.sleep(1)  # Simple 1s delay between retries
    
    return False

class TTSEngine:
    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.kokoro = None
        # GitHub release URL - using the actual release URL you provided
        self.release_url = "https://github.com/dexters-lab-ai/young-boudicca/releases/download/v1.0.0"
        # File hashes for verification - using the hashes you provided
        self.file_hashes = {
            "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
            "voices-v1.0.bin": "d19762d46cf0e6648cb28a7711df1637aad15818185d13f4ff840d57f2f6dfed"
        }

    def load(self):
        """Load the TTS model, downloading it first if needed."""
        try:
            os.makedirs(self.model_dir, exist_ok=True)
            voices_path = os.path.join(self.model_dir, "voices-v1.0.bin")
            model_path = os.path.join(self.model_dir, "kokoro-v1.0.onnx")
            
            # Download model files if they don't exist
            if not os.path.exists(voices_path) or not os.path.exists(model_path):
                logger.info("Downloading TTS model files...")
                
                if not download_with_retry(
                    f"{self.release_url}/kokoro-v1.0.onnx",
                    model_path,
                    self.file_hashes.get("kokoro-v1.0.onnx")
                ):
                    raise RuntimeError("Failed to download kokoro-v1.0.onnx")
                    
                if not download_with_retry(
                    f"{self.release_url}/voices-v1.0.bin",
                    voices_path,
                    self.file_hashes.get("voices-v1.0.bin")
                ):
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
