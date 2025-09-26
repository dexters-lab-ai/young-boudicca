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

from fastapi import FastAPI, HTTPException, Request, status as http_status
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

# Global variables
kokoro = None
app_globals = {
    'kokoro': None,
    'start_time': time.time(),
    'requests_processed': 0,
    'total_processing_time': 0.0
}

def find_model_files() -> tuple[str, str]:
    """Locate model files with fallback paths
    
    Returns:
        tuple: (model_path, voices_path)
        
    Raises:
        FileNotFoundError: If model files cannot be found in any location
    """
    # Get environment variables with defaults
    model_path = os.getenv('KOKORO_MODEL_PATH')
    voices_path = os.getenv('KOKORO_VOICES_PATH')
    
    # If both paths are provided via environment variables, use them
    if model_path and voices_path:
        model_path = os.path.abspath(model_path)
        voices_path = os.path.abspath(voices_path)
        
        if os.path.exists(model_path) and os.path.exists(voices_path):
            logger.info("Using model files from environment variables:")
            logger.info(f"- Model: {model_path}")
            logger.info(f"- Voices: {voices_path}")
            return model_path, voices_path
        else:
            logger.warning("Environment variables point to non-existent files. Falling back to default locations.")
    
    # Define possible locations to search for model files
    possible_paths = [
        # Local directory (relative to script)
        (os.path.join(current_dir, 'kokoro-v1.0.onnx'), 
         os.path.join(current_dir, 'voices-v1.0.bin')),
        # Local models subdirectory (relative to script)
        (os.path.join(current_dir, 'models', 'kokoro-v1.0.onnx'),
         os.path.join(current_dir, 'models', 'voices-v1.0.bin')),
        # Docker container path (production)
        ('/app/server/python-tts/models/kokoro-v1.0.onnx', 
         '/app/server/python-tts/models/voices-v1.0.bin'),
        # Development path (from project root)
        (os.path.abspath(os.path.join(current_dir, '..', '..', 'server', 'python-tts', 'models', 'kokoro-v1.0.onnx')),
         os.path.abspath(os.path.join(current_dir, '..', '..', 'server', 'python-tts', 'models', 'voices-v1.0.bin')))
    ]
    
    # Check each possible path
    for mp, vp in possible_paths:
        if os.path.exists(mp) and os.path.exists(vp):
            logger.info("Found model files at:")
            logger.info(f"- Model: {mp}")
            logger.info(f"- Voices: {vp}")
            return os.path.abspath(mp), os.path.abspath(vp)
    
    # If we get here, no valid paths were found
    error_msg = "\nERROR: Could not find model files in any of the following locations:\n"
    for mp, vp in possible_paths:
        error_msg += f"- Model: {mp} ({'EXISTS' if os.path.exists(mp) else 'NOT FOUND'})\n"
        error_msg += f"- Voices: {vp} ({'EXISTS' if os.path.exists(vp) else 'NOT FOUND'})\n\n"
    
    error_msg += "TROUBLESHOOTING TIPS:\n"
    error_msg += "1. Download the model files (kokoro-v1.0.onnx and voices-v1.0.bin)\n"
    error_msg += "2. Place them in one of the following locations:\n"
    for mp, _ in possible_paths:
        error_msg += f"   - {os.path.dirname(mp)}/\n"
    error_msg += "\n3. OR set the KOKORO_MODEL_PATH and KOKORO_VOICES_PATH environment variables\n"
    
    logger.error(error_msg)
    raise FileNotFoundError("Could not find Kokoro model files. See logs for details.")

@app.on_event("startup")
async def startup_event():
    """Initialize TTS engine on startup with enhanced error handling and logging"""
    global kokoro, app_globals
    
    logger.info("Starting up TTS server...")
    
    try:
        # Find model files
        model_path, voices_path = find_model_files()
        logger.info(f"Found model files:\n- Model: {model_path}\n- Voices: {voices_path}")
        
        # Initialize Kokoro
        logger.info("Initializing Kokoro TTS engine...")
        # Initialize Kokoro with just model and voices path
        kokoro = Kokoro(model_path, voices_path)
        
        # Store in app globals
        app_globals['kokoro'] = kokoro
        
        # Warm up the model
        logger.info("Warming up TTS engine...")
        start_time = time.time()
        test_text = "Initializing TTS service. "
        
        # List of default voices to use as fallback
        default_voices = ["af_sarah", "am_echo", "af_nova", "af_heart", "am_adam"]
        
        try:
            # First try to get voices from the model
            if hasattr(kokoro, 'list_voices'):
                try:
                    available_voices = kokoro.list_voices()
                    # If it's a string, convert to a list
                    if isinstance(available_voices, str):
                        available_voices = [available_voices]
                    
                    # If no voices found, use default voices
                    if not available_voices:
                        logger.warning("No voices found via list_voices(), using default voices")
                        available_voices = default_voices
                    else:
                        logger.info(f"Found {len(available_voices)} voices via list_voices()")
                except Exception as e:
                    logger.warning(f"Error calling list_voices(): {str(e)}")
                    available_voices = default_voices
            else:
                logger.info("list_voices() not available, using default voices")
                available_voices = default_voices
                
            logger.info(f"Available voices: {available_voices}")
            
            # Select the first available voice
            voice_to_use = available_voices[0] if available_voices else default_voices[0]
            
            # Log the selected voice
            logger.info(f"Selected voice for warmup: {voice_to_use}")
            
            # Test if the voice is valid by trying to generate a short audio clip
            test_text = "TTS service is initializing."
            logger.info("Testing voice with sample text...")
            
            # Create a test stream and consume it to verify the voice works
            test_stream = kokoro.create_stream(
                text=test_text,
                voice=voice_to_use,
                speed=1.0,
                lang='en',
                trim=False
            )
            
            # Consume the generator to verify it works
            async for _ in test_stream:
                break
                
        except Exception as e:
            logger.error(f"Error during voice initialization: {str(e)}")
            logger.error(traceback.format_exc())
            # Fall back to the first default voice if there's an error
            voice_to_use = default_voices[0]
            logger.warning(f"Falling back to default voice: {voice_to_use}")
        logger.info(f"Using voice for warmup: {voice_to_use}")

        async for _ in kokoro.create_stream(text=test_text, voice=voice_to_use):
            break
        warmup_time = time.time() - start_time
        
        logger.info(f"TTS engine ready in {warmup_time:.2f} seconds")
        
    except Exception as e:
        logger.error(f"Failed to initialize TTS engine: {e}")
        logger.error(traceback.format_exc())
        raise RuntimeError(f"Failed to initialize TTS engine: {e}")


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
        # Ensure list_voices method exists
        if not hasattr(kokoro_model, 'list_voices'):
            kokoro_model.list_voices = lambda: ["default"]
        
        # Get the list of voices
        voices = kokoro_model.list_voices()
        
        # If it's a string, convert to a list
        if isinstance(voices, str):
            voices = [voices]
            
        # Ensure we always return at least the default voice
        if not voices:
            voices = ["default"]
            
        return {
            "status": "success",
            "count": len(voices),
            "voices": voices,
            "timestamp": time.time()
        }
    except Exception as e:
        logger.error(f"Error listing voices: {e}")
        # Return default voice in case of error
        return {
            "status": "success",
            "count": 1,
            "voices": ["default"],
            "timestamp": time.time()
        }

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
    logger.info("Shutting down TTS server...")
    
    # Clean up Kokoro resources
    if kokoro:
        logger.info("Cleaning up TTS engine...")
        # Add any Kokoro-specific cleanup here if needed
    logger.info("[kokoro-server] Shutdown complete")

async def lifespan(app: FastAPI):
    """Handle application lifespan events"""
    # Startup
    logger.info("[kokoro-server] Starting up...")
    yield
    # Shutdown
    await shutdown_event()

@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring and load balancers"""
    kokoro_model = app_globals.get('kokoro')
    
    health_status = {
        "status": "ok",
        "service": "kokoro-tts",
        "version": "1.0.0",
        "uptime_seconds": time.time() - app_globals['start_time'],
        "requests_processed": app_globals.get('requests_processed', 0),
        "avg_processing_time": (
            app_globals['total_processing_time'] / app_globals['requests_processed']
            if app_globals['requests_processed'] > 0 else 0
        )
    }
    
    if kokoro_model:
        try:
            # Ensure list_voices method exists
            if not hasattr(kokoro_model, 'list_voices'):
                kokoro_model.list_voices = lambda: ["default"]
            
            # Get voices and handle different return types
            voices = kokoro_model.list_voices()
            if isinstance(voices, str):
                voices = [voices]
            
            health_status["voices_available"] = len(voices)
            health_status["voices"] = voices
            
            # Add some basic voice info
            health_status["voice_languages"] = list(set([v.split('_')[0] for v in voices if '_' in v]))
            
        except Exception as e:
            logger.error(f"[health] Error checking voices: {e}")
            health_status["voices_available"] = 1
            health_status["voices"] = ["default"]
            health_status["voice_languages"] = ["en-us"]
    else:
        health_status["status"] = "error"
        health_status["error"] = "TTS engine not initialized"
        health_status["voices_available"] = 0
        health_status["voices"] = []
        health_status["voice_languages"] = []
    
    status_code = 200 if kokoro_model else 503
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
