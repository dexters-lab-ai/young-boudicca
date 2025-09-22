/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const sentimentMap: { [key: string]: string[] } = {
  happy: ['great', 'awesome', 'love', 'happy', 'good', 'nice', 'epic', 'amazing', 'brilliant', 'wonderful', 'joy', 'fun', 'excellent', 'fantastic', 'lol', 'lmao', '🔥', '✨', '😊'],
  sad: ['sad', 'bad', 'sorry', 'ashamed', 'oppression', 'weak', 'unfortunate', 'sorrow', 'alas', 'poor', 'terrible', 'awful', '😢'],
  angry: ['hate', 'angry', 'fight', 'against', 'fierce', 'nonsense', 'daft', 'ridiculous', 'attack', 'idiot', 'stupid', 'shut up', '🛡️', '😡'],
  surprised: ['wow', 'whoa', 'really', 'omg', 'surprised', 'unbelievable', 'no way', 'what?!', '🤯'],
};

export function getExpressionForText(text: string): string {
  const lowerCaseText = text.toLowerCase();

  for (const expression in sentimentMap) {
    for (const keyword of sentimentMap[expression]) {
      if (lowerCaseText.includes(keyword)) {
        return expression;
      }
    }
  }

  return 'neutral'; // Default expression
}
