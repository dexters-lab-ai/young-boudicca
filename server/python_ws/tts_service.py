import os
import logging
from typing import AsyncGenerator, Optional
from kokoro_onnx import Kokoro
from kokoro_onnx.tokenizer import Tokenizer

logger = logging.getLogger(__name__)

class TTSService:
    def __init__(self):
        self.engine = None
        self.tokenizer = None
        self.initialized = False

    async def initialize(self):
        """Initialize TTS engine asynchronously"""
        try:
            model_path = os.getenv('KOKORO_MODEL_PATH', '/app/models/kokoro-v1.0.onnx')
            voices_path = os.getenv('KOKORO_VOICES_PATH', '/app/models/voices-v1.0.bin')
            
            logger.info(f"Initializing TTS engine with model: {model_path}")
            self.tokenizer = Tokenizer()
            self.engine = Kokoro(model_path, voices_path, tokenizer=self.tokenizer)
            self.initialized = True
            logger.info("TTS engine initialized successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize TTS engine: {e}")
            self.initialized = False
            return False

    async def stream_tts(self, text: str, voice: str, speed: float = 1.0) -> AsyncGenerator[bytes, None]:
        """Stream TTS audio chunks"""
        if not self.initialized or not self.engine:
            raise RuntimeError("TTS engine not initialized")
        
        # Clamp speed between 0.5 and 3.0
        speed = max(0.5, min(3.0, float(speed)))
        
        try:
            # Get language from voice (format: lang-voice)
            language = voice.split('_')[0] if '_' in voice else 'en-us'
            
            # Stream audio chunks
            async for audio_chunk, _ in self.engine.create_stream(
                text=text,
                voice=voice,
                language=language,
                speed=speed
            ):
                if audio_chunk is not None:
                    yield audio_chunk
                
        except Exception as e:
            logger.error(f"TTS generation error: {e}")
            raise

# Singleton instance
tts_service = TTSService()
