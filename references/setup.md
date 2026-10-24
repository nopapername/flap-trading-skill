# AI 安装与首次设置

用户可用 README 中的一条消息同时请求安装并明确交易规则。AI 连续完成以下工作，用户只处理必须的 App 操作和缺失选择，不要求用户抄命令或另发一段配置。

收到请求就提取用户实际给出的预算、滑点、模式、底池兑换、直购及审计选择；在钱包核实前暂存这些选择，不提前绑定或执行交易。仅阅读文档中的示例不算授权。

## 默认交易规则（v1）

用户明确说“按默认交易规则设置”，表示接受下面的首次设置组合；无需逐项再次确认：

- 允许在用户本金预算内为购买兑换支付币，最多兑换一次；允许经验证的已发行代币用 BNB 直购。
- 审计不可用就停止；不自动开放审计豁免、卖出后换币、自动卖出或 claim。
- 已明确的预算、滑点和模式直接复用，缺失的必要选择才合并询问；预算和自动买入模式不能仅从“默认规则”推断。

将该选择映射为 `--allow-quote-conversion --allow-direct`，不添加 `--ack-audit-unavailable` 或 `--auto-sale-to-bnb`。用户明确的“不允许”等覆盖此组合。该组合只供用户选择，不因安装、阅读示例、已有作者授权或本说明更新而生效；未选择时沿用未开放的默认权限，不覆盖已有 policy。后续规则调整不能追溯扩大已保存授权。

## 安装（首次或缺少依赖时）

1. 确定当前 AI 客户端的 Skill 目录。Codex 通常为 `~/.codex/skills/flap-trading`，Claude Code 为 `~/.claude/skills/flap-trading`；若客户端有官方 Skill 安装器，优先使用。优先安装最新稳定 Release；使用安装器时选择该版本的 ref，而非未发布代码。下载整个公开仓库/版本包，不能只安装 SKILL.md。不要覆盖已有安装或用户状态；升级用独立目录检查后切换，状态目录保持不变。
2. 检查 Node.js >=22 和 npm；缺少时按当前环境安装或明确报告需要的系统步骤。在 Skill 目录执行 `npm ci --ignore-scripts`。安装官方钱包依赖 `npm install -g @binance/agentic-wallet@1.11.0 --ignore-scripts`，或使用用户已安装的兼容版本；不要自行升级可用钱包会话。
3. 用绝对路径调用 `node <skill-directory>/src/cli.mjs doctor`。只输出需要用户知道的连接/依赖问题，不输出会话凭证。
4. 钱包未连接时，读取并使用官方 [Binance Agentic Wallet Skill](https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet) 的登录流程；官方 Skill 未安装时将其安装为依赖，读取 authentication/preflight 参考。向用户显示官方 CLI 返回的二维码/登录链接与配对码，等待其在 App 确认，再验证登录。不要伪造二维码，也不要收集私钥、助记词或会话令牌。开发者模式只能由用户在币安 App 开启；AI 只查询。

## 首次设置（一次收集，不逐项反复询问）

复用安装消息中已明确的规则；确实缺少必要选择时一次问清，不要求用户重新复制模板。钱包连接后核实完整地址，再保存授权。需要核对的项目：

- 每笔本金上限（<=1 BNB）及滑点（<=5%），Gas 另计。
- 模式：只读、逐笔确认、发送 CONFIG／预测 CA 自动买入。
- 是否允许兑换其他底池的支付币、是否允许已发行代币直接购买。
- 明确请求卖出后，是否自动仅将本次卖出所得支付币兑换为 BNB（`--auto-sale-to-bnb`；默认关闭）。
- 审计不可用时停止，还是用户明确知悉后允许继续；默认停止。

可以给一段可修改的回复模板，但示例不等于授权。例如“每笔最多0.1 BNB、滑点1%，发送CONFIG自动买入，允许底池兑换和已发行直购；审计不可用就停止”。用户已有明确选择时不重复问。新的配置只授权这个用户，不读取作者的 policy.json。

将确认过的值映射为 `init --wallet ADDRESS --budget BNB --slippage-bps BPS --mode auto|confirm|read-only`，仅在对应选择为允许时添加 `--allow-quote-conversion`、`--allow-direct`、`--auto-sale-to-bnb`、`--ack-audit-unavailable`。每个执行参数必须有用户授权依据。模式和可选权限在未被用户选择时不开放；用户明确选择上述默认组合时按该组合保存，不能为了省事全选。

`init` 不覆盖已有 policy。已设置时核对现有授权，只处理用户明确要求的变化；不要每次 CONFIG 重做安装/登录/设置。用户安装后可能需要重载 Skill 列表，说明它将在客户端重载后可用。

## 设置完成

简短列出已验证的完整钱包地址、每笔预算、滑点、自动模式和可选权限，再告诉用户：“规则已保存，现在直接发送 Flap CONFIG 或预测 CA 即可按授权买入。”不要在该消息里自动购买示例地址。以后授权范围内收到输入，直接进入单进程买入，必要预览在后台连续执行；异常才提示。

## 状态与验收

状态位于 `FLAP_HOME`，否则 `$XDG_DATA_HOME/flap-trading-skill`，否则 `~/.local/share/flap-trading-skill`。`--data-dir` 同时隔离策略和台账。凭证始终由官方钱包管理，不拷贝到项目或 GitHub。

验收/开发强制 `FLAP_READ_ONLY=1`。`node scripts/acceptance.mjs` 使用本地 RPC 和严格只读钱包替身验证首次设置、CONFIG/CA、持仓、恢复；不会真实扫码或签名。真实链上解析可单独只读测试。模拟通过不等于真实资金成交已验证。
