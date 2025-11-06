export const availableTools = [
  {
    type: 'function' as const,
    function: {
      name: 'setMood',
      description: 'Sets the visual and auditory mood of the environment. This changes the background image and the background music.',
      parameters: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
            description: 'The name of the environment to switch to. Available options are: Studio, Forest, Space.',
          },
        },
        required: ['environment'],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'triggerGesture',
      description: 'Triggers a specific gesture animation for the 3D avatar.',
      parameters: {
        type: 'object',
        properties: {
          gesture: {
            type: 'string',
            description: 'The name of the gesture to perform. Available options are: greeting, cute, elegant, pose, peacesign, dance, dance_meme, shoot, spin, squat, fight, powerful, pumped.',
          },
        },
        required: ['gesture'],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetchTrendingTokens',
      description: 'Fetches the top trending tokens from Solscan.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'The number of trending tokens to fetch. Defaults to 9.',
          },
        },
        required: [],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetchToken',
      description: 'Fetches detailed information about a specific token by its mint address.',
      parameters: {
        type: 'object',
        properties: {
          mint: {
            type: 'string',
            description: 'The mint address of the token to fetch.',
          },
        },
        required: ['mint'],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetchBondingTokens',
      description: 'Fetches tokens currently in the bonding stage from various Solana launchpads.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'The number of tokens to fetch. Defaults to 20.',
          },
          platform: {
            type: 'string',
            description: 'The launchpad platform to filter by. Supported values: "pumpfun", "jupiter", "meteora", "raydium", "kamino", "orca". Defaults to all platforms if not specified.',
          },
        },
        required: [],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'fetchLatestTokens',
      description: 'Fetches the most recently created tokens.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'The number of tokens to fetch. Defaults to 50.',
          },
        },
        required: [],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'getTokenMetadata',
      description: 'Gets the metadata for a given token address.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'The address of the token.',
          },
        },
        required: ['address'],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'getMarketInfo',
      description: 'Gets the market information for a given token address.',
      parameters: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            description: 'The address of the token.',
          },
        },
        required: [],
      },
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'generateSoraVideo',
      description: 'Generates a short video using Sora based on the currently active user image. Requires an uploaded or captured image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Optional override for the video generation prompt. Leave empty to use the default Sora mode prompt.',
          },
          aspectRatio: {
            type: 'string',
            description: 'Optional aspect ratio hint. Accepts "portrait" or "landscape".',
          },
          removeWatermark: {
            type: 'boolean',
            description: 'Whether to request watermark removal (defaults to true).',
          },
        },
        required: [],
      },
    }
  },
];
