// ============================================================
// Concept Forge — Plugin Entry Point
// ============================================================
// register(api) is the single OpenClaw Plugin SDK entry.
// Hooks: session_start, after_response, session_end
// All hooks are wrapped in try-catch — errors never block
// the main conversation flow.
// ============================================================

import type { OpenClawPluginApi, LedgerData, DetectionSignal, ParsedMention } from './types';
import { loadLedger, saveLedger, resolveProjectId } from './store';
import {
  ensureConcept,
  findConceptByName,
  setDefinition,
  addAlias,
  freeze,
  unfreeze,
  merge,
  discard,
  markMetaphorOnly,
  checkVagueAging,
  incrementVagueTurns,
  finalizeSession,
  formatInventory,
  transition,
} from './ledger';
import { parseResponse, parseStateIntents, parseGestures } from './parser';
import { scanAll } from './scanner';

// ---- Plugin State ----

/** In-memory ledger state for the current session */
let ledger: LedgerData | null = null;
let currentProjectId = 'default';
let currentSessionId = '';

// ---- Entry Point ----

export function register(api: OpenClawPluginApi): void {
  const log = api.logger;

  log.info('[ConceptForge] Plugin registered');

  // ---- Hook: session_start ----
  api.on('session_start', async (context) => {
    try {
      const projectId = resolveProjectId(api.config, context.session.projectId);
      currentProjectId = projectId;
      currentSessionId = context.session.id;

      log.info(`[ConceptForge] session_start — projectId=${projectId}, sessionId=${currentSessionId}`);

      // Load existing ledger
      ledger = loadLedger(projectId, currentSessionId);

      // Finalize previous session's tracking
      ledger = finalizeSession(ledger, currentSessionId);

      // Format system prompt augmentation with existing concepts
      const promptAugmentation = buildSessionStartPrompt(ledger);

      log.info(`[ConceptForge] Loaded ledger with ${ledger.order.length} concepts`);

      return promptAugmentation;
    } catch (err) {
      log.error('[ConceptForge] Error in session_start hook:', err);
      return '';
    }
  });

  // ---- Hook: after_response ----
  api.on('after_response', async (context) => {
    try {
      if (!ledger) {
        log.warn('[ConceptForge] No ledger loaded — skipping after_response');
        return;
      }

      const lastMsg = context.lastResponse || context.messages[context.messages.length - 1];
      if (!lastMsg || !lastMsg.content) return;

      const text = lastMsg.content;

      // Increment turn counter and vague turns
      incrementVagueTurns(ledger);

      // 1. Parse mentions from the response
      const mentions = parseResponse(text);

      // 2. Parse user gestures
      const gestures = parseGestures(text);
      applyGestures(gestures, ledger, currentSessionId, api.logger);

      // 3. Parse state change intents
      const stateIntents = parseStateIntents(text);
      applyStateIntents(stateIntents, ledger, currentSessionId, api.logger);

      // 4. Process parsed mentions — create/update concepts
      processMentions(mentions, ledger, currentSessionId, api.logger);

      // 5. Scan for signals
      const signals = scanAll(ledger, mentions, currentSessionId);

      // 6. Check vague concept aging
      const staleVague = checkVagueAging(ledger);
      if (staleVague.length > 0) {
        const names = staleVague.map((c) => c.name).join('", "');
        signals.push({
          type: 'synonymLoop', // Using synonymLoop as closest match for aging alert; severity is info
          message: `Vague concepts "${names}" have not been upgraded in 10+ turns.`,
          conceptIds: staleVague.map((c) => c.id),
          suggestedAction: `"${names}" ${staleVague.length > 1 ? 'have' : 'has'} been Vague for 10+ turns. Consider: (a) defining ${staleVague.length > 1 ? 'them' : 'it'} as Forming, (b) merging with an existing concept, or (c) discarding.`,
          severity: 'info',
        });
      }

      // 7. Persist the ledger
      saveLedger(ledger);

      // 8. Format intervention text if auto-intervene is on and signals found
      let interventionText = '';
      if (api.config.autoIntervene !== false && signals.length > 0) {
        interventionText = formatInterventions(signals);
      }

      log.info(
        `[ConceptForge] after_response — ${mentions.length} mentions, ${gestures.length} gestures, ${signals.length} signals`
      );

      return interventionText || undefined;
    } catch (err) {
      api.logger.error('[ConceptForge] Error in after_response hook:', err);
      return;
    }
  });

  // ---- Hook: session_end ----
  api.on('session_end', async (context) => {
    try {
      if (!ledger) {
        log.warn('[ConceptForge] No ledger loaded — skipping session_end');
        return;
      }

      // Finalize and persist
      ledger = finalizeSession(ledger, currentSessionId);
      saveLedger(ledger);

      // Format inventory
      const inventory = formatInventory(ledger);

      log.info(`[ConceptForge] session_end — saved ledger with ${ledger.order.length} concepts`);

      return '\n\n' + inventory;
    } catch (err) {
      log.error('[ConceptForge] Error in session_end hook:', err);
      return '';
    }
  });
}

// ---- Internal Helpers ----

/**
 * Build the system prompt augmentation for session start.
 * Injects the current concept inventory so the LLM can reference it.
 */
function buildSessionStartPrompt(ledger: LedgerData): string {
  if (ledger.order.length === 0) return '';

  const nonVague = ledger.order
    .map((id) => ledger.concepts[id])
    .filter((c) => c.status !== 'vague' && c.status !== 'zombie');

  if (nonVague.length === 0) return '';

  const lines: string[] = [
    '',
    '---',
    '[Concept Forge] Previously tracked concepts:',
  ];

  for (const c of nonVague) {
    const defPreview = c.definition
      ? ` — ${c.definition.substring(0, 100)}${c.definition.length > 100 ? '...' : ''}`
      : '';
    lines.push(`  [${c.status.toUpperCase()}] ${c.name}${defPreview}`);
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Apply parsed user gestures to the ledger.
 */
function applyGestures(
  gestures: NonNullable<ParsedMention['gesture']>[],
  ledger: LedgerData,
  sessionId: string,
  log: OpenClawPluginApi['logger']
): void {
  for (const gesture of gestures) {
    try {
      switch (gesture.type) {
        case 'lock': {
          const result = freeze(ledger, gesture.conceptName, gesture.definition, ledger.turnCount, sessionId);
          if (result.success) {
            log.info(`[ConceptForge] Locked: "${gesture.conceptName}" = "${gesture.definition}"`);
          } else {
            log.warn(`[ConceptForge] Lock failed: ${result.error}`);
          }
          break;
        }
        case 'merge': {
          const result = merge(ledger, gesture.conceptA, gesture.conceptB, ledger.turnCount, sessionId);
          if (result.success) {
            log.info(`[ConceptForge] Merged: "${gesture.conceptA}" ← "${result.absorbed}"`);
          } else {
            log.warn(`[ConceptForge] Merge failed: ${result.error}`);
          }
          break;
        }
        case 'discard': {
          const result = discard(ledger, gesture.conceptName);
          if (result.success) {
            log.info(`[ConceptForge] Discarded: "${result.removed}"`);
          } else {
            log.warn(`[ConceptForge] Discard failed: ${result.error}`);
          }
          break;
        }
        case 'metaphorOnly': {
          const result = markMetaphorOnly(ledger, gesture.conceptName, ledger.turnCount, sessionId);
          if (result.success) {
            log.info(`[ConceptForge] Marked MetaphorOnly: "${gesture.conceptName}"`);
          } else {
            log.warn(`[ConceptForge] MetaphorOnly failed: ${result.error}`);
          }
          break;
        }
        case 'unfreeze': {
          const result = unfreeze(ledger, gesture.conceptName, ledger.turnCount, sessionId);
          if (result.success) {
            log.info(`[ConceptForge] Unfroze: "${gesture.conceptName}"`);
          } else {
            log.warn(`[ConceptForge] Unfreeze failed: ${result.error}`);
          }
          break;
        }
      }
    } catch (err) {
      log.error(`[ConceptForge] Error applying gesture:`, err);
    }
  }
}

/**
 * Apply parsed state change intents to the ledger.
 */
function applyStateIntents(
  intents: Array<{ conceptName: string; action: string; definition?: string }>,
  ledger: LedgerData,
  sessionId: string,
  log: OpenClawPluginApi['logger']
): void {
  for (const intent of intents) {
    try {
      switch (intent.action) {
        case 'freeze': {
          if (intent.definition) {
            freeze(ledger, intent.conceptName, intent.definition, ledger.turnCount, sessionId);
          } else {
            const existing = findConceptByName(ledger, intent.conceptName);
            if (existing) {
              freeze(ledger, intent.conceptName, existing.definition, ledger.turnCount, sessionId);
            }
          }
          break;
        }
        case 'unfreeze': {
          unfreeze(ledger, intent.conceptName, ledger.turnCount, sessionId);
          break;
        }
        case 'metaphorOnly': {
          markMetaphorOnly(ledger, intent.conceptName, ledger.turnCount, sessionId);
          break;
        }
        case 'discard': {
          discard(ledger, intent.conceptName);
          break;
        }
      }
    } catch (err) {
      log.error(`[ConceptForge] Error applying state intent:`, err);
    }
  }
}

/**
 * Process parsed mentions: create/update concepts in the ledger.
 */
function processMentions(
  mentions: ParsedMention[],
  ledger: LedgerData,
  sessionId: string,
  log: OpenClawPluginApi['logger']
): void {
  for (const mention of mentions) {
    try {
      // Get or create the concept
      let concept = ensureConcept(ledger, mention.name, ledger.turnCount, sessionId);

      // Apply definition if extracted
      if (mention.definition) {
        concept = setDefinition(concept, mention.definition, ledger.turnCount, sessionId);

        // Auto-upgrade: Vague → Forming when a definition is provided
        if (concept.status === 'vague') {
          const result = transition(concept, 'forming', ledger.turnCount, sessionId);
          if (result.success) {
            concept = result.concept;
            log.info(`[ConceptForge] Auto-upgraded "${concept.name}": Vague → Forming`);
          }
        }

        ledger.concepts[concept.id] = concept;
      }

      // Add as alias if detected as synonym
      if (mention.possibleAliasFor && mention.possibleAliasFor !== concept.id) {
        const targetConcept = ledger.concepts[mention.possibleAliasFor];
        if (targetConcept) {
          const updated = addAlias(targetConcept, mention.name);
          ledger.concepts[targetConcept.id] = updated;
          log.info(`[ConceptForge] Added alias "${mention.name}" → "${targetConcept.name}"`);
        }
      }

      // If the concept is updated, persist it
      if (concept !== ledger.concepts[concept.id]) {
        ledger.concepts[concept.id] = concept;
      }
    } catch (err) {
      log.error(`[ConceptForge] Error processing mention "${mention.name}":`, err);
    }
  }
}

/**
 * Format detection signals into natural-language intervention text.
 */
function formatInterventions(signals: DetectionSignal[]): string {
  if (signals.length === 0) return '';

  const blocks = signals
    .filter((s) => s.severity !== 'block') // Block signals should not be auto-sent; they need user confirmation
    .map((s) => {
      return `[Concept Forge] ${s.message} ${s.suggestedAction}`;
    });

  // Only include block signals if they are standalone and need immediate attention
  const blockSignals = signals.filter((s) => s.severity === 'block');
  for (const s of blockSignals) {
    blocks.push(`[Concept Forge] ⚠️ ${s.message} ${s.suggestedAction}`);
  }

  return blocks.length > 0 ? '\n\n' + blocks.join('\n\n') : '';
}
