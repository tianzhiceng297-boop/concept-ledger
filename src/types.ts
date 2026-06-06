// ============================================================
// Concept Ledger — Type Definitions
// ============================================================

/** The six concept maturity states */
export type ConceptStatus =
  | 'vague'
  | 'forming'
  | 'clear'
  | 'frozen'
  | 'metaphorOnly'
  | 'zombie';

/** A single concept record in the ledger */
export interface Concept {
  /** Unique identifier (derived from canonical name, slugified) */
  id: string;
  /** Canonical name of the concept (PascalCase or descriptive phrase) */
  name: string;
  /** Current maturity status */
  status: ConceptStatus;
  /** Current definition text */
  definition: string;
  /** History of past definitions for drift detection */
  definitionHistory: DefinitionRecord[];
  /** Known alternative names (aliases) */
  aliases: string[];
  /** Dialogue turn when created (0-indexed) */
  createdAt: number;
  /** Dialogue turn when last modified */
  lastChanged: number;
  /** Number of consecutive dialogue turns this concept stayed Vague */
  vagueTurns: number;
  /** List of session IDs where this concept was referenced */
  referencedInSessions: string[];
  /** When this was marked Frozen */
  frozenAt?: number;
  /** Additional metadata */
  metadata: Record<string, string>;
}

/** A historical definition record */
export interface DefinitionRecord {
  text: string;
  recordedAt: number;
  sessionId: string;
}

/** The full ledger data structure persisted to disk */
export interface LedgerData {
  /** Schema version for migration */
  version: number;
  /** Project identifier */
  projectId: string;
  /** All concepts indexed by concept ID */
  concepts: Record<string, Concept>;
  /** Ordered list of concept IDs (creation order) */
  order: string[];
  /** Total dialogue turn counter */
  turnCount: number;
  /** Current session ID */
  sessionId: string;
  /** Previous session IDs (latest 10) for Zombie scanning */
  previousSessionIds: string[];
  /** Plugin-level metadata */
  metadata: {
    createdAt: string;
    updatedAt: string;
    pluginVersion: string;
  };
}

/** Signals detected by the scanner */
export interface DetectionSignal {
  type: SignalType;
  /** Human-readable description of the signal */
  message: string;
  /** Concepts involved (IDs) */
  conceptIds: string[];
  /** Suggested action text for the agent to present */
  suggestedAction: string;
  /** Severity: info, warn, block */
  severity: 'info' | 'warn' | 'block';
}

export type SignalType =
  | 'synonymLoop'
  | 'definitionDrift'
  | 'metaphorOverreach'
  | 'conceptCollision'
  | 'zombieConcept';

/** Parsed concept mentions from LLM responses */
export interface ParsedMention {
  /** Extracted concept name */
  name: string;
  /** Extracted definition, if any */
  definition?: string;
  /** The name this might be an alias for (if detected as synonym) */
  possibleAliasFor?: string;
  /** Detected user gesture */
  gesture?: UserGesture;
  /** Whether this appears inside a code block */
  inCodeBlock: boolean;
  /** Context snippet (surrounding text) */
  context: string;
}

/** User gestures that can be parsed from messages */
export type UserGesture =
  | { type: 'lock'; conceptName: string; definition: string }
  | { type: 'merge'; conceptA: string; conceptB: string }
  | { type: 'discard'; conceptName: string }
  | { type: 'metaphorOnly'; conceptName: string }
  | { type: 'unfreeze'; conceptName: string };

/** Transition table: from → set of allowed destinations */
export type TransitionMap = Record<ConceptStatus, ConceptStatus[]>;

/** Plugin configuration */
export interface PluginConfig {
  projectId?: string;
  autoIntervene?: boolean;
  synonymThreshold?: number;
}

/** OpenClaw Plugin API interface (what we receive from register()) */
export interface OpenClawPluginApi {
  /** Current plugin config */
  config: PluginConfig;
  /** Current session info */
  session: {
    id: string;
    projectId?: string;
  };
  /** Register a hook handler */
  on: (hook: PluginHookName, handler: HookHandler) => void;
  /** Get conversation history */
  getConversationHistory: () => Promise<ConversationMessage[]>;
  /** Logger */
  logger: {
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

export type PluginHookName = 'session_start' | 'after_response' | 'session_end';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export type HookHandler = (context: HookContext) => Promise<string | void>;

export interface HookContext {
  session: { id: string; projectId?: string };
  messages: ConversationMessage[];
  lastResponse?: ConversationMessage;
}

/**
 * Conservative SDK return: a plain string.
 * - session_start: return the system prompt augmentation (or '')
 * - after_response: return intervention text (or void)
 * - session_end: return concept inventory (or '')
 */
export type HookResult = string;
