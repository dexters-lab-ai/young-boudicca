import useStore from './store';
import { togglePaywallModal } from './actions';
import { PaywallDetails } from '../types';

// This is a placeholder for a proper WWW-Authenticate header parser.
// A production implementation should handle various auth schemes and parameters.
function parseWWWAuthenticateHeader(header: string): Record<string, string> {
    const result: Record<string, string> = {};
    // Example header: `x402 token_type="EIP-2612", network="base-sepolia", pay_to="..." ...`
    const parts = header.split(/[, ]+/);
    parts.slice(1).forEach(part => {
        const [key, value] = part.split('=');
        if (key && value) {
            result[key.trim()] = value.trim().replace(/"/g, '');
        }
    });
    return result;
}


export async function fetchApiWith402(requestFn: () => Promise<Response>): Promise<Response> {
    const response = await requestFn();

    if (response.status === 402) {
        const wwwAuthenticate = response.headers.get('WWW-Authenticate');
        if (!wwwAuthenticate) {
            throw new Error('402 response missing WWW-Authenticate header.');
        }

        const details = parseWWWAuthenticateHeader(wwwAuthenticate);
        const { setError } = useStore.getState();

        return new Promise((resolve, reject) => {
            const paywallDetails: PaywallDetails = {
                // These details should be dynamically parsed from the header
                type: 'chat_credits', // This would need to be determined from the request or response
                amount: parseFloat(details.price || '0.1'),
                recipient: details.pay_to,
                currency: 'USDC', // Assuming USDC
                network: 'Base', // Assuming Base
                itemDescription: 'Continue your conversation', // This should be more dynamic
                originalRequest: async () => {
                    try {
                        // This function is called by the modal after a "successful" payment simulation.
                        // In a real x402 client, this would involve retrying the original request
                        // with an `Authorization: x402 ...` header.
                        // For our simulation, we just re-run the original fetch.
                        const retryResponse = await requestFn();
                        if (retryResponse.ok) {
                            resolve(retryResponse);
                        } else {
                            const errorText = await retryResponse.text();
                            reject(new Error(`Request failed after payment: ${errorText}`));
                        }
                    } catch (e) {
                        reject(e);
                    } finally {
                        togglePaywallModal(false);
                    }
                },
            };
            
            // Open the paywall
            togglePaywallModal(true, paywallDetails);

            // We don't resolve or reject here; the modal's flow will do that.
            // If the user closes the modal, the promise remains pending,
            // effectively cancelling the operation from the caller's perspective.
        });
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    return response;
}
