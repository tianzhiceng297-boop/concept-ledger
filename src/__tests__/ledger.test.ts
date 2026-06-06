// ============================================================
// Concept Ledger — State Machine Tests
// ============================================================

import {
  ensureConcept,
  transition,
  freeze,
  unfreeze,
  merge,
  discard,
  markMetaphorOnly,
  isValidTransition,
  findConceptByName,
  formatInventory,
} from '../ledger';
import { createEmptyLedger, saveLedger, loadLedger } from '../store';
import type { Concept, LedgerData } from '../types';

// Helper: create a fresh ledger for each test
function freshLedger(): LedgerData {
  return createEmptyLedger('test-project', 'test-session-1');
}

describe('State Machine Transitions', () => {
  let ledger: LedgerData;
  const turn = 0;
  const sessionId = 'test-session';

  beforeEach(() => {
    ledger = freshLedger();
  });

  test('Vague → Forming (definition given)', () => {
    const concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    expect(concept.status).toBe('vague');

    const result = transition(concept, 'forming', turn + 1, sessionId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.status).toBe('forming');
    }
  });

  test('Forming → Clear (boundaries stable)', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        expect(r2.concept.status).toBe('clear');
      }
    }
  });

  test('Clear → Frozen (implementation confirmed)', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        const r3 = transition(r2.concept, 'frozen', 3, sessionId);
        expect(r3.success).toBe(true);
        if (r3.success) {
          expect(r3.concept.status).toBe('frozen');
          expect(r3.concept.frozenAt).toBe(3);
        }
      }
    }
  });

  test('Frozen → Clear (Unfreeze)', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        const r3 = transition(r2.concept, 'frozen', 3, sessionId);
        expect(r3.success).toBe(true);
        if (r3.success) {
          const r4 = transition(r3.concept, 'clear', 4, sessionId);
          expect(r4.success).toBe(true);
          if (r4.success) {
            expect(r4.concept.status).toBe('clear');
          }
        }
      }
    }
  });

  test('Clear → Forming (downgrade on wrong definition)', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        const r3 = transition(r2.concept, 'forming', 3, sessionId);
        expect(r3.success).toBe(true);
        if (r3.success) {
          expect(r3.concept.status).toBe('forming');
        }
      }
    }
  });

  test('Forming → Vague (downgrade)', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'vague', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        expect(r2.concept.status).toBe('vague');
      }
    }
  });

  test('Frozen → Zombie', () => {
    let concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        const r3 = transition(r2.concept, 'frozen', 3, sessionId);
        expect(r3.success).toBe(true);
        if (r3.success) {
          const r4 = transition(r3.concept, 'zombie', 4, sessionId);
          expect(r4.success).toBe(true);
          if (r4.success) {
            expect(r4.concept.status).toBe('zombie');
          }
        }
      }
    }
  });

  test('Vague → MetaphorOnly', () => {
    const concept = ensureConcept(ledger, 'GreenChannel', turn, sessionId);
    expect(concept.status).toBe('vague');

    const result = transition(concept, 'metaphorOnly', turn + 1, sessionId);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.status).toBe('metaphorOnly');
    }
  });

  test('Invalid transition: Vague → Frozen (skipping Forming and Clear)', () => {
    const concept = ensureConcept(ledger, 'EventFilter', turn, sessionId);
    const result = transition(concept, 'frozen', turn + 1, sessionId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid transition');
    }
  });

  test('Invalid transition: MetaphorOnly → Forming', () => {
    let concept = ensureConcept(ledger, 'GreenChannel', turn, sessionId);
    const r1 = transition(concept, 'metaphorOnly', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'forming', 2, sessionId);
      expect(r2.success).toBe(false);
    }
  });

  test('Invalid transition: Zombie → anything', () => {
    let concept = ensureConcept(ledger, 'OldConcept', turn, sessionId);
    // Fast-forward to zombie
    const r1 = transition(concept, 'forming', 1, sessionId);
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 2, sessionId);
      expect(r2.success).toBe(true);
      if (r2.success) {
        const r3 = transition(r2.concept, 'frozen', 3, sessionId);
        expect(r3.success).toBe(true);
        if (r3.success) {
          const r4 = transition(r3.concept, 'zombie', 4, sessionId);
          expect(r4.success).toBe(true);
          if (r4.success) {
            const r5 = transition(r4.concept, 'vague', 5, sessionId);
            expect(r5.success).toBe(false);
          }
        }
      }
    }
  });
});

describe('Command Interface', () => {
  test('freeze() creates concept if not exists and freezes it', () => {
    const ledger = freshLedger();
    const result = freeze(ledger, 'DataFunnel', 'Pipes data through a narrowing filter', 0, 's1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.name).toBe('DataFunnel');
      expect(result.concept.status).toBe('frozen');
      expect(result.concept.definition).toBe('Pipes data through a narrowing filter');
    }
  });

  test('freeze() fails on MetaphorOnly concept', () => {
    const ledger = freshLedger();
    markMetaphorOnly(ledger, 'GreenChannel', 0, 's1');
    const result = freeze(ledger, 'GreenChannel', 'Some definition', 1, 's1');
    expect(result.success).toBe(false);
  });

  test('unfreeze() Frozen → Clear', () => {
    const ledger = freshLedger();
    freeze(ledger, 'DataFunnel', 'Definition', 0, 's1');
    const result = unfreeze(ledger, 'DataFunnel', 1, 's1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.status).toBe('clear');
    }
  });

  test('merge() absorbs concept B into concept A', () => {
    const ledger = freshLedger();
    freeze(ledger, 'EventFilter', 'Filters events', 0, 's1');
    freeze(ledger, 'EventSieve', 'Same as filter', 1, 's1');

    const result = merge(ledger, 'EventFilter', 'EventSieve', 2, 's1');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.primary.name).toBe('EventFilter');
      expect(result.absorbed).toBe('EventSieve');
      expect(result.primary.aliases).toContain('EventSieve');
      // EventSieve's name is now an alias of EventFilter, so findConceptByName
      // returns EventFilter. But EventSieve should be removed from the order.
      expect(ledger.order).toHaveLength(1);
      expect(ledger.order[0]).toBe('eventfilter');
    }
  });

  test('discard() removes a concept', () => {
    const ledger = freshLedger();
    ensureConcept(ledger, 'TempConcept', 0, 's1');
    const result = discard(ledger, 'TempConcept');
    expect(result.success).toBe(true);
    expect(findConceptByName(ledger, 'TempConcept')).toBeNull();
  });

  test('isValidTransition checks all allowed transitions', () => {
    expect(isValidTransition('vague', 'forming')).toBe(true);
    expect(isValidTransition('vague', 'metaphorOnly')).toBe(true);
    expect(isValidTransition('vague', 'frozen')).toBe(false);
    expect(isValidTransition('vague', 'zombie')).toBe(false);
    expect(isValidTransition('forming', 'clear')).toBe(true);
    expect(isValidTransition('forming', 'vague')).toBe(true);
    expect(isValidTransition('forming', 'frozen')).toBe(false);
    expect(isValidTransition('clear', 'frozen')).toBe(true);
    expect(isValidTransition('clear', 'forming')).toBe(true);
    expect(isValidTransition('frozen', 'clear')).toBe(true);
    expect(isValidTransition('frozen', 'zombie')).toBe(true);
    expect(isValidTransition('frozen', 'forming')).toBe(false);
    expect(isValidTransition('metaphorOnly', 'forming')).toBe(false);
    expect(isValidTransition('metaphorOnly', 'vague')).toBe(false);
    expect(isValidTransition('zombie', 'vague')).toBe(false);
  });
});

describe('formatInventory', () => {
  test('produces correct inventory output', () => {
    const ledger = freshLedger();
    freeze(ledger, 'DataFunnel', 'Definition A', 0, 's1');
    freeze(ledger, 'EventPipeline', 'Definition B', 1, 's1');

    ensureConcept(ledger, 'MessageDecay', 2, 's1');
    const md = findConceptByName(ledger, 'MessageDecay')!;
    const r1 = transition(md, 'forming', 3, 's1');
    expect(r1.success).toBe(true);
    if (r1.success) {
      const r2 = transition(r1.concept, 'clear', 4, 's1');
      if (r2.success) {
        ledger.concepts[md.id] = r2.concept;
      }
    }

    const inventory = formatInventory(ledger);
    expect(inventory).toContain('DataFunnel');
    expect(inventory).toContain('EventPipeline');
    expect(inventory).toContain('MessageDecay');
    expect(inventory).toContain('Frozen (2)');
    expect(inventory).toContain('Clear (1)');
  });
});
