import io
import os
import asyncio
import socket
import json
import struct
import time
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Kokoro TTS Service", version="1.0.0")

# --- Globals ---
tts_process: asyncio.subprocess.Process | None = None
KOKORO_SERVER_HOST = '127.0.0.1'
KOKORO_SERVER_PORT = 65432
KOKORO_HEALTH_PORT = KOKORO_SERVER_PORT + 1

# --- Model Path Resolution ---
HERE = os.path.dirname(os.path.abspath(__file__))
WORKDIR = HERE
# Check for models in the current directory, then the parent (server/)
if not (os.path.exists(os.path.join(WORKDIR, "voices-v1.0.bin")) and os.path.exists(os.path.join(WORKDIR, "kokoro-v1.0.onnx"))):
    PARENT = os.path.abspath(os.path.join(HERE, os.pardir))
    if os.path.exists(os.path.join(PARENT, "voices-v1.0.bin")) and os.path.exists(os.path.join(PARENT, "kokoro-v1.0.onnx")):
        WORKDIR = PARENT

# --- FastAPI App --- 

class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None
    lang: str | None = None
    speed: float | None = None

@app.on_event("startup")
async def startup_event():
    """Starts the persistent kokoro_server.py process."""
    global tts_process
    server_script_path = os.path.join(os.path.dirname(__file__), 'kokoro_server.py')
    print(f"[python-tts] Starting persistent TTS server: {server_script_path}")
    try:
        args = [os.getenv("PYTHON", os.sys.executable), server_script_path]
        tts_process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        print(f"[python-tts] Kokoro server process started with PID: {tts_process.pid}")
        
        # Task to monitor and log stdout/stderr from the server process
        async def log_output(stream, prefix):
            if stream:
                async for line in stream:
                    print(f"[{prefix}] {line.decode().strip()}")
        
        asyncio.create_task(log_output(tts_process.stdout, "kokoro-server"))
        asyncio.create_task(log_output(tts_process.stderr, "kokoro-server-err"))

    except Exception as e:
        print(f"[python-tts] FATAL: Failed to start kokoro_server.py: {e}")
        tts_process = None

@app.on_event("shutdown")
async def shutdown_event():
    """Terminates the persistent TTS process."""
    if tts_process and tts_process.returncode is None:
        print("[python-tts] Terminating kokoro_server.py process...")
        tts_process.terminate()
        await tts_process.wait()

async def is_tts_server_healthy():
    """Pings the TTS server's health check endpoint."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(KOKORO_SERVER_HOST, KOKORO_HEALTH_PORT),
            timeout=0.5
        )
        data = await reader.read(100)
        writer.close()
        await writer.wait_closed()
        return data == b'OK'
    except Exception:
        return False

@app.get("/health")
async def health():
    if not tts_process or tts_process.returncode is not None:
        return {"status": "error", "detail": "TTS process is not running."}
    
    if await is_tts_server_healthy():
        return {"status": "ok"}
    else:
        return {"status": "error", "detail": "TTS socket server not responding to health check."}

@app.post("/speak")
async def speak(req: SpeakRequest):
    """Connects to the persistent kokoro-tts server to synthesize audio."""
    if not tts_process or tts_process.returncode is not None:
        raise HTTPException(status_code=503, detail="TTS process is not running.")
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Missing text for synthesis.")

    # Wait for the TTS server to be healthy before proceeding
    is_healthy = False
    for _ in range(10):  # Retry for up to 5 seconds
        if await is_tts_server_healthy():
            is_healthy = True
            break
        await asyncio.sleep(0.5)

    if not is_healthy:
        raise HTTPException(status_code=503, detail="TTS server did not become healthy in time.")

    async def stream_generator():
        """Connects to the socket server and yields audio chunks as they arrive."""
        reader, writer = None, None
        try:
            reader, writer = await asyncio.open_connection(KOKORO_SERVER_HOST, KOKORO_SERVER_PORT)
            request_payload = json.dumps(req.dict()).encode('utf-8')
            # Send a 4-byte header with the payload size
            writer.write(struct.pack('<I', len(request_payload)))
            # Send the payload
            writer.write(request_payload)
            await writer.drain()

            while True:
                # Read the 4-byte length prefix for the next chunk
                len_prefix = await reader.readexactly(4)
                chunk_len = struct.unpack('<I', len_prefix)[0]

                # A zero-length chunk signals the end of the stream
                if chunk_len == 0:
                    break

                # Read the audio chunk of the specified length and yield it
                audio_chunk = await reader.readexactly(chunk_len)
                yield audio_chunk

        except ConnectionRefusedError:
            print("[python-tts] Error: Could not connect to the TTS socket server.")
            # This error won't be sent to client as headers are already sent.
        except asyncio.IncompleteReadError:
            print("[python-tts] Incomplete read from socket, connection likely closed.")
        except Exception as e:
            print(f"[python-tts] Error in stream_generator: {e}")
        finally:
            if writer:
                writer.close()
                await writer.wait_closed()

    return StreamingResponse(stream_generator(), media_type="application/octet-stream")
