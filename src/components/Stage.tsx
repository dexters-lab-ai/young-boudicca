/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../lib/store';
import imageData from '../lib/imageData';
import c from 'clsx';
import { setInputSource, setActiveModelUrl, toggleCreateAgentModal, setActiveEnvironment, toggleMusicMuted, toggleBettingModal } from '../lib/actions';
import Avatar from './Avatar';
import Filters from './Filters';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import MemeGenerator from './MemeGenerator';
import AgentSelector from './AgentSelector';

import '../styles/Stage.css';

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

export default function Stage() {
  const activePhotoId = useStore.use.activePhotoId();
  const photos = useStore.use.photos();
  const models = useStore.use.models();
  const activeModelUrl = useStore.use.activeModelUrl();
  const activeModelToast = useStore.use.activeModelToast();
  const activeCustomAgent = useStore.use.activeCustomAgent();
  const environments = useStore.use.environments();
  const activeEnvironmentUrl = useStore.use.activeEnvironmentUrl();
  const activeMusic = useStore.use.activeMusic();
  const isMusicMuted = useStore.use.isMusicMuted();

  const [inputSource, _setInputSource] = useState<'default' | 'upload' | 'webcam' | 'generator'>('default');
  const [videoActive, setVideoActive] = useState(false);
  const [didJustSnap, setDidJustSnap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const modelSwitcherRef = useRef<HTMLDivElement>(null);

  const scrollModels = useCallback((direction: 'left' | 'right') => {
    const container = modelSwitcherRef.current;
    if (!container) return;
    const scrollAmount = direction === 'left' ? -180 : 180;
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.loop = true;
    }
    const audio = audioRef.current;
    
    // Function to fade out and change source
    const fadeOutAndSwitch = (newSrc: string) => {
        let currentVolume = audio.volume;
        if (currentVolume > 0 && !audio.paused) {
            const fadeOutInterval = setInterval(() => {
                currentVolume -= 0.1;
                if (currentVolume <= 0) {
                    clearInterval(fadeOutInterval);
                    audio.pause();
                    if (newSrc) {
                        audio.src = newSrc;
                        fadeIn(audio);
                    } else {
                        audio.src = '';
                    }
                } else {
                    audio.volume = currentVolume;
                }
            }, 50);
        } else {
            if (newSrc) {
                audio.src = newSrc;
                fadeIn(audio);
            } else {
                audio.pause();
                audio.src = '';
            }
        }
    };

    // Function to fade in
    const fadeIn = (el: HTMLAudioElement) => {
        el.volume = 0;
        el.play().catch(e => console.error("Audio playback failed:", e));
        let newVolume = 0;
        const fadeInInterval = setInterval(() => {
            newVolume += 0.05;
            if (newVolume >= 0.5) { // Fade to 50% volume
                clearInterval(fadeInInterval);
                el.volume = 0.5;
            } else {
                el.volume = newVolume;
            }
        }, 50);
    };

    if (activeMusic?.url && audio.src !== activeMusic.url) {
        fadeOutAndSwitch(activeMusic.url);
    } else if (!activeMusic?.url && !audio.paused) {
        fadeOutAndSwitch('');
    }

    // Mute/unmute logic
    audio.muted = isMusicMuted;

  }, [activeMusic, isMusicMuted]);


  const activePhoto = photos.find(p => p.id === activePhotoId);
  const isVideo = activePhoto?.mediaType === 'video';
  const activeImageSrc = !isVideo && activePhotoId ? (
    activePhoto?.isInitial
      ? imageData.inputs[activePhotoId]
      : imageData.outputs[activePhotoId]
  ) : null;
  const activeVideoMeta = isVideo && activePhotoId ? imageData.videos[activePhotoId] : undefined;
  const activeVideoTask = isVideo && activePhotoId ? imageData.tasks[activePhotoId] : undefined;
  const activeVideoUrl = activeVideoMeta?.url ?? null;

  const startVideo = async () => {
    if (videoRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1080 }, height: { ideal: 1080 }, facingMode: 'user' },
          audio: false,
        });
        videoRef.current.srcObject = stream;
        setVideoActive(true);
        const { width, height } = stream.getVideoTracks()[0].getSettings();
        const size = Math.min(width || 1080, height || 1080);
        canvas.width = size;
        canvas.height = size;
      } catch (err) {
        console.error("Error accessing webcam:", err);
        setVideoActive(false);
        // Switch back to default if webcam fails
        _setInputSource('default');
        setInputSource('default');
      }
    }
  };

  const stopVideo = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setVideoActive(false);
    }
  }

  const setSource = (source: 'default' | 'upload' | 'webcam' | 'generator') => {
    stopVideo();
    if (source === 'webcam') {
        startVideo();
    } else if (source === 'default') {
        setInputSource('default');
    } else if (source === 'upload') {
        uploadInputRef.current?.click();
    }
     _setInputSource(source);
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setInputSource('upload', e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
     event.target.value = ''; // Reset input
  };
  
  const takePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const { videoWidth, videoHeight } = video;
    const squareSize = canvas.width;
    const sourceSize = Math.min(videoWidth, videoHeight);
    const sourceX = (videoWidth - sourceSize) / 2;
    const sourceY = (videoHeight - sourceSize) / 2;

    if (ctx) {
        ctx.clearRect(0, 0, squareSize, squareSize);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, -squareSize, 0, squareSize, squareSize);
        setInputSource('webcam', canvas.toDataURL('image/jpeg'));
    }
    setDidJustSnap(true);
    setTimeout(() => setDidJustSnap(false), 1000);
  };
  
  // Cleanup video on component unmount
  useEffect(() => stopVideo, []);

  return (
    <div className="stage">
      <div className="media-container" style={{ backgroundImage: `url(${activeEnvironmentUrl})` }}>
        {activeModelToast && <div className="model-info-toast">{activeModelToast} selected</div>}
        {didJustSnap && <div className="flash" />}

        {activePhoto?.isBusy && <div className="media-overlay shimmer">Processing...</div>}

        {inputSource === 'generator' && <MemeGenerator onClose={() => setSource('default')} />}

        {inputSource === 'webcam' && videoActive && (
          <>
            <video ref={videoRef} muted autoPlay playsInline disablePictureInPicture />
            <button className="shutter" onClick={takePhoto}><span className="icon">camera</span></button>
          </>
        )}
        
        {inputSource !== 'webcam' && inputSource !== 'generator' && activePhotoId === 'default-image' && activeModelUrl && (
            <div className="default-image">
                <Suspense fallback={<div className="media-overlay">Loading 3D Model...</div>}>
                    <Canvas
                      camera={{ fov: 30 }}
                      onCreated={({ gl }) => {
                        // Set desired output color space without relying on Canvas gl typing
                        (gl as any).outputColorSpace = THREE.SRGBColorSpace;
                        // Transparent background for canvas
                        (gl as any).setClearColor(0x000000, 0);
                      }}
                    >
                        {/* @ts-ignore */}
                        <directionalLight position={[1, 1, 1]} intensity={1.5} />
                        {/* @ts-ignore */}
                        <ambientLight intensity={0.5} />
                        <OrbitControls enablePan={false} enableZoom={true} enableRotate={true} />
                        <Avatar modelUrl={activeModelUrl} />
                    </Canvas>
                </Suspense>
                 <div className="environment-switcher">
                    {environments.map(env => (
                        <button 
                          key={env.name} 
                          onClick={() => setActiveEnvironment(env)} 
                          title={env.name}
                          className={c({ active: env.url === activeEnvironmentUrl })}
                        >
                            {env.icon}
                        </button>
                    ))}
                    <button 
                        onClick={() => toggleMusicMuted()} 
                        title={isMusicMuted ? 'Unmute Music' : 'Mute Music'} 
                        className="control-button"
                    >
                        <span className="icon">{isMusicMuted ? 'volume_off' : 'volume_up'}</span>
                    </button>
                </div>
            </div>
        )}

        {inputSource !== 'webcam' && inputSource !== 'generator' && activePhotoId !== 'default-image' && (
          isVideo ? (
            <div className="video-player">
              {activeVideoUrl ? (
                <>
                  <video
                    key={activeVideoUrl}
                    controls
                    loop
                    poster={activeVideoMeta?.thumbnail}
                    src={activeVideoUrl}
                  />
                  <a
                    className="video-download"
                    href={activeVideoUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="icon">download</span>
                    Download
                  </a>
                </>
              ) : (
                <div className="video-placeholder">
                  <div className="spinner" />
                  <p>{activeVideoTask?.error ?? 'Rendering video…'}</p>
                </div>
              )}
            </div>
          ) : (
            activeImageSrc && <img src={activeImageSrc} alt="Generated art" />
          )
        )}

        {inputSource === 'upload' && !activeImageSrc && !isVideo && (
           <div className="media-overlay">Select an image</div>
        )}
      </div>

      <div className="model-switcher">
        <button
          className="model-nav-button"
          type="button"
          aria-label="Scroll models left"
          onClick={() => scrollModels('left')}
        >
          <span className="icon">chevron_left</span>
        </button>
        <div className="model-scroll" ref={modelSwitcherRef}>
          {models.map(model => (
            <button
              key={model.name}
              className={c("model-button", { active: model.url === activeModelUrl && !activeCustomAgent })}
              onClick={() => {
                setActiveModelUrl(model);
              }}
            >
              {model.name}
            </button>
          ))}
          <AgentSelector />
        </div>
        <button
          className="model-nav-button"
          type="button"
          aria-label="Scroll models right"
          onClick={() => scrollModels('right')}
        >
          <span className="icon">chevron_right</span>
        </button>
      </div>

      <div className="input-controls">
        <button className="control-button" onClick={() => toggleCreateAgentModal(true)} title="Create a new AI Agent">
          <span className="icon">add_circle</span>
        </button>
        <button className="control-button" onClick={() => toggleBettingModal(true)} title="Monaco Protocol">
          <span className="icon">paid</span>
        </button>
        <button className={c("control-button", { active: inputSource === 'generator' })} onClick={() => setSource('generator')} title="Meme Generator">
          <span className="icon">auto_awesome</span>
        </button>
        <button className={c("control-button", { active: inputSource === 'upload' })} onClick={() => setSource('upload')} title="Upload Image">
          <span className="icon">upload</span>
        </button>
        <input type="file" ref={uploadInputRef} onChange={handleFileUpload} accept="image/*" style={{ display: 'none' }} />
        <button className={c("control-button", { active: inputSource === 'webcam' })} onClick={() => setSource('webcam')} title="Use Webcam">
          <span className="icon">photo_camera</span>
        </button>
        <button className={c("control-button", { active: showFilters })} onClick={() => setShowFilters(v => !v)} title={showFilters ? "Hide Filters" : "Show Filters"}>
          <span className="icon">switch_access_shortcut_add</span>
        </button>
      </div>

      {showFilters && <Filters />}
    </div>
  );
}