import { useState, useEffect } from 'react';

class ErrorService extends EventTarget {
    /**
     * Dispatches a global 'sentinel-error' event.
     * @param message The error message string to be sent with the event.
     */
    dispatchError(message: string) {
        this.dispatchEvent(new CustomEvent('sentinel-error', { detail: message }));
    }
}

// Export a singleton instance so the entire application shares the same event bus.
export const errorService = new ErrorService();

export function useErrorService() {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handleError = (event: Event) => {
            const customEvent = event as CustomEvent<string>;
            setError(customEvent.detail);
        };

        errorService.addEventListener('sentinel-error', handleError);

        return () => {
            errorService.removeEventListener('sentinel-error', handleError);
        };
    }, []);

    const clearError = () => {
        setError(null);
    };

    return { error, clearError };
}
