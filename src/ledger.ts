// ============================================================
// Concept Ledger — State Machine Engine
// ============================================================
// Implements the 6-state concept lifecycle:
// Vague → Forming → Clear → Frozen
// Reversible: Forming → Vague, Clear → Forming, Frozen → Clear
// Special: MetaphorOnly (never upgrades), Zombie (frozen + unreferenced)
// ============================================================

import type {
  Concept,
  ConceptStatus,
  LedgerData,
  TransitionMap,
  DefinitionRecord,
} from './types';
import { conceptIdFromName } from './store';

// ---- Transition Table ----

/**
 * Hard-coded allowed transitions.
 * Vague → Forming (definition given)
 * Vague → MetaphorOnly (user tags)
 * Forming → Clear (boundaries stable)
 * Forming → Vague (downgrade)
 * Clear → Frozen (implementation confirmed)
 * Clear → Forming (definition found wrong)
 * Frozen → Clear (unfreeze)
 * Frozen → Zombie (no longer referenced)
 */
const TRANSITIONS: TransitionMap = {
  vague: ['forming', 'metaphorOnly'],
  forming: ['clear', 'vague'],
  clear: ['frozen', 'forming'],
  frozen: ['clear', 'zombie'],
  metaphorOnly: [],
  zombie: [],
};

/**
 * Validate whether a transition from `from` to `to` is allowed.
 */
export function isValidTransition(from: ConceptStatus, to: ConceptStatus): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Perform a status transition with validation.
 * Returns the updated concept or an error message.
 */
export function transition(
  concept: Concept,
  to: ConceptStatus,
  turnNumber: number,
  sessionId: string
): { success: true; concept: Concept } | { success: false; error: string } {
  if (!isValidTransition(concept.status, to)) {
    return {
      success: false,
      error: `Invalid transition: ${concept.status} → ${to}. Allowed transitions from ${concept.status}: [${TRANSITIONS[concept.status].join(', ') || 'none'}]`,
    };
  }

  const updated: Concept = {
    ...concept,
    status: to,
    lastChanged: turnNumber,
  };

  // Reset vague counter on upgrade out of Vague
  if (concept.status === 'vague' && to !== 'vague') {
    updated.vagueTurns = 0;
  }

  // Track frozen timestamp
  if (to === 'frozen') {
    updated.frozenAt = turnNumber;
  }

  // Track session reference
  if (!updated.referencedInSessions.includes(sessionId)) {
    updated.referencedInSessions = [...updated.referencedInSessions, sessionId];
  }

  return { success: true, concept: updated };
}

// ---- Ledger CRUD Operations ----

/**
 * Find a concept by its canonical name (case-insensitive match on name or aliases).
 */
export function findConceptByName(data: LedgerData, name: string): Concept | null {
  const normalized = name.trim().toLowerCase();
  for (const id of data.order) {
    const c = data.concepts[id];
    if (c.name.toLowerCase() === normalized) return c;
    if (c.aliases.some((a) => a.toLowerCase() === normalized)) return c;
  }
  return null;
}

/**
 * Create or retrieve a concept. If it exists, return it. If not, create a new Vague concept.
 */
export function ensureConcept(
  data: LedgerData,
  name: string,
  turnNumber: number,
  sessionId: string
): Concept {
  const existing = findConceptByName(data, name);
  if (existing) return existing;

  const id = conceptIdFromName(name);
  // Ensure unique ID
  let uniqueId = id;
  let counter = 1;
  while (data.concepts[uniqueId]) {
    uniqueId = `${id}-${counter}`;
    counter++;
  }

  const concept: Concept = {
    id: uniqueId,
    name: name.trim(),
    status: 'vague',
    definition: '',
    definitionHistory: [],
    aliases: [],
    createdAt: turnNumber,
    lastChanged: turnNumber,
    vagueTurns: 0,
    referencedInSessions: [sessionId],
    metadata: {},
  };

  data.concepts[uniqueId] = concept;
  data.order.push(uniqueId);

  return concept;
}

/**
 * Add a definition to a concept. If the definition is substantially the same as
 * the current one, does nothing. Otherwise, archives the old definition to history
 * and updates.
 */
export function setDefinition(
  concept: Concept,
  definition: string,
  turnNumber: number,
  sessionId: string
): Concept {
  const trimmed = definition.trim();
  if (!trimmed) return concept;

  // Don't update if definition hasn't changed
  if (concept.definition.trim().toLowerCase() === trimmed.toLowerCase()) {
    return concept;
  }

  // Archive current definition if it exists
  const history = [...concept.definitionHistory];
  if (concept.definition) {
    history.push({
      text: concept.definition,
      recordedAt: concept.lastChanged,
      sessionId,
    });
  }

  return {
    ...concept,
    definition: trimmed,
    definitionHistory: history,
    lastChanged: turnNumber,
  };
}

/**
 * Add an alias to a concept. Deduplicates.
 */
export function addAlias(concept: Concept, alias: string): Concept {
  const trimmed = alias.trim();
  if (!trimmed) return concept;
  if (concept.aliases.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
    return concept;
  }
  return {
    ...concept,
    aliases: [...concept.aliases, trimmed],
  };
}

// ---- Command Interface ----

/**
 * Freeze a concept with a final definition. Creates the concept if it doesn't exist.
 * Valid transition: any state except metaphorOnly/zombie can be frozen.
 */
export function freeze(
  data: LedgerData,
  conceptName: string,
  definition: string,
  turnNumber: number,
  sessionId: string
): { success: true; concept: Concept } | { success: false; error: string } {
  let concept = findConceptByName(data, conceptName);
  if (!concept) {
    concept = ensureConcept(data, conceptName, turnNumber, sessionId);
  }

  if (concept.status === 'metaphorOnly') {
    return { success: false, error: `"${concept.name}" is marked as Metaphor Only and cannot be frozen.` };
  }

  if (concept.status === 'zombie') {
    return { success: false, error: `"${concept.name}" is a Zombie concept and cannot be frozen.` };
  }

  // Set the definition
  concept = setDefinition(concept, definition, turnNumber, sessionId);

  // "Lock" is a user gesture that bypasses normal transition validation.
  // Directly set status to frozen as a user override.
  concept = {
    ...concept,
    status: 'frozen',
    lastChanged: turnNumber,
    frozenAt: turnNumber,
    vagueTurns: 0,
  };

  // Track session reference
  if (!concept.referencedInSessions.includes(sessionId)) {
    concept.referencedInSessions = [...concept.referencedInSessions, sessionId];
  }

  data.concepts[concept.id] = concept;
  return { success: true, concept };
}

/**
 * Unfreeze a concept: Frozen → Clear.
 */
export function unfreeze(
  data: LedgerData,
  conceptName: string,
  turnNumber: number,
  sessionId: string
): { success: true; concept: Concept } | { success: false; error: string } {
  const concept = findConceptByName(data, conceptName);
  if (!concept) {
    return { success: false, error: `Concept "${conceptName}" not found.` };
  }

  if (concept.status !== 'frozen') {
    return { success: false, error: `Concept "${concept.name}" is not Frozen (status: ${concept.status}).` };
  }

  const result = transition(concept, 'clear', turnNumber, sessionId);
  if (!result.success) return result;

  data.concepts[concept.id] = result.concept;
  return { success: true, concept: result.concept };
}

/**
 * Merge two concepts: conceptB is absorbed into conceptA.
 * conceptA inherits conceptB's aliases, and conceptB is removed.
 */
export function merge(
  data: LedgerData,
  nameA: string,
  nameB: string,
  turnNumber: number,
  sessionId: string
): { success: true; primary: Concept; absorbed: string } | { success: false; error: string } {
  const conceptA = findConceptByName(data, nameA);
  const conceptB = findConceptByName(data, nameB);

  if (!conceptA) {
    return { success: false, error: `Concept "${nameA}" not found.` };
  }
  if (!conceptB) {
    return { success: false, error: `Concept "${nameB}" not found.` };
  }
  if (conceptA.id === conceptB.id) {
    return { success: false, error: 'Cannot merge a concept with itself.' };
  }

  // Absorb B's aliases into A
  let updated = conceptA;
  for (const alias of conceptB.aliases) {
    updated = addAlias(updated, alias);
  }
  // Add B's name as an alias of A
  updated = addAlias(updated, conceptB.name);
  // Keep the more mature status
  const statusOrder: ConceptStatus[] = ['vague', 'forming', 'clear', 'frozen'];
  const aRank = statusOrder.indexOf(conceptA.status);
  const bRank = statusOrder.indexOf(conceptB.status);
  if (bRank > aRank) {
    const transResult = transition(updated, conceptB.status, turnNumber, sessionId);
    if (transResult.success) {
      updated = transResult.concept;
    }
  }

  updated.lastChanged = turnNumber;
  data.concepts[conceptA.id] = updated;

  // Remove concept B
  delete data.concepts[conceptB.id];
  data.order = data.order.filter((id) => id !== conceptB.id);

  return { success: true, primary: updated, absorbed: conceptB.name };
}

/**
 * Discard (remove) a concept from the ledger entirely.
 */
export function discard(
  data: LedgerData,
  conceptName: string
): { success: true; removed: string } | { success: false; error: string } {
  const concept = findConceptByName(data, conceptName);
  if (!concept) {
    return { success: false, error: `Concept "${conceptName}" not found.` };
  }

  delete data.concepts[concept.id];
  data.order = data.order.filter((id) => id !== concept.id);

  return { success: true, removed: concept.name };
}

/**
 * Mark a concept as Metaphor Only.
 */
export function markMetaphorOnly(
  data: LedgerData,
  conceptName: string,
  turnNumber: number,
  sessionId: string
): { success: true; concept: Concept } | { success: false; error: string } {
  let concept = findConceptByName(data, conceptName);
  if (!concept) {
    concept = ensureConcept(data, conceptName, turnNumber, sessionId);
  }

  if (concept.status === 'metaphorOnly') {
    return { success: true, concept };
  }

  const result = transition(concept, 'metaphorOnly', turnNumber, sessionId);
  if (!result.success) return result;

  data.concepts[concept.id] = result.concept;
  return { success: true, concept: result.concept };
}

// ---- Vague Concept Aging ----

/**
 * Check for Vague concepts that have been stagnant for >= 10 turns.
 * Returns a list of concepts that need user attention.
 */
export function checkVagueAging(data: LedgerData): Concept[] {
  const stale: Concept[] = [];
  for (const id of data.order) {
    const c = data.concepts[id];
    if (c.status === 'vague' && c.vagueTurns >= 10) {
      stale.push(c);
    }
  }
  return stale;
}

/**
 * Increment the vague turn counter for all Vague concepts.
 * Called once per dialogue turn.
 */
export function incrementVagueTurns(data: LedgerData): void {
  data.turnCount++;
  for (const id of data.order) {
    const c = data.concepts[id];
    if (c.status === 'vague') {
      c.vagueTurns++;
    }
  }
}

// ---- Session Tracking ----

/**
 * Track a session reference for a concept.
 */
export function trackReference(concept: Concept, sessionId: string): Concept {
  if (!concept.referencedInSessions.includes(sessionId)) {
    return {
      ...concept,
      referencedInSessions: [...concept.referencedInSessions, sessionId],
    };
  }
  return concept;
}

/**
 * Finalize the ledger for session end: update session tracking.
 */
export function finalizeSession(data: LedgerData, sessionId: string): LedgerData {
  // Move current session to previous sessions (keep last 10)
  if (sessionId && !data.previousSessionIds.includes(sessionId)) {
    data.previousSessionIds = [sessionId, ...data.previousSessionIds].slice(0, 10);
  }
  return data;
}

// ---- Inventory Formatting ----

/**
 * Format the concept inventory for session wrap-up display.
 */
export function formatInventory(data: LedgerData): string {
  const byStatus: Record<ConceptStatus, Concept[]> = {
    vague: [],
    forming: [],
    clear: [],
    frozen: [],
    metaphorOnly: [],
    zombie: [],
  };

  for (const id of data.order) {
    const c = data.concepts[id];
    byStatus[c.status].push(c);
  }

  const lines: string[] = [];
  const order: [ConceptStatus, string][] = [
    ['frozen', 'Frozen'],
    ['clear', 'Clear'],
    ['forming', 'Forming'],
    ['vague', 'Vague'],
    ['metaphorOnly', 'Metaphor Only'],
    ['zombie', 'Zombie'],
  ];

  lines.push('Concept inventory for this session:');
  for (const [status, label] of order) {
    const items = byStatus[status];
    if (items.length > 0 || status === 'zombie') {
      const names = items.map((c) => c.name).join(', ') || 'None';
      const suffix = status === 'frozen'
        ? ' — ready for implementation'
        : status === 'zombie'
          ? ''
          : '';
      lines.push(`  ${label} (${items.length})   ${names}${suffix}`);
    }
  }

  return lines.join('\n');
}
