"""
TTS Module Initialization

This module handles the TTS (Text-to-Speech) functionality using the Kokoro model.
The actual model file (kokoro-v1.0.onnx) will be downloaded during the Docker build.
"""

import os

# Define the path to the model file
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'kokoro-v1.0.onnx')

def get_model_path() -> str:
    """Return the path to the TTS model file."""
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"TTS model not found at {MODEL_PATH}. "
            "Please ensure the model file is downloaded during the Docker build."
        )
    return MODEL_PATH
