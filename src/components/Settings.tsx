import React, { useEffect } from 'react';
import useStore from '../lib/store';
import { toggleSettingsModal, fetchUserCredits, toggleAutonomy } from '../lib/actions';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function SettingsModal() {
    const wallet = useWallet();
    const { publicKey, signMessage } = wallet;
    const userCredits = useStore.use.userCredits();
    const isLoading = useStore.use.isLoadingUserCredits();

    useEffect(() => {
        if (publicKey) {
            fetchUserCredits(publicKey.toBase58());
        }
    }, [publicKey]);

    const handleAutonomyToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const enabled = event.target.checked;
        // Optimistically update the UI
        // FIX: Changed from immer-style mutation to returning a new state object to satisfy TypeScript.
        useStore.setState((state) => ({
            userCredits: state.userCredits
              ? { ...state.userCredits, autonomyEnabled: enabled }
              : state.userCredits,
          }));
        await toggleAutonomy(enabled, { publicKey, signMessage });
    };

    const renderContent = () => {
        if (!publicKey) {
            return (
                <div className="wallet-connect-prompt">
                    <p>Connect your wallet to manage your account.</p>
                    <WalletMultiButton />
                </div>
            );
        }

        if (isLoading) {
            return <div className="spinner" />;
        }

        if (!userCredits) {
            return <p style={{textAlign: 'center'}}>Could not load your account details. Please try again later.</p>;
        }

        const freePromptsRemaining = Math.max(0, 5 - userCredits.freePromptUsage);

        return (
            <>
                <div className="credits-list">
                    <div className="credit-item">
                        <div className="credit-info">
                            <span className="icon">chat</span>
                            <h4>Free Prompts Remaining</h4>
                        </div>
                        <div className="credit-balance">
                            <span>{freePromptsRemaining}</span>
                        </div>
                    </div>
                </div>
                <p style={{textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '1rem 0 0 0'}}>
                    After your free prompts are used, features are unlocked via small, on-demand payments.
                </p>

                <div className="form-section autonomy-section">
                    <h4>Autonomous Behavior</h4>
                     <div className="autonomy-toggle">
                        <p>Enable your agent to think and act on its own, even when you're away.</p>
                        <label className="switch">
                            <input 
                                type="checkbox" 
                                checked={userCredits.autonomyEnabled} 
                                onChange={handleAutonomyToggle} 
                            />
                            <span className="slider round"></span>
                        </label>
                    </div>
                </div>
            </>
        );
    };

    return (
        <div className="modal-backdrop settings-modal" onClick={() => toggleSettingsModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleSettingsModal(false)}>
                    <span className="icon">close</span>
                </button>
                <div className="modal-header">
                    <h2>Account</h2>
                    <p>Manage your free prompt usage and agent settings.</p>
                </div>
                {renderContent()}
            </div>
        </div>
    );
}