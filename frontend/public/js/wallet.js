import { BrowserProvider } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import { SEPOLIA_HEX, SEPOLIA_BIG } from "./config.js";

/** UI refs */
const btnWallet   = document.getElementById("btnWallet");
const walletMenu  = document.getElementById("walletMenu");
const btnDisconnect = document.getElementById("btnDisconnect");

const walletModal = document.getElementById("walletModal");
const modalClose  = document.getElementById("modalClose");
const optMetaMask = document.getElementById("optMetaMask");
const mmStatus    = document.getElementById("mmStatus");
const mmInstall   = document.getElementById("mmInstall");

const pillNetwork = document.getElementById("pillNetwork");
const pillAddress = document.getElementById("pillAddress");
const pillContract= document.getElementById("pillContract");

let provider = null;
let signer   = null;
let user     = null;
let chainId  = null;

const listeners = new Set();
function notify() {
  for (const cb of listeners) cb({ provider, signer, user, chainId, isConnected: !!user });
}
export function onWalletState(cb){ listeners.add(cb); return () => listeners.delete(cb); }

export function setContractAddress(addr){
  if (pillContract) pillContract.textContent = `${addr.slice(0,8)}…${addr.slice(-4)}`;
}

/* ---------- modal helpers ---------- */
function showModal(){ walletModal.classList.remove("hide"); updateMMStatus(); }
function hideModal(){ walletModal.classList.add("hide"); }
function updateMMStatus(){
  const hasMM = !!window.ethereum && !!window.ethereum.request && (window.ethereum.isMetaMask || true);
  mmStatus.textContent = hasMM ? "Detected" : "Not found";
  mmInstall.classList.toggle("hide", hasMM);
}
modalClose?.addEventListener("click", hideModal);
walletModal?.addEventListener("click", (e) => { if (e.target === walletModal || e.target.classList.contains("modal__backdrop")) hideModal(); });

/* ---------- dropdown ---------- */
function toggleMenu(show){
  walletMenu.classList.toggle("hide", show === undefined ? !walletMenu.classList.contains("hide") : !show ? true : false);
}
document.addEventListener("click", (e) => {
  if (!walletMenu.contains(e.target) && e.target !== btnWallet) walletMenu.classList.add("hide");
});

/* ---------- chain tools ---------- */
async function ensureSepolia(){
  const id = await window.ethereum.request({ method: "eth_chainId" });
  if (BigInt(id) !== SEPOLIA_BIG) {
    try {
      await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: SEPOLIA_HEX }] });
    } catch (e) {
      if (e?.code === 4902) {
        await window.ethereum.request({
          method:"wallet_addEthereumChain",
          params:[{
            chainId: SEPOLIA_HEX, chainName:"Sepolia",
            nativeCurrency:{ name:"SepoliaETH", symbol:"SEP", decimals:18 },
            rpcUrls:["https://sepolia.infura.io/v3/"], blockExplorerUrls:["https://sepolia.etherscan.io"]
          }]
        });
      } else { throw e; }
    }
  }
}

/* ---------- connect / disconnect ---------- */
export async function connectMetaMask(){
  if (!window.ethereum || typeof window.ethereum.request !== "function") {
    updateMMStatus(); showModal(); return;
  }
  await ensureSepolia();
  provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  user = await signer.getAddress();
  const net = await provider.getNetwork();
  chainId = net.chainId;

  // UI
  btnWallet.textContent = "Wallet";
  pillNetwork.textContent = `Network: Sepolia (${chainId.toString()})`;
  pillAddress.textContent = `${user.slice(0,6)}…${user.slice(-4)}`;
  pillAddress.classList.remove("hide");

  hideModal();
  notify();
}

export function disconnectWallet(){
  provider = null; signer = null; user = null; chainId = null;

  pillAddress.classList.add("hide");
  pillAddress.textContent = "–";
  pillNetwork.textContent = "Network: –";

  btnWallet.textContent = "🔗 Connect";
  walletMenu.classList.add("hide");
  notify();
}

/* ---------- UI wiring ---------- */
btnWallet?.addEventListener("click", () => {
  if (!user) { showModal(); }
  else { toggleMenu(true); }
});
btnDisconnect?.addEventListener("click", () => disconnectWallet());
optMetaMask?.addEventListener("click", connectMetaMask);

/* Reload on chain/account change to keep app state sane */
if (window.ethereum?.on) {
  window.ethereum.on("chainChanged", () => location.reload());
  window.ethereum.on("accountsChanged", () => location.reload());
}

/* Export getters for app.js */
export function getWallet(){ return { provider, signer, user, chainId, isConnected: !!user }; }
