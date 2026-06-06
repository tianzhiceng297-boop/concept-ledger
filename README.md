# Concept Ledger — OpenClaw Plugin

A living glossary that tracks concept maturity in your conversations. The plugin automatically detects naming chaos, intervenes at the right moment, and helps concepts evolve from vague to implementable — all without manual commands.

## Installation

```bash
npm install concept-ledger
```

Or build from source:

```bash
git clone <repo-url>
cd concept-ledger-plugin
npm install
npm run build
```

Add to your OpenClaw configuration:

```json
{
  "plugins": ["concept-ledger"]
}
```

## How It Works

The plugin maintains a **Concept Ledger** — a background knowledge graph of every term in your conversation. It tracks each concept through a 6-state lifecycle:

### State Machine

```
┌─────────┐    definition given     ┌─────────┐    boundaries stable    ┌───────┐    implementation confirmed    ┌────────┐
│  VAGUE  │ ──────────────────────→ │ FORMING │ ──────────────────────→ │ CLEAR │ ────────────────────────────→ │ FROZEN │
│         │                         │         │                         │       │                                 │        │
│ metaphor│ ←──────── downgrade ────│         │ ←── definition wrong ───│       │ ←────────── unfreeze ──────────│        │
│ /intuit │                         │         │                         │       │                                 │        │
└────┬────┘                         └─────────┘                         └───────┘                                 └───┬────┘
     │                                                                                                              │
     │ user tags                                                                                                     │ unreferenced
     ▼                                                                                                              ▼
┌──────────────┐                                                                                              ┌────────┐
│ METAPHOR     │                                                                                              │ ZOMBIE │
│ ONLY         │  (never upgrades)                                                                            │        │
└──────────────┘                                                                                              └────────┘
```

### Statuses

| Status | Meaning | How to Enter |
|--------|---------|--------------|
| **Vague** | Metaphor or intuition; cannot be described without figurative language | Default entry for new concepts |
| **Forming** | Has a provisional definition; general logic can be articulated | Definition is provided by user or agent |
| **Clear** | Can be described independently and without ambiguity; boundaries explicit | Definition is stable and used consistently |
| **Frozen** | Entered implementation path; has an interface or data structure | User confirms or code appears |
| **Metaphor Only** | Explicitly declared as a figure of speech; never to be resolved | User tags it |
| **Zombie** | Frozen but no longer referenced in recent sessions | Auto-detected by scanner |

## Auto-Detection

The plugin continuously scans conversations for these signals:

| Signal | Trigger | Behavior |
|--------|---------|----------|
| **Synonym Loop** | 3+ alternative names for the same concept | Pauses and suggests unification |
| **Definition Drift** | Meaning of a Forming/Clear concept shifts significantly | Alerts: upgrade or redefinition? |
| **Metaphor Overreach** | Vague concept tied to implementation details | Blocks: define clearly first |
| **Concept Collision** | Two concepts are logically equivalent | Suggests merging |
| **Zombie Concept** | Frozen concept unreferenced in 5+ sessions | Marks as Zombie, suggests review |

## User Gestures

| Gesture | Effect |
|---------|--------|
| `Lock [Concept] = [Definition]` | Freeze directly with final definition |
| `Merge [A], [B]` | Merge B into A; A inherits all associations |
| `Discard [Concept]` | Remove from ledger entirely |
| `Metaphor only [Concept]` | Mark as Metaphor Only; plugin stops pushing for upgrade |
| `Unfreeze [Concept]` | Frozen → Clear; allow modification |

## Session Wrap-Up

At the end of each session, the plugin embeds a concept inventory:

```
Concept inventory for this session:
  Frozen (2)   Data Funnel, Event Pipeline — ready for implementation
  Clear  (1)   Message Decay — suggest freezing after confirming interface
  Forming (2)  Perception Gateway, Sentiment Probe — continue refining
  Vague  (1)   Green Channel — suggest discarding or redefining
  Zombie (0)   None
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
| `projectId` | string | `"default"` | Isolate ledgers by project |
| `autoIntervene` | boolean | `true` | Whether to automatically intervene when signals are detected |
| `synonymThreshold` | number | `0.85` | Jaro-Winkler similarity threshold for synonym detection |

## Storage

All data is stored in **local JSON files** at:

```
~/.openclaw/concept-ledger/{projectId}.json
```

- Data is written atomically (temp file → rename) to prevent corruption
- Automatic schema migration on version upgrades
- Path safety validation prevents directory traversal

## Disclaimer

**This plugin operates entirely locally.** It reads and writes only JSON files in the `~/.openclaw/concept-ledger/` directory. It does not:

- Make any network requests
- Execute shell commands
- Read environment variables
- Upload any data to external services
- Access files outside the `concept-ledger` storage directory

## Development

```bash
npm install
npm run build
npm test
```

### Project Structure

```
src/
├── index.ts       # Plugin entry: register(api), lifecycle hooks
├── ledger.ts      # State machine engine, transitions, commands
├── scanner.ts     # Term scanner: 5 detection signals
├── parser.ts      # LLM response parser: concepts, definitions, gestures
├── store.ts       # JSON persistence with atomic writes
├── types.ts       # All type definitions
└── __tests__/     # Test files
    ├── ledger.test.ts
    ├── scanner.test.ts
    └── store.test.ts
```

## License

MIT

## 安全声明

本插件仅操作本地 JSON 文件（`~/.openclaw/concept-ledger/`），不上传任何数据到远程服务器，不执行网络请求，不调用 shell 命令，不读取环境变量。文件路径通过 `path.relative` 白名单严格校验，防止目录遍历攻击。

## 从 Skill 迁移

如果你之前使用过 Concept Ledger Skill（纯文档版本），Plugin 版本提供：

- **真正的跨会话持久化**：Skill 版本每次会话从零开始；Plugin 版本自动保存和恢复概念状态
- **自动检测信号**：Skill 版本依赖 LLM 自觉扫描对话内容；Plugin 版本在 Hook 中硬编码阈值自动执行
- **状态机硬编码约束**：Skill 版本的状态转换可能被 LLM 忽略或绕过；Plugin 版本通过 TRANSITIONS 表强制校验，非法转换直接报错
- **路径安全**：Plugin 版本对文件 I/O 进行白名单路径校验，Skill 版本无文件操作

Skill 版本轻量、不依赖任何构建，适合快速试用的场景。Plugin 版本更强健，适合需要跨会话术语一致性的长期项目。
