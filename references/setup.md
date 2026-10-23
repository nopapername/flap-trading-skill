# Installation and first use

Requirements: Node22+, npm, Binance official `@binance/agentic-wallet` CLI >=1.11.0. Wallet signing stays inside the official CLI. This package does not contain or implement a wallet.

Install this repository as `~/.codex/skills/flap-trading` (or your AI client's skill directory), then `npm ci --ignore-scripts` inside it. Restart/reload skill discovery. Claude Code can use `~/.claude/skills/flap-trading`. The skill folder includes its own CLI; a root SKILL.md alone without src/dependencies is insufficient.

Install the official wallet dependency with `npm install -g @binance/agentic-wallet@1.11.0 --ignore-scripts`, or an explicitly reviewed newer compatible version. Follow Binance's official Skill for login QR/verification and App developer-mode setup. Never paste credentials into this skill. Wallet CLI changes require re-running compatibility checks; this project targets v1.11.0.

Run `node src/cli.mjs doctor`. It only reads status. State is stored outside installed code: `FLAP_HOME`, otherwise `$XDG_DATA_HOME/flap-trading-skill`, otherwise `~/.local/share/flap-trading-skill`. `--data-dir` overrides both policy and ledger location. Upgrades preserve this directory; keep it private and back it up before upgrades.

Ask the user to choose wallet, budget, slippage and mode before init. Example AFTER a user authorizes these values:

```sh
node src/cli.mjs init --wallet YOUR_BNB_CHAIN_ADDRESS --budget 0.1 --slippage-bps 100 --mode confirm
```

To explicitly authorize automatic buys, select `--mode auto`; independent flags `--allow-quote-conversion`, `--allow-direct`, and `--ack-audit-unavailable` each require the user's authorization. Default mode is read-only and those flags default false. Global hard caps:1BNB and500bps; personal limits may be lower. Gas is additional and reserved before buying. The initializer never overwrites existing policy; review changes explicitly. `FLAP_READ_ONLY=1` blocks all wallet mutations even with `--live`.
