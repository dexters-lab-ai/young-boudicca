import { FunctionDeclaration, Type } from '@google/genai';

export const availableTools: FunctionDeclaration[] = [
  {
    name: 'setMood',
    description: 'Sets the visual and auditory mood of the environment. This changes the background image and the background music.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        environment: {
          type: Type.STRING,
          description: 'The name of the environment to switch to. Available options are: Studio, Forest, Space.',
        },
      },
      required: ['environment'],
    },
  },
  {
    name: 'triggerGesture',
    description: 'Triggers a specific gesture animation for the 3D avatar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        gesture: {
          type: Type.STRING,
          description: 'The name of the gesture to perform. Available options are: greeting, cute, elegant, pose, peacesign, dance, dance_meme, shoot, spin, squat, fight, powerful, pumped.',
        },
      },
      required: ['gesture'],
    },
  },
  {
    name: 'fetchTrendingTokens',
    description: 'Fetches the top trending tokens from Solscan.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'The number of trending tokens to fetch. Defaults to 9.',
        },
      },
      required: [],
    },
  },
  {
    name: 'fetchToken',
    description: 'Fetches detailed information about a specific token by its mint address.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mint: {
          type: Type.STRING,
          description: 'The mint address of the token to fetch.',
        },
      },
      required: ['mint'],
    },
  },
  {
    name: 'fetchBondingTokens',
    description: 'Fetches tokens currently in the bonding stage from various Solana launchpads.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'The number of tokens to fetch. Defaults to 20.',
        },
        platform: {
            type: Type.STRING,
            description: 'The launchpad platform to filter by. Supported values: "pumpfun", "jupiter", "meteora", "raydium", "kamino", "orca". Defaults to all platforms if not specified.',
        },
      },
      required: [],
    },
  },
  {
    name: 'fetchLatestTokens',
    description: 'Fetches the most recently created tokens.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'The number of tokens to fetch. Defaults to 50.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getTokenMetadata',
    description: 'Gets the metadata for a given token address.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        address: {
          type: Type.STRING,
          description: 'The address of the token.',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'getMarketInfo',
    description: 'Gets the market information for a given token address.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        address: {
          type: Type.STRING,
          description: 'The address of the token.',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'fetchCandles',
    description: 'Fetches daily price data for a given token address within a time range.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        address: {
          type: Type.STRING,
          description: 'The address of the token.',
        },
        time_from: {
          type: Type.NUMBER,
          description: 'The start of the time range as a Unix timestamp.',
        },
        time_to: {
          type: Type.NUMBER,
          description: 'The end of the time range as a Unix timestamp.',
        },
      },
      required: ['address', 'time_from', 'time_to'],
    },
  },
  {
    name: 'listMonacoMarkets',
    description: 'Fetches a list of available betting markets from the Monaco Protocol.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        marketStatus: {
          type: Type.STRING,
          description: 'The status of the markets to fetch. Defaults to "open". Other options include "initializing", "settled", "readyForSettlement", "voided".',
        },
      },
      required: [],
    },
  },
  {
    name: 'getMonacoMarketDetails',
    description: 'Fetches details for a specific Monaco Protocol betting market, including the possible outcomes and current prices.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        marketPk: {
          type: Type.STRING,
          description: 'The public key (address) of the market to fetch details for.',
        },
      },
      required: ['marketPk'],
    },
  },
  {
      name: 'listUserMonacoOrders',
      description: 'Lists all active and settled orders for a given user wallet address on the Monaco Protocol.',
      parameters: {
          type: Type.OBJECT,
          properties: {
              walletAddress: {
                  type: Type.STRING,
                  description: 'The Solana wallet address of the user.'
              }
          },
          required: ['walletAddress']
      }
  },
  {
    name: 'placeMonacoOrder',
    description: 'Places an order (a bet) on a specific outcome of a Monaco Protocol market.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        marketPk: {
          type: Type.STRING,
          description: 'The public key (address) of the market to place an order on.',
        },
        outcomeIndex: {
            type: Type.NUMBER,
            description: 'The index of the outcome to bet on (e.g., 0 for the first outcome, 1 for the second).',
        },
        forAgainst: {
          type: Type.STRING,
          description: 'Whether to place a "for" (back) or "against" (lay) order. Must be either "for" or "against".',
        },
        amount: {
          type: Type.NUMBER,
          description: 'The amount of USDC to stake on the order.',
        },
        walletAddress: {
          type: Type.STRING,
          description: "The user's Solana wallet address."
        }
      },
      required: ['marketPk', 'outcomeIndex', 'forAgainst', 'amount', 'walletAddress'],
    }
  }
];