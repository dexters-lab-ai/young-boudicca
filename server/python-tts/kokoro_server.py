import sys
import os
import asyncio
import json
import time
import io
import struct
import traceback
import logging
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr)
    ]
)
logger = logging.getLogger('kokoro-tts-server')

# Constants
DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = 65432
DEFAULT_MODEL_NAME = 'kokoro-v1.0.onnx'
DEFAULT_VOICES_NAME = 'voices-v1.0.bin'

# Try to import kokoro_tts with fallback to kokoro_onnx
KOKORO_MODULE = None
try:
    import kokoro_tts as kokoro_module
    from kokoro_tts import Kokoro, Tokenizer, SAMPLE_RATE
    KOKORO_MODULE = 'kokoro_tts'
    logger.info("Using kokoro_tts module")
except ImportError:
    try:
        from kokoro_onnx import Kokoro, Tokenizer, SAMPLE_RATE
        KOKORO_MODULE = 'kokoro_onnx'
        logger.info("Using kokoro_onnx module (fallback)")
    except ImportError as e:
        logger.error("Could not import kokoro_tts or kokoro_onnx. Please install one of them.")
        sys.exit(1)

class ModelPaths:
    """Helper class to manage model file paths with fallback locations."""
    
    def __init__(self, model_name: str = DEFAULT_MODEL_NAME, voices_name: str = DEFAULT_VOICES_NAME):
        self.model_name = model_name
        self.voices_name = voices_name
        self.workdir = self._find_models()
        
    def _find_models(self) -> Path:
        """Search for model files in common locations."""
        search_paths = [
            Path(__file__).parent,  # Current directory
            Path(__file__).parent.parent,  # Parent directory
            Path('/app/models'),  # Common Docker path
            Path('/app'),  # Root app directory
            Path.home() / '.cache' / 'kokoro-tts'  # User cache directory
        ]
        
        for path in search_paths:
            model_path = path / self.model_name
            voices_path = path / self.voices_name
            if model_path.exists() and voices_path.exists():
                logger.info(f"Found model files in: {path}")
                return path
                
        raise FileNotFoundError(
            f"Could not find model files ({self.model_name}, {self.voices_name}) in any of: "
            f"{', '.join(str(p) for p in search_paths)}"
        )
    
    @property
    def model_path(self) -> Path:
        return self.workdir / self.model_name
        
    @property
    def voices_path(self) -> Path:
        return self.workdir / self.voices_name

async def handle_health_check(reader, writer):
    """Responds to a health check ping."""
    writer.write(b'OK')
    await writer.drain()
    writer.close()
    await writer.wait_closed()

class TTSRequestHandler:
    """Handles TTS requests with proper error handling and streaming."""
    
    def __init__(self, kokoro_model, max_text_length: int = 1000):
        self.kokoro = kokoro_model
        self.max_text_length = max_text_length
        
    async def process_request(self, reader, writer):
        """Process a single TTS request."""
        addr = writer.get_extra_info('peername')
        logger.info(f"Connection from {addr}")
        
        try:
            # Read request
            request_data = await self._read_request(reader)
            if not request_data:
                return
                
            # Process TTS
            await self._stream_tts(writer, request_data)
            
        except asyncio.CancelledError:
            logger.warning(f"Request from {addr} was cancelled")
            raise
            
        except ConnectionResetError:
            logger.warning(f"Connection reset by peer: {addr}")
            
        except Exception as e:
            logger.error(f"Error processing request: {e}", exc_info=True)
            await self._send_error(writer, str(e))
            
        finally:
            writer.close()
            await writer.wait_closed()
            logger.info(f"Closed connection from {addr}")
    
    async def _read_request(self, reader) -> Optional[Dict[str, Any]]:
        """Read and validate the incoming request."""
        try:
            # Read header with timeout
            header = await asyncio.wait_for(reader.readexactly(4), timeout=5.0)
            payload_size = struct.unpack('<I', header)[0]
            
            # Validate payload size (10MB max)
            if payload_size > 10 * 1024 * 1024:
                raise ValueError("Request payload too large")
                
            # Read payload with timeout
            data = await asyncio.wait_for(reader.readexactly(payload_size), timeout=10.0)
            req = json.loads(data.decode('utf-8'))
            
            # Validate request
            if 'text' not in req:
                raise ValueError("Missing 'text' in request")
                
            if len(req['text']) > self.max_text_length:
                raise ValueError(f"Text too long (max {self.max_text_length} characters)")
                
            logger.info(f"Processing request for text: '{req['text'][:30]}...'")
            return req
            
        except (asyncio.IncompleteReadError, asyncio.TimeoutError) as e:
            logger.warning(f"Invalid request: {e}")
            return None
            
    async def _stream_tts(self, writer, request: Dict[str, Any]):
        """Stream TTS audio back to the client."""
        request_start = time.time()
        bytes_sent = 0
        chunks_sent = 0
        
        try:
            # Start TTS synthesis
            synthesis_start = time.time()
            
            # Get default values
            voice = request.get('voice', 'en-us_ljspeech')
            speed = float(request.get('speed', 1.0))
            lang = request.get('lang', 'en-us')
            
            # Stream audio chunks
            async for samples, _ in self.kokoro.create_stream(
                text=request['text'],
                voice=voice,
                speed=speed,
                lang=lang,
                trim=False
            ):
                # Convert to bytes and send
                audio_bytes = samples.tobytes()
                len_prefix = struct.pack('<I', len(audio_bytes))
                
                # Write chunk with timeout
                try:
                    writer.write(len_prefix + audio_bytes)
                    await asyncio.wait_for(writer.drain(), timeout=5.0)
                    
                    # Track stats
                    bytes_sent += len(audio_bytes)
                    chunks_sent += 1
                    
                except asyncio.TimeoutError:
                    logger.warning("Timeout sending audio chunk")
                    raise
            
            # Send end-of-stream marker
            writer.write(struct.pack('<I', 0))
            await writer.drain()
            
            # Log performance
            total_time = time.time() - request_start
            synthesis_time = time.time() - synthesis_start
            logger.info(
                f"TTS synthesis completed in {synthesis_time:.2f}s, "
                f"{len(request['text'])/synthesis_time:.1f} chars/s, "
                f"{bytes_sent/1024/synthesis_time:.1f} KB/s, "
                f"{chunks_sent} chunks, "
                f"total time: {total_time:.2f}s"
            )
            
        except Exception as e:
            logger.error(f"Error during TTS synthesis: {e}", exc_info=True)
            raise
    
    async def _send_error(self, writer, message: str):
        """Send an error response to the client."""
        try:
            error_response = json.dumps({
                'error': message,
                'timestamp': time.time()
            }).encode('utf-8')
            
            # Send error with length prefix
            writer.write(struct.pack('<I', len(error_response)) + error_response)
            await writer.drain()
            
        except Exception as e:
            logger.error(f"Failed to send error response: {e}")
            
    @staticmethod
    async def handle_health_check(reader, writer):
        """Handle health check requests."""
        try:
            writer.write(b'OK')
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

async def main():
    """Main entry point for the Kokoro TTS server."""
    try:
        # Configure logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[logging.StreamHandler(sys.stderr)]
        )
        
        logger.info("Starting Kokoro TTS server...")
        
        # Get configuration from environment variables with defaults
        host = os.getenv('KOKORO_HOST', DEFAULT_HOST)
        port = int(os.getenv('KOKORO_PORT', str(DEFAULT_PORT)))
        health_port = port + 1
        
        # Set up model paths
        try:
            model_paths = ModelPaths()
            logger.info(f"Using model: {model_paths.model_path}")
            logger.info(f"Using voices: {model_paths.voices_path}")
        except FileNotFoundError as e:
            logger.critical(str(e))
            sys.exit(1)
            
        # Initialize TTS model
        try:
            logger.info("Initializing TTS model...")
            start_time = time.time()
            
            tokenizer = Tokenizer()
            kokoro = Kokoro(
                model_path=str(model_paths.model_path),
                voices_path=str(model_paths.voices_path),
                tokenizer=tokenizer
            )
            
            load_time = time.time() - start_time
            logger.info(f"Model loaded in {load_time:.2f} seconds")
            
            # Create request handler
            handler = TTSRequestHandler(kokoro)
            
        except Exception as e:
            logger.critical(f"Failed to initialize TTS model: {e}", exc_info=True)
            sys.exit(1)
            
        # Start servers
        try:
            # TTS server
            tts_server = await asyncio.start_server(
                handler.process_request,
                host=host,
                port=port,
                reuse_address=True,
                backlog=100
            )
            
            # Health check server
            health_server = await asyncio.start_server(
                TTSRequestHandler.handle_health_check,
                host=host,
                port=health_port,
                reuse_address=True
            )
            
            # Log server info
            tts_addrs = ', '.join(str(sock.getsockname()) for sock in tts_server.sockets)
            health_addrs = ', '.join(str(sock.getsockname()) for sock in health_server.sockets)
            
            logger.info(f"TTS server listening on {tts_addrs}")
            logger.info(f"Health check available at {health_addrs}")
            logger.info("Server is ready to handle requests")
            
            # Keep the server running
            async with tts_server, health_server:
                await asyncio.gather(
                    tts_server.serve_forever(),
                    health_server.serve_forever()
                )
                
        except asyncio.CancelledError:
            logger.info("Server shutdown requested")
            
        except Exception as e:
            logger.critical(f"Server error: {e}", exc_info=True)
            sys.exit(1)
            
    except KeyboardInterrupt:
        logger.info("Shutting down gracefully...")
        
    except Exception as e:
        logger.critical(f"Unexpected error: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[kokoro-server] Shutting down.", file=sys.stderr)
