# Your Environment Variables
# -----------------------------
# Create a .env file in the root of the project and add the following keys.

# Required for the Google Gemini conversational engine
API_KEY="YOUR_GEMINI_API_KEY"

# Required for Text-to-Speech voice synthesis
ELEVENLABS_API_KEY="YOUR_ELEVENLABS_API_KEY"

# Required for the autonomous agent message queue and real-time events
REDIS_URL="redis://localhost:6379"

# Required for the PayAI x402 payment system
FACILITATOR_URL="https://facilitator.payai.network"
NETWORK="solana" # The blockchain network for payments (e.g., "solana", "base-sepolia")
MERCHANT_WALLET_ADDRESS="YOUR_SOLANA_WALLET_ADDRESS" # Wallet to receive payments for default models

# Optional: Required for all live crypto data tools and the token ticker
SOLSCAN_API_KEY="YOUR_SOLSCAN_PRO_API_KEY"

# Optional: Required to enable custom AI agent creation and sharing features
MONGODB_URI="YOUR_MONGODB_CONNECTION_STRING"