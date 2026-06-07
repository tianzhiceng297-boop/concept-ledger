# Changelog

## 2.0.0 — Brand Rebirth: Concept Ledger → Concept Forge (2026-06-08)

### Changed
- **Name**: `concept-ledger` → `concept-forge` (package, manifest, all internal references)
- **Storage path**: `~/.openclaw/concept-ledger/` → `~/.openclaw/concept-forge/` (existing data auto-migrated on first load)
- **Description**: rewritten with scenario-based positioning — client jargon decoding, brainstorming capture, team alignment
- **README**: complete rewrite — pain-point-first, 3 scenario cards, technical details folded below

### Added
- **Legacy data migration**: `loadLedger()` now checks old `concept-ledger/` directory and copies files to `concept-forge/` if new path is empty

## 1.0.1 (2026-06-07)

### Fixed
- Translated Security Statement and Migration Guide in README from Chinese to English for consistency

## 1.0.0 — Initial Plugin Release (2026-06-07)

First formal release, migrating from a pure Markdown Skill to an OpenClaw Plugin.

### Added
- **Cross-session persistence**: ledger automatically saved to `~/.openclaw/concept-ledger/{projectId}.json`; Clear/Forming/Frozen concepts auto-restored next session
- **5 auto-detection signals**:
  - Synonym Loop — triggered when a concept accumulates 3+ alternative names; suggests unification
  - Definition Drift — alerts when Forming/Clear concept definition shifts > 50% keyword overlap
  - Metaphor Overreach — blocks when Vague concepts appear in code blocks or interface descriptions
  - Concept Collision — suggests merging when two concepts have > 80% keyword overlap
  - Zombie Concept — marks Frozen concepts unreferenced in 5+ sessions
- **5 user gestures**: Lock / Merge / Discard / Metaphor only / Unfreeze
- **6-state state machine**: Vague → Forming → Clear → Frozen, with downgrade paths and MetaphorOnly/Zombie special states
- **Vague concept aging**: Prompts user to decide when Vague concepts remain un-upgraded for 10+ turns
- **Session wrap-up inventory**: Auto-outputs concept status summary at end of session

### Technical
- TypeScript + OpenClaw Plugin SDK
- Jaro-Winkler similarity algorithm (self-implemented, threshold 0.85)
- CJK bigram tokenization for Chinese text
- Atomic JSON writes (tmp + rename)
- `path.relative` whitelist path validation
- All hooks wrapped in try-catch; errors never block main conversation

### Security
- Local JSON file I/O only; no network requests, no shell execution, no env var reads
- File read/write strictly confined to `~/.openclaw/concept-ledger/`
- Directory traversal prevention via `path.relative` boundary check

### Migration from Skill
| Dimension | Skill Version | Plugin Version |
|-----------|--------------|----------------|
| Persistence | Starts from scratch each session | Auto-restores across sessions |
| Detection trigger | Relies on LLM self-awareness | Hook-driven, hardcoded thresholds |
| State constraints | May be ignored by LLM | Hardcoded TRANSITIONS table, invalid transitions throw |
| Path safety | No file operations | Atomic writes + whitelist path validation |
