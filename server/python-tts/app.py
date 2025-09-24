import asyncio
import json
import logging
import os
import signal
import struct
import time
from pathlib import Path
from typing import Optional, Dict, Any, AsyncGenerator, Tuple

from fastapi import FastAPI, HTTPException, status, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger('kokoro-tts-api')

# --- Configuration ---
class Config:
    HOST: str = os.getenv('KOKORO_API_HOST', '0.0.0.0')
    PORT: int = int(os.getenv('KOKORO_API_PORT', '8899'))
    SERVER_HOST: str = os.getenv('KOKORO_SERVER_HOST', '127.0.0.1')
    SERVER_PORT: int = int(os.getenv('KOKORO_SERVER_PORT', '65432'))
    MAX_TEXT_LENGTH: int = int(os.getenv('KOKORO_MAX_TEXT_LENGTH', '1000'))
    STARTUP_TIMEOUT: int = int(os.getenv('KOKORO_STARTUP_TIMEOUT', '30'))
    PROCESS_CHECK_INTERVAL: float = 1.0

# Initialize FastAPI
app = FastAPI(
    title="Kokoro TTS Service",
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
)

# --- Global State ---
class AppState:
    def __init__(self):
        self.process: Optional[asyncio.subprocess.Process] = None
        self.start_time: float = 0
        self.shutting_down: bool = False
        self.startup_lock = asyncio.Lock()

app_state = AppState()

# --- Models ---
class HealthResponse(BaseModel):
    status: str
    uptime: float
    server_pid: Optional[int] = None
    server_status: Optional[str] = None
    server_uptime: Optional[float] = None
    version: str = "1.0.0"

class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=Config.MAX_TEXT_LENGTH)
    voice: Optional[str] = Field(
        default=None,
        description="Voice ID (e.g., 'en-us_ljspeech')"
    )
    lang: Optional[str] = Field(
        default=None,
        description="Language code (e.g., 'en-us')",
        regex=r'^[a-z]{2}(-[A-Z]{2})?$'
    )
    speed: Optional[float] = Field(
        default=1.0,
        ge=0.5,
        le=2.0,
        description="Speech rate (0.5-2.0)"
    )

    @validator('text')
    def validate_text(cls, v):
        if not v or not v.strip():
            raise ValueError("Text cannot be empty or whitespace")
        return v.strip()

# --- Helper Functions ---
async def log_stream(stream: asyncio.StreamReader, prefix: str) -> None:
    """Log output from a stream with a prefix."""
    while not stream.at_eof():
        try:
            line = await stream.readline()
            if line:
                logger.info(f"[{prefix}] {line.decode().strip()}")
        except Exception as e:
            logger.error(f"Error reading from {prefix}: {e}")
            break

def get_uptime() -> float:
    """Get application uptime in seconds."""
    return time.time() - app_state.start_time

# --- FastAPI App --- 

class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None
    lang: str | None = None
    speed: float | None = None

# --- Server Management ---
async def start_tts_server() -> bool:
    """Start the TTS server process if not already running."""
    async with app_state.startup_lock:
        if app_state.process is not None and app_state.process.returncode is None:
            logger.info("TTS server is already running")
            return True
            
        logger.info("Starting TTS server process...")
        
        try:
            server_script = Path(__file__).parent / 'kokoro_server.py'
            if not server_script.exists():
                logger.error(f"Server script not found: {server_script}")
                return False
                
            # Build the command
            python_exec = os.getenv("PYTHON", sys.executable)
            cmd = [python_exec, str(server_script)]
            
            # Set environment variables
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            
            # Start the process
            app_state.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                start_new_session=True  # Prevent signals from being sent to the child
            )
            
            logger.info(f"TTS server started with PID: {app_state.process.pid}")
            
            # Start loggers
            asyncio.create_task(log_stream(app_state.process.stdout, "tts-stdout"))
            asyncio.create_task(log_stream(app_state.process.stderr, "tts-stderr"))
            
            # Monitor the process
            asyncio.create_task(monitor_tts_process())
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to start TTS server: {e}", exc_info=True)
            if app_state.process:
                app_state.process.terminate()
                app_state.process = None
            return False

async def monitor_tts_process() -> None:
    """Monitor the TTS server process and restart if it fails."""
    if not app_state.process:
        return
        
    try:
        returncode = await app_state.process.wait()
        logger.warning(f"TTS server process exited with code {returncode}")
        
        if not app_state.shutting_down:
            logger.info("Attempting to restart TTS server...")
            await asyncio.sleep(1)  # Prevent tight restart loop
            await start_tts_server()
            
    except asyncio.CancelledError:
        logger.info("TTS process monitoring cancelled")
    except Exception as e:
        logger.error(f"Error monitoring TTS process: {e}", exc_info=True)

async def stop_tts_server() -> None:
    """Stop the TTS server process gracefully."""
    if not app_state.process:
        return
        
    try:
        logger.info(f"Stopping TTS server (PID: {app_state.process.pid})...")
        
        # Try SIGTERM first
        app_state.process.terminate()
        
        try:
            await asyncio.wait_for(app_state.process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("TTS server did not terminate gracefully, forcing...")
            app_state.process.kill()
            await app_state.process.wait()
            
        logger.info("TTS server stopped")
        
    except Exception as e:
        logger.error(f"Error stopping TTS server: {e}", exc_info=True)
    finally:
        app_state.process = None

# --- Health Checks ---
async def check_tts_server_health(timeout: float = 1.0) -> Tuple[bool, str]:
    """Check if the TTS server is healthy."""
    if not app_state.process or app_state.process.returncode is not None:
        return False, "TTS server process is not running"
        
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(Config.SERVER_HOST, Config.SERVER_PORT + 1),  # Health port
            timeout=timeout
        )
        data = await asyncio.wait_for(reader.read(100), timeout=timeout)
        writer.close()
        await writer.wait_closed()
        
        if data == b'OK':
            return True, "OK"
        return False, f"Unexpected health check response: {data}"
        
    except asyncio.TimeoutError:
        return False, "Health check timed out"
    except ConnectionRefusedError:
        return False, "Connection refused"
    except Exception as e:
        return False, f"Health check failed: {str(e)}"

# --- API Endpoints ---
@app.on_event("startup")
async def startup():
    """Initialize the application."""
    app_state.start_time = time.time()
    logger.info("Starting up...")
    
    # Start the TTS server
    if not await start_tts_server():
        logger.error("Failed to start TTS server during startup")
    
    # Set up signal handlers
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown()))
    
    logger.info("Startup complete")

@app.on_event("shutdown")
async def shutdown():
    """Cleanup on application shutdown."""
    if app_state.shutting_down:
        return
        
    app_state.shutting_down = True
    logger.info("Shutting down...")
    
    # Stop the TTS server
    await stop_tts_server()
    
    logger.info("Shutdown complete")

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    server_healthy, server_status = await check_tts_server_health()
    
    return {
        "status": "ok" if server_healthy else "degraded",
        "uptime": get_uptime(),
        "server_pid": app_state.process.pid if app_state.process else None,
        "server_status": server_status,
        "server_uptime": time.time() - app_state.process.start_time if app_state.process else None
    }

@app.post("/speak")
async def speak(request: SpeakRequest):
    ""
    Convert text to speech.
    
    This endpoint streams the generated audio directly to the client.
    """
    # Check if TTS server is running
    if not app_state.process or app_state.process.returncode is not None:
        if not await start_tts_server():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="TTS server is not available"
            )
    
    # Wait for server to be ready
    start_time = time.time()
    while time.time() - start_time < Config.STARTUP_TIMEOUT:
        healthy, _ = await check_tts_server_health()
        if healthy:
            break
        await asyncio.sleep(0.1)
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS server is not responding"
        )
    
    async def generate_audio():
        """Stream audio from the TTS server."""
        reader = writer = None
        try:
            # Connect to the TTS server
            reader, writer = await asyncio.open_connection(
                Config.SERVER_HOST,
                Config.SERVER_PORT
            )
            
            # Send the request
            request_data = request.dict(exclude_unset=True)
            payload = json.dumps(request_data).encode('utf-8')
            
            # Send payload length (4 bytes) followed by the payload
            writer.write(struct.pack('<I', len(payload)) + payload)
            await writer.drain()
            
            # Stream the response
            while True:
                # Read chunk length (4 bytes)
                len_data = await reader.readexactly(4)
                chunk_len = struct.unpack('<I', len_data)[0]
                
                # A zero-length chunk indicates the end of the stream
                if chunk_len == 0:
                    break
                
                # Read the chunk data and yield it
                chunk = await reader.readexactly(chunk_len)
                yield chunk
                
        except asyncio.IncompleteReadError:
            logger.warning("Incomplete read from TTS server")
        except ConnectionResetError:
            logger.error("Connection to TTS server was reset")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Connection to TTS server failed"
            )
        except Exception as e:
            logger.error(f"Error during TTS generation: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"TTS generation failed: {str(e)}"
            )
        finally:
            if writer:
                writer.close()
                await writer.wait_closed()
    
    # Return the audio stream
    return StreamingResponse(
        generate_audio(),
        media_type="audio/wav",
        headers={
            "Content-Disposition": "inline; filename=speech.wav",
            "X-Content-Type-Options": "nosniff"
        }
    )

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Handle HTTP exceptions with JSON responses."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "path": request.url.path,
            "timestamp": time.time()
        }
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all other exceptions."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal server error",
            "path": request.url.path,
            "timestamp": time.time()
        }
    )

# --- Main Execution ---
if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app:app",
        host=Config.HOST,
        port=Config.PORT,
        log_level="info",
        reload=False,
        workers=1  # We manage our own subprocesses
    )
