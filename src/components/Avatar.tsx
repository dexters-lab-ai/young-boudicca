/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as React from 'react';
import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import useVrm from '../hooks/useVrm';
import useVrmAnimation from '../hooks/useVrmAnimation';
import useStore from '../lib/store';
function LoadedAvatar({ vrmUrl }: { vrmUrl: string }) {
    const { vrm, loading, error } = useVrm(vrmUrl);
    const activeCustomAgent = useStore.use.activeCustomAgent();

    const animationUrls = useMemo(() => {
        const defaults = {
            greeting: '/animations/gesture_greeting.vrma',
            cute: '/animations/gesture_cute.vrma',
            elegant: '/animations/gesture_elegant.vrma',
            pose: '/animations/gesture_pose.vrma',
            peacesign: '/animations/gesture_peacesign.vrma',
            dance: '/animations/gesture_dance.vrma',
            dance_meme: '/animations/dance_picatrix.vrma',
            shoot: '/animations/gesture_shoot.vrma',
            spin: '/animations/gesture_spin.vrma',
            squat: '/animations/gesture_squat.vrma',
            fight: '/animations/gesture_fight.vrma',
            powerful: '/animations/gesture_powerful.vrma',
            pumped: '/animations/gesture_ready.vrma',
        };

        if (activeCustomAgent) {
            return {
                ...defaults,
                greeting: activeCustomAgent.animationGreetingUrl || defaults.greeting,
                dance: activeCustomAgent.animationDanceUrl || defaults.dance,
                spin: activeCustomAgent.animationSpinUrl || defaults.spin,
                pose: activeCustomAgent.animationPoseUrl || defaults.pose,
                pumped: activeCustomAgent.animationPumpedUrl || defaults.pumped,
            };
        }

        return defaults;
    }, [activeCustomAgent]);

    const idleClip = useVrmAnimation('/animations/idle_loop.vrma', vrm);
    const talkingClip = useVrmAnimation('/animations/gesture_talk.vrma', vrm);
    
    // Gesture clips
    const gestureClips = {
        greeting: useVrmAnimation(animationUrls.greeting, vrm),
        cute: useVrmAnimation(animationUrls.cute, vrm),
        elegant: useVrmAnimation(animationUrls.elegant, vrm),
        pose: useVrmAnimation(animationUrls.pose, vrm),
        peacesign: useVrmAnimation(animationUrls.peacesign, vrm),
        dance: useVrmAnimation(animationUrls.dance, vrm),
        dance_meme: useVrmAnimation(animationUrls.dance_meme, vrm),
        shoot: useVrmAnimation(animationUrls.shoot, vrm),
        spin: useVrmAnimation(animationUrls.spin, vrm),
        squat: useVrmAnimation(animationUrls.squat, vrm),
        fight: useVrmAnimation(animationUrls.fight, vrm),
        powerful: useVrmAnimation(animationUrls.powerful, vrm),
        pumped: useVrmAnimation(animationUrls.pumped, vrm),
    } as const;

    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const actionsRef = useRef<{ [key: string]: THREE.AnimationAction | null }>({});
    
    const activeExpression = useStore.use.activeExpression();
    const currentGesture = useStore.use.currentGesture();
    const gestureNonce = useStore.use.gestureNonce();
    const talkingNonce = useStore.use.talkingNonce();
    const setActiveAnimation = useStore.use.setActiveAnimation();


    // No initial gesture; remain in IDLE until speech

    // Initialize mixer
    useEffect(() => {
        if (vrm) {
            console.log('[Mixer] Initializing new animation mixer');
            mixerRef.current = new THREE.AnimationMixer(vrm.scene);
             // Set up a listener for animation completion
            const onFinished = (e: any) => {
                console.log('[Mixer] Animation finished event in root listener', e);
                // Log the current state of all actions
                const actionsState = Object.entries(actionsRef.current).map(([name, act]) => {
                    if (!act) return { name, isRunning: false, isScheduled: false };
                    const clip = act.getClip();
                    return {
                        name,
                        isRunning: act.isRunning(),
                        isScheduled: act.isScheduled(),
                        time: act.time,
                        duration: clip?.duration,
                        loop: act.loop
                    };
                });
                console.log('[Mixer] Current actions state:', actionsState);
            };
            
            mixerRef.current.addEventListener('finished', onFinished);
            
            // Add a periodic check of animation states
            const interval = setInterval(() => {
                if (mixerRef.current) {
                    const runningActions = Object.entries(actionsRef.current)
                        .filter(([_, act]) => act?.isRunning())
                        .map(([name, act]) => ({
                            name,
                            time: act?.time,
                            duration: act?.getClip()?.duration,
                            weight: act?.getEffectiveWeight()
                        }));
                    if (runningActions.length > 0) {
                        console.log('[Mixer] Currently running actions:', runningActions);
                    }
                }
            }, 1000);
            
            return () => {
                console.log('[Mixer] Cleaning up mixer');
                clearInterval(interval);
                if (mixerRef.current) {
                    mixerRef.current.removeEventListener('finished', onFinished);
                    // Stop all actions before cleanup
                    Object.values(actionsRef.current).forEach(action => {
                        if (action?.isRunning()) {
                            console.log(`[Mixer] Stopping action during cleanup`);
                            action.stop();
                        }
                    });
                }
            };
        } else {
            console.log('[Mixer] No VRM model, setting mixer to null');
            mixerRef.current = null;
        }
    }, [vrm, setActiveAnimation]);


    // Setup animation actions (IDLE only)
    useEffect(() => {
        const mixer = mixerRef.current;
        const clips: Record<string, THREE.AnimationClip | null | undefined> = { IDLE: idleClip, TALKING: talkingClip };
        // register gesture clips
        Object.entries(gestureClips).forEach(([k, clip]) => (clips[k] = clip));
        if (!mixer || !idleClip) return;

        // Clear previous actions
        Object.values(actionsRef.current).forEach(action => action && mixer.stopAllAction());
        actionsRef.current = {};

        // Create new actions
        Object.entries(clips).forEach(([name, clip]) => {
            if (clip) {
                actionsRef.current[name] = mixer.clipAction(clip);
            }
        });

        // Start with idle animation
        actionsRef.current.IDLE?.setLoop(THREE.LoopRepeat, Infinity).play();
        setActiveAnimation('IDLE');

    }, [idleClip, talkingClip, setActiveAnimation, gestureClips]);

    // Play gesture one-shot overlay when store triggers
    useEffect(() => {
        // Skip if no gesture or no mixer
        const mixer = mixerRef.current;
        if (!mixer || !currentGesture) {
            return;
        }
        
        console.log('[Gesture] Effect triggered with gesture:', currentGesture, 'nonce:', gestureNonce);
        
        const action = actionsRef.current[currentGesture];
        if (!action) {
            console.log(`[Gesture] No action found for gesture: ${currentGesture}`);
            return;
        }

        // Get clip duration
        const clip = action.getClip();
        const clipDuration = (clip?.duration || 0) * 1000; // Convert to ms
        console.log(`[Gesture] ${currentGesture} clip duration: ${clipDuration}ms (${clip?.duration}s)`);

        // Get current state
        const store = useStore.getState();
        
        // Calculate durations - use full duration for all gestures
        const minDuration = clipDuration * 0.9;  // Must play at least 90% of the clip
        const maxDuration = clipDuration * 1.1;  // Will clean up after 110% of clip duration
        
        // Track animation state
        let isCleanedUp = false;
        let hasCompleted = false;
        // FIX: Use ReturnType<typeof setTimeout> for browser compatibility instead of NodeJS.Timeout.
        let timeout: ReturnType<typeof setTimeout>;
        
        const cleanupGesture = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;
            
            // Remove all listeners first to prevent race conditions
            const mixer = action.getMixer();
            if (mixer) {
                mixer.removeEventListener('finished', onFinished);
            }
            
            // Fade out and stop the action
            if (action.isRunning()) {
                action.fadeOut(0.2);
                setTimeout(() => {
                    if (action.isRunning()) {
                        action.stop();
                    }
                }, 200);
            }
            
            // Clear timeout
            if (timeout) {
                clearTimeout(timeout);
            }
            
            console.log(`[Gesture] Cleanup complete for: ${currentGesture}`);
        };
        
        const onFinished = (e: any) => {
            // Ignore if we've already cleaned up or this isn't our action
            if (isCleanedUp || hasCompleted || e.action !== action) {
                return;
            }
            
            const elapsed = Date.now() - gestureStartTime;
            console.log(`[Gesture] ${currentGesture} finished after ${elapsed}ms`);
            
            if (elapsed >= minDuration) {
                console.log(`[Gesture] ${currentGesture} finished naturally`);
                hasCompleted = true;
                store.setGesturePlaying(false);
                cleanupGesture();
            } else {
                // If finished too quickly, restart it
                console.log(`[Gesture] ${currentGesture} finished too quickly, restarting`);
                action.reset().play();
            }
        };
        
        // Configure the animation
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1.0);
        action.setEffectiveTimeScale(1.0);
        
        // Add finished listener before starting
        const actionMixer = action.getMixer();
        if (!actionMixer) {
            console.error('[Gesture] No mixer available for action');
            return;
        }
        
        // Stop any currently running animations that might interfere
        Object.entries(actionsRef.current).forEach(([name, act]) => {
            if (!act || !act.isRunning() || name === currentGesture) return;
            
            console.log(`[Gesture] Stopping potentially conflicting animation: ${name}`);
            // Immediately stop the action without fade for TALKING animation
            if (name === 'TALKING') {
                act.stop();
            } else {
                act.fadeOut(0.1);
                setTimeout(() => {
                    if (act?.isRunning()) act.stop();
                }, 100);
            }
        });
        
        // Set the gesture as playing in the store
        store.setGesturePlaying(true);
        
        // Start the animation
        action.play();
        console.log(`[Gesture] Started playing: ${currentGesture}`);
        
        // Add the finished listener AFTER starting the animation
        actionMixer.addEventListener('finished', onFinished);
        const gestureStartTime = Date.now();
        
        // Set a safety timeout to ensure cleanup
        timeout = setTimeout(() => {
            if (!isCleanedUp) {
                console.log(`[Gesture] Safety timeout reached for: ${currentGesture}`);
                store.setGesturePlaying(false);
                cleanupGesture();
            }
        }, maxDuration + 2000);
        
        // Cleanup function for the effect
        return () => {
            console.log(`[Gesture] Effect cleanup for gesture: ${currentGesture}`);
            cleanupGesture();
        };
    }, [currentGesture, gestureNonce]);

    // Play talking overlay for ~5 seconds when triggered, but NEVER during gestures
    useEffect(() => {
        console.log('[Talking] Talking effect triggered, nonce:', talkingNonce);
        
        // Get current store state
        const store = useStore.getState();
        
        // Check global gesture active flag first (fast path)
        if (store.isGestureActive) {
            console.log('[Talking] Gesture is active (global flag), skipping talking animation');
            return;
        }
        
        // Double-check by looking at actual running animations
        const isAnyGestureRunning = Object.entries(actionsRef.current).some(
            ([name, act]) => name !== 'IDLE' && name !== 'TALKING' && act?.isRunning()
        );
            
        if (isAnyGestureRunning) {
            console.log('[Talking] Gesture animation detected, skipping talking animation');
            // Update global flag if we detect a running gesture
            store.setGesturePlaying(true);
            return;
        }
        
        const mixer = mixerRef.current;
        if (!mixer) {
            console.log('[Talking] No mixer available');
            return;
        }
        
        if (!talkingClip) {
            console.log('[Talking] No talking clip available');
            return;
        }
        
        const action = actionsRef.current['TALKING'];
        if (!action) {
            console.log('[Talking] No talking action found');
            return;
        }
        
        // Don't start if already talking
        if (action.isRunning()) {
            console.log('[Talking] Already talking, skipping');
            return;
        }
        
        // Double-check for gestures right before starting
        if (useStore.getState().isGesturePlaying) {
            console.log('[Talking] Gesture started while waiting to talk, aborting');
            return;
        }
        
        console.log('[Talking] Starting talking animation');
        
        // Configure the talking animation
        action.reset();
        action.clampWhenFinished = false;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.setEffectiveWeight(0.5); // Lower weight than gestures
        action.fadeIn(0.15).play();
        
        // Set up cleanup
        let isCleanedUp = false;
        const cleanupTalking = () => {
            if (isCleanedUp) return;
            isCleanedUp = true;
            
            if (action.isRunning()) {
                action.fadeOut(0.2);
                setTimeout(() => {
                    if (action.isRunning()) {
                        action.stop();
                    }
                }, 200);
            }
            
            clearTimeout(timeout);
            console.log('[Talking] Cleanup complete');
        };
        
        // Stop after 5 seconds
        const timeout = setTimeout(() => {
            console.log('[Talking] Timeout reached, stopping talking animation');
            cleanupTalking();
        }, 5000);
        
        // Check for gestures periodically
        const gestureCheck = setInterval(() => {
            if (useStore.getState().isGesturePlaying) {
                console.log('[Talking] Gesture detected, stopping talking animation');
                cleanupTalking();
            }
        }, 100);
        
        return () => {
            console.log('[Talking] Cleaning up talking animation');
            clearInterval(gestureCheck);
            cleanupTalking();
        };
    }, [talkingNonce, talkingClip]);

    // Remove animation switching; always keep idle playing. Lipsync handles speech.

    // No gesture on speak in simplified mode

    const { camera } = useThree();

    // Setup camera on initial load; orient all models to face the camera (yaw-only)
    useEffect(() => {
        if (!vrm) return;

        const box = new THREE.Box3().setFromObject(vrm.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        vrm.scene.position.sub(center);

        vrm.scene.lookAt(camera.position);
        const yaw = vrm.scene.rotation.y;
        vrm.scene.rotation.set(0, yaw, 0);

        if (!vrmUrl.toLowerCase().endsWith('frankenstein.vrm')) {
            vrm.scene.rotation.y += Math.PI;
        }

        const modelHeight = size.y;
        if (camera instanceof THREE.PerspectiveCamera) {
            const distance = (modelHeight / 2) / Math.tan(camera.fov * (Math.PI / 180) / 2);
            camera.position.set(0, 0.05, distance * 1.1);
        }
        
        camera.updateProjectionMatrix();

        if (vrm.expressionManager) {
            console.log('Available Expressions:', Object.keys(vrm.expressionManager.expressionMap));
        }

    }, [vrm, camera, vrmUrl]);

    // Remove gesture-based facial expressions in simplified mode

    // Remove chat-driven expressions/gestures in simplified mode

    // Remove periodic idle nudges in simplified mode

    // Lipsync driven by animation state
    const mouthTRef = useRef(0);
    // Expression blending state
    const exprTargetRef = useRef<Record<string, number>>({});
    const baseExprs = ['joy','angry','sorrow','surprised'];

    useEffect(() => {
        // Map chat expression -> VRM expression targets
        const targets: Record<string, number> = { joy: 0, angry: 0, sorrow: 0, surprised: 0 };
        switch (activeExpression) {
            case 'happy':
                targets.joy = 0.7; break;
            case 'angry':
                targets.angry = 0.7; break;
            case 'sad':
                targets.sorrow = 0.7; break;
            case 'surprised':
                targets.surprised = 0.7; break;
            default:
                // neutral
                break;
        }
        exprTargetRef.current = targets;
    }, [activeExpression]);

    useFrame((_, delta) => {
        mixerRef.current?.update(delta);
        vrm?.update(delta);

        const { activeAnimation, isTextStreaming } = useStore.getState();
        const isSpeaking = activeAnimation === 'TALKING' || isTextStreaming;
        
        if (vrm?.expressionManager) {
            // Support alternative viseme sets and a mouthOpen fallback
            const candidateVisemes = ['aa','ih','ee','oh','ou','A','I','U','E','O'];
            const names = Object.keys(vrm.expressionManager.expressionMap);
            const visemes = candidateVisemes.filter(v => names.includes(v));
            const hasMouthOpen = names.includes('mouthOpen');

            if (isSpeaking) {
                mouthTRef.current += delta;
                const osc = (Math.sin(mouthTRef.current * 8) + 1) / 2; // 8 Hz
                const intensity = 0.25 + 0.6 * osc; // a bit stronger for visibility
                if (visemes.length > 0) {
                    const idx = Math.floor((mouthTRef.current * 1000) / 180) % visemes.length;
                    const currentViseme = visemes[idx];
                    for (const v of visemes) {
                        const target = v === currentViseme ? intensity : 0;
                        const currentVal = vrm.expressionManager.getValue(v) || 0;
                        vrm.expressionManager.setValue(v, THREE.MathUtils.lerp(currentVal, target, 0.35));
                    }
                } else if (hasMouthOpen) {
                    const currentVal = vrm.expressionManager.getValue('mouthOpen') || 0;
                    vrm.expressionManager.setValue('mouthOpen', THREE.MathUtils.lerp(currentVal, intensity, 0.35));
                }
            } else {
                 // Reset visemes when not talking
                for (const v of visemes) {
                    const currentVal = vrm.expressionManager.getValue(v) || 0;
                    if (currentVal > 0) {
                        vrm.expressionManager.setValue(v, THREE.MathUtils.lerp(currentVal, 0, 0.1));
                    }
                }
                if (hasMouthOpen) {
                    const mv = vrm.expressionManager.getValue('mouthOpen') || 0;
                    if (mv > 0) {
                        vrm.expressionManager.setValue('mouthOpen', THREE.MathUtils.lerp(mv, 0, 0.1));
                    }
                }
            }

            // Blend chat-based expressions smoothly
            for (const key of baseExprs) {
                if (names.includes(key)) {
                    const current = vrm.expressionManager.getValue(key) || 0;
                    const target = exprTargetRef.current[key] ?? 0;
                    // faster blend-in, slower decay
                    const t = target > current ? 0.25 : 0.12;
                    vrm.expressionManager.setValue(key, THREE.MathUtils.lerp(current, target, t));
                }
            }
        }
    });

    if (loading) return null;
    if (error) {
        console.error(`Failed to load VRM: ${error}`);
        return null;
    }

        // @ts-ignore - vrm.scene is valid but TypeScript doesn't know about it
    return vrm ? <primitive object={vrm.scene} /> : null;
}

const Avatar: React.FC<{ modelUrl: string }> = ({ modelUrl }) => {
    return <LoadedAvatar vrmUrl={modelUrl} />;
};

export default Avatar;