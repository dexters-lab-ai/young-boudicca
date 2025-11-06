import React, { useEffect } from 'react';
import useStore from '../lib/store';
import { toggleSettingsModal, fetchUserCredits, togglePaywallModal } from '../lib/actions';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PaywallDetails } from '../types';

export default function SettingsModal() {
    const { publicKey } = useWallet();
    const userCredits = useStore.use.userCredits();
    const isLoading = useStore.use.isLoadingUserCredits();

    useEffect(() => {
        if (publicKey) {
            fetchUserCredits(publicKey.toBase58());
        }
    }, [publicKey]);

    const handleBuyCredits = (type: PaywallDetails['type']) => {
        if (!publicKey) return;

        let details: PaywallDetails | undefined;
        const recipient = process.env.MERCHANT_WALLET_ADDRESS;
        if (!recipient) {
            useStore.getState().setError("The creator has not set up a payment wallet.");
            return;
        }

        const commonRequest = async () => {
            if (publicKey) {
                await fetchUserCredits(publicKey.toBase58());
            }
        };

        if (type === 'chat_credits') {
            details = {
                type: 'chat_credits',
                amount: 1,
                currency: 'USDC',
                network: 'Solana',
                itemDescription: '50 Chat Credits',
                quantity: 50,
                recipient,
                originalRequest: commonRequest,
            };
        } else if (type === 'sora_credits') {
             details = {
                type: 'sora_credits',
                amount: 1,
                currency: 'USDC',
                network: 'Solana',
                itemDescription: '3 Sora Videos',
                quantity: 3,
                recipient,
                originalRequest: commonRequest,
            };
        } else if (type === 'image_credits') {
             details = {
                type: 'image_credits',
                amount: 1,
                currency: 'USDC',
                network: 'Solana',
                itemDescription: '10 Image Generations',
                quantity: 10,
                recipient,
                originalRequest: commonRequest,
            };
        }

        if (details) {
            togglePaywallModal(true, details);
        }
    };

    const renderContent = () => {
        if (!publicKey) {
            return (
                <div className="wallet-connect-prompt">
                    <p>Connect your wallet to manage your account and credits.</p>
                    <WalletMultiButton />
                </div>
            );
        }

        if (isLoading) {
            return <div className="spinner" />;
        }

        if (!userCredits) {
            return <p style={{textAlign: 'center'}}>Could not load your credit balance. Please try again later.</p>;
        }

        return (
            <div className="credits-list">
                <div className="credit-item">
                    <div className="credit-info">
                        <span className="icon">chat</span>
                        <h4>Chat Credits</h4>
                    </div>
                    <div className="credit-balance">
                        <span>{userCredits.paidPromptCredits}</span>
                        <button onClick={() => handleBuyCredits('chat_credits')}>Buy More</button>
                    </div>
                </div>
                <div className="credit-item">
                    <div className="credit-info">
                        <span className="icon">movie</span>
                        <h4>Sora Generations</h4>
                    </div>
                    <div className="credit-balance">
                        <span>{userCredits.soraCredits}</span>
                        <button onClick={() => handleBuyCredits('sora_credits')}>Buy More</button>
                    </div>
                </div>
                <div className="credit-item">
                    <div className="credit-info">
                        <span className="icon">image</span>
                        <h4>Image Generations</h4>
                    </div>
                    <div className="credit-balance">
                        <span>{userCredits.imageCredits}</span>
                        <button onClick={() => handleBuyCredits('image_credits')}>Buy More</button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="modal-backdrop settings-modal" onClick={() => toggleSettingsModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button className="close-button" onClick={() => toggleSettingsModal(false)}>
                    <span className="icon">close</span>
                </button>
                <div className="modal-header">
                    <h2>Account & Credits</h2>
                    <p>Track your balances and purchase more credits to use with our default AI agents.</p>
                </div>
                {renderContent()}
            </div>
        </div>
    );
}