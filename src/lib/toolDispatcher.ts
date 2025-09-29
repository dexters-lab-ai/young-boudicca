import useStore from './store';
// FIX: `setGesture` is not exported from `./actions`. It's a method on the store.
// FIX: Corrected import from setActiveEnvironmentUrl to setActiveEnvironment.
import { setActiveEnvironment } from './actions';

// Server-side tools that require an API call
const serverTools = new Set([
    'fetchTokenList',
    'fetchTrendingTokens',
    'fetchToken',
    'fetchBondingTokens',
    'fetchLatestTokens',
    'getTokenMetadata',
    'getMarketInfo',
    'fetchCandles',
]);

function mapToolToEndpoint(name: string): { url: string; body: (args: any) => any } | null {
    const baseUrl = '/tools';
    switch (name) {
        case 'fetchTokenList':
            return { url: `${baseUrl}/fetchTokenList`, body: (a) => ({ type: a?.type, platform: a?.platform }) };
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
            return null;
    }
}

async function dispatchServerTool(name: string, args: any): Promise<any> {
     try {
      const endpoint = mapToolToEndpoint(name);
      if (!endpoint) return { error: `Unknown server tool: ${name}` };
      
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

function dispatchClientTool(name: string, args: any): Promise<any> {
    const { environments } = useStore.getState();
    switch (name) {
        case 'setMood':
            const envName = args.environment?.toLowerCase();
            const targetEnv = environments.find(e => e.name.toLowerCase() === envName);
            if (targetEnv) {
                // FIX: Call the correct action with the full environment object.
                setActiveEnvironment(targetEnv); // Assuming this is the correct action
                return Promise.resolve({ result: `Mood set to ${targetEnv.name}` });
            } else {
                return Promise.resolve({ error: `Environment "${args.environment}" not found.` });
            }
        case 'triggerGesture':
            const gestureName = args.gesture?.toLowerCase();
            if (gestureName) {
                // FIX: Call `setGesture` via the zustand store.
                useStore.getState().setGesture(gestureName);
                return Promise.resolve({ result: `Gesture "${gestureName}" triggered.` });
            } else {
                return Promise.resolve({ error: 'Gesture name not provided.' });
            }
        default:
            return Promise.resolve({ error: `Unknown client tool: ${name}` });
    }
}

export async function dispatchToolCall(name: string, args: any): Promise<any> {
    if (serverTools.has(name)) {
        return dispatchServerTool(name, args);
    } else {
        return dispatchClientTool(name, args);
    }
}