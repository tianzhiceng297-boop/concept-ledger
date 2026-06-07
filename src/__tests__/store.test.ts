// ============================================================
// Concept Forge — Store Tests
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createEmptyLedger,
  loadLedger,
  saveLedger,
  resolveProjectId,
  conceptIdFromName,
  isPathSafe,
} from '../store';

const TEST_PROJECT = '__test_concept_forge';
const TEST_SESSION = 'test-session-1';

// Get a temp directory for testing
function getTestFilePath(): string {
  const home = os.homedir();
  return path.join(home, '.openclaw', 'concept-forge', `${TEST_PROJECT}.json`);
}

describe('Store — JSON Persistence', () => {
  afterEach(() => {
    // Clean up test file
    const filePath = getTestFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  test('createEmptyLedger creates a valid ledger with correct structure', () => {
    const ledger = createEmptyLedger(TEST_PROJECT, TEST_SESSION);

    expect(ledger.version).toBe(1);
    expect(ledger.projectId).toBe(TEST_PROJECT);
    expect(ledger.concepts).toEqual({});
    expect(ledger.order).toEqual([]);
    expect(ledger.turnCount).toBe(0);
    expect(ledger.sessionId).toBe(TEST_SESSION);
    expect(ledger.previousSessionIds).toEqual([]);
    expect(ledger.metadata.pluginVersion).toBe('2.0.0');
  });

  test('loadLedger creates a new ledger if none exists', () => {
    const filePath = getTestFilePath();
    // Ensure file does not exist
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const ledger = loadLedger(TEST_PROJECT, TEST_SESSION);
    expect(ledger.projectId).toBe(TEST_PROJECT);
    expect(ledger.order).toEqual([]);
  });

  test('saveLedger and loadLedger round-trip with concepts', () => {
    const ledger = createEmptyLedger(TEST_PROJECT, TEST_SESSION);

    // Add a concept manually
    ledger.concepts['event-filter'] = {
      id: 'event-filter',
      name: 'EventFilter',
      status: 'frozen',
      definition: 'Filters events based on threshold criteria',
      definitionHistory: [
        { text: 'Filters events', recordedAt: 0, sessionId: TEST_SESSION },
      ],
      aliases: ['DataSieve'],
      createdAt: 0,
      lastChanged: 5,
      vagueTurns: 0,
      referencedInSessions: [TEST_SESSION],
      frozenAt: 5,
      metadata: {},
    };
    ledger.order.push('event-filter');
    ledger.turnCount = 5;

    saveLedger(ledger);

    // Load it back
    const loaded = loadLedger(TEST_PROJECT, 'test-session-2');
    expect(loaded.order).toEqual(['event-filter']);
    expect(loaded.concepts['event-filter'].name).toBe('EventFilter');
    expect(loaded.concepts['event-filter'].status).toBe('frozen');
    expect(loaded.concepts['event-filter'].aliases).toContain('DataSieve');
    expect(loaded.turnCount).toBe(5);
  });

  test('saveLedger creates temp file and renames (atomic write)', () => {
    const ledger = createEmptyLedger(TEST_PROJECT, TEST_SESSION);
    saveLedger(ledger);

    const filePath = getTestFilePath();
    const tmpPath = filePath + '.tmp';

    // Temp file should not exist after successful rename
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  test('resolveProjectId uses config first, then session, then default', () => {
    expect(resolveProjectId({}, undefined)).toBe('default');
    expect(resolveProjectId({}, 'session-project')).toBe('session-project');
    expect(resolveProjectId({ projectId: 'config-project' }, undefined)).toBe('config-project');
    expect(resolveProjectId({ projectId: 'config-project' }, 'session-project')).toBe('config-project');
  });

  test('conceptIdFromName generates valid slugs', () => {
    expect(conceptIdFromName('EventFilter')).toBe('eventfilter');
    expect(conceptIdFromName('Event Filter')).toBe('event-filter');
    expect(conceptIdFromName('  Event  Filter  ')).toBe('event-filter');
    expect(conceptIdFromName('Some Concept Name')).toBe('some-concept-name');
    expect(conceptIdFromName('PascalCaseTerm')).toBe('pascalcaseterm');
  });
});

describe('Path Safety', () => {
  test('isPathSafe validates concept-forge paths', () => {
    const home = os.homedir();
    const safePath = path.join(home, '.openclaw', 'concept-forge', 'test.json');
    expect(isPathSafe(safePath)).toBe(true);
  });

  test('isPathSafe rejects paths outside concept-forge', () => {
    expect(isPathSafe('/etc/passwd')).toBe(false);
    expect(isPathSafe('/tmp/test.json')).toBe(false);
    expect(isPathSafe('../outside.json')).toBe(false);
  });
});
