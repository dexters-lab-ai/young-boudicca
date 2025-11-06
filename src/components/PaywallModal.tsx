import React from 'react';
import useStore from '../lib/store';
import { togglePaywallModal } from '../lib/actions';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import '../styles/PaywallModal.css';

// This is a placeholder for the client-side x402 payment flow.
// In a real implementation with the PayAI SDK, you would use their
// client library (e.g., x402-fetch or x402-axios) which handles
// the wallet interaction and retries automatically.
async function handlePayment(paywallDetails: any) {
    // 1. Prompt user to sign a message using their wallet.
    // This would be handled by the x402 client library.
    console.log("Simulating payment signature for:", paywallDetails);
    
    // 2. The client library would then automatically retry the original request
    // with the signature in the Authorization header.
    // We'll simulate this by calling the originalRequest function.
    await paywallDetails.originalRequest();
}


export default function PaywallModal() {
    const { publicKey } = useWallet();
    const paywallDetails = useStore.use.paywallDetails();
    const [status, setStatus] = React.useState<'idle' | 'paying' | 'success' | 'error'>('idle');
    const [error, setError] = React.useState<string | null>(null);

    const handleConfirmPayment = async () => {
        if (!paywallDetails) return;
        setStatus('paying');
        setError(null);
        try {
            // Simulate the payment and retry flow
            await handlePayment(paywallDetails);
            setStatus('success');
            setTimeout(() => {
                togglePaywallModal(false);
            }, 2000);
        } catch (err: any) {
            console.error("Payment failed:", err);
            setStatus('error');
            setError(err.message || 'Payment failed. Please try again.');
        }
    };
    
    if (!paywallDetails) return null;

    const renderContent = () => {
        if (status === 'success') {
            return (
                <div className="paywall-status">
                    <span className="icon success">check_circle</span>
                    <p>Payment successful! Unlocking content...</p>
                </div>
            );
        }

        return (
            <>
                <div className="paywall-details">
                    <div className="detail-item">
                        <span className="label">Item</span>
                        <span className="value">{paywallDetails.itemDescription}</span>
                    </div>
                     <div className="detail-item">
                        <span className="label">Network</span>
                        <span className="value">{paywallDetails.network}</span>
                    </div>
                    <div className="detail-item">
                        <span className="label">Amount</span>
                        <span className="value amount">{paywallDetails.amount} {paywallDetails.currency}</span>
                    </div>
                </div>
                
                {status === 'paying' && (
                    <div className="paywall-status">
                        <div className="spinner" />
                        <p>Awaiting confirmation from your wallet...</p>
                    </div>
                )}
                
                {status === 'error' && (
                     <div className="paywall-status error">
                        <span className="icon">error</span>
                        <p>{error}</p>
                    </div>
                )}

                <div className="paywall-actions">
                    {!publicKey ? (
                        <div className="wallet-prompt-small" style={{width: '100%'}}>
                            <p>Connect your wallet to pay.</p>
                            <WalletMultiButton />
                        </div>
                    ) : (
                        <button onClick={handleConfirmPayment} disabled={status === 'paying'}>
                            {status === 'paying' ? 'Processing...' : `Pay ${paywallDetails.amount} ${paywallDetails.currency}`}
                        </button>
                    )}
                </div>
            </>
        )
    };

    return (
        <div className="modal-backdrop paywall-modal" onClick={() => status !== 'paying' && togglePaywallModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                 <button className="close-button" onClick={() => togglePaywallModal(false)} disabled={status === 'paying'}>
                    <span className="icon">close</span>
                </button>
                <div className="paywall-header">
                    <img src="/images/402protocol-logo.png" alt="402 Protocol" />
                    <h2>Payment Required</h2>
                    <p>This feature requires a small payment to continue.</p>
                </div>
                {renderContent()}
            </div>
        </div>
    )
}