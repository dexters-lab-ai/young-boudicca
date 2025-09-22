/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * @license
 * Copyright 2024-present, Moeru AI, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { loadVRMAnimation } from '../lib/vrm';

/**
 * A hook to load a VRM animation (.vrma) and create a THREE.AnimationClip from it.
 * This hook depends on a pre-loaded VRM model.
 *
 * @param url The URL of the .vrma animation file.
 * @param vrm The VRM model to which the animation will be applied.
 * @returns A THREE.AnimationClip or null if the animation is not yet loaded or fails to load.
 */
export default function useVrmAnimation(url: string, vrm: VRM | null): THREE.AnimationClip | null {
    const [animationClip, setAnimationClip] = useState<THREE.AnimationClip | null>(null);

    useEffect(() => {
        if (!url || !vrm) {
            setAnimationClip(null);
            return;
        }

        let isMounted = true;

        loadVRMAnimation(url, vrm)
            .then((clip: THREE.AnimationClip) => {
                if (isMounted) {
                    setAnimationClip(clip);
                }
            })
            .catch((error: Error) => {
                if (isMounted) {
                    console.error(`Animation load error in useVrmAnimation for URL: ${url}`, error);
                    setAnimationClip(null);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [url, vrm]);

    return animationClip;
}