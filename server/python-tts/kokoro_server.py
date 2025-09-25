"""FastAPI server for Kokoro TTS"""
import os
import sys
import logging
import asyncio
from fastapi import FastAPI, WebSocket, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from your_kokoro_module import Kokoro, Tokenizer  # Replace with actual import

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Add the current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)
logger.info(f"Added {current_dir} to Python path")

# Create FastAPI app
app = FastAPI(title="Kokoro TTS Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize TTS engine
kokoro = None

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on startup"""
    global kokoro
    try:
        model_path = os.getenv('KOKORO_MODEL_PATH', '/app/models/kokoro-v1.0.onnx')
        voices_path = os.getenv('KOKORO_VOICES_PATH', '/app/models/voices-v1.0.bin')
        
        logger.info(f"[kokoro-server] Initializing tokenizer...")
        tokenizer = Tokenizer()
        
        logger.info(f"[kokoro-server] Loading model from: {model_path}")
        kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
        logger.info("[kokoro-server] TTS engine initialized successfully")
        
    except Exception as e:
        logger.error(f"[kokoro-server] Failed to initialize TTS engine: {e}")
        logger.exception(e)
        raise

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_json()
            text = data.get('text')
            voice = data.get('voice', 'en-US-Standard-A')
            
            if not text:
                await websocket.send_json({"error": "No text provided"})
                continue
                
            try:
                audio_data = kokoro.synthesize(text, voice=voice)
                await websocket.send_bytes(audio_data)
            except Exception as e:
                await websocket.send_json({"error": str(e)})
                
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await websocket.close()

@app.get("/voices")
async def get_voices():
    """Return list of available voices"""
    try:
        voices = kokoro.list_voices()
        return {"voices": voices}
    except Exception as e:
        return {"error": str(e)}

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    if kokoro is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    return {"status": "ok", "service": "kokoro-tts"}

@app.post("/synthesize")
async def synthesize_tts(request: Request):
    """Synthesize speech from text."""
    if kokoro is None:
        raise HTTPException(status_code=503, detail="Service not ready")

    try:
        # Parse request body
        body = await request.json()
        text = body.get("text", "")
        voice = body.get("voice", "en-us_ljspeech")
        speed = float(body.get("speed", 1.0))

        if not text:
            raise HTTPException(status_code=400, detail="Text is required")

        logger.info(f"[kokoro-server] Processing request for text: '{text[:50]}...'")

        # Create a generator for streaming the audio
        async def generate_audio():
            try:
                async for samples, _ in kokoro.create_stream(
                    text=text,
                    voice=voice,
                    speed=speed,
                    lang=voice.split('_')[0] if '_' in voice else 'en-us',
                    trim=False
                ):
                    yield samples.tobytes()
            except Exception as e:
                logger.error(f"[kokoro-server] Error during audio generation: {e}")
                logger.exception(e)
                raise HTTPException(status_code=500, detail="Error generating audio")

        # Return the audio stream
        return StreamingResponse(
            generate_audio(),
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=speech.wav",
                "X-Content-Type-Options": "nosniff"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[kokoro-server] Error in /synthesize endpoint: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=str(e))

async def main():
    logger.info("Starting Kokoro TTS server")
    try:
        import uvicorn
        port = int(os.getenv('PORT', 8899))
        host = "0.0.0.0"
        logger.info(f"[kokoro-server] Starting server on {host}:{port}")
        uvicorn.run(app, host=host, port=port, log_level="info", reload=False, workers=1)
    except Exception as e:
        logger.error(f"[kokoro-server] Failed to start server: {e}")
        logger.exception(e)
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[kokoro-server] Shutting down.", file=sys.stderr)
