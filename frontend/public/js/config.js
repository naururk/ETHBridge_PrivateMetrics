// ================== Chain IDs ==================
export const SEPOLIA_HEX = "0xaa36a7";
export const SEPOLIA_BIG = 11155111n;

// ✅ Base Sepolia: правильный chainId 0x14A34 (84532)
export const BASE_SEPOLIA_HEX = "0x14A34";
export const BASE_SEPOLIA_BIG = 84532n;

// ============== RPC / Explorer (L2) ============
export const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";

export const BASE_SEPOLIA_RPC_BACKUPS = [
  "https://base-sepolia.g.alchemy.com/v2/ВАШ_КЛЮЧ",
  "https://base-sepolia.infura.io/v3/ВАШ_КЛЮЧ"
];

// ============== RPC / Explorer (L1) ============
// CORS-friendly read-only RPC для Sepolia (первичные + запасные)
export const SEPOLIA_RPC_PRIMARY   = "https://ethereum-sepolia.publicnode.com";
export const SEPOLIA_RPC_SECONDARY = "https://rpc.ankr.com/eth_sepolia";
export const SEPOLIA_RPC_BACKUPS = [
  "https://eth-sepolia.public.blastapi.io"
];
// (если где-то нужен единый alias)
export const SEPOLIA_RPC = SEPOLIA_RPC_PRIMARY;

// ================== Zama relayer ================
export const RELAYER_URL = "https://relayer.testnet.zama.cloud";
export const GATEWAY_URL = "https://gateway.sepolia.zama.ai/";
export const KMS_ADDRESS = "0x1364cBBf2cDF5032C47d8226a6f6FBD2AFCDacAC";

// ============== Your contract (L2) ==============
export const CONTRACT_ADDRESS = "0xB6970Bd34dd8Ac7eE684dEFB61399D2B122905eB"; // MetricsHub on Base Sepolia

// L2ToL1MessagePasser (OP Stack системный адрес)
export const L2_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";

// ============== Bridges & Portals ===============
// L2 (Base Sepolia) Standard Bridge — системный адрес OP-Stack
export const L2_BRIDGE_BASE_SEPOLIA = "0x4200000000000000000000000000000000000010";

// L1 (Ethereum Sepolia) контракты Base:
export const L1_BRIDGE_SEPOLIA        = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120"; // L1StandardBridge
export const OPTIMISM_PORTAL_SEPOLIA  = "0x49f53e41452C74589E85cA1677426Ba426459e85"; // OptimismPortal
export const L2_OUTPUT_ORACLE_SEPOLIA = "0x84457ca9D0163FbC4bbfe4Dfbb20ba46e48DF254"; // L2OutputOracle (не обязателен в этом фронте)
