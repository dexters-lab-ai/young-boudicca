/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

export async function synthesizeSpeech(text: string, voiceName: string, apiKey: string): Promise<ArrayBuffer> {
  const response = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'en-US', name: voiceName },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google TTS API error: ${errorData.error.message}`);
  }

  const data = await response.json();
  const audioContent = data.audioContent;
  // Decode base64 audio content
  const byteCharacters = atob(audioContent);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return byteArray.buffer;
}
