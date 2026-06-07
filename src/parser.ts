// ============================================================
// Concept Forge — Content Parser
// ============================================================
// Extracts concept names, definitions, user gestures, and
// state-change intents from LLM response text.
// ============================================================

import type { ParsedMention, UserGesture } from './types';

// ---- Pattern Definitions ----

/** Match PascalCase or CamelCase terms (at least 2 words joined) */
const PASCAL_CASE_PATTERN = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;

/** Match quoted terms (single or double quotes, or Chinese quotes) */
const QUOTED_TERM_PATTERN = /[""]([^""]{2,40})[""]|'([^']{2,40})'/g;

/** Match definitions: "X means Y", "X is defined as Y", "X = Y", "X refers to Y", "X 指的是 Y" */
const DEFINITION_PATTERNS = [
  // English patterns
  /(['"]?[\w\s-]{2,40}['"]?)\s+(?:means|is defined as|refers to|is a|is an)\s+(.+?)(?:[.;]|$)/gi,
  // Chinese patterns
  /(['"]?[\w\s\u4e00-\u9fff-]{2,40}['"]?)\s*(?:指的是|定义为|是指|的意思是)\s*(.+?)(?:[。；]|$)/gi,
  // Assignment-like: "X = Y" or "X: Y"
  /\b([A-Z][a-zA-Z]{1,40})\s*[:=]\s*([^.;\n]{3,100})/g,
];

/** User gesture patterns */
const GESTURE_PATTERNS = [
  {
    regex: /lock\s+(['"]?)([\w\s-]{2,40})\1\s*=\s*(.+?)(?:[.;]|$)/i,
    build: (m: RegExpMatchArray): UserGesture => ({
      type: 'lock',
      conceptName: m[2].trim(),
      definition: m[3].trim(),
    }),
  },
  {
    regex: /merge\s+(['"]?)([\w\s-]{2,40})\1\s*,\s*(['"]?)([\w\s-]{2,40})\3/i,
    build: (m: RegExpMatchArray): UserGesture => ({
      type: 'merge',
      conceptA: m[2].trim(),
      conceptB: m[4].trim(),
    }),
  },
  {
    regex: /discard\s+(['"]?)([\w\s-]{2,40})\1/i,
    build: (m: RegExpMatchArray): UserGesture => ({
      type: 'discard',
      conceptName: m[2].trim(),
    }),
  },
  {
    regex: /metaphor\s+only\s+(['"]?)([\w\s-]{2,40})\1/i,
    build: (m: RegExpMatchArray): UserGesture => ({
      type: 'metaphorOnly',
      conceptName: m[2].trim(),
    }),
  },
  {
    regex: /unfreeze\s+(['"]?)([\w\s-]{2,40})\1/i,
    build: (m: RegExpMatchArray): UserGesture => ({
      type: 'unfreeze',
      conceptName: m[2].trim(),
    }),
  },
];

/** State change intent patterns */
const STATE_INTENT_PATTERNS = [
  {
    regex: /(?:let'?s?\s+)?freeze\s+(['"]?)([\w\s-]{2,40})\1(?:\s*[:=]\s*(.+))?/i,
    action: 'freeze',
  },
  {
    regex: /(?:let'?s?\s+)?unfreeze\s+(['"]?)([\w\s-]{2,40})\1/i,
    action: 'unfreeze',
  },
  {
    regex: /(['"]?[\w\s-]{2,40}['"]?)\s+is\s+(?:just\s+)?(?:a\s+)?metaphor/i,
    action: 'metaphorOnly',
  },
  {
    regex: /(?:let'?s?\s+)?discard\s+(['"]?)([\w\s-]{2,40})\1/i,
    action: 'discard',
  },
];

/** Blocklist: words that look like PascalCase but aren't concepts */
const CONCEPT_BLOCKLIST = new Set([
  'JavaScript', 'TypeScript', 'Python', 'React', 'Vue', 'Node', 'OpenClaw',
  'GitHub', 'API', 'REST', 'JSON', 'HTML', 'CSS', 'SQL', 'HTTP', 'HTTPS',
  'URL', 'URI', 'DOM', 'CLI', 'SDK', 'MVP', 'UI', 'UX', 'CI', 'CD',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
]);

// ---- Extraction Functions ----

/**
 * Extract structured concept mentions from a raw text block.
 */
export function parseResponse(text: string): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const seenNames = new Set<string>();

  // First, extract user gestures (highest priority)
  const gestures = parseGestures(text);

  // Extract PascalCase terms
  const pascalMatches = [...text.matchAll(PASCAL_CASE_PATTERN)];
  for (const match of pascalMatches) {
    const name = match[1];
    if (CONCEPT_BLOCKLIST.has(name)) continue;
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const inCodeBlock = isInCodeBlock(text, match.index!);
    const context = getContext(text, match.index!, match[0].length);

    const mention: ParsedMention = {
      name,
      inCodeBlock,
      context,
    };

    // Check if a definition follows this mention
    const def = extractDefinitionFor(name, text, match.index!);
    if (def) {
      mention.definition = def;
    }

    // Check for associated gesture
    const gesture = gestures.find((g) => {
      const gName = 'conceptName' in g ? g.conceptName : '';
      return gName.toLowerCase() === name.toLowerCase();
    });
    if (gesture) {
      mention.gesture = gesture;
    }

    mentions.push(mention);
  }

  // Extract quoted terms (that aren't already captured)
  const quotedMatches = [...text.matchAll(QUOTED_TERM_PATTERN)];
  for (const match of quotedMatches) {
    const name = (match[1] || match[2]).trim();
    if (name.length < 2) continue;
    if (CONCEPT_BLOCKLIST.has(name)) continue;
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const inCodeBlock = isInCodeBlock(text, match.index!);
    const context = getContext(text, match.index!, match[0].length);

    const mention: ParsedMention = {
      name,
      inCodeBlock,
      context,
    };

    const def = extractDefinitionFor(name, text, match.index!);
    if (def) {
      mention.definition = def;
    }

    const gesture = gestures.find((g) => {
      const gName = 'conceptName' in g ? g.conceptName : '';
      return gName.toLowerCase() === name.toLowerCase();
    });
    if (gesture) {
      mention.gesture = gesture;
    }

    mentions.push(mention);
  }

  return mentions;
}

/**
 * Parse user gestures from text.
 */
export function parseGestures(text: string): UserGesture[] {
  const gestures: UserGesture[] = [];
  for (const { regex, build } of GESTURE_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      gestures.push(build(match));
    }
  }
  return gestures;
}

/**
 * Parse state change intents from text ("let's freeze X", "X is just a metaphor").
 * Returns pairs of [conceptName, action].
 */
export function parseStateIntents(text: string): Array<{ conceptName: string; action: string; definition?: string }> {
  const intents: Array<{ conceptName: string; action: string; definition?: string }> = [];

  for (const { regex, action } of STATE_INTENT_PATTERNS) {
    const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'gi'))];
    for (const match of matches) {
      const conceptName = (match[2] || match[1]).trim();
      const definition = match[3]?.trim();
      if (conceptName.length >= 2) {
        intents.push({ conceptName, action, definition });
      }
    }
  }

  return intents;
}

/**
 * Extract a definition for a given concept name from surrounding text.
 */
function extractDefinitionFor(name: string, text: string, nameIndex: number): string | undefined {
  // Search backward and forward from the name to find definition patterns
  const searchWindow = text.substring(
    Math.max(0, nameIndex - 100),
    Math.min(text.length, nameIndex + 300)
  );

  for (const pattern of DEFINITION_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    const match = pattern.exec(searchWindow);
    if (match) {
      const subject = (match[1] || '').trim();
      const def = (match[2] || '').trim();
      if (subject.toLowerCase() === name.toLowerCase() && def.length > 0) {
        return def;
      }
    }
    pattern.lastIndex = 0;
  }

  return undefined;
}

/**
 * Check if a position in the text is inside a code block (``` ... ```).
 */
function isInCodeBlock(text: string, position: number): boolean {
  const beforePos = text.substring(0, position);
  const backtickMatches = beforePos.match(/```/g);
  if (!backtickMatches) return false;
  // Odd number of ``` before this position means we're inside a code block
  return backtickMatches.length % 2 === 1;
}

/**
 * Get surrounding context text around a position.
 */
function getContext(text: string, position: number, length: number): string {
  const start = Math.max(0, position - 50);
  const end = Math.min(text.length, position + length + 50);
  return text.substring(start, end);
}

/**
 * Extract all definitions from text, regardless of subject.
 * Returns pairs of [subject, definition].
 */
export function extractAllDefinitions(text: string): Array<{ subject: string; definition: string }> {
  const results: Array<{ subject: string; definition: string }> = [];

  for (const pattern of DEFINITION_PATTERNS) {
    const resetPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'gi');
    const matches = [...text.matchAll(resetPattern)];
    for (const match of matches) {
      const subject = (match[1] || '').trim();
      const definition = (match[2] || '').trim();
      if (subject.length >= 2 && definition.length > 0) {
        results.push({ subject, definition });
      }
    }
  }

  return results;
}
