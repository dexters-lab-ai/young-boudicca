import useStore from './store';
import { togglePaywallModal } from './actions';
import { PaywallDetails } from '../types';

// Parses a WWW-Authenticate header from the x402-express middleware.
// Example: `x402 price="$0.1", pay_to="...", network="solana", ...`
function parseWWWAuthenticateHeader(header: string): Record<string, string> {
    const result: Record<string, string> = {};
    const parts = header.split(/[, ]+/);
    parts.slice(1).forEach(part => {
        const [key, value] = part.split('=');
        if (key && value) {
            result[key.trim()] = value.trim().replace(/"/g, '');
        }
    });
    return result;
}


/**
 * A wrapper for the Fetch API that automatically handles 402 Payment Required responses.
 * When a 402 is received, it triggers a paywall modal and handles retrying the
 * original request with payment proof upon successful transaction.
 * @param url The URL for the fetch request.
 * @param options The options for the fetch request.
 * @returns A promise that resolves to the Response object.
 */
export async function fetchApiWith402(url: string, options: RequestInit): Promise<Response> {
    const response = await fetch(url, options);

    if (response.status === 402) {
        const wwwAuthenticate = response.headers.get('WWW-Authenticate');
        if (!wwwAuthenticate || !wwwAuthenticate.toLowerCase().startsWith('x402')) {
            throw new Error('402 response missing or invalid WWW-Authenticate header.');
        }

        const details = parseWWWAuthenticateHeader(wwwAuthenticate);

        return new Promise((resolve, reject) => {
            const paywallDetails: PaywallDetails = {
                type: 'generic',
                amount: parseFloat((details.price || '$0').replace('$', '')),
                recipient: details.pay_to,
                currency: details.currency || 'USDC',
                network: details.network || 'solana',
                itemDescription: details.description || 'Unlock this feature',
                originalRequest: async (txSignature?: string) => {
                    try {
                        const retryOptions: RequestInit = { 
                            ...options, 
                            headers: { 
                                ...options.headers 
                            } 
                        };
                        
                        if (txSignature) {
                            // The x402 facilitator expects the signature as proof of payment.
                            (retryOptions.headers as Record<string, string>)['Authorization'] = `x402-solana ${txSignature}`;
                        }
                        
                        const retryResponse = await fetch(url, retryOptions);
                        
                        if (retryResponse.ok) {
                            resolve(retryResponse);
                        } else {
                            const errorText = await retryResponse.text();
                            let errorJson;
                            try {
                               errorJson = JSON.parse(errorText);
                            } catch {
                                // Not a json response
                            }
                            reject(new Error(errorJson?.error || `Request failed after payment: ${retryResponse.statusText}`));
                        }
                    } catch (e) {
                        reject(e);
                    } finally {
                        togglePaywallModal(false);
                    }
                },
            };
            
            togglePaywallModal(true, paywallDetails);
        });
    }

    if (!response.ok) {
        try {
            const errorData = await response.json();
            throw new Error(errorData.error || `API request failed with status ${response.status}`);
        } catch {
            throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
        }
    }

    return response;
}