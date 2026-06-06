# Changelog

## 1.0.0 — Plugin 首发 (2026-06-07)

这是 Concept Ledger 从纯 Markdown Skill 迁移为 OpenClaw Plugin 的首个正式版本。

### 新增
- **跨会话持久化**：概念账本自动保存到 `~/.openclaw/concept-ledger/{projectId}.json`，下次会话自动恢复 Clear/Forming/Frozen 概念
- **5 种自动检测信号**：
  - Synonym Loop — 同一概念出现第 3 个别名时触发，建议统一命名
  - Definition Drift — Forming/Clear 概念定义语义偏移 > 50% 时告警
  - Metaphor Overreach — Vague 概念进入代码块或接口描述时阻断
  - Concept Collision — 两个概念定义关键词重叠 > 80% 时建议合并
  - Zombie Concept — Frozen 概念 5 会话未被引用时标记为僵尸
- **5 种用户手势**：Lock / Merge / Discard / Metaphor only / Unfreeze
- **6 状态状态机**：Vague → Forming → Clear → Frozen，支持回退和 MetaphorOnly/Zombie 特殊状态
- **Vague 概念老化提醒**：Vague 概念超过 10 轮对话未升级，自动提示用户决策
- **会话收尾清单**：会话结束时自动输出概念状态汇总

### 技术实现
- TypeScript + OpenClaw Plugin SDK
- Jaro-Winkler 相似度算法（自实现，阈值 0.85）
- 中文 CJK bigram 分词
- JSON 原子写入（tmp + rename）
- `path.relative` 白名单路径校验
- 全部 Hook 包裹 try-catch，错误不阻断主对话

### 安全
- 仅操作本地 JSON 文件，无网络请求、无 shell 执行、无环境变量读取
- 文件读写严格限制在 `~/.openclaw/concept-ledger/` 目录内
- 目录遍历防护：`path.relative` 判断越界

### 从 Skill 版本的变更
| 维度 | Skill 版本 | Plugin 版本 |
|------|-----------|------------|
| 持久化 | 每次会话从零开始 | 跨会话自动恢复 |
| 检测触发 | 依赖 LLM 自觉扫描 | Hook 自动执行，硬编码阈值 |
| 状态约束 | 可能被 LLM 忽略 | 硬编码 TRANSITIONS 表，非法转换报错 |
| 路径安全 | 无文件操作 | 原子写入 + 白名单路径校验 |
