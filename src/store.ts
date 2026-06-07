// ============================================================
// Concept Forge — Persistence Layer
// ============================================================
// All file I/O is confined to ~/.openclaw/concept-forge/
// No network, no shell, no env vars.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LedgerData, Concept, PluginConfig } from './types';

// ---- Constants ----

const STORAGE_DIR = '.openclaw';
const LEDGER_SUBDIR = 'concept-forge';
const LEGACY_LEDGER_SUBDIR = 'concept-ledger';
const CURRENT_VERSION = 1;
const PLUGIN_VERSION = '2.0.0';

// ---- Path Utilities ----

/**
 * Get the storage directory path: ~/.openclaw/concept-forge/
 * Validates that the resulting path contains "concept-forge" for safety.
 */
function getStorageDir(): string {
  const home = os.homedir();
  const dir = path.join(home, STORAGE_DIR, LEDGER_SUBDIR);
  validatePath(dir);
  return dir;
}

/**
 * Get the ledger file path: ~/.openclaw/concept-forge/{projectId}.json
 * Validates that the resulting path contains "concept-forge" for safety.
 */
function getLedgerPath(projectId: string): string {
  // Sanitize projectId to prevent directory traversal
  const safeId = sanitizeProjectId(projectId);
  const filePath = path.join(getStorageDir(), `${safeId}.json`);
  validatePath(filePath);
  return filePath;
}

/**
 * Sanitize project ID: only allow alphanumeric, hyphens, underscores.
 * Prevents directory traversal attacks.
 */
function sanitizeProjectId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

/**
 * Allowed base directory for ledger storage (resolved, trailing-sep form).
 * Computed lazily and cached so we only resolve once.
 */
let _allowedBase: string | null = null;
function allowedBase(): string {
  if (_allowedBase) return _allowedBase;
  const home = os.homedir();
  _allowedBase = path.resolve(home, STORAGE_DIR, LEDGER_SUBDIR) + path.sep;
  return _allowedBase;
}

/**
 * Validate that a path is within the concept-forge storage directory.
 * Uses path.resolve + path.relative — immune to substring-based
 * bypasses like /evil/concept-forge-backdoor/.
 * Throws if the resolved path is not under the allowed base.
 */
function validatePath(filePath: string): void {
  const resolved = path.resolve(filePath);
  const base = allowedBase();
  const relative = path.relative(base, resolved);
  // If relative starts with ".." or is absolute, the path escapes the base
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `Path validation failed: path must be under ${base}. Got: ${resolved}`
    );
  }
}

/**
 * Extract project ID from config or session context.
 */
export function resolveProjectId(config: PluginConfig, sessionProjectId?: string): string {
  return config.projectId || sessionProjectId || 'default';
}

// ---- Core Operations ----

/**
 * Ensure the storage directory exists.
 */
export function ensureStorageDir(): void {
  const dir = getStorageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Attempt to migrate data from the legacy concept-ledger/ path.
 * Returns the parsed LedgerData if migration succeeded, or null.
 */
function tryMigrateLegacyData(projectId: string): LedgerData | null {
  try {
    const home = os.homedir();
    const legacyDir = path.join(home, STORAGE_DIR, LEGACY_LEDGER_SUBDIR);
    const legacyPath = path.join(legacyDir, `${projectId}.json`);

    if (!fs.existsSync(legacyPath)) return null;

    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const data = JSON.parse(raw) as LedgerData;

    if (!data.version || !data.concepts || !data.order) return null;

    // Migrate schema if needed
    if (data.version < CURRENT_VERSION) {
      return migrate(data);
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Create an empty ledger for a project.
 */
export function createEmptyLedger(projectId: string, sessionId: string): LedgerData {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    projectId: sanitizeProjectId(projectId),
    concepts: {},
    order: [],
    turnCount: 0,
    sessionId,
    previousSessionIds: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      pluginVersion: PLUGIN_VERSION,
    },
  };
}

/**
 * Load the ledger from disk. Creates an empty one if it doesn't exist.
 */
export function loadLedger(projectId: string, sessionId: string): LedgerData {
  ensureStorageDir();
  const filePath = getLedgerPath(projectId);
  const safeProjectId = sanitizeProjectId(projectId);

  if (!fs.existsSync(filePath)) {
    // Try migrating from legacy concept-ledger/ path (v1.x → v2.0.0)
    const migrated = tryMigrateLegacyData(safeProjectId);
    if (migrated) {
      migrated.sessionId = sessionId;
      migrated.metadata.updatedAt = new Date().toISOString();
      migrated.metadata.pluginVersion = PLUGIN_VERSION;
      saveLedger(migrated);
      return migrated;
    }

    const empty = createEmptyLedger(safeProjectId, sessionId);
    writeLedgerSync(empty); // seed the file
    return empty;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let data: LedgerData;
  try {
    data = JSON.parse(raw) as LedgerData;
  } catch {
    // If JSON is corrupted, create a new ledger
    const empty = createEmptyLedger(safeProjectId, sessionId);
    writeLedgerSync(empty);
    return empty;
  }

  // Run migration if needed
  if (data.version < CURRENT_VERSION) {
    data = migrate(data);
  }

  // Update session tracking
  data.sessionId = sessionId;
  data.metadata.updatedAt = new Date().toISOString();

  return data;
}

/**
 * Save the ledger to disk atomically.
 * Writes to a temp file first, then renames to avoid corruption.
 */
export function saveLedger(data: LedgerData): void {
  ensureStorageDir();

  data.metadata.updatedAt = new Date().toISOString();
  data.metadata.pluginVersion = PLUGIN_VERSION;

  const targetPath = getLedgerPath(data.projectId);
  const tmpPath = targetPath + '.tmp';

  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf-8');

  // Atomic rename on POSIX; on Windows it's effectively atomic for same-volume
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Synchronous write (used during initialization, before hooks fire).
 * Less safe than saveLedger — only use when no async context is available.
 */
function writeLedgerSync(data: LedgerData): void {
  ensureStorageDir();
  const targetPath = getLedgerPath(data.projectId);
  const tmpPath = targetPath + '.tmp';

  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Delete a concept from the ledger and persist.
 */
export function removeFromLedger(data: LedgerData, conceptId: string): LedgerData {
  delete data.concepts[conceptId];
  data.order = data.order.filter((id) => id !== conceptId);
  saveLedger(data);
  return data;
}

// ---- Migration ----

/**
 * Migrate ledger data from older schema versions to the current version.
 * MVP: only handles v0 → v1 (adding metadata fields).
 */
export function migrate(data: LedgerData): LedgerData {
  let migrated = { ...data };

  if (migrated.version < 1) {
    // Ensure all concepts have the required fields
    for (const id of Object.keys(migrated.concepts)) {
      const c = migrated.concepts[id];
      if (!c.definitionHistory) {
        c.definitionHistory = c.definition
          ? [{ text: c.definition, recordedAt: c.createdAt, sessionId: migrated.sessionId }]
          : [];
      }
      if (!c.metadata) {
        c.metadata = {};
      }
      if (typeof c.vagueTurns === 'undefined') {
        c.vagueTurns = 0;
      }
      if (!c.referencedInSessions) {
        c.referencedInSessions = [];
      }
    }

    if (!migrated.previousSessionIds) {
      migrated.previousSessionIds = [];
    }

    if (!migrated.metadata) {
      migrated.metadata = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pluginVersion: PLUGIN_VERSION,
      };
    }

    migrated.version = 1;
  }

  saveLedger(migrated);
  return migrated;
}

// ---- Utility ----

/**
 * Generate a unique concept ID from a name.
 */
export function conceptIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Check if a path is safe (under concept-forge directory).
 */
export function isPathSafe(filePath: string): boolean {
  try {
    validatePath(filePath);
    return true;
  } catch {
    return false;
  }
}
