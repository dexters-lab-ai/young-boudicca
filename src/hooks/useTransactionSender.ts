import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import useStore from '../lib/store';

type TransactionStatus = 'idle' | 'sending' | 'confirming' | 'success' | 'error';

export function useTransactionSender() {
    const { connection } = useConnection();
    const { sendTransaction } = useWallet();
    const setError = useStore.use.setError();

    const [status, setStatus] = useState<TransactionStatus>('idle');
    const [signature, setSignature] = useState<string | null>(null);
    const [error, setLocalError] = useState<string | null>(null);

    const send = useCallback(async (serializedTransaction: string) => {
        if (!sendTransaction) {
            const noWalletError = 'Wallet not connected. Please connect your wallet to send a transaction.';
            setLocalError(noWalletError);
            setError(noWalletError);
            setStatus('error');
            return null;
        }

        setStatus('sending');
        setSignature(null);
        setLocalError(null);

        try {
            const buffer = Buffer.from(serializedTransaction, 'base64');
            const transaction = Transaction.from(buffer);

            const txSignature = await sendTransaction(transaction, connection);
            setSignature(txSignature);
            setStatus('confirming');

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            const result = await connection.confirmTransaction({
                blockhash,
                lastValidBlockHeight,
                signature: txSignature,
            }, 'confirmed');

            if (result.value.err) {
                throw new Error(`Transaction confirmation failed: ${JSON.stringify(result.value.err)}`);
            }

            setStatus('success');
            return txSignature;

        } catch (err: any) {
            console.error("Transaction failed:", err);
            const errorMessage = err.message || 'An unknown error occurred while sending the transaction.';
            setLocalError(errorMessage);
            setError(errorMessage);
            setStatus('error');
            return null;
        }
    }, [connection, sendTransaction, setError]);

    const reset = useCallback(() => {
        setStatus('idle');
        setSignature(null);
        setLocalError(null);
    }, []);

    return { status, signature, error, send, reset };
}
