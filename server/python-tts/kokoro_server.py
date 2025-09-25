import sys
import os
import asyncio
import json
import time
import io
import struct
import traceback
from pathlib import Path
from scipy.io.wavfile import write as write_wav

# Add the server directory to Python path
server_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if server_dir not in sys.path:
    sys.path.insert(0, server_dir)

# Add virtual environment site-packages
venv_path = '/opt/venv/lib/python3.11/site-packages'
if os.path.exists(venv_path) and venv_path not in sys.path:
    sys.path.append(venv_path)

print(f"Python sys.path: {sys.path}")

# Try to import required modules
try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import SAMPLE_RATE
    from kokoro_onnx.tokenizer import Tokenizer
    print("[kokoro-server] Successfully imported Kokoro modules")
except ImportError as e:
    print(f"[kokoro-server] Error importing Kokoro: {e}", file=sys.stderr)
    print("Python path:", sys.path, file=sys.stderr)
    print("Current directory:", os.getcwd(), file=sys.stderr)
    print("Files in current directory:", os.listdir('.'), file=sys.stderr)
    sys.exit(1)

HOST = '0.0.0.0'
PORT = 8899

async def handle_health_check(reader, writer):
    """Responds to a health check ping."""
    writer.write(b'OK')
    await writer.drain()
    writer.close()
    await writer.wait_closed()

async def handle_client(reader, writer):
    """Callback to handle a single client connection."""
    addr = writer.get_extra_info('peername')
    print(f"[kokoro-server] Connection from {addr}", file=sys.stderr)
    kokoro_model = app_globals['kokoro']

    try:
        request_start_time = time.time()
        # Read the 4-byte header to get the size of the request payload
        header = await reader.readexactly(4)
        payload_size = struct.unpack('<I', header)[0]

        # Read the request payload
        data = await reader.readexactly(payload_size)
        if not data:
            return

        req = json.loads(data.decode('utf-8'))
        print(f"[kokoro-server] Processing request for text: '{req.get('text', '')[:30]}...'", file=sys.stderr)

        synthesis_start_time = time.time()
        
        # Use the streaming endpoint for lower latency
        async for samples, _ in kokoro_model.create_stream(
            text=req.get('text', ''),
            voice=req.get('voice') or 'en-us_ljspeech',
            speed=req.get('speed') or 1.0,
            lang=req.get('lang') or 'en-us',
            trim=False
        ):
            # Convert numpy array to raw bytes and send directly for performance
            audio_bytes = samples.tobytes()
            
            # Pack the length of the chunk as a 4-byte integer (unsigned little-endian)
            len_prefix = struct.pack('<I', len(audio_bytes))
            # Send length prefix followed by the audio chunk
            writer.write(len_prefix + audio_bytes)
            await writer.drain()

        # Signal end of stream with a zero-length chunk
        writer.write(struct.pack('<I', 0))
        await writer.drain()

        synthesis_duration = time.time() - synthesis_start_time
        total_request_duration = time.time() - request_start_time
        print(f"[kokoro-server] Synthesis stream finished in: {synthesis_duration:.4f} seconds.", file=sys.stderr)
        print(f"[kokoro-server] Total request processed in: {total_request_duration:.4f} seconds.", file=sys.stderr)

    except Exception as e:
        print(f"[kokoro-server] Error processing request: {e}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        try:
            error_response = json.dumps({'error': str(e)}).encode('utf-8')
            writer.write(struct.pack('<I', len(error_response)) + error_response)
            await writer.drain()
        except Exception as send_e:
            print(f"[kokoro-server] Failed to send error response: {send_e}", file=sys.stderr)
    finally:
        print(f"[kokoro-server] Closing connection from {addr}", file=sys.stderr)
        writer.close()
        await writer.wait_closed()

async def main():
    """Loads the model and runs the TTS socket server."""
    print("[kokoro-server] Starting...", file=sys.stderr)
    print(f"[kokoro-server] Current working directory: {os.getcwd()}", file=sys.stderr)
    print(f"[kokoro-server] Python path: {sys.path}", file=sys.stderr)

    # --- Model Loading ---
    # List of possible model locations in order of preference
    possible_paths = [
        # Docker container paths
        ("/app/models/kokoro-v1.0.onnx", "/app/models/voices-v1.0.bin"),
        # Local development paths
        (os.path.join(os.path.dirname(__file__), "kokoro-v1.0.onnx"),
         os.path.join(os.path.dirname(__file__), "voices-v1.0.bin")),
        # Parent directory
        (os.path.join(os.path.dirname(os.path.dirname(__file__)), "kokoro-v1.0.onnx"),
         os.path.join(os.path.dirname(os.path.dirname(__file__)), "voices-v1.0.bin"))
    ]

    model_path = None
    voices_path = None
    
    # Find the first valid pair of model files
    for mp, vp in possible_paths:
        if os.path.exists(mp) and os.path.exists(vp):
            model_path = os.path.abspath(mp)
            voices_path = os.path.abspath(vp)
            print(f"[kokoro-server] Found model files at: {model_path}", file=sys.stderr)
            break
    
    if not model_path or not voices_path:
        print("[kokoro-server] ERROR: Could not find model files in any of these locations:", file=sys.stderr)
        for i, (mp, vp) in enumerate(possible_paths):
            print(f"  {i+1}. {mp}", file=sys.stderr)
            print(f"     {vp}", file=sys.stderr)
        sys.exit(1)

    print(f"[kokoro-server] Loading model from: {model_path}", file=sys.stderr)
    print(f"[kokoro-server] Loading voices from: {voices_path}", file=sys.stderr)
    
    try:
        # Initialize tokenizer and model
        print("[kokoro-server] Initializing tokenizer...", file=sys.stderr)
        tokenizer = Tokenizer()
        
        print("[kokoro-server] Loading Kokoro model (this may take a moment)...", file=sys.stderr)
        start_time = time.time()
        kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
        load_time = time.time() - start_time
        
        print(f"[kokoro-server] Model loaded successfully in {load_time:.2f} seconds", file=sys.stderr)
        
        # Verify model is working by getting a voice list
        try:
            # Get available voices from the model
            voice_list = kokoro.list_voices() if hasattr(kokoro, 'list_voices') else ["default"]
            print(f"[kokoro-server] Available voices: {voice_list}", file=sys.stderr)
        except Exception as e:
            print(f"[kokoro-server] Warning: Could not list voices - {e}", file=sys.stderr)
        
        # Store model in a global dict to be accessible by the client handler
        global app_globals
        app_globals = {'kokoro': kokoro}
        
        # Start the TTS server
        print(f"[kokoro-server] Starting TTS server on {HOST}:{PORT}...", file=sys.stderr)
        tts_server = await asyncio.start_server(
            handle_client, 
            host=HOST, 
            port=PORT
        )
        
        # Health check server on port 8900
        health_port = 8900
        health_server = await asyncio.start_server(
            handle_health_check,
            host=HOST,
            port=health_port
        )
        
        print(f"[kokoro-server] TTS server running on {HOST}:{PORT}", file=sys.stderr)
        print(f"[kokoro-server] Health check running on {HOST}:{health_port}", file=sys.stderr)
        
        # Keep the server running
        async with tts_server, health_server:
            await asyncio.gather(
                tts_server.serve_forever(),
                health_server.serve_forever()
            )
            
    except Exception as e:
        print(f"[kokoro-server] FATAL: {str(e)}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(1)

    async with tts_server, health_server:
        await asyncio.gather(tts_server.serve_forever(), health_server.serve_forever())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[kokoro-server] Shutting down.", file=sys.stderr)
