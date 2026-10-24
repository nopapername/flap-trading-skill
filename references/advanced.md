# Flap Trading Skill

独立、可分发的社区 AI Skill，通过币安官方 Agentic Wallet 操作 BNB Chain 上的 Flap Agent 内盘。**不是币安或 Flap 官方产品。** 当前版本0.1.11，尚未以真实资金验证分发版本。

支持：预测 CA / 完整 CONFIG / Flap 链接解析；最高可买份额；原生 BNB 和 ERC20 内盘；经验证的已发行代币 BNB 直购；显式内盘卖出及代币→BNB 兑换；订单恢复；多市场持仓和资金成本对账。

## 安装

需要 Node.js22+、npm，以及币安官方 baw>=1.11.0。将整个仓库安装为 Skill，不能只复制 SKILL.md：

```sh
git clone https://github.com/nopapername/flap-trading-skill.git "$HOME/.codex/skills/flap-trading"
cd "$HOME/.codex/skills/flap-trading"
npm ci --ignore-scripts
npm install -g @binance/agentic-wallet@1.11.0 --ignore-scripts
node src/cli.mjs doctor
```

重载 AI 的 Skill 列表。Claude Code 可将路径换成 `~/.claude/skills/flap-trading`。其他支持 SKILL.md 的客户端使用各自的 Skill 目录。也可在仓库运行 `npm install -g . --ignore-scripts`，获得 `flap-trading` 命令；这不替代 AI Skill 的安装。

钱包登录及开发者模式按[币安官方钱包 Skill](https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet)完成。钱包凭证由官方工具管理，本项目不接收私钥、助记词或登录会话。

## 首次设置

先连接自己的钱包，再明确授权预算、滑点和模式。下列为配置示例，替换钱包地址并自行选择额度：

```sh
node src/cli.mjs init --wallet YOUR_BNB_CHAIN_ADDRESS --budget 0.1 --slippage-bps 100 --mode confirm
```

- `read-only`：只查询，默认模式。
- `confirm`：每笔需要用户确认后使用 `--live --confirm`。
- `auto`：用户明确授权后，发送 CA/CONFIG 可在个人限额内自动买入。

ERC20 自动兑换、已发行代币直接购买和审计不可用时继续交易，分别由 `--allow-quote-conversion`、`--allow-direct`、`--ack-audit-unavailable` 选择启用，未选择权限时均关闭；明确接受默认交易规则v3时，AI在首次设置中保存以上三项及 `--auto-sale-to-bnb` 授权，无需逐项再次询问。已有策略不因升级改变。用户可设置更低限额；程序硬上限为每意图本金1BNB、滑点5%，Gas另计。不会自动加大滑点或反复补资金。详见[首次设置](setup.md)。

## 使用

可对 AI 说：

> 使用 Flap Trading，查询这个预测 CA：0x……
>
> 将这份 CONFIG 按我设置的自动买入规则执行。
>
> 查询全部持仓，检查未完成订单。

AI 应先核对你的授权；没有自动买入授权时，发送地址只进入查询/确认流程。CLI 示例：

```sh
node src/cli.mjs resolve 0xYOUR_PREDICTED_TOKEN_ADDRESS
node src/cli.mjs prepare market.config
node src/cli.mjs buy market.config --live --confirm
node src/cli.mjs operations
node src/cli.mjs recover REQUEST_ID
node src/cli.mjs portfolio
node src/cli.mjs reconcile-history
# Only persist canonical repairs to the local ledger; no wallet transaction:
FLAP_READ_ONLY=1 node src/cli.mjs reconcile-history --apply
node src/cli.mjs accounts
```

链接支持 `https://flap.sh/apps/agent-bonding-curve?token=0x...`，也接受单独的 `ca`、`address` 或 `market` 参数；不抓取用户 URL。未知映射会要求提供 Mini App CONFIG。原生 BNB 内盘和 ERC20 内盘按钱包剩余最高份额计算；ERC20 最多兑换一次后按实际余额买入。已发行 DEX 直购使用明确授权的预算，不套用内盘份额上限。

默认请求 ID 对每钱包/市场保持稳定，重复发送不会重复买入。明确再次购买才使用新的 `--request ID`。买入后的持仓表显示币名/完整CA、余额、成本含Gas、预计可卖价值、净盈亏。

卖出必须另行明确请求：

```sh
node src/cli.mjs sell market.config --share-bps 10000 --live --confirm --request MY_SALE_ID
node src/cli.mjs exit QUOTE_OR_ACTUAL_TOKEN_CA --amount all --live --confirm --request MY_EXIT_ID
```

`sell CONFIG` 自动识别内外盘。内盘按策略返回支付资产或只兑换本次所得为BNB；阶段3核对实际代币身份、代码、链上余额和精度后，按 `--share-bps` 指定比例卖出实际代币为BNB（向下取整，默认全部）。领取状态以固定区块claimableProbe为准，历史HELD_SHARES不冒充可领取数量；领取状态不可读时明确标未知。未领取份额不作为实际代币出售，不自动claim；仅有未领取份额时返回提示，两者同时存在时只卖已到账代币并说明其余份额。阶段2迁移期间停止。不会自动决定卖出时机、清理尾差或在已提交后更换场所。

## 恢复、成本与边界

数据保存在 `~/.local/share/flap-trading-skill`，可用 `FLAP_HOME` / `--data-dir` 隔离。升级不覆盖个人策略和台账。PREPARING、UNKNOWN、PENDING 等未完成状态阻止新意图花费同一笔资金；恢复只读取订单和回执，不重新签名。[恢复说明](recovery.md)。

成本与支付币余额分开记账，部分退款保留剩余成本。订单金额与真实净到账严格区分。缺少完整 BNB 入账证据或外部历史时，已实现盈亏保持未知，不能用报价填补；本版不提供全量链上历史索引。[对账说明](accounting.md)。

## 开发与测试

```sh
npm ci --ignore-scripts
npm test
npm run check:release
npm pack --ignore-scripts
```

测试启动器强制 `FLAP_READ_ONLY=1`，交易边界使用假适配器。只读链上解析另作烟测。不会为测试发起真实买卖、授权或签名。安装包仅包含源代码、Skill说明、依赖锁和脱敏样本，不包含开发者钱包、真实台账或授权。

[协议 ABI 来源](protocol.md) · MIT License

GitHub Actions 模板见 [docs/github-actions-test.yml](https://github.com/nopapername/flap-trading-skill/blob/main/docs/github-actions-test.yml)。首次上传所用令牌没有 workflow 权限，因此模板尚未启用；具有相应权限后，将其复制到 .github/workflows/test.yml 即可。上述本地及安装包测试已通过。

## 成交后统计

`buy`／`sell`／`exit`／确认完成的 `recover` 先返回交易结果，再返回独立持仓任务 ID。AI 自动用 `portfolio-job ID --wait-ms 30000` 取表；后台任务不持有交易队列，归档网络读取在钱包锁之外。`portfolio-job ID --resume` 只恢复统计，不恢复或重试金融操作。独立任务强制 `FLAP_READ_ONLY=1`，持仓快照须不早于触发它的确认区块；错误字段保留未知。

## 连续卖出为 BNB

用户接受默认规则v3或单独授权 `automaticSaleConversion` 后，初始化时加 `--auto-sale-to-bnb`；已有策略只能在用户明确授权后修改此字段，不能因升级自动开启。`sell CONFIG --live --confirm --request ID [--resume]` 创建 SALE_BNB_V1 父请求，关联固定 SELL_V1／EXIT_V1 子请求。仅兑换当前卖出实际到账原始数量，交易前再次验证链上精度/余额，不调用 amount=all。每个必要合约预览及风险检查保留，代币字段在固定区块批量读取。

查询 `recover PARENT_ID` 只读确认子阶段；下一步尚未提交时，同一请求 `sell ... --resume` 连续完成。PREPARING 且无提交标记可以显式恢复；UNKNOWN/PENDING 不可重发。卖出成功但兑换失败时，报告实际保留资产并刷新持仓，不能把整次流程说成未卖出。

净盈亏=已证明实际 BNB-本次卖出对应买入成本（含买入/资金兑换 Gas）-卖出 Gas-退出兑换 Gas。单独跟踪本次支付币所得批次，不稀释原有支付币成本。部分兑换保留余款，整体盈亏暂不标记完全已实现。

## 毕业后的自动卖出与恢复

阶段3卖出复用 EXIT_V1，保存市场、实际代币、精度、原始数量、卖出比例及未领取份额。`recover ID --order-id ID [--tx HASH]` 只读核实；只有未提交的PREPARING可以用原CONFIG、原比例、原滑点及同一请求 `sell ... --resume` 继续。已提交订单绝不按新余额重算或重复提交。旧SELL_V1/SALE_BNB_V1仍按旧流程恢复。

成交后持仓任务同时保存市场卖出报告，数量按实际代币精度显示。实际BNB须交易级证明，成本须与完整台账及卖前实际余额一致。额外授权费用不能证明已覆盖时，实收BNB仍按证据展示，净盈亏保留未知；已确认兑换Gas单列，不冒充全部费用。期初nonce读取不改变钱包，缺失或出现前置钱包交易时费用完整性保持未知。
