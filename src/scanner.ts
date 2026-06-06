// ============================================================
// Concept Ledger — Term Scanner
// ============================================================
// Detects the five core signals:
// 1. Synonym Loop    — 3rd alias triggers unification prompt
// 2. Definition Drift — keyword overlap < 50% between old & new def
// 3. Metaphor Overreach — Vague concept appears in code block
// 4. Concept Collision — two concepts with > 80% keyword overlap
// 5. Zombie Concept  — Frozen concept unreferenced in last 5 sessions
// ============================================================

import type { Concept, DetectionSignal, LedgerData, ParsedMention } from './types';
import { findConceptByName } from './ledger';

// ---- Configuration ----

const SYNONYM_THRESHOLD = 0.85;  // Jaro-Winkler
const SYNONYM_TRIGGER_COUNT = 3;  // Number of aliases before triggering
const DRIFT_OVERLAP_THRESHOLD = 0.50;  // < 50% overlap = drift
const COLLISION_OVERLAP_THRESHOLD = 0.80; // > 80% overlap = collision
const ZOMBIE_SESSION_COUNT = 5;  // Last N sessions to check for references

// ---- Jaro-Winkler Similarity ----

/**
 * Compute Jaro-Winkler similarity between two strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function jaroWinkler(s1: string, s2: string): number {
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  // Jaro distance
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(b.length - 1, i + matchDistance);
    for (let j = start; j <= end; j++) {
      if (!bMatches[j] && a[i] === b[j]) {
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  // Transpositions
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (
    matches / a.length +
    matches / b.length +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Winkler modification: boost for common prefix (up to 4 chars)
  const prefixScale = 0.1;
  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(maxPrefix, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }

  return jaro + (prefix * prefixScale * (1 - jaro));
}

// ---- Keyword Extraction ----

/**
 * Extract a bag of lowercase keywords from a definition text.
 * Simple tokenization: split on non-alphanumeric, filter stop words,
 * keep tokens with length >= 3.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each',
  'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'than', 'too', 'very', 'that', 'this', 'these',
  'those', 'which', 'what', 'who', 'whom', 'whose', 'when', 'where',
  'why', 'how', 'it', 'its', 'it\'s', 'they', 'them', 'their', 'we',
  'us', 'our', 'you', 'your', 'he', 'she', 'his', 'her', 'him',
  '的', '是', '在', '了', '和', '与', '或', '不', '这', '那', '就', '也',
  '都', '要', '会', '可以', '能', '把', '被', '让', '从', '到', '对', '用',
  '一个', '一种', '这个', '那个', '这些', '那些', '它', '它们', '我', '我们',
  '你', '你们', '他', '她', '他们',
]);

export function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();
  const keywords = new Set<string>();

  // Handle ASCII tokens: split on non-alphanumeric
  const asciiTokens = text.toLowerCase().split(/[^a-z0-9]+/);
  for (const token of asciiTokens) {
    if (token.length >= 3 && !STOP_WORDS.has(token)) {
      keywords.add(token);
    }
  }

  // Handle CJK: extract bigrams from contiguous CJK sequences
  const cjkChars = text.match(/[\u4e00-\u9fff]+/g);
  if (cjkChars) {
    for (const seq of cjkChars) {
      // Add individual chars of length for very short sequences
      if (seq.length <= 2) {
        keywords.add(seq);
      } else {
        // Extract bigrams
        for (let i = 0; i < seq.length - 1; i++) {
          const bigram = seq.substring(i, i + 2);
          keywords.add(bigram);
        }
      }
    }
  }

  return keywords;
}

/**
 * Compute keyword overlap ratio between two bags of keywords.
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 */
export function keywordOverlap(keywordsA: Set<string>, keywordsB: Set<string>): number {
  if (keywordsA.size === 0 && keywordsB.size === 0) return 1.0;

  const intersection = new Set<string>();
  const union = new Set<string>(keywordsA);

  for (const kw of keywordsB) {
    union.add(kw);
    if (keywordsA.has(kw)) {
      intersection.add(kw);
    }
  }

  return intersection.size / union.size;
}

// ---- Signal Detection ----

/**
 * Run all scanners on the given ledger state and extracted mentions.
 */
export function scanAll(
  data: LedgerData,
  mentions: ParsedMention[],
  sessionId: string
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];

  signals.push(...scanSynonymLoop(data, mentions));
  signals.push(...scanDefinitionDrift(data, mentions));
  signals.push(...scanMetaphorOverreach(data, mentions));
  signals.push(...scanConceptCollision(data));
  signals.push(...scanZombieConcepts(data, sessionId));

  return signals;
}

/**
 * Synonym Loop Detection:
 * A new concept name is > 0.85 Jaro-Winkler similar to an existing concept OR
 * is found to be semantically equivalent. When a concept accumulates 3+ aliases, trigger.
 */
export function scanSynonymLoop(
  data: LedgerData,
  mentions: ParsedMention[]
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];

  for (const mention of mentions) {
    const existingConcept = findConceptByName(data, mention.name);
    if (existingConcept) continue; // Already tracked

    // Check against all existing concepts for high similarity
    for (const id of data.order) {
      const concept = data.concepts[id];

      // Check canonical name similarity
      const simName = jaroWinkler(mention.name, concept.name);
      if (simName >= SYNONYM_THRESHOLD) {
        // This mention is likely a synonym
        mention.possibleAliasFor = concept.id;

        // Count existing aliases + this one
        const totalAliasCount = concept.aliases.length + 1;
        if (totalAliasCount >= SYNONYM_TRIGGER_COUNT) {
          signals.push({
            type: 'synonymLoop',
            message: `"${concept.name}" has accumulated ${totalAliasCount} alternative names: [${concept.aliases.join(', ')}${concept.aliases.length > 0 ? ', ' : ''}"${mention.name}"]. Consider unifying terminology.`,
            conceptIds: [concept.id],
            suggestedAction: `"${concept.aliases.join('", "')}${concept.aliases.length > 0 ? ', ' : ''}"${mention.name}" may all refer to "${concept.name}". Suggest unifying the name — which is most accurate?`,
            severity: 'warn',
          });
        }
        break;
      }

      // Check alias similarity
      for (const alias of concept.aliases) {
        const simAlias = jaroWinkler(mention.name, alias);
        if (simAlias >= SYNONYM_THRESHOLD) {
          mention.possibleAliasFor = concept.id;

          const totalAliasCount = concept.aliases.length + 1;
          if (totalAliasCount >= SYNONYM_TRIGGER_COUNT) {
            signals.push({
              type: 'synonymLoop',
              message: `"${concept.name}" has accumulated ${totalAliasCount} alternative names including "${mention.name}". Consider unifying terminology.`,
              conceptIds: [concept.id],
              suggestedAction: `"${concept.aliases.join('", "')}${concept.aliases.length > 0 ? ', ' : ''}"${mention.name}" may all refer to "${concept.name}". Suggest unifying the name.`,
              severity: 'warn',
            });
          }
          break;
        }
      }
    }
  }

  return signals;
}

/**
 * Definition Drift Detection:
 * Compare current definition keywords against the most recent historical definition.
 * If overlap < 50%, flag as drift.
 */
export function scanDefinitionDrift(
  data: LedgerData,
  mentions: ParsedMention[]
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];

  for (const mention of mentions) {
    if (!mention.definition) continue;

    const existingConcept = findConceptByName(data, mention.name);
    if (!existingConcept) continue;
    if (existingConcept.status !== 'forming' && existingConcept.status !== 'clear') continue;
    if (!existingConcept.definition) continue;

    const oldKeywords = extractKeywords(existingConcept.definition);
    const newKeywords = extractKeywords(mention.definition);

    const overlap = keywordOverlap(oldKeywords, newKeywords);

    if (overlap < DRIFT_OVERLAP_THRESHOLD) {
      signals.push({
        type: 'definitionDrift',
        message: `The definition of "${existingConcept.name}" has shifted significantly (${(overlap * 100).toFixed(0)}% overlap). Old: "${existingConcept.definition.substring(0, 80)}..." New: "${mention.definition.substring(0, 80)}..."`,
        conceptIds: [existingConcept.id],
        suggestedAction: `The meaning of "${existingConcept.name}" seems to have shifted—from "${existingConcept.definition.substring(0, 60)}..." to "${mention.definition.substring(0, 60)}..." Is this a deepening of the same concept, or two different things?`,
        severity: 'warn',
      });
    }
  }

  return signals;
}

/**
 * Metaphor Overreach Detection:
 * A Vague concept appears inside a code block or is bound to an implementation detail
 * (class name, function signature, API, interface).
 */
export function scanMetaphorOverreach(
  data: LedgerData,
  mentions: ParsedMention[]
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];

  for (const mention of mentions) {
    const existingConcept = findConceptByName(data, mention.name);
    if (!existingConcept) continue;
    if (existingConcept.status !== 'vague') continue;

    if (mention.inCodeBlock) {
      signals.push({
        type: 'metaphorOverreach',
        message: `Vague concept "${existingConcept.name}" appears in a code block. It should be clearly defined before entering implementation.`,
        conceptIds: [existingConcept.id],
        suggestedAction: `"${existingConcept.name}" is currently Vague in the ledger, yet it appears in implementation code. Do you want to: (a) first define what "${existingConcept.name}" is, (b) confirm it's an alias for an existing concept, or (c) discard this direction?`,
        severity: 'block',
      });
      continue;
    }

    // Check context for implementation keywords
    const implPatterns = [
      /\bclass\s+\w+/i,
      /\bfunction\s+\w+/i,
      /\binterface\s+\w+/i,
      /\bapi\s+\w+/i,
      /\bstruct\s+\w+/i,
      /\btype\s+\w+/i,
      /\bendpoint\s+\w+/i,
      /\bmethod\s+\w+/i,
    ];

    for (const pattern of implPatterns) {
      if (pattern.test(mention.context)) {
        signals.push({
          type: 'metaphorOverreach',
          message: `Vague concept "${existingConcept.name}" is being associated with implementation details. It should be defined first.`,
          conceptIds: [existingConcept.id],
          suggestedAction: `"${existingConcept.name}" is currently Vague but seems tied to implementation. Would you like to define it clearly first?`,
          severity: 'block',
        });
        break;
      }
    }
  }

  return signals;
}

/**
 * Concept Collision Detection:
 * Two Clear/Forming concepts have > 80% keyword overlap in their definitions.
 */
export function scanConceptCollision(data: LedgerData): DetectionSignal[] {
  const signals: DetectionSignal[] = [];
  const concepts = data.order
    .map((id) => data.concepts[id])
    .filter((c) => c.status === 'forming' || c.status === 'clear');

  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const c1 = concepts[i];
      const c2 = concepts[j];

      // Skip if either has no definition
      if (!c1.definition || !c2.definition) continue;

      const kw1 = extractKeywords(c1.definition);
      const kw2 = extractKeywords(c2.definition);
      const overlap = keywordOverlap(kw1, kw2);

      if (overlap >= COLLISION_OVERLAP_THRESHOLD) {
        signals.push({
          type: 'conceptCollision',
          message: `"${c1.name}" and "${c2.name}" have ${(overlap * 100).toFixed(0)}% definition overlap. They may be logically equivalent.`,
          conceptIds: [c1.id, c2.id],
          suggestedAction: `"${c1.name}" and "${c2.name}" appear to be logically equivalent (${(overlap * 100).toFixed(0)}% definition overlap). Should they be merged?`,
          severity: 'info',
        });
      }
    }
  }

  return signals;
}

/**
 * Zombie Concept Detection:
 * Frozen concepts not referenced in the last N sessions are flagged.
 */
export function scanZombieConcepts(
  data: LedgerData,
  currentSessionId: string
): DetectionSignal[] {
  const signals: DetectionSignal[] = [];
  const recentSessions = new Set(
    [currentSessionId, ...data.previousSessionIds].slice(0, ZOMBIE_SESSION_COUNT)
  );

  for (const id of data.order) {
    const concept = data.concepts[id];
    if (concept.status !== 'frozen') continue;

    // Check if referenced in any recent session
    const isReferenced = concept.referencedInSessions.some((sid) =>
      recentSessions.has(sid)
    );

    if (!isReferenced) {
      signals.push({
        type: 'zombieConcept',
        message: `Frozen concept "${concept.name}" has not been referenced in the last ${ZOMBIE_SESSION_COUNT} sessions.`,
        conceptIds: [concept.id],
        suggestedAction: `"${concept.name}" was Frozen but hasn't been used in ${ZOMBIE_SESSION_COUNT} sessions. Consider marking it as Zombie or reviewing whether it's still needed.`,
        severity: 'info',
      });
    }
  }

  return signals;
}
