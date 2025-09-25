"""FastAPI server for Kokoro TTS"""
import os
import sys
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from kokoro_tts import TextToSpeech, list_voices

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize TTS engine
tts = None

@app.on_event("startup")
async def startup_event():
    global tts
    model_path = os.getenv('KOKORO_MODEL_PATH', '/app/models/kokoro-v1.0.onnx')
    voices_path = os.getenv('KOKORO_VOICES_PATH', '/app/models/voices-v1.0.bin')
    tts = TextToSpeech(model_path=model_path, voices_path=voices_path)

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
                audio_data = tts.synthesize(text, voice=voice)
                await websocket.send_bytes(audio_data)
            except Exception as e:
                await websocket.send_json({"error": str(e)})
                
    except Exception as e:
        print(f"WebSocket error: {e}", file=sys.stderr)
    finally:
        await websocket.close()

@app.get("/voices")
async def get_voices():
    """Return list of available voices"""
    try:
        voices = list_voices()
        return {"voices": voices}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv('PORT', 8899))
    uvicorn.run(app, host="0.0.0.0", port=port)
    # List of possible model locations in order of preference
    possible_paths = [
        # Docker container paths
        ("/app/models/kokoro-v1.0.onnx", "/app/models/voices-v1.0.bin"),
        # Local paths
        (
            os.path.join(os.path.dirname(__file__), "kokoro-v1.0.onnx"),
            os.path.join(os.path.dirname(__file__), "voices-v1.0.bin")
        ),
        # Parent directory
        (
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "kokoro-v1.0.onnx"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "voices-v1.0.bin")
        )
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
        error_msg = "[kokoro-server] ERROR: Could not find model files in any of these locations:\n"
        for i, (mp, vp) in enumerate(possible_paths):
            error_msg += f"  {i+1}. {mp}\n     {vp}\n"
        print(error_msg, file=sys.stderr)
        raise RuntimeError("Model files not found. Check server logs for details.")

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
            voice_list = kokoro.list_voices() if hasattr(kokoro, 'list_voices') else ["default"]
            print(f"[kokoro-server] Available voices: {voice_list}", file=sys.stderr)
        except Exception as e:
            print(f"[kokoro-server] Warning: Could not list voices - {e}", file=sys.stderr)
    
    except Exception as e:
        error_msg = f"[kokoro-server] FATAL: Failed to initialize Kokoro model: {str(e)}"
        print(error_msg, file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        raise RuntimeError("Failed to initialize Kokoro model. Check server logs for details.")

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
        
        print(f"[kokoro-server] Processing request for text: '{text[:50]}...'", file=sys.stderr)
        
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
                print(f"[kokoro-server] Error during audio generation: {e}", file=sys.stderr)
                print(traceback.format_exc(), file=sys.stderr)
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
        print(f"[kokoro-server] Error in /synthesize endpoint: {e}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    """Run the FastAPI application directly if this file is executed."""
    port = int(os.environ.get("PORT", 8899))
    host = os.environ.get("HOST", "0.0.0.0")
    
    print(f"[kokoro-server] Starting server on {host}:{port}", file=sys.stderr)
    uvicorn.run(
        "kokoro_server:app",
        host=host,
        port=port,
        log_level="info",
        reload=False,
        workers=1
    )
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
