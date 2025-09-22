/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useCallback } from 'react';
import useStore from '../lib/store';
import { getElizaResponse } from '../lib/eliza';

/**
 * A React hook to manage a text-only AI agent session for Eliza.
 * This hook interacts with a stateful Eliza instance.
 *
 * @returns An object containing the agent's state and methods to interact with the session.
 */
export function useElizaAgent() {
    const [isAssistantTyping, setIsAssistantTyping] = useState(false);
    const addMessage = useStore.use.addMessage();
    const setActiveAnimation = useStore.use.setActiveAnimation();
    const setError = useStore.use.setError();

    const sendMessage = useCallback(async (text: string) => {
        try {
            addMessage(text, 'user');
            
            // Set animation to "talking" to provide visual feedback
            setActiveAnimation('TALKING');
            setIsAssistantTyping(true);
            
            // Get a real response from the stateful Eliza engine
            const response = await getElizaResponse(text);

            // Add the assistant's response
            addMessage(response, 'assistant');

        } catch (error) {
            console.error("Error in Eliza agent:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            setError(`Eliza agent failed: ${errorMessage}`);
            addMessage("I'm sorry, I encountered an internal error. Please try again.", 'assistant');
        } finally {
            // Turn off typing indicator and return to idle animation
            setIsAssistantTyping(false);
            setActiveAnimation('IDLE');
        }
    }, [addMessage, setActiveAnimation, setError]);

    return {
        isAssistantTyping,
        sendMessage,
    };
}