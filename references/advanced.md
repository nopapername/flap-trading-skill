# Flap Trading Skill

独立、可分发的社区 AI Skill，通过币安官方 Agentic Wallet 操作 BNB Chain 上的 Flap Agent 内盘。**不是币安或 Flap 官方产品。** 当前版本0.1.1，尚未以真实资金验证分发版本。

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

ERC20 自动兑换、已发行代币直接购买和审计不可用时继续交易，分别由 `--allow-quote-conversion`、`--allow-direct`、`--ack-audit-unavailable` 选择启用，默认均关闭。用户可设置更低限额；程序硬上限为每意图本金1BNB、滑点5%，Gas另计。不会自动加大滑点或反复补资金。详见[首次设置](setup.md)。

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
node src/cli.mjs accounts
```

链接支持 `https://flap.sh/apps/agent-bonding-curve?token=0x...`，也接受单独的 `ca`、`address` 或 `market` 参数；不抓取用户 URL。未知映射会要求提供 Mini App CONFIG。原生 BNB 内盘和 ERC20 内盘按钱包剩余最高份额计算；ERC20 最多兑换一次后按实际余额买入。已发行 DEX 直购使用明确授权的预算，不套用内盘份额上限。

默认请求 ID 对每钱包/市场保持稳定，重复发送不会重复买入。明确再次购买才使用新的 `--request ID`。买入后的持仓表显示币名/完整CA、余额、成本含Gas、预计可卖价值、净盈亏。

卖出必须另行明确请求：

```sh
node src/cli.mjs sell market.config --share-bps 10000 --live --confirm --request MY_SALE_ID
node src/cli.mjs exit QUOTE_OR_ACTUAL_TOKEN_CA --amount all --live --confirm --request MY_EXIT_ID
```

内盘卖出返回市场支付资产；ERC20→BNB 是独立的显式兑换。不会自动卖出、领取、清理尾差或在资金兑换后更换场所。阶段3尚未领取的份额须另行处理，本版不执行 claim。

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
