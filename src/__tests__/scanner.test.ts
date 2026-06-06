// ============================================================
// Concept Ledger — Scanner Tests
// ============================================================

import {
  jaroWinkler,
  extractKeywords,
  keywordOverlap,
  scanSynonymLoop,
  scanDefinitionDrift,
  scanMetaphorOverreach,
  scanConceptCollision,
  scanZombieConcepts,
} from '../scanner';
import { ensureConcept, setDefinition, freeze, transition } from '../ledger';
import { createEmptyLedger } from '../store';
import type { ParsedMention, LedgerData } from '../types';

// ---- Jaro-Winkler Tests ----

describe('jaroWinkler', () => {
  test('identical strings', () => {
    expect(jaroWinkler('EventFilter', 'EventFilter')).toBe(1.0);
  });

  test('very similar strings (high similarity)', () => {
    const sim = jaroWinkler('EventFilter', 'EventFilters');
    expect(sim).toBeGreaterThan(0.85);
  });

  test('moderately similar strings', () => {
    const sim = jaroWinkler('DataFunnel', 'DataSieve');
    expect(sim).toBeGreaterThan(0.7);
  });

  test('completely different strings', () => {
    const sim = jaroWinkler('DataFunnel', 'QuickBrownFox');
    expect(sim).toBeLessThan(0.5);
  });

  test('one empty string', () => {
    expect(jaroWinkler('', 'EventFilter')).toBe(0.0);
    expect(jaroWinkler('EventFilter', '')).toBe(0.0);
  });

  test('short similar strings with common prefix', () => {
    const sim = jaroWinkler('Funnel', 'Funnels');
    expect(sim).toBeGreaterThan(0.85);
  });
});

// ---- Keyword Extraction Tests ----

describe('extractKeywords', () => {
  test('extracts meaningful keywords from definition', () => {
    const keywords = extractKeywords('Input is a full data stream, output is threshold events');
    expect(keywords.has('input')).toBe(true);
    expect(keywords.has('data')).toBe(true);
    expect(keywords.has('stream')).toBe(true);
    expect(keywords.has('output')).toBe(true);
    expect(keywords.has('events')).toBe(true);
  });

  test('filters stop words', () => {
    const keywords = extractKeywords('the is a of in on');
    expect(keywords.size).toBe(0);
  });

  test('extracts Chinese keywords (bigrams)', () => {
    const keywords = extractKeywords('数据流进来经过过滤后输出事件');
    // Bigrams: 数据, 据流, 流进, 进来, 经过, 过滤, 滤后, 后输, 输出, 出事, 事件
    expect(keywords.has('数据')).toBe(true);
    expect(keywords.has('过滤')).toBe(true);
    expect(keywords.has('输出')).toBe(true);
    expect(keywords.has('事件')).toBe(true);
  });
});

// ---- Keyword Overlap Tests ----

describe('keywordOverlap', () => {
  test('identical keyword sets', () => {
    const kw1 = extractKeywords('data stream input');
    const kw2 = extractKeywords('data stream input');
    expect(keywordOverlap(kw1, kw2)).toBe(1.0);
  });

  test('partially overlapping keyword sets', () => {
    const kw1 = extractKeywords('data stream input filter');
    const kw2 = extractKeywords('data stream output events');
    const overlap = keywordOverlap(kw1, kw2);
    expect(overlap).toBeGreaterThan(0.3);
    expect(overlap).toBeLessThan(0.6);
  });

  test('completely different keyword sets', () => {
    const kw1 = extractKeywords('data stream filter');
    const kw2 = extractKeywords('sentiment probe analysis');
    expect(keywordOverlap(kw1, kw2)).toBe(0.0);
  });
});

// ---- Synonym Loop Detection ----

describe('scanSynonymLoop', () => {
  test('detects synonym loop after 3 aliases', () => {
    const ledger = createEmptyLedger('scan-test', 's1');
    const concept = ensureConcept(ledger, 'EventFilter', 0, 's1');
    // Add 2 existing aliases manually
    concept.aliases = ['DataSieve', 'DataStrainer'];
    ledger.concepts[concept.id] = concept;

    // 3rd alias in mention
    const mentions: ParsedMention[] = [
      { name: 'EventFunnel', inCodeBlock: false, context: 'like an EventFunnel' },
    ];

    const signals = scanSynonymLoop(ledger, mentions);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('synonymLoop');
    expect(signals[0].conceptIds).toContain(concept.id);
  });

  test('does not trigger for first alias', () => {
    const ledger = createEmptyLedger('scan-test-2', 's1');
    const concept = ensureConcept(ledger, 'EventFilter', 0, 's1');
    concept.aliases = []; // no aliases yet
    ledger.concepts[concept.id] = concept;

    const mentions: ParsedMention[] = [
      { name: 'EventSieve', inCodeBlock: false, context: 'EventSieve is similar' },
    ];

    const signals = scanSynonymLoop(ledger, mentions);
    expect(signals.length).toBe(0); // Only 2 names including the mention itself, not 3
  });
});

// ---- Definition Drift Detection ----

describe('scanDefinitionDrift', () => {
  test('detects significant drift (< 50% overlap)', () => {
    const ledger = createEmptyLedger('drift-test', 's1');
    const concept = ensureConcept(ledger, 'MessageDecay', 0, 's1');
    const formed = transition(concept, 'forming', 1, 's1');
    if (formed.success) {
      const withDef = setDefinition(formed.concept, 'Messages disappear automatically after a time threshold', 2, 's1');
      ledger.concepts[withDef.id] = withDef;

      const mentions: ParsedMention[] = [
        {
          name: 'MessageDecay',
          definition: 'Priority decreases over time based on recency weighting',
          inCodeBlock: false,
          context: 'MessageDecay means priority decreases',
        },
      ];

      const signals = scanDefinitionDrift(ledger, mentions);
      expect(signals.length).toBe(1);
      expect(signals[0].type).toBe('definitionDrift');
    }
  });

  test('does not trigger for similar definitions', () => {
    const ledger = createEmptyLedger('drift-test-2', 's1');
    const concept = ensureConcept(ledger, 'MessageDecay', 0, 's1');
    const formed = transition(concept, 'forming', 1, 's1');
    if (formed.success) {
      const withDef = setDefinition(formed.concept, 'Messages disappear automatically after a time threshold expires', 2, 's1');
      ledger.concepts[withDef.id] = withDef;

      const mentions: ParsedMention[] = [
        {
          name: 'MessageDecay',
          definition: 'Messages disappear automatically once time threshold is reached',
          inCodeBlock: false,
          context: '',
        },
      ];

      const signals = scanDefinitionDrift(ledger, mentions);
      // These share: messages, disappear, automatically, time, threshold = 5 / ~6-7 keywords ≈ >70% overlap
      expect(signals.length).toBe(0);
    }
  });
});

// ---- Metaphor Overreach Detection ----

describe('scanMetaphorOverreach', () => {
  test('detects Vague concept in code block', () => {
    const ledger = createEmptyLedger('overreach-test', 's1');
    ensureConcept(ledger, 'GreenChannel', 0, 's1');

    const mentions: ParsedMention[] = [
      { name: 'GreenChannel', inCodeBlock: true, context: 'class GreenChannel {' },
    ];

    const signals = scanMetaphorOverreach(ledger, mentions);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('metaphorOverreach');
    expect(signals[0].severity).toBe('block');
  });

  test('detects Vague concept near class keyword', () => {
    const ledger = createEmptyLedger('overreach-test-2', 's1');
    ensureConcept(ledger, 'GreenChannel', 0, 's1');

    const mentions: ParsedMention[] = [
      { name: 'GreenChannel', inCodeBlock: false, context: 'class GreenChannel implements some interface' },
    ];

    const signals = scanMetaphorOverreach(ledger, mentions);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('metaphorOverreach');
  });

  test('does not trigger for Forming concept in code block', () => {
    const ledger = createEmptyLedger('overreach-test-3', 's1');
    const concept = ensureConcept(ledger, 'DataFunnel', 0, 's1');
    const formed = transition(concept, 'forming', 1, 's1');
    if (formed.success) {
      ledger.concepts[concept.id] = formed.concept;

      const mentions: ParsedMention[] = [
        { name: 'DataFunnel', inCodeBlock: true, context: 'class DataFunnel' },
      ];

      const signals = scanMetaphorOverreach(ledger, mentions);
      expect(signals.length).toBe(0);
    }
  });
});

// ---- Concept Collision Detection ----

describe('scanConceptCollision', () => {
  test('detects two concepts with similar definitions', () => {
    const ledger = createEmptyLedger('collision-test', 's1');

    // Create two concepts with very similar definitions (sharing most keywords)
    const c1 = ensureConcept(ledger, 'EventFilter', 0, 's1');
    const r1 = transition(c1, 'forming', 1, 's1');
    if (r1.success) {
      const withDef = setDefinition(r1.concept, 'Filters incoming events based on threshold criteria', 2, 's1');
      const r2 = transition(withDef, 'clear', 3, 's1');
      if (r2.success) {
        ledger.concepts[c1.id] = r2.concept;
      }
    }

    const c2 = ensureConcept(ledger, 'EventSieve', 4, 's1');
    const r3 = transition(c2, 'forming', 5, 's1');
    if (r3.success) {
      const withDef = setDefinition(r3.concept, 'Filters incoming events based on threshold criteria', 6, 's1');
      const r4 = transition(withDef, 'clear', 7, 's1');
      if (r4.success) {
        ledger.concepts[c2.id] = r4.concept;
      }
    }

    const signals = scanConceptCollision(ledger);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('conceptCollision');
  });

  test('does not trigger for clearly different concepts', () => {
    const ledger = createEmptyLedger('collision-test-2', 's1');

    const c1 = ensureConcept(ledger, 'EventFilter', 0, 's1');
    const r1 = transition(c1, 'forming', 1, 's1');
    if (r1.success) {
      const withDef = setDefinition(r1.concept, 'Filters events based on threshold criteria', 2, 's1');
      const r2 = transition(withDef, 'clear', 3, 's1');
      if (r2.success) {
        ledger.concepts[c1.id] = r2.concept;
      }
    }

    const c2 = ensureConcept(ledger, 'SentimentProbe', 4, 's1');
    const r3 = transition(c2, 'forming', 5, 's1');
    if (r3.success) {
      const withDef = setDefinition(r3.concept, 'Analyzes text to determine emotional polarity', 6, 's1');
      const r4 = transition(withDef, 'clear', 7, 's1');
      if (r4.success) {
        ledger.concepts[c2.id] = r4.concept;
      }
    }

    const signals = scanConceptCollision(ledger);
    expect(signals.length).toBe(0);
  });
});
