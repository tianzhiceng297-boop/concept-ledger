# Concept Forge — Turn Vague Ideas into Crystal-Clear Specs

> *"What the client actually meant" — turbocharged.*

Your client says *"make it more intelligent"*, your team throws around metaphors like *"a data sieve"*, *"the green channel"*, and *"breathing room"* — and three weeks later nobody agrees on what anything means.

**Concept Forge** catches this chaos in real time. It captures metaphors and jargon from conversations, decodes fuzzy requirements, detects naming collisions and definition drift, and auto-builds a shared terminology dictionary your whole team can rely on.

## 🔥 Three Scenarios, One Plugin

### 🤯 Brainstorming Without Losing the Thread

Your team dumps 20 metaphors, 5 competing names for the same thing, and a dozen half-baked ideas into a session. The plugin:

- **Auto-captures** every concept mentioned — PascalCase terms, quoted phrases, Chinese and English alike
- **Detects synonym loops** — when 3+ different names refer to the same concept, it pauses and asks: *"Which one do we mean?"*
- **Tracks concept maturity** through a 6-state forge: `Vague → Forming → Clear → Frozen`

### 🗣️ Decoding "Client-Speak"

The client says *"The system should feel more premium"* or *"We need a smart recommendation engine."* The plugin:

- **Flags Vague concepts** that stay undefined for too long (10+ turns)
- **Blocks metaphor overreach** — if someone starts coding `class PremiumFeeling`, the plugin raises a red flag: *"Define this first."*
- **Detects definition drift** — when the same term subtly shifts meaning across the conversation: *"Is this a deepening, or two different things?"*

### 📖 Team Alignment: Single Source of Truth

- Every concept gets a **canonical name** and a **versioned definition history**
- At session end, a **concept inventory** is auto-generated — everyone sees what's frozen, what's forming, and what's still vague
- Concepts persist **across sessions** — pick up exactly where you left off last week

## ⚙️ The 6-State Forge

```
VAGUE ──(definition given)──→ FORMING ──(boundaries clear)──→ CLEAR ──(confirmed)──→ FROZEN ──(unreferenced)──→ ZOMBIE
  │                               │                            │                          │
  │ user tags                     │ downgrade                  │ redefinition needed      │ unfreeze
  ▼                               ▼                            ▼                          ▼
METAPHOR ONLY                  VAGUE                        FORMING                    CLEAR
```

| Status | What It Means | How It Gets There |
|--------|--------------|-------------------|
| **Vague** | Metaphor or intuition; can't be described without figurative language | Default entry point |
| **Forming** | Has a provisional definition; logic can be articulated | Definition is provided |
| **Clear** | Can be described independently and without ambiguity | Definition used consistently |
| **Frozen** | Locked in; ready for implementation or documentation | User confirms |
| **Metaphor Only** | Explicitly a figure of speech — never to be resolved | User tags it |
| **Zombie** | Frozen but unreferenced in 5+ sessions | Auto-detected |

## 🛡️ 5 Auto-Detection Signals

| Signal | What It Catches | Severity |
|--------|----------------|----------|
| **Synonym Loop** | 3+ names for the same thing (e.g., DataFunnel, DataSieve, EventStrainer) | ⚠️ Warn |
| **Definition Drift** | Same word, shifting meaning across turns | ⚠️ Warn |
| **Metaphor Overreach** | Vague concept appears in code/interface descriptions | 🚫 Block |
| **Concept Collision** | Two different names with near-identical definitions | ℹ️ Info |
| **Zombie Concept** | Frozen concept untouched for 5+ sessions | ℹ️ Info |

## Installation

```bash
npm install concept-forge
```

Or build from source:

```bash
git clone https://github.com/tianzhiceng297-boop/concept-forge.git
cd concept-forge
npm install
npm run build
npm test
```

Add to your OpenClaw configuration:

```json
{
  "plugins": ["concept-forge"]
}
```

## Configuration

```json
{
  "projectId": "my-project",
  "autoIntervene": true,
  "synonymThreshold": 0.85
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectId` | string | `"default"` | Isolate forge data by project |
| `autoIntervene` | boolean | `true` | Auto-intervene when signals are detected |
| `synonymThreshold` | number | `0.85` | Jaro-Winkler similarity threshold for synonym detection |

---
## Technical Details

### Storage

All data lives in **local JSON files** at `~/.openclaw/concept-forge/{projectId}.json`.

- Atomic writes (temp file → rename) prevent corruption
- Automatic schema migration on version upgrades
- Whitelist path validation prevents directory traversal
- **v1.x users**: ledger files from `~/.openclaw/concept-ledger/` are auto-migrated on first load

### User Gestures

| Gesture | Effect |
|---------|--------|
| `Lock [Concept] = [Definition]` | Freeze directly with final definition |
| `Merge [A], [B]` | Merge B into A |
| `Discard [Concept]` | Remove from ledger entirely |
| `Metaphor only [Concept]` | Mark as Metaphor Only — stop pushing for upgrade |
| `Unfreeze [Concept]` | Frozen → Clear; open for modification |

### Project Structure

```
src/
├── index.ts       # Plugin entry: register(api), lifecycle hooks
├── ledger.ts      # State machine engine, transitions, commands
├── scanner.ts     # 5 detection signals + Jaro-Winkler/CJK bigram engines
├── parser.ts      # LLM response parser: concepts, definitions, gestures
├── store.ts       # JSON persistence with atomic writes + legacy migration
├── types.ts       # All type definitions
└── __tests__/     # 47 test cases
```

### Security

This plugin operates **entirely locally**. It does not:
- Make network requests
- Execute shell commands
- Read environment variables
- Upload data to external services
- Access files outside `~/.openclaw/concept-forge/`

File I/O is confined via `path.relative` whitelist validation — directory traversal attacks are blocked at the boundary.

## License

MIT
