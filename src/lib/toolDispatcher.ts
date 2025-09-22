function mapToolToEndpoint(name: string): { url: string; body: (args: any) => any } | null {
    const baseUrl = '/tools';
    switch (name) {
        case 'fetchTrendingTokens':
            return { url: `${baseUrl}/fetchTrendingTokens`, body: (a) => ({ limit: a?.limit ?? 9 }) };
        case 'fetchToken':
            return { url: `${baseUrl}/fetchToken`, body: (a) => ({ mint: a?.mint }) };
        case 'fetchBondingTokens':
            return { url: `${baseUrl}/fetchBondingTokens`, body: (a) => ({ limit: a?.limit ?? 20, platform: a?.platform }) };
        case 'fetchLatestTokens':
            return { url: `${baseUrl}/fetchLatestTokens`, body: (a) => ({ limit: a?.limit ?? 50 }) };
        case 'getTokenMetadata':
            return { url: `${baseUrl}/getTokenMetadata`, body: (a) => ({ address: a?.address }) };
        case 'getMarketInfo':
            return { url: `${baseUrl}/getMarketInfo`, body: (a) => ({ address: a?.address }) };
        case 'fetchCandles':
            return {
                url: `${baseUrl}/fetchCandles`,
                body: (a) => ({ address: a?.address, time_from: a?.time_from, time_to: a?.time_to }),
            };
        default:
            console.warn(`No endpoint mapping for tool: ${name}`);
            return null;
    }
}

export async function dispatchToolCall(name: string, args: any): Promise<any> {
    try {
      const endpoint = mapToolToEndpoint(name);
      if (!endpoint) return { error: `Unknown tool: ${name}` };
      
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(endpoint.body(args)),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { error: `Tool ${name} failed with status ${res.status}: ${errorText}` };
      }
      return await res.json();
    } catch(e: any) {
      return { error: `Tool ${name} threw an exception: ${e.message}` };
    }
}