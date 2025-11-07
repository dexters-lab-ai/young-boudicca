import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useWallet } from '@solana/wallet-adapter-react';
import useStore from '../lib/store';

const useSocketManager = () => {
    const { publicKey } = useWallet();
    const addMessage = useStore.use.addMessage();
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        if (publicKey) {
            // Connect to the server
            const socket = io({
                reconnection: true,
                reconnectionAttempts: 5,
            });
            socketRef.current = socket;

            socket.on('connect', () => {
                console.log('[Socket.IO] Connected with id:', socket.id);
                // Authenticate with wallet address
                socket.emit('authenticate', publicKey.toBase58());
            });

            socket.on('disconnect', () => {
                console.log('[Socket.IO] Disconnected');
            });

            socket.on('autonomy:monologue', ({ text, agentName }) => {
                console.log(`[Socket.IO] Received monologue from ${agentName}:`, text);
                addMessage(`*${text}*`, 'assistant');
            });
            
            return () => {
                console.log('[Socket.IO] Disconnecting socket...');
                socket.disconnect();
                socketRef.current = null;
            };
        } else if (socketRef.current) {
            // If wallet disconnects, also disconnect the socket
            console.log('[Socket.IO] Wallet disconnected, disconnecting socket...');
            socketRef.current.disconnect();
            socketRef.current = null;
        }

    }, [publicKey, addMessage]);

    return socketRef.current;
};

export default useSocketManager;