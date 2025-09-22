/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Lightweight, dependency-free ELIZA-like responder.
// Maintains minimal conversational state (greeting + last topic hints).

type Rule = {
    pattern: RegExp;
    replies: string[];
  };
  
  let greeted = false;
  let lastTopic: string | null = null;
  
  const reflections: Record<string, string> = {
    "am": "are",
    "was": "were",
    "i": "you",
    "i'd": "you would",
    "i've": "you have",
    "i'll": "you will",
    "my": "your",
    "are": "am",
    "you've": "I have",
    "you'll": "I will",
    "your": "my",
    "yours": "mine",
    "you": "me",
    "me": "you"
  };
  
  function reflect(fragment: string): string {
    return fragment
      .split(/\s+/)
      .map((w) => reflections[w.toLowerCase()] ?? w)
      .join(" ");
  }
  
  function replaceAllCompat(input: string, find: string, replacement: string): string {
    if (!find) return input;
    return input.split(find).join(replacement);
  }
  
  const rules: Rule[] = [
    { pattern: /hello|hi|hey|good\s+(morning|afternoon|evening)/i, replies: [
        "Hello. How are you feeling today?",
        "Hi there. What's on your mind?",
        "Hey. How can I help you today?"
      ] },
    { pattern: /because\b(.*)/i, replies: [
        "Is that the real reason?",
        "What other reasons come to mind?",
        "Does that reason apply to other situations too?"
      ] },
    { pattern: /i need\b(.*)/i, replies: [
        "Why do you need $1?",
        "Would obtaining $1 really help you?",
        "What would it mean if you got $1?"
      ] },
    { pattern: /i (?:am|feel)\b(.*)/i, replies: [
        "How long have you been feeling$1?",
        "What makes you feel$1?",
        "Do you enjoy feeling$1?"
      ] },
    { pattern: /i can't\b(.*)/i, replies: [
        "What makes you think you can't$1?",
        "Have you tried? What happened?",
        "What would change if you could$1?"
      ] },
    { pattern: /i don't\b(.*)/i, replies: [
        "Why don't you$1?",
        "What would happen if you did$1?",
        "What makes you say you don't$1?"
      ] },
    { pattern: /i (?:think|believe)\b(.*)/i, replies: [
        "Do you often think$1?",
        "What leads you to believe$1?",
        "What if the opposite were true about$1?"
      ] },
    { pattern: /you\b(.*)/i, replies: [
        "We were discussing you, not me.",
        "Why do you say I$1?",
        "What does that suggest to you?"
      ] },
    { pattern: /(?:mother|father|family|friend|partner|boss|teacher)/i, replies: [
        "Tell me more about your relationships.",
        "How do they influence the way you feel?",
        "What comes to mind when you think about them?"
      ] },
    { pattern: /why\b(.*)/i, replies: [
        "What do you think?",
        "Does an explanation change how you feel?",
        "What answers have you considered?"
      ] },
    { pattern: /(?:yes|yeah|yep|sure)\b/i, replies: [
        "I see. Can you elaborate?",
        "What makes you so certain?",
        "And how does that make you feel?"
      ] },
    { pattern: /(?:no|nope|nah)\b/i, replies: [
        "Why not?",
        "What would make you say yes?",
        "What holds you back?"
      ] },
    { pattern: /(.*)/i, replies: [
        "$r",
        "Can you tell me more?",
        "How does that relate to$T?",
        "Does this connect to$T in some way?"
      ] },
  ];
  
  function random<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
  
  function formatReply(template: string, input: string, match: RegExpExecArray | null): string {
    let out = template;
    if (match) {
      // Replace $1 with reflected capture
      if (out.includes("$1") && match[1] !== undefined) {
        const frag = match[1].trim();
        out = replaceAllCompat(out, "$1", reflect(frag));
      }
    }
    // Replace $T with last topic if known
    if (out.includes("$T")) {
      const topic = lastTopic ? ` ${lastTopic}` : " that";
      out = replaceAllCompat(out, "$T", topic);
    }
    // Special token $r -> reflective question
    if (out.includes("$r")) {
      const reflected = reflect(input);
      out = out.replace("$r", `Why do you say \"${reflected}\"?`);
    }
    return out;
  }
  
  function updateTopic(text: string) {
    const m = text.match(/\b([a-zA-Z][a-zA-Z0-9_-]{2,})\b/g);
    if (m && m.length) {
      // Pick a somewhat meaningful token (skip common words)
      const blacklist = new Set(["the","and","but","for","are","you","with","that","this","have","not","can","your","about","what","when","where","why","how","who","which"]);
      const candidate = m.find(w => !blacklist.has(w.toLowerCase()));
      if (candidate) lastTopic = candidate.toLowerCase();
    }
  }
  
  export async function getElizaResponse(prompt: string): Promise<string> {
    const input = (prompt || "").trim();
    if (!greeted) {
      greeted = true;
      if (!input) return "Hello. I'm here to listen. What's on your mind?";
    }
  
    updateTopic(input);
  
    for (const rule of rules) {
      const m = rule.pattern.exec(input);
      if (m) {
        const reply = random(rule.replies);
        return formatReply(reply, input, m);
      }
    }
  
    return "Please, go on.";
  }
  
  export function resetEliza() {
    greeted = false;
    lastTopic = null;
  }