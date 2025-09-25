"""Verify Python environment and dependencies."""
import sys
import pkg_resources

def verify_environment():
    """Verify Python version and required packages."""
    print(f"Python version: {sys.version}")
    
    required = [
        'kokoro-tts==2.3.0',
        'fastapi',
        'uvicorn',
        'websockets',
        'python-multipart',
        'numpy',
        'scipy',
        'soundfile',
        'onnxruntime',
    ]
    
    for package in required:
        try:
            pkg_resources.require(package)
            dist = pkg_resources.get_distribution(package.split('==')[0])
            print(f"✓ {dist.key} {dist.version}")
        except pkg_resources.DistributionNotFound:
            print(f"✗ {package} not found")
        except pkg_resources.VersionConflict as e:
            print(f"✗ {package} version conflict: {e}")

if __name__ == "__main__":
    verify_environment()
