import React, { useEffect, useState } from 'react';
import useStore from '../lib/store';
import '../styles/VoiceControls.css';

const VoiceSelector: React.FC = () => {
  const { kokoroVoices, setKokoroVoices, preferredVoiceName, setPreferredVoiceName } = useStore();
  const cleanVoice = (s: string) => s.replace(/^\s*\d+\.\s*/, '').trim();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVoices = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/tts-voices');
        if (!response.ok) {
          throw new Error(`Failed to fetch voices: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.error) {
          throw new Error(data.error);
        }
        // Normalize server payload to {value,label}[]
        const normalized: { value: string; label: string }[] = Array.isArray(data.voices)
          ? data.voices.map((v: any) => {
              if (v && typeof v === 'object' && 'value' in v && 'label' in v) return v as { value: string; label: string };
              const label = String(v);
              return { value: cleanVoice(label), label };
            })
          : [];
        setKokoroVoices(normalized);

        // Normalize any persisted preference and ensure we have a valid default
        const cleanedList: string[] = normalized.map(v => v.value).filter(Boolean);
        if (cleanedList.length > 0) {
          const normalizedPref = preferredVoiceName ? cleanVoice(preferredVoiceName) : '';
          if (!normalizedPref || !cleanedList.includes(normalizedPref)) {
            setPreferredVoiceName(cleanedList[0]);
          } else if (normalizedPref !== preferredVoiceName) {
            // Persist the cleaned form if different
            setPreferredVoiceName(normalizedPref);
          }
        }
      } catch (error: any) {
        console.error("Failed to fetch Kokoro TTS voices:", error);
        setError("Error loading voices");
      } finally {
        setIsLoading(false);
      }
    };

    fetchVoices();
    // We intentionally include preferredVoiceName so we can normalize it after fetch
  }, [setKokoroVoices, preferredVoiceName, setPreferredVoiceName]);

  const handleVoiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    // Store the cleaned voice id
    setPreferredVoiceName(event.target.value);
  };

  if (error) {
    return (
      <select className="voice-selector" disabled title={error}>
        <option>{error}</option>
      </select>
    );
  }

  if (isLoading) {
    return (
      <select className="voice-selector" disabled>
        <option>Loading Voices...</option>
      </select>
    );
  }

  return (
    <div className="relative">
      <select
        value={preferredVoiceName || ''}
        onChange={handleVoiceChange}
        className="voice-selector"
        title="Select a TTS voice"
      >
        <option value="">Default Voice</option>
        {kokoroVoices.map((v: { value: string; label: string }) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default VoiceSelector;