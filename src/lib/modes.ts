/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Mode } from '../types';

const modes: Record<string, Mode> = {
  sora: {
    name: 'Sora Video',
    emoji: '🎬',
    prompt: 'Generate a cinematic Sora video based on this image. Include expressive motion and consistent lighting.'
  },

  renaissance: {
    name: 'Renaissance',
    emoji: '🎨',
    prompt: 'Make the person in the photo look like a Renaissance painting.'
  },

  cartoon: {
    name: 'Cartoon',
    emoji: '😃',
    prompt:
      'Transform this image into a cute simple cartoon. Use minimal lines and solid colors.'
  },

  statue: {
    name: 'Statue',
    emoji: '🏛️',
    prompt:
      'Make the person look like a classical marble statue, including the clothes and eyes.'
  },

  '80s': {
    name: '80s',
    emoji: '✨',
    prompt:
      'Make the person in the photo look like a 1980s yearbook photo. Feel free to change the hairstyle and clothing.'
  },

  '19century': {
    name: '19th Cent.',
    emoji: '🎩',
    prompt:
      'Make the photo look like a 19th century daguerreotype. Feel free to change the background to make it period appropriate and add props like Victorian clothing. Try to keep the perspective the same.'
  },

  anime: {
    name: 'Anime',
    emoji: '🍣',
    prompt:
      'Make the person in the photo look like a photorealistic anime character with exaggerated features.'
  },

  psychedelic: {
    name: 'Psychedelic',
    emoji: '🌈',
    prompt:
      "Create a 1960s psychedelic hand-drawn poster-style illustration based on this image with bright bold solid colors and swirling shapes. Don't add any text."
  },

  '8bit': {
    name: '8-bit',
    emoji: '🎮',
    prompt:
      'Transform this image into a minimalist 8-bit brightly colored cute pixel art scene on a 80x80 pixel grid.'
  },

  beard: {
    name: 'Big Beard',
    emoji: '🧔🏻',
    prompt: 'Make the person in the photo look like they have a huge beard.'
  },

  comic: {
    name: 'Comic Book',
    emoji: '💥',
    prompt:
      'Transform the photo into a comic book panel with bold outlines, halftone dots, and speech bubbles.'
  },

  old: {
    name: 'Old',
    emoji: '👵🏻',
    prompt: 'Make the person in the photo look extremely old.'
  }
}

export default modes;