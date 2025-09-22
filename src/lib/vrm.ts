/**
 * @license
 * Copyright 2024-present, Moeru AI, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

// Create a single, reusable GLTFLoader instance
const loader = new GLTFLoader();

// Register the VRM plugins
loader.register(parser => new VRMLoaderPlugin(parser));
loader.register(parser => new VRMAnimationLoaderPlugin(parser));

const vrmCache = new Map<string, Promise<VRM>>();
const vrmaCache = new Map<string, Promise<THREE.AnimationClip>>();

/**
 * Loads a VRM model from a URL.
 * Utilizes a cache to avoid re-loading the same model.
 * @param url The URL of the .vrm file.
 * @returns A promise that resolves to the loaded VRM object.
 */
export async function loadVRM(url: string): Promise<VRM> {
    if (vrmCache.has(url)) {
        return vrmCache.get(url)!;
    }

    const promise = new Promise<VRM>((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                const vrm = gltf.userData.vrm as VRM;
                if (!vrm) {
                    reject(new Error('Failed to get VRM from GLTF a'));
                    return;
                }
                // VRMUtils.removeUnnecessaryJoints(vrm.scene);
                resolve(vrm);
            },
            undefined,
            (error) => {
                const message = error instanceof Error ? error.message : String(error);
                reject(new Error(`Failed to load VRM from ${url}: ${message}`));
            }
        );
    });

    vrmCache.set(url, promise);
    return promise;
}

/**
 * Loads a VRM animation from a URL and creates an AnimationClip.
 * @param url The URL of the .vrma file.
 * @param vrm The VRM model to associate the animation with.
 * @returns A promise that resolves to a THREE.AnimationClip.
 */
export async function loadVRMAnimation(url: string, vrm: VRM): Promise<THREE.AnimationClip> {
    const cacheKey = `${url}-${vrm.scene.uuid}`;
    if (vrmaCache.has(cacheKey)) {
        return vrmaCache.get(cacheKey)!;
    }

    const promise = new Promise<THREE.AnimationClip>((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                const vrmAnimation = gltf.userData.vrmAnimations?.[0];
                if (!vrmAnimation) {
                    reject(new Error(`No VRM animation found in ${url}`));
                    return;
                }
                const clip = createVRMAnimationClip(vrmAnimation, vrm);
                resolve(clip);
            },
            undefined,
            (error) => {
                if (error instanceof Error) {
                    console.error(`Failed to load VRM animation at ${url}:`, error.message);
                } else {
                    console.error(`Failed to load VRM animation at ${url}:`, error);
                }
                vrmaCache.delete(cacheKey); // Clean up cache on error
                reject(new Error(`Failed to load VRM animation from ${url}`));
            }
        );
    });

    vrmaCache.set(cacheKey, promise);
    return promise;
}
