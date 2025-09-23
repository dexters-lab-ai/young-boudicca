# This will be the new unified WebSocket server, inspired by RealtimeVoiceChat-main.

import asyncio
import json
import logging
import os
import struct
import sys
import traceback
import numpy as np
import hashlib
import requests
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

def verify_file_hash(file_path: str, expected_hash: str) -> bool:
    """Verify the SHA-256 hash of a file."""
    if not os.path.exists(file_path):
        return False
        
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest() == expected_hash.lower()

def download_file(url: str, destination: str, expected_hash: str = None, max_retries: int = 3) -> bool:
    """Download a file with retry and optional hash verification."""
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    temp_path = f"{destination}.download"
    
    for attempt in range(max_retries):
        try:
            # Skip if file exists and hash matches
            if os.path.exists(destination) and (expected_hash is None or verify_file_hash(destination, expected_hash)):
                return True
                
            logger.info(f"Downloading {url} (attempt {attempt + 1}/{max_retries})")
            with requests.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                with open(temp_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
            
            # Verify hash if provided
            if expected_hash and not verify_file_hash(temp_path, expected_hash):
                raise ValueError("Hash verification failed")
                
            # Move the temporary file to the destination
            if os.path.exists(destination):
                os.remove(destination)
            os.rename(temp_path, destination)
            return True
            
        except Exception as e:
            logger.warning(f"Download attempt {attempt + 1} failed: {e}")
            if os.path.exists(temp_path):
                os.remove(temp_path)
            if attempt == max_retries - 1:  # Last attempt
                logger.error(f"Failed to download {url} after {max_retries} attempts")
                return False
            
            # Exponential backoff before retry
            time.sleep(2 ** attempt)
    
    return False

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

class TTSEngine:
    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.kokoro = None
        # GitHub release URL
        self.release_url = "https://github.com/dexters-lab-ai/young-boudicca/releases/download/v1.0.0"
        # File hashes for verification
        self.file_hashes = {
            "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
            "voices-v1.0.bin": "d19762d46cf0e6648cb28a7711df1637aad15818185d13f4ff840d57f2f6dfed"
        }

    def load(self):
        logger.info(f"Loading models to: {self.model_dir}")
        try:
            # Define file paths
            voices_path = os.path.join(self.model_dir, "voices-v1.0.bin")
            model_path = os.path.join(self.model_dir, "kokoro-v1.0.onnx")
            
            # Download model files with hash verification
            logger.info("Downloading TTS model files...")
            
            # Download voices file
            voices_url = f"{self.release_url}/voices-v1.0.bin"
            if not download_file(
                voices_url,
                voices_path,
                self.file_hashes["voices-v1.0.bin"]
            ):
                raise RuntimeError(f"Failed to download voices file from {voices_url}")
            
            # Download model file
            model_url = f"{self.release_url}/kokoro-v1.0.onnx"
            if not download_file(
                model_url,
                model_path,
                self.file_hashes["kokoro-v1.0.onnx"]
            ):
                raise RuntimeError(f"Failed to download model file from {model_url}")
                
            logger.info("Model files downloaded and verified successfully")

            logger.info("Initializing tokenizer...")
            tokenizer = Tokenizer()
            logger.info("Tokenizer initialized. Loading Kokoro model...")
            self.kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
            logger.info("Model loaded successfully.")
        except Exception as e:
            logger.error(f"FATAL: Failed to load model: {e}")
            logger.error(traceback.format_exc())
            self.kokoro = None

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
    # Resolve model path relative to the script's location
    model_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'python-tts'))
    tts_engine = TTSEngine(model_dir)
    tts_engine.load()

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Client connected to TTS WebSocket.")

    # Send the sample rate to the client upon connection
    await websocket.send_json({
        "type": "sample_rate",
        "value": SAMPLE_RATE
    })

    try:
        while True:
            data = await websocket.receive_text()
            req = json.loads(data)
            text_to_speak = req.get("text")

            if not text_to_speak:
                continue

            logger.info(f"Received TTS request for: '{text_to_speak[:50]}...'" )
            
            async for audio_chunk in tts_engine.stream_tts(
                text=text_to_speak,
                voice=req.get("voice"),
                lang=req.get("lang"),
                speed=req.get("speed")
            ):
                # Send each audio chunk as a binary message
                await websocket.send_bytes(audio_chunk)
            
            # Send an empty byte string to signal the end of the stream for this request
            await websocket.send_bytes(b'')

    except WebSocketDisconnect:
        logger.info("Client disconnected.")
    except Exception as e:
        logger.error(f"An error occurred in the WebSocket: {e}")
        logger.error(traceback.format_exc())


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
