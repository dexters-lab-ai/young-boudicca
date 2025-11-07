import React, { useState } from 'react';
import useStore from '../lib/store';
import { togglePaywallModal } from '../lib/actions';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import '../styles/PaywallModal.css';

// Mainnet USDC mint address on Solana
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u63';

export default function PaywallModal() {
    const { publicKey, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const paywallDetails = useStore.use.paywallDetails();
    const [status, setStatus] = useState<'idle' | 'paying' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    const handleConfirmPayment = async () => {
        if (!publicKey || !paywallDetails || !sendTransaction) return;
        setStatus('paying');
        setError(null);

        try {
            const { recipient, amount, currency, network } = paywallDetails;

            if (network.toLowerCase() !== 'solana') {
                throw new Error(`This wallet only supports Solana payments. Network required: ${network}`);
            }
            if (currency.toUpperCase() !== 'USDC') {
                throw new Error(`Unsupported currency: ${currency}. Only USDC is supported.`);
            }

            const usdcMint = new PublicKey(USDC_MINT_ADDRESS);
            // Convert dollar amount to smallest USDC unit (6 decimals)
            const lamports = Math.round(amount * Math.pow(10, 6)); 
            const recipientPk = new PublicKey(recipient);

            const fromAta = await getAssociatedTokenAddress(usdcMint, publicKey);
            const toAta = await getAssociatedTokenAddress(usdcMint, recipientPk);
            
            const toAccount = await connection.getAccountInfo(toAta);
            const transaction = new Transaction();

            // If recipient doesn't have an associated token account, create one for them
            if (!toAccount) {
                transaction.add(
                    createAssociatedTokenAccountInstruction(
                        publicKey, // Payer
                        toAta,
                        recipientPk,
                        usdcMint
                    )
                );
            }
            
            transaction.add(
                createTransferInstruction(
                    fromAta,
                    toAta,
                    publicKey,
                    lamports
                )
            );
            
            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'processed');

            // Retry original request with the signature as proof of payment
            await paywallDetails.originalRequest(signature);
            
            setStatus('success');
            setTimeout(() => {
                togglePaywallModal(false);
            }, 2000);

        } catch (err: any) {
            console.error("Payment failed:", err);
            setStatus('error');
            setError(err.message || 'Payment failed. Please check your wallet and try again.');
        }
    };
    
    if (!paywallDetails) return null;

    const renderContent = () => {
        if (status === 'success') {
            return (
                <div className="paywall-status">
                    <span className="icon success">check_circle</span>
                    <p>Payment successful! Unlocking feature...</p>
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