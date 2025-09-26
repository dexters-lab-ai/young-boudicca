# This will be the new unified WebSocket server, inspired by RealtimeVoiceChat-main.

import asyncio
import json
import logging
import os
import struct
import sys
import traceback
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

class TTSEngine:
    def __init__(self, model_dir):
        self.kokoro = None
        self.model_dir = model_dir

    def load(self):
        logger.info(f"Loading models from: {self.model_dir}")
        try:
            voices_path = os.path.join(self.model_dir, "voices-v1.0.bin")
            model_path = os.path.join(self.model_dir, "kokoro-v1.0.onnx")
            
            if not os.path.exists(voices_path) or not os.path.exists(model_path):
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
    # Assumes this script is in server/python-ws and models are in server/python-tts
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.abspath(os.path.join(script_dir, '..', 'python-tts'))
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
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8899)