import { useState, useEffect } from 'react';
import useStore from '../lib/store';
import { toggleSubscriptionModal } from '../lib/actions';
import { useWallet } from '@solana/wallet-adapter-react';
import '../styles/SubscriptionModal.css';

const USDC_TOKEN_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u63'; // Placeholder Solana USDC

export default function SubscriptionModal() {
    const { publicKey } = useWallet();
    const agentId = useStore.use.subscriptionModalAgentId();
    const agent = useStore.use.customAgents().find(a => a._id === agentId);
    
    const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Reset state if modal is reopened for a different agent
        setStatus('idle');
        setError(null);
    }, [agentId]);

    const handleCopy = (textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy);
    };

    const handleConfirm = async () => {
        if (!publicKey || !agent) return;
        setStatus('verifying');
        setError(null);

        // In a real app, this is where you would initiate the transaction with the user's wallet.
        // For this simulation, we'll just create a placeholder signature.
        const simulatedTxSignature = `SIM_TX_${Date.now()}`;

        try {
            const response = await fetch(`/api/subscribe/${agent._id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: publicKey.toBase58(),
                    txSignature: simulatedTxSignature,
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Verification failed.');
            }

            setStatus('success');
            // Refresh subscription status in the store
            useStore.getState().setSubscriptionStatus(agent._id, { isSubscribed: true, expiresAt: new Date(result.expiresAt) });
            setTimeout(() => toggleSubscriptionModal(false), 2000);

        } catch (err: any) {
            setStatus('error');
            setError(err.message);
        }
    };

    if (!agent) return null;

    const renderContent = () => {
        if (status === 'success') {
            return (
                <div className="status-message success">
                    <span className="icon">check_circle</span>
                    <h3>Subscription Verified!</h3>
                    <p>You now have access to {agent.name}. The modal will close shortly.</p>
                </div>
            )
        }

        return (
            <>
                <div className="subscription-header">
                    <h2>Subscribe to {agent.name}</h2>
                    <p>Unlock full access to chat with this agent for one week.</p>
                </div>
                <div className="subscription-steps">
                    <div className="step">
                        <div className="step-number">1</div>
                        <div className="step-content">
                            <h4>Payment Details</h4>
                            <p>You will be prompted to send <strong>1 Solana USDC</strong> to the creator's wallet.</p>
                            <div className="address-box">
                                <span className="address-text">{agent.creatorWalletAddress}</span>
                                <button onClick={() => handleCopy(agent.creatorWalletAddress)} title="Copy Address"><span className="icon">content_copy</span></button>
                            </div>
                            <p className="token-info">Token: USDC ({USDC_TOKEN_ADDRESS})</p>
                        </div>
                    </div>
                     <div className="step">
                        <div className="step-number">2</div>
                        <div className="step-content">
                            <h4>Confirm</h4>
                            <p>Click the button below to confirm the subscription. Your wallet will prompt you to approve the transaction.</p>
                        </div>
                    </div>
                </div>

                {error && <p className="error-message">{error}</p>}

                <button
                    className="verify-button"
                    onClick={handleConfirm}
                    disabled={status === 'verifying' || !publicKey}
                >
                    {status === 'verifying' ? 'Processing...' : (publicKey ? 'Confirm Subscription' : 'Connect Wallet to Subscribe')}
                </button>
            </>
        )
    }

    return (
        <div className="modal-backdrop subscription-modal" onClick={() => toggleSubscriptionModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleSubscriptionModal(false)}>
                    <span className="icon">close</span>
                </button>
                {renderContent()}
            </div>
        </div>
    );
}