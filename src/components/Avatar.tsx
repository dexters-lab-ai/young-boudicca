/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import useVrm from '../hooks/useVrm';
import useVrmAnimation from '../hooks/useVrmAnimation';
import useStore from '../lib/store';

function LoadedAvatar({ vrmUrl }: { vrmUrl: string }) {
    const { vrm, loading, error } = useVrm(vrmUrl);
    const idleClip = useVrmAnimation('/animations/idle_loop.vrma', vrm);
    // Use idle2 as a subtle talking body motion overlay (optional)
    const talkingClip = useVrmAnimation('/animations/gesture_talk.vrma', vrm);
    // Gesture clips
    const gestureClips = {
        greeting: useVrmAnimation('/animations/gesture_greeting.vrma', vrm),
        cute: useVrmAnimation('/animations/gesture_cute.vrma', vrm),
        elegant: useVrmAnimation('/animations/gesture_elegant.vrma', vrm),
        pose: useVrmAnimation('/animations/gesture_pose.vrma', vrm),
        peacesign: useVrmAnimation('/animations/gesture_peacesign.vrma', vrm),
        dance: useVrmAnimation('/animations/gesture_dance.vrma', vrm),
        dance_meme: useVrmAnimation('/animations/dance_picatrix.vrma', vrm),
        shoot: useVrmAnimation('/animations/gesture_shoot.vrma', vrm),
        spin: useVrmAnimation('/animations/gesture_spin.vrma', vrm),
        squat: useVrmAnimation('/animations/gesture_squat.vrma', vrm),
        fight: useVrmAnimation('/animations/gesture_fight.vrma', vrm),
        powerful: useVrmAnimation('/animations/gesture_powerful.vrma', vrm),
        pumped: useVrmAnimation('/animations/gesture_ready.vrma', vrm),
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
            mixerRef.current = new THREE.AnimationMixer(vrm.scene);
             // Set up a listener for animation completion
            const onFinished = (_e: any) => {
                // No one-shots active in simplified mode
            };
            mixerRef.current.addEventListener('finished', onFinished);
            return () => {
                mixerRef.current?.removeEventListener('finished', onFinished);
            };
        } else {
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

    }, [idleClip, talkingClip, setActiveAnimation, gestureClips.greeting, gestureClips.cute, gestureClips.elegant, gestureClips.pose, gestureClips.peacesign, gestureClips.dance, gestureClips.shoot, gestureClips.spin, gestureClips.squat]);

    // Play gesture one-shot overlay when store triggers
    useEffect(() => {
        const mixer = mixerRef.current;
        if (!mixer || !currentGesture) return;
        const action = actionsRef.current[currentGesture];
        if (!action) return;
        // stop any running gesture actions
        Object.entries(actionsRef.current).forEach(([name, act]) => {
            if (name !== 'IDLE' && act && act.isRunning()) {
                act.stop();
            }
        });
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.fadeIn(0.15).play();
        // allow it to fade out after finish
        action.getMixer().addEventListener('finished', (_e: any) => {
            action.fadeOut(0.2);
        });
    }, [currentGesture, gestureNonce]);

    // Play talking overlay for ~5 seconds when triggered
    useEffect(() => {
        const mixer = mixerRef.current;
        if (!mixer || !talkingClip) return;
        const action = actionsRef.current['TALKING'];
        if (!action) return;
        // Give talking priority: stop any running gesture
        Object.entries(actionsRef.current).forEach(([name, act]) => {
            if (name !== 'IDLE' && name !== 'TALKING' && act && act.isRunning()) {
                act.stop();
            }
        });
        action.reset();
        action.clampWhenFinished = false;
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.fadeIn(0.15).play();
        const to = window.setTimeout(() => {
            action.fadeOut(0.2);
            // stop after fade to free channel
            window.setTimeout(() => action.stop(), 250);
        }, 5000);
        return () => window.clearTimeout(to);
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

        if (!vrmUrl.toLowerCase().includes('war_boudica')) {
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

    // @ts-ignore
    return vrm ? <primitive object={vrm.scene} /> : null;
}

export default function Avatar({ modelUrl }: { modelUrl: string }) {
    return <LoadedAvatar vrmUrl={modelUrl} />;
}