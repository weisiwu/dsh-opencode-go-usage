# dsh-opencode-go-usage

DSH Web UI 插件：在输入框卡片正下方常驻一条额度条，显示**当前会话所选路由所属 OpenCode Go 账号**的剩余量与状态（5 小时 / 周 / 月三档窗口 + 绑定窗口的重置倒计时）。

## 它解决什么

OpenCode Go 的限制是「月度美元额度折算成三档滚动窗口」（5 小时 = 20%、周 = 50%、月 = 100%），用尽时上游会按账号给出三类完全不同的报错：

| 上游报错 | 含义 | 是否会自己恢复 |
|---|---|---|
| `GoUsageLimitError` | 某一档窗口用尽 | 会，到 `resetsAt` 自动回血 |
| `CreditsError` | 余额/额度都不可用（若工作区开了 Use balance 回落，额度用尽也会伪装成这个） | 看情况，最容易误判 |
| `RegionError` | 模型新版只在中国区托管，需在该账号 workspace 显式 opt-in | 不会，必须人工点一次 |

插件把这三档窗口的真实数字直接画在输入框下面，因此「还剩多少、什么时候恢复」不再需要发一次真实推理请求去试错。

## 工作原理

```
浏览器半边（client）                          宿主半边（host）
─────────────────────────                    ────────────────────────────────
读会话的 modelSelection 投影 ──┐
（next ?? lastUsed）           │
                              ▼
                    conversation.composer.dock 槽位
                              │  rpc.call('/opencode-go-usage','usage')
                              ▼
                                              读 settings.yaml → 找 baseURL 指向
                                              opencode.ai/zen/go 的路由，按 apiKeyEnv
                                              分组为「账号」
                                                       │
                                              解析凭据（env → .credentials.yaml refs）
                                                       │
                                              GET {origin}/usage（TTL 60s + 单飞合并）
                                                       │
                              已脱敏的账号表 ◄──────────┘
```

- **凭据永不进浏览器**：host 只回传账号标签、路由列表、掩码后的 key（`sk-exam…1KEY`）与三档窗口数字。
- **只对 Go 路由显示**：当前会话选中的 provider 不在 Go 路由里时，整条不渲染，其他模型不受影响。
- **随切换即时更新**：切到别的账号（模型选择器的 `next`）会立即重读，不会继续显示上一个账号的余量。

## 安装

```bash
# 本地目录
pnpm dsh plugin --profile web add /path/to/dsh-opencode-go-usage

# 或直接从 GitHub
pnpm dsh plugin --profile web add github:weisiwu/dsh-opencode-go-usage
```

安装后重载 Web UI。插件依赖 `settings.yaml` 里的路由声明：任何 `baseURL` 指向 `https://opencode.ai/zen/go/v1` 且带 `apiKeyEnv` 的路由都会被自动识别，账号标签取该账号各路由 `displayName` 的公共前缀（如 `OpenCodeGo_1`）。

## 开发

```bash
npm install
npm test           # 单元测试（路由识别 / 额度读取与缓存 / 契约守卫 / 展示规则）
npm run typecheck
npm run build      # lib/index.js（host）+ lib/client.js（browser bundle）
npm run verify:artifacts
```

## 边界

- 只读：插件不写任何文件，也不修改任何路由或凭据。
- 只认 `opencode.ai/zen/go` 起源；Zen 的按量计费端点（`/zen/v1`）不在识别范围内。
- 上游用量接口为 `GET {origin}/usage`，返回 `rolling` / `weekly` / `monthly` 三档 `{status, percent, resetsAt}`；`percent` 是**已用**比例，界面显示的是 `100 - percent`。
- 上游接口若有变动，插件会把它归一化成 `invalid-response` 并在条上显示，而不是静默显示错误数字。

## 许可

MIT
