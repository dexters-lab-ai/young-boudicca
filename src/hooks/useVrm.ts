/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { useState, useEffect } from 'react';
import { VRM } from '@pixiv/three-vrm';
import { loadVRM } from '../lib/vrm';

/**
 * A hook to load a VRM model from a URL.
 * Manages the loading state and caches the result.
 * @param url The URL of the .vrm file.
 * @returns An object containing the loaded VRM, a loading state boolean, and any error that occurred.
 */
export default function useVrm(url: string) {
    const [vrm, setVrm] = useState<VRM | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<any>(null);

    useEffect(() => {
        if (!url) {
            setLoading(false);
            return;
        }

        let isMounted = true;
        setLoading(true);

        loadVRM(url)
            .then(loadedVrm => {
                if (isMounted) {
                    setVrm(loadedVrm);
                }
            })
            .catch(err => {
                if (isMounted) {
                    console.error(`VRM load error in useVrm for URL: ${url}`, err);
                    setError(err);
                }
            })
            .finally(() => {
                if (isMounted) {
                    setLoading(false);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [url]);

    return { vrm, loading, error };
}