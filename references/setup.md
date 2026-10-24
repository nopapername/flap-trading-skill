# AI 安装与首次设置

用户只需授权安装、完成 App 扫码及选择交易规则。以下步骤由 AI 执行，不要求用户抄命令。

## 安装（首次或缺少依赖时）

1. 确定当前 AI 客户端的 Skill 目录。Codex 通常为 `~/.codex/skills/flap-trading`，Claude Code 为 `~/.claude/skills/flap-trading`；若客户端有官方 Skill 安装器，优先使用。优先安装最新稳定 Release；使用安装器时选择该版本的 ref，而非未发布代码。下载整个公开仓库/版本包，不能只安装 SKILL.md。不要覆盖已有安装或用户状态；升级用独立目录检查后切换，状态目录保持不变。
2. 检查 Node.js >=22 和 npm；缺少时按当前环境安装或明确报告需要的系统步骤。在 Skill 目录执行 `npm ci --ignore-scripts`。安装官方钱包依赖 `npm install -g @binance/agentic-wallet@1.11.0 --ignore-scripts`，或使用用户已安装的兼容版本；不要自行升级可用钱包会话。
3. 用绝对路径调用 `node <skill-directory>/src/cli.mjs doctor`。只输出需要用户知道的连接/依赖问题，不输出会话凭证。
4. 钱包未连接时，读取并使用官方 [Binance Agentic Wallet Skill](https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet) 的登录流程；官方 Skill 未安装时将其安装为依赖，读取 authentication/preflight 参考。向用户显示官方 CLI 返回的二维码/登录链接与配对码，等待其在 App 确认，再验证登录。不要伪造二维码，也不要收集私钥、助记词或会话令牌。开发者模式只能由用户在币安 App 开启；AI 只查询。

## 首次设置（一次收集，不逐项反复询问）

连接后展示完整钱包地址，合并询问尚未明确的选择：

- 每笔本金上限（<=1 BNB）及滑点（<=5%），Gas 另计。
- 模式：只读、逐笔确认、发送 CONFIG／预测 CA 自动买入。
- 是否允许兑换其他底池的支付币、是否允许已发行代币直接购买。
- 明确请求卖出后，是否自动仅将本次卖出所得支付币兑换为 BNB（`--auto-sale-to-bnb`；默认关闭）。
- 审计不可用时停止，还是用户明确知悉后允许继续；默认停止。

可以给一段可修改的回复模板，但示例不等于授权。例如“每笔最多0.1 BNB、滑点1%，发送CONFIG自动买入，允许底池兑换和已发行直购；审计不可用就停止”。用户已有明确选择时不重复问。新的配置只授权这个用户，不读取作者的 policy.json。

将确认过的值映射为 `init --wallet ADDRESS --budget BNB --slippage-bps BPS --mode auto|confirm|read-only`，仅在对应选择为允许时添加 `--allow-quote-conversion`、`--allow-direct`、`--ack-audit-unavailable`。每个执行参数必须有用户授权依据。模式和可选权限默认不开放；不能为了省事全选。

`init` 不覆盖已有 policy。已设置时核对现有授权，只处理用户明确要求的变化；不要每次 CONFIG 重做安装/登录/设置。用户安装后可能需要重载 Skill 列表，说明它将在客户端重载后可用。

## 设置完成

只需告诉用户：“已连接钱包，规则已保存。现在发送 Flap CONFIG 或预测 CA 即可按你授权的规则买入。”不要在该消息里自动购买示例地址。以后授权范围内收到输入，直接进入单进程买入，必要预览在后台连续执行；异常才提示。

## 状态与验收

状态位于 `FLAP_HOME`，否则 `$XDG_DATA_HOME/flap-trading-skill`，否则 `~/.local/share/flap-trading-skill`。`--data-dir` 同时隔离策略和台账。凭证始终由官方钱包管理，不拷贝到项目或 GitHub。

验收/开发强制 `FLAP_READ_ONLY=1`。`node scripts/acceptance.mjs` 使用本地 RPC 和严格只读钱包替身验证首次设置、CONFIG/CA、持仓、恢复；不会真实扫码或签名。真实链上解析可单独只读测试。模拟通过不等于真实资金成交已验证。
