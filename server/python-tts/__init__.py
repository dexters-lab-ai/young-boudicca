"""
TTS Module Initialization

This module handles the TTS (Text-to-Speech) functionality using the Kokoro model.
"""

import os
from kokoro_onnx import Kokoro
from kokoro_onnx.config import SAMPLE_RATE
from kokoro_onnx.tokenizer import Tokenizer

class TTSService:
    def __init__(self, model_dir: str = None):
        self.model_dir = model_dir or os.path.dirname(__file__)
        self.model = None
        self.tokenizer = None
        
    def initialize(self):
        """Initialize the TTS service with model files."""
        model_path = os.path.join(self.model_dir, 'kokoro-v1.0.onnx')
        voices_path = os.path.join(self.model_dir, 'voices-v1.0.bin')
        
        if not os.path.exists(model_path) or not os.path.exists(voices_path):
            raise FileNotFoundError(
                f"TTS model files not found at {self.model_dir}. "
                "Please ensure model files are downloaded during build."
            )
            
        self.tokenizer = Tokenizer()
        self.model = Kokoro(model_path, voices_path, tokenizer=self.tokenizer)
        return self

# Singleton instance
tts_service = TTSService()
