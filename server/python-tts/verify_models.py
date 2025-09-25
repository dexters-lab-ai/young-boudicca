import os
import sys
from pathlib import Path

# Paths to check
MODEL_PATHS = [
    "./kokoro-v1.0.onnx",
    "./voices-v1.0.bin",
    "./models/kokoro-v1.0.onnx",
    "./models/voices-v1.0.bin",
    "/app/models/kokoro-v1.0.onnx",
    "/app/models/voices-v1.0.bin"
]

def check_models():
    """Check if model files exist in any of the expected locations."""
    found_models = []
    
    print("Checking for model files...")
    for model_path in MODEL_PATHS:
        full_path = os.path.abspath(model_path)
        exists = os.path.exists(full_path)
        status = "FOUND" if exists else "NOT FOUND"
        print(f"{status}: {full_path}")
        if exists:
            found_models.append(full_path)
    
    if not found_models:
        print("\nERROR: No model files found in any of the expected locations!")
        print("Please download the model files and place them in one of these locations:")
        for path in MODEL_PATHS:
            print(f"- {os.path.abspath(path)}")
        return False
    
    print("\nFound the following model files:")
    for path in found_models:
        print(f"- {path}")
    return True

if __name__ == "__main__":
    success = check_models()
    sys.exit(0 if success else 1)
