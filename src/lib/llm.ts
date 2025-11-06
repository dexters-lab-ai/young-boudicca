/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";

// According to guidelines, API key must be from process.env.API_KEY
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

/**
 * Generates a meme caption using the Gemini API.
 * @param prompt The user's prompt describing the meme.
 * @returns A promise that resolves to the generated caption string, or null on failure.
 */
export async function generateMeme(prompt: string): Promise<string | null> {
  try {
    const systemInstruction = "You are a witty and concise meme caption generator. You will be given a prompt for a meme, and you must return a short, punchy, and funny caption for it. Return ONLY the caption text, with no extra formatting or explanations.";
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
      },
    });

    const text = response.text;
    if (text) {
      return text.trim();
    }
    return null;
  } catch (error) {
    console.error("Error generating meme caption with Gemini:", error);
    return null;
  }
}
