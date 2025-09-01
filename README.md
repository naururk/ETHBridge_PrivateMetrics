# Cross-Chain ETH Bridge — Private Metrics (Zama FHEVM)

<p align="center"><img width="506" height="59" alt="image" src="https://github.com/user-attachments/assets/f3fe41d0-e08e-40ab-9aa5-5eb7abb0aab7" /> </p>

A minimal, production‑style dApp that bridges ETH between **Ethereum Sepolia (L1)** and **Base Sepolia (L2)** while recording **fully homomorphically encrypted (FHE)** usage metrics. Users keep their per‑wallet totals and history private; only **k‑anonymous** aggregates can be published as public snapshots.

Built with **Zama FHEVM** (Solidity library + Relayer SDK), **ethers/viem**, and plain HTML/CSS/JS.

<h2>
 <p align="center">
  <a href="https://drive.google.com/file/d/1pe5I_9lrvU-Vvr6GY6tjqpavKjn6_Vuf/view?usp=sharing" target="_blank" rel="noopener noreferrer">
    🎥 Video ETHBridge_PrivateMetrics_demo
  </a>
 </p>
</h2>

<h2>
 <p align="center">
  <a href="https://naururk.github.io/ETHBridge_PrivateMetrics/" target="_blank" rel="noopener noreferrer">
    🚀 Live Demo
  </a>
 </p>
</h2>

---

## Core features

* **Bridge ETH (L1↔L2)**

  * L1 ⇒ L2: `depositETH` via Base bridge
  * L2 ⇒ L1: `withdraw/withdrawTo`, with **Prove → Finalize** on L1
* **Private per‑wallet metrics** (sum & count)

  * All values are **encrypted on-chain** with FHE
  * Reading requires **User Decrypt (EIP‑712)** via Zama Relayer SDK
* **Per‑wallet history** (encrypted amounts + timestamps)

  * Grant/re-grant rights for past entries (`grantMyHistoryRange`)
  * Local analytics: 24h, 7d, Median, P90, size pies
* **Public snapshots with k‑anonymity**

  * `publish(src,dst,k)` reveals **only** if total tx ≥ k
  * Public fields are globally decryptable; private totals remain private
* **Robust finalization UI**

  * Scans L1 `Recorded` events, tracks withdrawal status
  * One-click **Prove** / **Finalize** with retries and fallbacks
* **Resilient RPC layer**

  * Endpoint rotation for Sepolia; backup RPCs for Base Sepolia
* **Clean UX**

  * Charts (Chart.js), history with pagination, toasts, tooltips

---

## Architecture

### Smart contract (Solidity)

* `MetricsHub.sol` (FHEVM)

  * Stores encrypted aggregates per direction `(src,dst)`
  * Stores encrypted per‑user history `(amountWei, timestamp)`
  * Emits `Recorded(src,dst,user,idx,originTx)` for each record
  * `publish(src,dst,k)` enforces k‑anonymity when revealing **public snapshots**
  * Utility functions `myHistoryLength`, `getMyHistory`, `grantMyHistory*`

### Frontend

* **Public UI** (static): `public/index.html`, `public/styles.css`
* **Logic**:

  * `public/js/app.js` — entry point, orchestrates modules
  * `public/js/finalization.js` — L2→L1 Prove/Finalize
  * `public/js/config.js` — chain IDs, RPCs, addresses, relayer URLs
  * `public/js/abi.js` — ABI for `MetricsHub`

### Zama Relayer SDK

* Used for **encrypting inputs** and **(public/user) decrypt** of FHE handles
* EIP‑712 signature gates per‑user access (time‑boxed UD session)

---

## Prerequisites

* **Node.js ≥ 18** (for local static server / tooling)
* **MetaMask** (or compatible wallet)
* Test ETH on **Sepolia** and **Base Sepolia**
* (Optional) API keys for **Alchemy/Infura** backups

> The app is static and loads dependencies from CDNs; a simple HTTP server is enough.

---

## Installation & run (dev)

```bash
# 1) Clone
git clone <your-repo-url>
cd <repo>/public

# 2) Serve statically (choose one)
# a) Node http-server
npx http-server -c-1 -p 5173 .
# b) Python
python3 -m http.server 5173
# c) Any static server (Vite preview, nginx, etc.)

# 3) Open in browser
http://localhost:5173/
```

> Do **not** open `index.html` with `file://` — use an HTTP server.

---

## Configuration

Edit `public/js/config.js` to match your environment:

```js
// Chain IDs
export const SEPOLIA_HEX = "0xaa36a7";
export const SEPOLIA_BIG = 11155111n;
export const BASE_SEPOLIA_HEX = "0x14A34"; // 84532
export const BASE_SEPOLIA_BIG = 84532n;

// RPC / Explorer (L2)
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
export const BASE_SEPOLIA_RPC_BACKUPS = [
  "https://base-sepolia.g.alchemy.com/v2/<ALCHEMY_KEY>",
  "https://base-sepolia.infura.io/v3/<INFURA_KEY>",
];

// RPC (L1) with rotation
export const SEPOLIA_RPC_PRIMARY   = "https://ethereum-sepolia.publicnode.com";
export const SEPOLIA_RPC_SECONDARY = "https://rpc.ankr.com/eth_sepolia";
export const SEPOLIA_RPC_BACKUPS   = ["https://eth-sepolia.public.blastapi.io"]; // optional

// Zama Relayer
export const RELAYER_URL = "https://relayer.testnet.zama.cloud";
export const GATEWAY_URL = "https://gateway.sepolia.zama.ai/";
export const KMS_ADDRESS = "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC";

// Contracts
export const CONTRACT_ADDRESS = "<MetricsHub on Base Sepolia>";
export const L2_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
export const L2_BRIDGE_BASE_SEPOLIA = "0x4200000000000000000000000000000000000010";
export const L1_BRIDGE_SEPOLIA = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120"; // L1StandardBridge
export const OPTIMISM_PORTAL_SEPOLIA  = "0x49f53e41452C74589E85cA1677426Ba426459e85";
export const L2_OUTPUT_ORACLE_SEPOLIA = "0x84457ca9D0163FbC4bbfe4Dfbb20ba46e48DF254";
```

* Replace `<ALCHEMY_KEY>/<INFURA_KEY>` with your API keys if you use backups.
* Set `CONTRACT_ADDRESS` to your deployed **MetricsHub** on Base Sepolia.

---

## How it works (flows)

### L1 ⇒ L2 (Deposit)

1. User deposits ETH via **L1StandardBridge**
2. Frontend records the same amount into `MetricsHub.record(...)`

   * Amount is encrypted client‑side via Relayer SDK
   * Contract updates FHE aggregates and appends encrypted history

### L2 ⇒ L1 (Withdraw → Prove → Finalize)

1. User initiates `withdraw` on L2 (Base Sepolia)
2. UI monitors status on L1: `waiting-to-prove` → `ready-to-prove` → `waiting-to-finalize` → `ready-to-finalize` → `finalized`
3. Prove & Finalize buttons call the Optimism Portal actions via **viem**

### Private reads

* Per‑wallet totals/history are decrypted using **User Decrypt** (EIP‑712) with a short‑lived UD session.

### Public snapshots (k‑anonymity)

* User sets **k** and clicks **Publish snapshot**
* Contract reveals only if `txCount ≥ k`; otherwise publishes zeros
* Public values can be read globally (no UD required)

---

## Development tips

* Avoid FHE ops in view functions (already respected in the contract)
* Use only Zama’s official packages:

  * Solidity: `@fhevm/solidity/lib/FHE.sol`
  * Relayer SDK: `@zama-fhe/relayer-sdk` (CDN variant is prewired)
* When switching accounts, the app resets UD context and clears UI totals to avoid data mixing
* RPC resilience: both L1 and L2 have fallback endpoints; keep them up‑to‑date

---

## Troubleshooting

* **503 / 400 on RPC**: add/rotate backup RPCs in `config.js`; ensure your keys are valid
* **Prove unavailable**: wait for L2 output to appear on L1; the UI will switch to `ready-to-prove` automatically
* **No public data after Publish**: your k‑threshold not met yet; increase activity or lower k (for testing)
* **History shows locks**: call `grantMyHistoryRange` automatically triggered by the app; if still locked, re‑click Refresh

---

## Roadmap ideas

* Multi‑token support (ERC‑20)
* Export history to CSV
* WebSocket live updates (logs, balances)
* Local LRU cache for decrypted handles
* Optional monthly epochs for public snapshots

---

## License

MIT. See `LICENSE`.
