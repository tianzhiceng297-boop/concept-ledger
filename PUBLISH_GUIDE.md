# 发布操作手册

本文档供人类在本地终端执行，所有命令可直接复制粘贴。

## 前置条件

- 本地已安装 Node.js (>= 18)
- 有 ClawHub 账号（通过 GitHub 登录）
- 本仓库已 clone 到本地

## 步骤

### 1. 安装 ClawHub CLI

```bash
npm install -g clawhub
```

### 2. 登录认证

```bash
clawhub login
```

- 浏览器会弹出 GitHub OAuth 授权页面
- 授权完成后，CLI 自动保存 session

### 3. 验证登录状态

```bash
clawhub whoami
```

- 预期输出：你的 ClawHub 用户名

### 4. 进入项目目录

```bash
cd /path/to/concept-forge
```

### 5. 最终构建与测试

```bash
npm install
npm run build
npm test
npm pack --dry-run
```

- 确认：`47/47` 测试通过
- 确认：`27 files, ~143 kB`

### 6. 预检发布（关键）

```bash
clawhub package publish . --family code-plugin --version 2.0.0 --dry-run
```

- 预期：`✓ Package validated`
- 如果报错，检查 manifest 字段，不要直接发布

### 7. 正式发布

```bash
clawhub package publish . --family code-plugin --version 2.0.0
```

- 成功后会在 dashboard 生成 Plugin 卡片

### 8. 监控审核状态

- 访问 https://clawhub.ai/dashboard
- 查看 Plugin 卡片状态：`Pending → Scanning → Pass / Review`
- Plugin 审核通常需要 3–5 个工作日

## 常见错误处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `Not authenticated` | 未登录 | 执行 `clawhub login` |
| `manifest.id format invalid` | ID 含大写或特殊字符 | 改 `openclaw.plugin.json` 的 `id` 为小写连字符 |
| `package.json missing openclaw.build` | 字段缺失 | 确认 `openclaw.build.openclawVersion` = `"2026.3.24-beta.2"` |
| `pluginApi version mismatch` | compat 版本不匹配 | 确认 `openclaw.compat.pluginApi` = `"1.0.0"` |
| `Path validation failed` | store.ts 路径校验触发 | 路径白名单限制在 `~/.openclaw/concept-forge/`，不要修改 |

## 审核通过后

- 在 README 中添加 "Plugin 版本已上线" 徽章
- 保留 Skill 版本作为轻量替代，不要删除
- 观察 Plugin 下载量（与 Skill 分开统计）

## 回滚（紧急情况）

如果需要下架当前版本：

```bash
clawhub package unpublish concept-forge --version 2.0.0
```
