import sys
import os
import asyncio
import json
import time
import io
import struct
import traceback
from scipy.io.wavfile import write as write_wav

# Add site-packages to path to ensure kokoro_tts is found
# This makes the script runnable even if the venv is not fully activated in the shell
venv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '.venv', 'Lib', 'site-packages'))
if venv_path not in sys.path:
    sys.path.insert(0, venv_path)

try:
    from kokoro_onnx import Kokoro
    from kokoro_onnx.config import SAMPLE_RATE
    from kokoro_onnx.tokenizer import Tokenizer
except ImportError:
    print("[kokoro-server] Error: Could not import Kokoro. Make sure it's installed in the venv.", file=sys.stderr)
    sys.exit(1)

HOST = '127.0.0.1'
PORT = 65432

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

    # --- Model Loading ---
    # Check in /app/models first (Docker container path)
    model_path = "/app/models/kokoro-v1.0.onnx"
    voices_path = "/app/models/voices-v1.0.bin"
    
    # If not found, check in the local directory structure
    if not (os.path.exists(model_path) and os.path.exists(voices_path)):
        workdir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(workdir, "kokoro-v1.0.onnx")
        voices_path = os.path.join(workdir, "voices-v1.0.bin")
        
        # If still not found, check one directory up
        if not (os.path.exists(model_path) and os.path.exists(voices_path)):
            parent_dir = os.path.abspath(os.path.join(workdir, '..'))
            model_path = os.path.join(parent_dir, "kokoro-v1.0.onnx")
            voices_path = os.path.join(parent_dir, "voices-v1.0.bin")
            
            if not (os.path.exists(model_path) and os.path.exists(voices_path)):
                print(f"[kokoro-server] Error: Model files not found. Checked in /app/models/, {workdir}, and {parent_dir}", file=sys.stderr)
                sys.exit(1)

    print(f"[kokoro-server] Loading models from: {workdir}", file=sys.stderr)
    try:
        print("[kokoro-server] Initializing tokenizer...", file=sys.stderr)
        tokenizer = Tokenizer()
        print("[kokoro-server] Tokenizer initialized. Loading Kokoro model...", file=sys.stderr)
        kokoro = Kokoro(model_path, voices_path, tokenizer=tokenizer)
        print("[kokoro-server] Model loaded successfully.", file=sys.stderr)
    except Exception as e:
        print(f"[kokoro-server] FATAL: Failed to load model: {e}", file=sys.stderr)
        sys.exit(1)

    # Store model in a global dict to be accessible by the client handler
    global app_globals
    app_globals = {'kokoro': kokoro}

    # Server for TTS requests
    tts_server = await asyncio.start_server(
        handle_client, HOST, PORT)

    # Server for health checks on a separate port
    health_server = await asyncio.start_server(
        handle_health_check, HOST, PORT + 1)

    tts_addrs = ', '.join(str(sock.getsockname()) for sock in tts_server.sockets)
    health_addrs = ', '.join(str(sock.getsockname()) for sock in health_server.sockets)
    print(f'[kokoro-server] TTS serving on {tts_addrs}', file=sys.stderr)
    print(f'[kokoro-server] Health check serving on {health_addrs}', file=sys.stderr)

    async with tts_server, health_server:
        await asyncio.gather(tts_server.serve_forever(), health_server.serve_forever())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[kokoro-server] Shutting down.", file=sys.stderr)
