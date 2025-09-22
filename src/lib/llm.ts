/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import limit from 'p-limit'
import useStore from './store'
import { GoogleGenAI, Modality } from '@google/genai';

const limitFunction = limit(2)

const timeoutMs = 123_333
const maxRetries = 5
const baseDelay = 1_233

interface ImageLlmRequest {
  model: string;
  prompt: string;
  inputFile: string;
}

function isDataUrl(dataUrl: string) {
    return /^data:.+;base64,/.test(dataUrl);
}

function dataUrlToInlineData(dataUrl: string) {
    const parts = dataUrl.split(',');
    const mimeType = parts[0].match(/:(.*?);/)?.[1];
    if (!mimeType) throw new Error('Invalid data URL: mime type not found');
    const base64Data = parts[1];
    return { inlineData: { mimeType, data: base64Data } } as const;
}

function getAi() {
    const apiKey = useStore.getState().apiKey;
    if (!apiKey) throw new Error('Missing API key');
    return new GoogleGenAI({ apiKey });
}

export async function generateImage({ model, prompt, inputFile }: ImageLlmRequest): Promise<string | null> {
    return limitFunction(async () => {
        let retries = 0;
        let hitQuota = false;
        while (retries < maxRetries) {
            try {
                if (!isDataUrl(inputFile)) {
                    console.warn('Invalid inputFile data URL');
                    return null;
                }
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), timeoutMs);

                const ai = getAi();
                const imagePart = dataUrlToInlineData(inputFile);
                const textPart = { text: prompt };
                const result = await ai.models.generateContent({
                    model,
                    contents: { parts: [imagePart, textPart] },
                    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
                });

                clearTimeout(timeout);
                const parts = (result.candidates?.[0]?.content?.parts ?? []) as any[];
                for (const part of parts) {
                    if (part.inlineData) {
                        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    }
                }
                return null;

            } catch (err: any) {
                console.error('Error generating image:', err);
                if (String(err?.message || '').includes('429') || String(err?.message || '').includes('RESOURCE_EXHAUSTED') || String(err?.message || '').includes('Quota')) {
                    hitQuota = true;
                    const delay = baseDelay * Math.pow(2, retries);
                    console.log(`Rate limited. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000));
                    retries++;
                } else {
                    return null;
                }
            }
        }
        if (hitQuota) {
            throw new Error('QUOTA');
        }
        console.error('Image generation failed after max retries.');
        return null;
    });
}

export async function generateMeme(prompt: string): Promise<string | null> {
    return limitFunction(async () => {
      let retries = 0;
      while (retries < maxRetries) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          const ai = getAi();
          const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: `Create a witty, short meme caption: ${prompt}` }] }],
          });
          clearTimeout(timeout);
          const text = result.text ?? result.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ').trim();
          return text || null;
        } catch (err: any) {
          console.error('Error generating meme:', err);
          if (err.message.includes('429') || err.message.includes('503')) {
            const delay = baseDelay * Math.pow(2, retries);
            console.log(`Rate limited. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000));
            retries++;
          } else {
            return null;
          }
        }
      }
      console.error('Meme generation failed after max retries.');
      return null;
    });
}