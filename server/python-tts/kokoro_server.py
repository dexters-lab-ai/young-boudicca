"""
Kokoro TTS Server

A high-performance, production-ready Text-to-Speech server using Kokoro TTS engine.
Features:
- REST API for TTS synthesis
- WebSocket support for real-time streaming
- Health monitoring and metrics
- Support for multiple audio formats (WAV, PCM)
- Graceful startup/shutdown
- Request tracing and logging
"""

import asyncio
import io
import json
import logging
import os
import signal
import struct
import sys
import time
import traceback
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request, WebSocket, status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from scipy.io.wavfile import write as write_wav

# Try to import Kokoro with fallback paths
kokoro_imported = False
try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.tokenizer import Tokenizer
    from kokoro_onnx.config import SAMPLE_RATE
    kokoro_imported = True
except ImportError:
    # Fallback to local import
    try:
        from your_kokoro_module import Kokoro, Tokenizer
        kokoro_imported = True
    except ImportError as e:
        logging.error(f"Failed to import Kokoro: {e}")
        kokoro_imported = False

# Setup logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Add the current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)
logger.info(f"Added {current_dir} to Python path")

# Create FastAPI app with lifespan management
app = FastAPI(
    title="Kokoro TTS Server",
    description="High-performance Text-to-Speech service using Kokoro",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "X-Processing-Time"]
)

# Global state
app_globals = {
    'kokoro': None,
    'start_time': time.time(),
    'requests_processed': 0,
    'total_processing_time': 0.0
}

def find_model_files() -> tuple[str, str]:
    """Locate model files with fallback paths"""
    # Check environment variables first
    model_path = os.getenv('KOKORO_MODEL_PATH')
    voices_path = os.getenv('KOKORO_VOICES_PATH')
    
    if model_path and voices_path and os.path.exists(model_path) and os.path.exists(voices_path):
        return model_path, voices_path
    
    # Check common locations
    possible_paths = [
        (os.path.join(current_dir, 'kokoro-v1.0.onnx'), 
         os.path.join(current_dir, 'voices-v1.0.bin')),
        (os.path.join(current_dir, 'models', 'kokoro-v1.0.onnx'),
         os.path.join(current_dir, 'models', 'voices-v1.0.bin')),
        ('/app/models/kokoro-v1.0.onnx', '/app/models/voices-v1.0.bin')
    ]
    
    for mp, vp in possible_paths:
        if os.path.exists(mp) and os.path.exists(vp):
            return os.path.abspath(mp), os.path.abspath(vp)
    
    raise FileNotFoundError("Could not find model files in any of the expected locations")

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on startup with enhanced error handling"""
    global app_globals
    
    if not kokoro_imported:
        logger.critical("Kokoro modules not found. Please install the required packages.")
        raise ImportError("Required Kokoro modules not found")
    
    try:
        # Find and validate model files
        model_path, voices_path = find_model_files()
        logger.info(f"[kokoro-server] Loading model from: {model_path}")
        logger.info(f"[kokoro-server] Loading voices from: {voices_path}")
        
        # Initialize Kokoro model
        try:
            logger.info("[kokoro-server] Loading Kokoro model (this may take a moment)...")
            kokoro = Kokoro(model_path, voices_path)
            app_globals['kokoro'] = kokoro
            logger.info("[kokoro-server] Model loaded successfully")
        except Exception as e:
            logger.critical(f"[kokoro-server] Failed to initialize TTS engine: {e}")
            logger.exception(e)
            raise
        
        # Verify model is working
        try:
            voices = kokoro.list_voices() if hasattr(kokoro, 'list_voices') else ["default"]
            logger.info(f"[kokoro-server] Available voices: {voices}")
        except Exception as e:
            logger.warning(f"[kokoro-server] Could not list voices: {e}")
        
    except Exception as e:
        logger.critical(f"[kokoro-server] Failed to initialize TTS engine: {e}")
        logger.exception(e)
        raise

@app.websocket("/ws/tts")
async def websocket_endpoint(websocket: WebSocket):
    """Handle WebSocket connections for real-time TTS"""
    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"[ws] New connection from {client_ip}")
    
    kokoro_model = app_globals.get('kokoro')
    if not kokoro_model:
        await websocket.send_json({"error": "TTS engine not ready"})
        await websocket.close()
        return
    
    try:
        while True:
            request_start = time.time()
            data = await websocket.receive_json()
            
            text = data.get('text', '').strip()
            voice = data.get('voice', 'en-us_ljspeech')
            speed = float(data.get('speed', 1.0))
            
            if not text:
                await websocket.send_json({"error": "No text provided"})
                continue
            
            try:
                # Log the request
                logger.info(f"[ws] Processing request from {client_ip} - Text: '{text[:50]}...'")
                
                # Stream audio chunks
                async for samples, _ in kokoro_model.create_stream(
                    text=text,
                    voice=voice,
                    speed=speed,
                    lang=voice.split('_')[0] if '_' in voice else 'en-us',
                    trim=False
                ):
                    # Send audio chunk with length prefix
                    audio_bytes = samples.tobytes()
                    len_prefix = struct.pack('<I', len(audio_bytes))
                    await websocket.send_bytes(len_prefix + audio_bytes)
                
                # Signal end of stream
                await websocket.send_bytes(struct.pack('<I', 0))
                
                # Log performance
                process_time = time.time() - request_start
                app_globals['requests_processed'] += 1
                app_globals['total_processing_time'] += process_time
                logger.info(f"[ws] Processed in {process_time:.3f}s - '{text[:30]}...'")
                
            except Exception as e:
                logger.error(f"[ws] Processing error: {e}")
                logger.exception(e)
                await websocket.send_json({"error": str(e)})
                
    except Exception as e:
        if not isinstance(e, (asyncio.CancelledError, RuntimeError)):
            logger.error(f"[ws] Connection error from {client_ip}: {e}")
    finally:
        await websocket.close()
        logger.info(f"[ws] Closed connection from {client_ip}")

@app.get("/voices")
async def get_voices():
    """Return list of available voices with metadata"""
    kokoro_model = app_globals.get('kokoro')
    if not kokoro_model:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS engine not ready"
        )
    
    try:
        voices = kokoro_model.list_voices() if hasattr(kokoro_model, 'list_voices') else ["default"]
        return {
            "status": "success",
            "count": len(voices),
            "voices": voices,
            "timestamp": time.time()
        }
    except Exception as e:
        logger.error(f"Error listing voices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )

@app.get("/health")
async def health_check():
    """Comprehensive health check endpoint with system status"""
    kokoro_model = app_globals.get('kokoro')
    current_time = time.time()
    uptime = current_time - app_globals['start_time']
    
    status = {
        "status": "ok" if kokoro_model else "error",
        "service": "kokoro-tts",
        "version": "1.0.0",
        "uptime_seconds": round(uptime, 2),
        "uptime_human": str(timedelta(seconds=int(uptime))),
        "requests_processed": app_globals['requests_processed'],
        "avg_processing_time": round(
            app_globals['total_processing_time'] / app_globals['requests_processed'], 3
        ) if app_globals['requests_processed'] > 0 else 0,
        "timestamp": current_time
    }
    
    if not kokoro_model:
        status["error"] = "TTS engine not initialized"
    
    status_code = status.HTTP_200_OK if kokoro_model else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(content=status, status_code=status_code)

@app.post("/synthesize")
async def synthesize_tts(request: Request):
    """Synthesize speech from text with streaming support.
    
    Args:
        request: The incoming HTTP request containing JSON with:
            - text: The text to synthesize (required)
            - voice: Voice ID (default: 'en-us_ljspeech')
            - speed: Speech rate (default: 1.0)
            - format: Output format ('wav' or 'pcm', default: 'wav')
    
    Returns:
        StreamingResponse: Audio data stream with appropriate content type
    """
    kokoro_model = app_globals.get('kokoro')
    if not kokoro_model:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS engine not ready"
        )
    
    request_start = time.time()
    request_id = f"{int(request_start * 1000)}-{os.urandom(4).hex()}"
    
    try:
        # Parse and validate request
        try:
            body = await request.json()
            text = body.get("text", "").strip()
            voice = body.get("voice", "en-us_ljspeech")
            speed = float(body.get("speed", 1.0))
            output_format = body.get("format", "wav").lower()
            
            if not text:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Text is required"
                )
                
            if output_format not in ("wav", "pcm"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unsupported format. Use 'wav' or 'pcm'"
                )
                
        except (json.JSONDecodeError, ValueError) as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid request: {str(e)}"
            )
        
        # Log the request
        logger.info(f"[synthesize:{request_id}] Processing request - "
                   f"Voice: {voice}, Speed: {speed}, Chars: {len(text)}")
        
        # Track performance
        process_start = time.time()
        
        async def generate_audio():
            """Generator that yields audio chunks with error handling"""
            try:
                async for samples, _ in kokoro_model.create_stream(
                    text=text,
                    voice=voice,
                    speed=speed,
                    lang=voice.split('_')[0] if '_' in voice else 'en-us',
                    trim=False
                ):
                    if output_format == "wav":
                        # Convert to WAV format
                        with io.BytesIO() as wav_buffer:
                            write_wav(wav_buffer, SAMPLE_RATE, samples)
                            wav_buffer.seek(0)
                            yield wav_buffer.read()
                    else:
                        # Raw PCM output
                        yield samples.tobytes()
                        
            except Exception as e:
                logger.error(f"[synthesize:{request_id}] Generation error: {e}")
                logger.exception(e)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Error generating audio: {str(e)}"
                )
        
        # Set appropriate content type
        content_type = "audio/wav" if output_format == "wav" else "audio/pcm"
        
        # Update metrics
        process_time = time.time() - process_start
        app_globals['requests_processed'] += 1
        app_globals['total_processing_time'] += process_time
        
        logger.info(f"[synthesize:{request_id}] Completed in {process_time:.3f}s - "
                   f"{len(text)} chars")
        
        # Return the streaming response
        return StreamingResponse(
            generate_audio(),
            media_type=content_type,
            headers={
                "Content-Disposition": f"attachment; filename=speech.{output_format}",
                "X-Request-ID": request_id,
                "X-Processing-Time": f"{process_time:.3f}s",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache"
            }
        )
        
    except HTTPException:
        raise
        
    except Exception as e:
        logger.critical(f"[synthesize:{request_id}] Unexpected error: {e}")
        logger.exception(e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred"
        )

async def shutdown_event():
    """Handle server shutdown"""
    logger.info("[kokoro-server] Shutting down...")
    # Add any cleanup code here if needed
    logger.info("[kokoro-server] Shutdown complete")

async def lifespan(app: FastAPI):
    """Handle application lifespan events"""
    # Startup
    logger.info("[kokoro-server] Starting up...")
    yield
    # Shutdown
    await shutdown_event()

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring and load balancers"""
    kokoro_model = app_globals.get('kokoro')
    current_time = time.time()
    uptime = current_time - app_globals['start_time']
    
    health_status = {
        "status": "ok" if kokoro_model else "error",
        "service": "kokoro-tts",
        "version": "1.0.0",
        "uptime_seconds": round(uptime, 2),
        "uptime_human": str(timedelta(seconds=int(uptime))),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "requests_processed": app_globals['requests_processed'],
        "avg_processing_time": round(
            app_globals['total_processing_time'] / app_globals['requests_processed'], 3
        ) if app_globals['requests_processed'] > 0 else 0,
        "model_loaded": kokoro_model is not None,
        "voices_available": 0
    }
    
    if kokoro_model:
        try:
            voices = kokoro_model.list_voices() if hasattr(kokoro_model, 'list_voices') else ["default"]
            health_status["voices_available"] = len(voices)
        except Exception as e:
            logger.error(f"[health] Error checking voices: {e}")
            health_status["error"] = str(e)
    
    # Return the appropriate status code based on health
    status_code = http_status.HTTP_200_OK if kokoro_model else http_status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(content=health_status, status_code=status_code)

async def main():
    """Main entry point for the TTS server"""
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler("tts_server.log")
        ]
    )
    
    logger.info("=" * 50)
    logger.info("Starting Kokoro TTS Server")
    logger.info(f"Python: {sys.version}")
    logger.info(f"Working Directory: {os.getcwd()}")
    
    try:
        import uvicorn
        
        # Get server configuration
        host = os.getenv('HOST', '0.0.0.0')
        port = int(os.getenv('PORT', 8899))
        workers = int(os.getenv('WORKERS', 1))
        log_level = os.getenv('LOG_LEVEL', 'info')
        
        logger.info(f"[kokoro-server] Server configuration:")
        logger.info(f"  Host: {host}")
        logger.info(f"  Port: {port}")
        logger.info(f"  Workers: {workers}")
        logger.info(f"  Log Level: {log_level.upper()}")
        
        # Configure and start server
        config = uvicorn.Config(
            app=app,
            host=host,
            port=port,
            workers=workers,
            log_level=log_level,
            timeout_keep_alive=60,  # 60 seconds keep-alive timeout
            limit_concurrency=100,  # Max concurrent connections
            limit_max_requests=1000,  # Restart worker after N requests
            reload=False,
            access_log=True
        )
        
        server = uvicorn.Server(config)
        await server.serve()
        
    except Exception as e:
        logger.critical(f"[kokoro-server] Fatal error: {e}")
        logger.exception(e)
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[kokoro-server] Shutting down.", file=sys.stderr)
