# Protocol provenance

Chain: BNB Smart Chain56. Supported Factory, Portal and Reader addresses are fixed in src/core.mjs. Runtime resolves the Probe from Factory and verifies Probe.market(), assetProbe and Reader metadata. Discovery uses Factory.marketOfToken(address), not a guessed CREATE2 address or a third-party search result.

Interfaces verified from the official Flap app https://flap.sh/apps/agent-bonding-curve?lang=zh and its published component:
https://lulxnvty7pwl9d1n.public.blob.vercel-storage.com/vault-ui/vaultui_agent-bonding-curve_01M5FK4RKTKXQ8GDT8ZMZMAYVD/v20261023134909522_agent-bonding-curve_8b26639fea52/component.mjs
SHA256:08545080fdc1e4c8d86e827cb56a3d1f748d8369d905e29b1b1b98b374ddc83f (rechecked2026-10-24).

Only interfaces are included; the application bundle is not redistributed. Future protocol upgrades may require a release. Unknown Probe layouts or phase mismatches stop execution. Only complete Solidity Error(string) readings ending ;END are valid Probe results; Probe methods are simulation-only and never broadcast.
