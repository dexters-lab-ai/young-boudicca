import { shuffle } from 'lodash';

// Must end with slash so path joining preserves /v2.0
const API_BASE_URL = 'https://pro-api.solscan.io/v2.0/';

function normalizeSolscanUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice('ipfs://'.length)}`;
  return url;
}

// Fisher-Yates shuffle algorithm
function shuffleArray<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function timestampToYYYYMMDD(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}


export class SolscanService {
  constructor() {
    const present = Boolean(process.env.SOLSCAN_API_KEY);
    const redact = (v?: string) => (v ? `${v.slice(0, 6)}...(${v.length})` : 'undefined');
    // eslint-disable-next-line no-console
    console.log(`[SolscanService] Init. SOLSCAN_API_KEY present: ${present ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
  }

  private async get<T = any>(endpoint: string, params: Record<string, any> = {}): Promise<T | null> {
    const apiKey = process.env.SOLSCAN_API_KEY || '';
    if (!apiKey) {
        console.error('[SolscanService] API Key is missing. Cannot make requests.');
        return null;
    }
    // Ensure endpoint does not start with '/'; new URL would otherwise drop '/v2.0'
    const ep = (endpoint || '').replace(/^\/+/, '');
    const url = new URL(ep, API_BASE_URL);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    console.log(`
--------------------------------------------------
[SolscanService] Requesting -> GET ${url.toString()} (base=${API_BASE_URL}, ep=${ep})
--------------------------------------------------`);

    try {
      const resp = await fetch(url.toString(), {
        headers: { accept: 'application/json', token: apiKey },
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        console.error(`
--------------------------------------------------
[SolscanService] Request FAILED <- ${resp.status} ${resp.statusText}
  URL: ${url.toString()}
  Response: ${errorText}
--------------------------------------------------`);
        return null;
      }

      const data = await resp.json();
      console.log(`
--------------------------------------------------
[SolscanService] Request SUCCESS <- ${resp.status}
  URL: ${url.toString()}
  Response (truncated): ${JSON.stringify(data).substring(0, 300)}...
--------------------------------------------------`);

      return data as T;

    } catch (err: any) {
      console.error(`[SolscanService] Network fetch error for ${endpoint}:`, err?.message || err);
      return null;
    }
  }

  async getLatestTokens(limit = 50): Promise<any[] | null> {
    const result = await this.get<{ success: boolean; data: any[] }>('token/latest', { page_size: limit });
    const data = result?.data || [];
    return Array.isArray(data) ? data.slice(0, limit) : null;
  }

  async getTrendingTokens(limit = 20): Promise<any[] | null> {
    const result = await this.get<{ data: any[] }>('token/trending', { limit });
    return result?.data || null;
  }

  async getTokenMetadata(tokenAddress: string): Promise<any | null> {
    const result = await this.get<{ success: boolean; data: any }>('token/meta', { address: tokenAddress });
    if (!result?.success || !result.data) return null;
    const d = result.data;
    const icon = d.icon ? normalizeSolscanUrl(d.icon) : d.icon;
    const metadata = d.metadata || {};
    const normalizedImage = metadata.image ? normalizeSolscanUrl(metadata.image) : metadata.image;
    return {
      ...d,
      icon,
      metadata: { ...metadata, image: normalizedImage },
      metadata_uri: d.metadata_uri ? normalizeSolscanUrl(d.metadata_uri) : d.metadata_uri,
    };
  }

  async getMarketInfo(tokenAddress: string): Promise<any | null> {
    const result = await this.get<{ success: boolean; data: any[] }>('token/markets', { 'token[]': tokenAddress, page: 1, page_size: 10 });
    // Return the first (likely most liquid) market, or null if none
    return result?.data?.[0] || null;
  }

  async fetchTokenCandles(params: { address: string; time_from: number; time_to: number }): Promise<any[]> {
    const { address, time_from, time_to } = params;
    const result = await this.get<{ success: boolean, data: any[] }>('token/price', {
      address,
      from_time: timestampToYYYYMMDD(time_from),
      to_time: timestampToYYYYMMDD(time_to),
    });
    return result?.data || [];
  }

  async fetchTokenDetails(tokenAddress: string): Promise<any | null> {
    try {
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      const [metadata, marketInfo, candles] = await Promise.all([
        this.getTokenMetadata(tokenAddress),
        this.getMarketInfo(tokenAddress),
        this.fetchTokenCandles({ address: tokenAddress, time_from: thirtyDaysAgo, time_to: now })
      ]);
      if (!metadata) return null;
      
      const pairAddr = marketInfo?.pool_id;
      const metaFromApi = metadata.metadata || {};

      const socials: Record<string, string> = {};
      const socialKeys = ['twitter', 'telegram', 'discord', 'website', 'facebook', 'instagram', 'linkedin', 'reddit', 'youtube', 'medium'];
      for (const key of socialKeys) {
          if (metaFromApi[key] && typeof metaFromApi[key] === 'string') {
              socials[key] = metaFromApi[key];
          }
      }
      if (metadata.socials && Array.isArray(metadata.socials)) {
          for (const s of metadata.socials) {
              const type = String(s.type).toLowerCase();
              if (s?.type && s?.url && !socials[type]) {
                  socials[type] = s.url;
              }
          }
      }
      if (!socials.website && metadata.website) {
          socials.website = metadata.website;
      }

      return {
        tokenAddress: tokenAddress,
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.icon,
        priceUsd: metadata.price,
        priceChange24h: metadata.price_change_24h ?? 0,
        marketCap: metadata.market_cap,
        marketCapRank: metadata.market_cap_rank,
        volume24h: metadata.volume_24h,
        holderCount: metadata.holder,
        supply: metadata.supply,
        creatorAddress: metadata.creator,
        createdTime: metadata.created_time,
        createdOn: metaFromApi.createdOn,
        description: metaFromApi.description || metadata.description || '',
        socials: socials,
        liquidityUsd: marketInfo?.total_tvl,
        pairLabel: `${metadata.symbol}/SOL`,
        candles: candles || [],
        solscanUrl: `https://solscan.io/token/${tokenAddress}`,
        dexscreenerUrl: pairAddr ? `https://dexscreener.com/solana/${pairAddr}` : `https://dexscreener.com/solana/${tokenAddress}`,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[SolscanService] fetchTokenDetails error:`, err);
      return null;
    }
  }

  async fetchTrendingTokens(limit = 9): Promise<any[]> {
    const trendingTokens = await this.getTrendingTokens(limit);
    if (!trendingTokens) return [];

    const enriched = await Promise.all(
      trendingTokens.map(async (token: any) => {
        try {
          const [metadata, marketInfo] = await Promise.all([
            this.getTokenMetadata(token.address),
            this.getMarketInfo(token.address),
          ]);
          if (!metadata) return null;

          if (!marketInfo) {
            console.warn(`[SolscanService] No market info for ${token.address}; returning partial token with defaults.`);
          }

          const socials: Record<string, string> = {};
          if (metadata.socials) {
            for (const s of metadata.socials) {
              if (s?.type && s?.url) socials[String(s.type).toLowerCase()] = s.url;
            }
          }

          // Better fallbacks: prefer metadata values, then token list values
          const name = metadata.name || token.name || 'Unknown Name';
          const symbol = metadata.symbol || token.symbol || 'N/A';

          // Derive a usable logo: icon or metadata.image, normalized for IPFS
          const logoCandidate = metadata.icon || metadata?.metadata?.image;
          const logo = logoCandidate ? normalizeSolscanUrl(logoCandidate) : '';

          const pairAddr = marketInfo?.pool_id;

          return {
            tokenAddress: token.address,
            name,
            symbol,
            decimals: token.decimals,
            logo,
            description: metadata.description,
            website: metadata.website,
            socials,
            marketCap: metadata.market_cap || 0,
            volume24h: metadata.volume_24h || 0,
            priceUsd: metadata.price || 0,
            priceChange24h: metadata.price_change_24h || 0,
            solscanUrl: `https://solscan.io/token/${token.address}`,
            dexscreenerUrl: pairAddr ? `https://dexscreener.com/solana/${pairAddr}` : `https://dexscreener.com/solana/${token.address}`,
          };
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.error(`[SolscanService] enrich trending ${token.address}:`, err?.message || err);
          return null;
        }
      })
    );

    return enriched.filter(Boolean) as any[];
  }

  /**
   * NOTE: Refactored to fix 404 error.
   * The previous implementation incorrectly used the `/launchpad/list` endpoint, which is not suitable for this purpose.
   * The official and correct way to get the latest tokens for a specific launchpad (like Pump.fun) is to use
   * the `/token/latest` endpoint with the `platform_id` query parameter.
   * This method now fetches a list of basic token info and then enriches each token with full metadata
   * and market info to provide a rich object for the UI.
   * The concept of a "bonding" status is implicit in this endpoint for launchpads. The concept of "graduated"
   * is not supported via this corrected endpoint, so that functionality has been deprecated.
  */
  async fetchLaunchpadTokens(limit = 50, platform_id?: string): Promise<any[]> {
    const params: Record<string, any> = { page_size: limit, page: 1 };
    if (platform_id) {
        params.platform_id = platform_id;
    }
    const result = await this.get<{ data: any[] }>('token/latest', params);
    const launchpadTokens = result?.data || [];
    if (!launchpadTokens) return [];

    // Enrich the basic token list with full metadata for the UI
    const enriched = await Promise.all(
        launchpadTokens.map(async (token: any) => {
            try {
                const [metadata, marketInfo] = await Promise.all([
                    this.getTokenMetadata(token.address),
                    this.getMarketInfo(token.address),
                ]);

                if (!metadata) return null; // Essential data missing

                const logoCandidate = metadata.icon || metadata?.metadata?.image || token.logo_uri;
                const logo = logoCandidate ? normalizeSolscanUrl(logoCandidate) : '';
                const pairAddr = marketInfo?.pool_id;

                return {
                    tokenAddress: token.address,
                    name: metadata.name || token.name || 'Unknown Name',
                    symbol: metadata.symbol || token.symbol || 'N/A',
                    logo,
                    priceUsd: metadata.price || 0,
                    priceChange24h: metadata.price_change_24h || 0,
                    marketCap: metadata.market_cap || 0,
                    volume24h: metadata.volume_24h || 0,
                    solscanUrl: `https://solscan.io/token/${token.address}`,
                    dexscreenerUrl: pairAddr ? `https://dexscreener.com/solana/${pairAddr}` : `https://dexscreener.com/solana/${token.address}`,
                    platform: token.platform,
                };
            } catch (err: any) {
                console.error(`[SolscanService] enrich launchpad token ${token.address}:`, err?.message || err);
                return null;
            }
        })
    );

    return enriched.filter(Boolean) as any[];
}

  async fetchTickerTokens(): Promise<any[]> {
    try {
      console.log('[SolscanService] Assembling tokens for ticker...');
      const [trending, bonding] = await Promise.all([
        this.fetchTrendingTokens(20),
        this.fetchLaunchpadTokens(20, 'pumpfun') // Default to pump.fun for the generic ticker
      ]);

      console.log(`[SolscanService] Fetched for ticker: ${trending?.length || 0} trending, ${bonding?.length || 0} bonding.`);

      const allTokens = [
        ...(trending || []),
        ...(bonding || []),
      ];

      // Deduplicate tokens by address
      const uniqueTokens = Array.from(new Map(allTokens.map(token => [token.tokenAddress, token])).values());
      console.log(`[SolscanService] Total unique tokens for ticker: ${uniqueTokens.length}`);
      
      return shuffleArray(uniqueTokens);
    } catch (error) {
      console.error('[SolscanService] Error fetching ticker tokens:', error);
      return [];
    }
  }
}

export const solscanService = new SolscanService();