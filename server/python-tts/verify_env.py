"""Verify Python environment and dependencies"""
import os
import sys

def verify_environment():
    print("=== Python Environment Verification ===")
    
    # Check Python version
    print(f"Python version: {sys.version}")
    
    # Check paths
    print("\nPython paths:")
    for path in sys.path:
        print(f"  {path}")
    
    # Check critical files
    server_file = os.path.join(os.path.dirname(__file__), "kokoro_server.py")
    if not os.path.exists(server_file):
        raise RuntimeError(f"Critical file missing: {server_file}")
    
    # Try imports
    try:
        from kokoro_onnx import Kokoro
        from kokoro_onnx.tokenizer import Tokenizer
        print("\nRequired packages available")
    except ImportError as e:
        raise RuntimeError(f"Failed to import required packages: {e}")

if __name__ == "__main__":
    verify_environment()
if __name__ == "__main__":
    verify_environment()
