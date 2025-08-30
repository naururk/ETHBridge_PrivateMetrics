// public/js/app.js
// Bridge + Private totals (per-wallet) + History + Directional analytics + fixed tooltips.

import {
  BrowserProvider,
  JsonRpcProvider,
  Contract,
  ethers,
  getAddress,
} from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import { initSDK, createInstance, SepoliaConfig } from "https://cdn.zama.ai/relayer-sdk-js/0.1.2/relayer-sdk-js.js";

import {
  CONTRACT_ADDRESS, KMS_ADDRESS, RELAYER_URL, GATEWAY_URL,
  SEPOLIA_BIG, SEPOLIA_HEX, BASE_SEPOLIA_BIG, BASE_SEPOLIA_HEX,
  L1_BRIDGE_SEPOLIA, L2_BRIDGE_BASE_SEPOLIA, BASE_SEPOLIA_RPC,
  L2_MESSAGE_PASSER,
  SEPOLIA_RPC_PRIMARY, SEPOLIA_RPC_SECONDARY, SEPOLIA_RPC_BACKUPS
} from "./config.js";
import { ABI_METRICS_HUB } from "./abi.js";
import { setupFinalization } from "./finalization.js";

/* ================== flags / utils ================== */
const DEBUG = false;
const logWarn = (...a)=>{ if(DEBUG) console.warn(...a); };
const logInfo = (...a)=>{ if(DEBUG) console.info(...a); };

/* ================== L2 ETH & ABIs (OP Bedrock) ================== */
const L2_ETH = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
const L2_BRIDGE_ABI = [
  "function withdrawTo(address _l2Token, address _to, uint256 _amount, uint32 _l1Gas, bytes _data) payable",
  "function withdraw(address _l2Token, uint256 _amount, uint32 _l1Gas, bytes _data) payable",
  "event WithdrawalInitiated(address indexed l1Token, address indexed from, address indexed to, uint256 amount, bytes extraData)"
];

/* ============== DOM ============== */
const $ = (id) => document.getElementById(id);
const toasts = $("toasts");
const btnWallet = $("btnWallet"), walletMenu = $("walletMenu"), btnDisconnect = $("btnDisconnect");
const walletModal = $("walletModal"), modalClose = $("modalClose"), optMetaMask = $("optMetaMask");
const pillAddress = $("pillAddress");
const pillContract = $("pillContract"), contractMini = $("contractMini");
const pillNetwork = $("pillNetwork"); // ← NEW: network badge

/* KPI & charts (existing) */
let splitChart = null, countChart = null, trendChart = null;
const vSB = $("vSB"), cSB = $("cSB"), vBS = $("vBS"), cBS = $("cBS"), pvSB = $("pvSB"), pvBS = $("pvBS");

/* Directional analytics UI refs */
const btnRefreshAnalytics = $("btnRefreshAnalytics");
const sb24v = $("sb24v"), sb7dv = $("sb7dv"), sbMed = $("sbMed"), sbP90 = $("sbP90");
const bs24v = $("bs24v"), bs7dv = $("bs7dv"), bsMed = $("bsMed"), bsP90 = $("bsP90");
let sizeChartSB = null, sizeChartBS = null;

/* Bridge controls */
const segDeposit = $("segDeposit"), segWithdraw = $("segWithdraw");
const amtEth = $("amtEth"), btnDoBridge = $("btnDoBridge");
const amtBalance = $("amtBalance");
const btnMax = $("btnMax");

/* History UI */
const histTitle = $("histTitle");
const btnRefreshHist = $("btnRefreshHist");
const histStatus = $("histStatus"), histList = $("histList");
let histPager = $("histPager");

/* Bottom reads/publish */
const segSB = $("segSB"), segBS = $("segBS");
const btnPrivateRead = $("btnPrivateRead"), btnPublicRead = $("btnPublicRead"), btnPublish = $("btnPublish");
const kAnon = $("kAnon");
const statusEl = $("status");

/* Finalization UI */
const finalStatus = $("finalStatus"), finalList = $("finalList"), btnRefreshFinal = $("btnRefreshFinal"), btnFinalizeAll = $("btnFinalizeAll");

/* Progress modal */
const progressModal = $("progressModal"), progressList = $("progressList"), progressClose = $("progressClose");
progressClose?.addEventListener("click", ()=>progressModal.classList.add("hide"));
function openProgress(){ progressModal?.classList.remove("hide"); progressList?.querySelectorAll("li").forEach(li=>li.classList.remove("done","active")); progressList?.querySelector('[data-step="enc"]')?.classList.add("active"); }
function markProgress(step){ const all=["enc","send","confirm","decrypt"]; const idx=all.indexOf(step); progressList?.querySelectorAll("li").forEach((li,i)=>{ if(i<idx) li.classList.add("done"); li.classList.toggle("active", i===idx); }); }
function closeProgress(){ progressModal?.classList.add("hide"); }
const safeClose = ()=>{ try{ closeProgress(); }catch{} };

/* ============== State ============== */
let provider, signer, user, contract, relayer;
const zero = "0x" + "0".repeat(64);
const DIR_S2B = { src: Number(SEPOLIA_BIG), dst: Number(BASE_SEPOLIA_BIG) };
const DIR_B2S = { src: Number(BASE_SEPOLIA_BIG), dst: Number(SEPOLIA_BIG) };
let activeBridge = "deposit"; // 'deposit' | 'withdraw'
let activeDir = "s2b";       // 's2b' | 'b2s'
let lastBalanceWei = 0n;

/* HISTORY pagination */
const HIST_PAGE_SIZE = 10;
let histTotal = 0;
let histPage = 1;
let histPages = 1;

/* ============== helpers ============== */
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function toast(msg,type="good",ms=2600){ const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=msg; toasts.appendChild(el); setTimeout(()=>el.remove(),ms); }
const setLoading=(el,on)=>el?.classList?.toggle("loading",!!on);
const setStatus=(t)=>{ if(statusEl) statusEl.textContent=t||""; };
function setStatusShort(eOrMsg){ let msg=typeof eOrMsg==="string"?eOrMsg:(eOrMsg?.shortMessage||eOrMsg?.reason||eOrMsg?.message||"Unknown error"); msg=String(msg).replace(/^Error:\s*/,'').replace(/\s{2,}/g,' ').slice(0,180); setStatus(msg); }
const isUserRejection=(e)=>e?.code===4001||e?.code==="ACTION_REJECTED"||/denied|rejected/i.test(e?.message||"");
function parseEthRelaxed(inp){ const s=String(inp??"").trim().replace(",",".").replace(/\s+/g,""); if(!/^\d*\.?\d+$/.test(s)) throw new Error("Enter a valid amount"); const wei=ethers.parseUnits(s,18); if(wei<=0n) throw new Error("Amount must be > 0"); return wei; }
function weiToEthStr(n){ return (Number(n)/1e18).toLocaleString(undefined,{ maximumFractionDigits:6 }); }
const toHex=(n)=>"0x"+BigInt(n).toString(16);

/* ===== Read-only providers ===== */
const BASE_SEPOLIA_NET = { chainId: Number(BASE_SEPOLIA_BIG), name: "base-sepolia" };
const roBase = new JsonRpcProvider(BASE_SEPOLIA_RPC, BASE_SEPOLIA_NET);

/* ===== Raw Sepolia RPC (rotation) ===== */
const SEPOLIA_ENDPOINTS=[SEPOLIA_RPC_PRIMARY,SEPOLIA_RPC_SECONDARY,...(SEPOLIA_RPC_BACKUPS||[])].filter(Boolean);
async function rpc(url, method, params, timeoutMs=3500){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const res=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:Math.floor(Math.random()*1e6),method,params}),signal:ctl.signal});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json(); if(data.error) throw new Error(data.error.message||"RPC error");
    return data.result;
  } finally { clearTimeout(t); }
}
async function sepoliaRpcTry(method, params){
  let last; for(const u of SEPOLIA_ENDPOINTS){ try{ return await rpc(u,method,params); }catch(e){ last=e; logWarn(`[Sepolia RPC fail] ${u}:`,e?.message||e); } }
  throw last||new Error("All Sepolia RPC failed");
}
async function sepoliaGetCode(addr){ return await sepoliaRpcTry("eth_getCode",[addr,"latest"]); }
async function sepoliaGetBalance(addr){ const hex=await sepoliaRpcTry("eth_getBalance",[addr,"latest"]); return BigInt(hex); }

/* ===== Charts ensure & reset ===== */
function ensureCharts(){
  if(!window.Chart) return;
  if(!splitChart){
    const el=document.getElementById("splitChart"); if(!el) return;
    splitChart=new Chart(el,{ type:"doughnut", data:{ labels:["S→B","B→S"], datasets:[{ data:[0,0], backgroundColor:["#111","#4f46e5"] }] }, options:{ plugins:{ legend:{ position:"bottom" } } } });
  }
  if(!countChart){
    const el=document.getElementById("countChart"); if(!el) return;
    countChart=new Chart(el,{ type:"bar", data:{ labels:["S→B","B→S"], datasets:[{ label:"Transfers", data:[0,0], backgroundColor:["#10b981","#3b82f6"] }] }, options:{ scales:{ y:{ beginAtZero:true, precision:0 } }, plugins:{ legend:{ display:false } } } });
  }
  if(!trendChart){
    const el=document.getElementById("trendChart"); if(!el) return;
    trendChart=new Chart(el,{ type:"line", data:{ labels:[], datasets:[{ label:"S→B Volume (ETH)", data:[], borderColor:"#111", fill:false, tension:.2 }] }, options:{ plugins:{ legend:{ display:false } } } });
  }
  if(!sizeChartSB){
    const el=document.getElementById("sizeChartSB"); if(el){
      sizeChartSB=new Chart(el,{ type:"doughnut", data:{ labels:["Small","Medium","Large"], datasets:[{ data:[0,0,0], backgroundColor:["#9ca3af","#4f46e5","#111827"] }] }, options:{ plugins:{ legend:{ position:"bottom" } } } });
    }
  }
  if(!sizeChartBS){
    const el=document.getElementById("sizeChartBS"); if(el){
      sizeChartBS=new Chart(el,{ type:"doughnut", data:{ labels:["Small","Medium","Large"], datasets:[{ data:[0,0,0], backgroundColor:["#9ca3af","#10b981","#111827"] }] }, options:{ plugins:{ legend:{ position:"bottom" } } } });
    }
  }
}
function resetChartsData(){
  ensureCharts();
  try{
    if (splitChart){ splitChart.data.datasets[0].data=[0,0]; splitChart.update(); }
    if (countChart){ countChart.data.datasets[0].data=[0,0]; countChart.update(); }
    if (trendChart){ trendChart.data.labels=[]; trendChart.data.datasets[0].data=[]; trendChart.update(); }
    if (sizeChartSB){ sizeChartSB.data.datasets[0].data=[0,0,0]; sizeChartSB.update(); }
    if (sizeChartBS){ sizeChartBS.data.datasets[0].data=[0,0,0]; sizeChartBS.update(); }
  }catch(e){ logWarn("resetChartsData:", e?.message||e); }
}

/* ===== Network badge ===== */
async function updateNetworkPill(){
  try{
    const idHex = await window.ethereum?.request?.({ method: "eth_chainId" });
    let label = "–";
    if (idHex){
      const id = BigInt(idHex);
      if (id === SEPOLIA_BIG) label = "Sepolia";
      else if (id === BASE_SEPOLIA_BIG) label = "Base Sepolia";
      else label = `Chain ${Number(id)}`;
    }
    pillNetwork && (pillNetwork.textContent = `Network: ${label}`);
  }catch{
    pillNetwork && (pillNetwork.textContent = "Network: –");
  }
}

/* ===== Wallet listeners ===== */
if(window.ethereum?.on){
  window.ethereum.on("chainChanged", async()=>{ 
    try{ 
      await rebuildProviderSigner(); 
      await refreshBalance(); 
      await updateNetworkPill();          // ← NEW
    }catch{} 
  });
  window.ethereum.on("accountsChanged", async()=>{
    provider=signer=user=contract=relayer=undefined;
    _udCtx = null;
    btnWallet.textContent="Connect";
    pillAddress?.classList.add("hide"); if(pillAddress) pillAddress.textContent="–";
    walletMenu?.classList.add("hide");
    setStatus("Account changed — reconnect");
    if(amtBalance) amtBalance.textContent="Balance: —";
    lastBalanceWei=0n;

    // clear top KPIs & public
    vSB && (vSB.textContent="—"); vBS && (vBS.textContent="—");
    cSB && (cSB.textContent="—"); cBS && (cBS.textContent="—");
    pvSB && (pvSB.textContent="—"); pvBS && (pvBS.textContent="—");
    // clear analytics KPIs
    ["sb24v","sb7dv","sbMed","sbP90","bs24v","bs7dv","bsMed","bsP90"].forEach(id=>{ const el=$(id); if(el) el.textContent="—"; });
    resetChartsData();
    resetHistoryUI();

    // reset network badge on disconnect/change
    pillNetwork && (pillNetwork.textContent = "Network: –"); // ← NEW
  });
}

/* ===== Finalization (unchanged) ===== */
const fin=setupFinalization({ ui:{ finalStatus, finalList, btnRefreshFinal, btnFinalizeAll }, ensureSepolia, getSigner:()=>signer, getUser:()=>user });

/* ===== Switchers (TX only) ===== */
async function rebuildProviderSigner(){ if(!window.ethereum) return; provider=new BrowserProvider(window.ethereum); signer=await provider.getSigner(); }
async function ensureSepolia(){ 
  const idHex=await window.ethereum.request({method:"eth_chainId"}); 
  if(BigInt(idHex)!==SEPOLIA_BIG){ 
    await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:SEPOLIA_HEX}]}); 
    await sleep(250); 
    if(user) await rebuildProviderSigner(); 
  } 
  await updateNetworkPill(); // ← NEW
}
async function ensureBaseSepolia(){ 
  const idHex=await window.ethereum.request({method:"eth_chainId"}); 
  if(BigInt(idHex)!==BASE_SEPOLIA_BIG){ 
    await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:BASE_SEPOLIA_HEX}]}); 
    await sleep(250); 
    if(user) await rebuildProviderSigner(); 
  } 
  await updateNetworkPill(); // ← NEW
}

/* ===== Wallet connect ===== */
function showWalletModal(show){
  walletModal?.classList.toggle("hide",!show);
  const ok=!!window.ethereum&&!!window.ethereum.request;
  document.getElementById("mmStatus").textContent=ok?"Detected":"Not found";
  document.getElementById("mmInstall")?.classList.toggle("hide",ok);
}
btnWallet?.addEventListener("click",()=>{ if(user) walletMenu.classList.toggle("hide"); else showWalletModal(true); });
btnDisconnect?.addEventListener("click",()=>{
  provider=signer=user=contract=relayer=undefined;
  _udCtx = null;
  btnWallet.textContent="Connect";
  pillAddress?.classList.add("hide"); if(pillAddress) pillAddress.textContent="–";
  walletMenu?.classList.add("hide");
  setStatus(""); toast("Disconnected","warn");
  if(amtBalance) amtBalance.textContent="Balance: —";
  lastBalanceWei=0n;
  vSB && (vSB.textContent="—"); vBS && (vBS.textContent="—");
  cSB && (cSB.textContent="—"); cBS && (cBS.textContent="—");
  pvSB && (pvSB.textContent="—"); pvBS && (pvBS.textContent="—");
  ["sb24v","sb7dv","sbMed","sbP90","bs24v","bs7dv","bsMed","bsP90"].forEach(id=>{ const el=$(id); if(el) el.textContent="—"; });
  resetChartsData();
  resetHistoryUI();

  pillNetwork && (pillNetwork.textContent = "Network: –"); // ← NEW
});
modalClose?.addEventListener("click",()=>showWalletModal(false));
optMetaMask?.addEventListener("click",connectWallet);

async function connectWallet(){
  try{
    showWalletModal(false);
    setLoading(btnWallet,true);

    await ensureSepolia();

    provider=new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts",[]);
    signer=await provider.getSigner();
    user=await signer.getAddress();

    _udCtx = null; // ensure fresh EIP-712 context
    pillAddress?.classList.remove("hide");
    if(pillAddress) pillAddress.textContent=`${user.slice(0,6)}…${user.slice(-4)}`;
    btnWallet.textContent="Connected";

    await updateNetworkPill(); // ← NEW

    await initSDK();
    const cfg={...SepoliaConfig, network:window.ethereum, relayerUrl:RELAYER_URL, gatewayUrl:GATEWAY_URL, debug:true};

    const kmsCode=await sepoliaGetCode(KMS_ADDRESS); if(kmsCode==="0x") throw new Error("KMS not found on Sepolia");
    const ctrCode=await sepoliaGetCode(CONTRACT_ADDRESS); if(ctrCode==="0x") throw new Error(`Contract not found on Sepolia at ${CONTRACT_ADDRESS}`);

    relayer=await createInstance(cfg);

    contract=new Contract(CONTRACT_ADDRESS, ABI_METRICS_HUB, signer);
    const cMini=`${CONTRACT_ADDRESS.slice(0,8)}…${CONTRACT_ADDRESS.slice(-4)}`;
    pillContract && (pillContract.textContent=cMini);
    contractMini && (contractMini.textContent=cMini);

    toast("Connected","good"); setStatus("");
    await refreshAllTiles();
    await refreshBalance();
    histPage=1; await fetchHistoryFromHub(histPage);

    await refreshDirectionalAnalytics();
  }catch(e){
    if(isUserRejection(e)) return;
    console.error(e); setStatusShort(e); toast("Connect failed","bad");
  }finally{ setLoading(btnWallet,false); }
}

/* ===== Relayer user-decrypt helpers ===== */
let _udCtx=null;
/** Returns cached UD-context for current address (rotates each minute) */
async function _getUserDecryptCtx(){
  const now=Date.now();
  if(_udCtx && _udCtx.addr===user && (now-_udCtx.t)<60_000) return _udCtx;
  const kp=await relayer.generateKeypair();
  const startTs=Math.floor(now/1000).toString(); const days="7";
  const eip712=relayer.createEIP712(kp.publicKey,[CONTRACT_ADDRESS],startTs,days);
  const sig=await signer.signTypedData(eip712.domain,{UserDecryptRequestVerification:eip712.types.UserDecryptRequestVerification},eip712.message);
  _udCtx={addr:user,t:now,kp,startTs,days,sig}; return _udCtx;
}
async function userDecryptOne(handle){
  const ctx=await _getUserDecryptCtx();
  const pair=[{handle,contractAddress:CONTRACT_ADDRESS}];
  const out=await relayer.userDecrypt(
    pair,
    ctx.kp.privateKey, ctx.kp.publicKey,
    ctx.sig.replace("0x",""),
    [CONTRACT_ADDRESS],
    user,
    ctx.startTs, ctx.days
  );
  return BigInt(out[handle] ?? 0);
}
async function userDecryptSafe(handles){
  const results=new Map(); const failedIdx=[];
  for(let i=0;i<iHandlesLen(handles);i++){
    const h=handles[i];
    try{
      const v=await userDecryptOne(h);
      results.set(h,v);
    }catch(e){
      failedIdx.push(i);
    }
  }
  return { results, failedIdx };
}
function iHandlesLen(arr){ return Array.isArray(arr) ? arr.length : Number(arr?.length ?? 0); }

/* ===== Helpers: (re)grant rights ===== */
async function regrantLastHistory(dir){
  try{
    await ensureSepolia(); await rebuildProviderSigner();
    const { src, dst } = (dir === "b2s") ? DIR_B2S : DIR_S2B;
    const len = Number(await contract.myHistoryLength(src, dst));
    if (len <= 0) return;
    const tx = await contract.grantMyHistoryRange(src, dst, BigInt(len - 1), BigInt(len), { gasLimit: 500_000 });
    await tx.wait();
  }catch(e){ logWarn("regrantLastHistory warn:", e?.message||e); }
}
async function grantRange(src,dst,start,count){
  const endExclusive = BigInt(start + count);
  const tx = await contract.grantMyHistoryRange(src,dst, BigInt(start), endExclusive, { gasLimit: 800_000 });
  await tx.wait();
  _udCtx = null; // refresh the UD signature window
}

/* ===== Public snapshots (unchanged) ===== */
async function getPublic(dir){
  try{
    const d = dir === "s2b" ? DIR_S2B : DIR_B2S;
    const { publicVolumeWei } = await contract.getPublicSnapshots(d.src, d.dst);
    const arr = [publicVolumeWei].filter(h => h && h !== zero);
    if (!arr.length) return 0n;
    const out = await relayer.publicDecrypt(arr);
    return BigInt(out[publicVolumeWei] ?? 0);
  }catch{
    return 0n;
  }
}

/* ===== Personal history reads via contract (msg.sender = signer) ===== */

/** wrapper: myHistoryLength for current wallet */
async function myHistoryLength(src, dst){
  // signer уже присоединён к contract; от него берётся msg.sender
  const len = await contract.myHistoryLength(src, dst);
  return Number(len || 0);
}
/** wrapper: getMyHistory page for current wallet */
async function myHistoryPage(src, dst, start, count){
  const res = await contract.getMyHistory(src, dst, start, count);
  // ethers v6 вернёт массивы [amounts, timestamps]
  const amounts = res[0], timestamps = res[1];
  return { amounts, timestamps };
}

/** Read last N of my history for a direction, returns [{wei, ts}] newest-first */
async function readMyLastN(dir, N=300){
  const d = dir==="s2b" ? DIR_S2B : DIR_B2S;

  const total = await myHistoryLength(d.src, d.dst);
  if (!total) return [];

  const start = Math.max(0, total - N);
  const count = total - start;

  const { amounts, timestamps } = await myHistoryPage(d.src, d.dst, start, count);

  let { results, failedIdx } = await userDecryptSafe(amounts);
  if (failedIdx.length > 0){
    try{
      await ensureSepolia(); await rebuildProviderSigner();
      await grantRange(d.src, d.dst, start, count);
      ({ results, failedIdx } = await userDecryptSafe(amounts));
    }catch(e){ logWarn("grant range (analytics) failed:", e?.message||e); }
  }

  const out=[];
  for(let i=0;i<count;i++){
    const h=amounts[i];
    const val = results.has(h) ? results.get(h) : null;
    const ts  = Number(timestamps[i]);
    if (val !== null) out.push({ wei: val, ts });
  }
  out.reverse();
  return out;
}

/** Read *all* my history for a direction (paged) and return [{wei, ts}] */
async function readMyAll(dir, pageSize = 300){
  const d = dir==="s2b" ? DIR_S2B : DIR_B2S;

  const total = await myHistoryLength(d.src, d.dst);
  if (!total) return [];

  const out = [];
  for (let start=0; start<total; start += pageSize){
    const count = Math.min(pageSize, total - start);
    const { amounts, timestamps } = await myHistoryPage(d.src, d.dst, start, count);

    let { results, failedIdx } = await userDecryptSafe(amounts);
    if (failedIdx.length > 0){
      try{
        await ensureSepolia(); await rebuildProviderSigner();
        await grantRange(d.src, d.dst, start, count);
        ({ results, failedIdx } = await userDecryptSafe(amounts));
      }catch(e){ logWarn("grant range (readMyAll) failed:", e?.message||e); }
    }

    for (let i=0;i<count;i++){
      const h = amounts[i];
      if (results.has(h)){
        out.push({ wei: results.get(h), ts: Number(timestamps[i]) });
      }
    }
    await sleep(60);
  }
  return out;
}

/** Strict private totals for *current wallet only* (sum & count) */
async function privateReadStrict(dir){
  try{
    const rows   = await readMyAll(dir, 350);
    const volWei = rows.reduce((a,b)=>a + (b?.wei??0n), 0n);
    const cnt    = rows.length;
    return { volWei, cnt: BigInt(cnt) };
  }catch(e){
    logWarn("privateReadStrict:", e?.message||e);
    return { volWei: 0n, cnt: 0n };
  }
}

/* ===== KPI + charts (existing) ===== */
function updateCharts(a,b){
  ensureCharts(); if(!splitChart||!countChart||!trendChart) return;
  splitChart.data.datasets[0].data=[Number(a.volWei)/1e18, Number(b.volWei)/1e18]; splitChart.update();
  countChart.data.datasets[0].data=[Number(a.cnt), Number(b.cnt)]; countChart.update();
  const t=Date.now(); trendChart.data.labels.push(new Date(t).toLocaleTimeString());
  trendChart.data.datasets[0].data.push((Number(a.volWei)/1e18).toFixed(6));
  if(trendChart.data.labels.length>50){ trendChart.data.labels.shift(); trendChart.data.datasets[0].data.shift(); }
  trendChart.update();
}
function updateTiles(a,b){
  const s=weiToEthStr(a.volWei), c=weiToEthStr(b.volWei);
  if(vSB) vSB.textContent=s; if(vBS) vBS.textContent=c;
  if(cSB) cSB.textContent=a.cnt.toString(); if(cBS) cBS.textContent=b.cnt.toString();
}
async function refreshAllTiles(){
  // Only current wallet's private totals
  const a = await privateReadStrict("s2b");
  const b = await privateReadStrict("b2s");
  updateTiles(a,b);
  updateCharts(a,b);
  // Do not auto-mix in global public snapshots; load them only on button click
  pvSB && (pvSB.textContent = "—");
  pvBS && (pvBS.textContent = "—");
}

/* === Directional analytics ===================================== */
function sumWei(arr){ return arr.reduce((a,b)=>a + (b?.wei??0n), 0n); }
function formatEth(wei){ return weiToEthStr(wei); }
function medianBig(arrSorted){
  const n=arrSorted.length; if(!n) return 0n;
  const mid=Math.floor(n/2);
  if (n%2===1) return arrSorted[mid];
  return (arrSorted[mid-1]+arrSorted[mid]) / 2n;
}
function pTileBig(arrSorted, p){
  const n=arrSorted.length; if(!n) return 0n;
  const idx = Math.min(n-1, Math.max(0, Math.floor((n-1)*p)));
  return arrSorted[idx];
}

/** Build per-direction analytics & render KPIs + size pies */
async function computeDirectional(dir){
  const rows = await readMyLastN(dir, 300);
  const now = Math.floor(Date.now()/1000);
  const dayAgo = now - 86400;
  const weekAgo = now - 7*86400;

  const r24 = rows.filter(r=>r.ts>=dayAgo);
  const r7d = rows.filter(r=>r.ts>=weekAgo);

  const vol24 = sumWei(r24);
  const vol7d = sumWei(r7d);

  const vals7d = r7d.map(r=>r.wei).sort((a,b)=> (a<b?-1:a>b?1:0));
  const med = medianBig(vals7d);
  const p90 = pTileBig(vals7d, 0.90);

  if (dir==="s2b"){
    sb24v && (sb24v.textContent = formatEth(vol24));
    sb7dv && (sb7dv.textContent = formatEth(vol7d));
    sbMed && (sbMed.textContent = formatEth(med));
    sbP90 && (sbP90.textContent = formatEth(p90));
    ensureCharts();
    if (sizeChartSB){
      let smallTx=0, mediumTx=0, largeTx=0;
      for(const w of vals7d){
        if(vals7d.length===0) break;
        else if (w < med) smallTx++;
        else if (w < p90) mediumTx++;
        else largeTx++;
      }
      sizeChartSB.data.datasets[0].data = [smallTx, mediumTx, largeTx];
      sizeChartSB.update();
    }
  } else {
    bs24v && (bs24v.textContent = formatEth(vol24));
    bs7dv && (bs7dv.textContent = formatEth(vol7d));
    bsMed && (bsMed.textContent = formatEth(med));
    bsP90 && (bsP90.textContent = formatEth(p90));
    ensureCharts();
    if (sizeChartBS){
      let smallTx=0, mediumTx=0, largeTx=0;
      for(const w of vals7d){
        if(vals7d.length===0) break;
        else if (w < med) smallTx++;
        else if (w < p90) mediumTx++;
        else largeTx++;
      }
      sizeChartBS.data.datasets[0].data = [smallTx, mediumTx, largeTx];
      sizeChartBS.update();
    }
  }
}

async function refreshDirectionalAnalytics(){
  try{
    setLoading(btnRefreshAnalytics, true);
    if (!user){
      ["sb24v","sb7dv","sbMed","sbP90","bs24v","bs7dv","bsMed","bsP90"].forEach(id=>{ const el=$(id); if(el) el.textContent="—"; });
      ensureCharts();
      if(sizeChartSB){ sizeChartSB.data.datasets[0].data=[0,0,0]; sizeChartSB.update(); }
      if(sizeChartBS){ sizeChartBS.data.datasets[0].data=[0,0,0]; sizeChartBS.update(); }
      return;
    }
    await computeDirectional("s2b");
    await computeDirectional("b2s");
  }finally{
    setLoading(btnRefreshAnalytics, false);
  }
}

/* ===== BALANCES ===== */
async function refreshBalance(){
  if(!amtBalance) return;
  try{
    const wantSepolia=(activeBridge==="deposit"); const label=`Balance on ${wantSepolia?"Sepolia":"Base Sepolia"}: `;
    amtBalance.textContent=label+"…";
    if(!user){ amtBalance.textContent=label+"—"; lastBalanceWei=0n; return; }
    const bal=wantSepolia?await sepoliaGetBalance(user):await roBase.getBalance(user);
    lastBalanceWei=bal; amtBalance.textContent=label+`${weiToEthStr(bal)} ETH`;
  }catch(e){
    const wantSepolia=(activeBridge==="deposit"); amtBalance.textContent=`Balance on ${wantSepolia?"Sepolia":"Base Sepolia"}: —`; lastBalanceWei=0n;
  }
}

/* ===== HISTORY (pagination) ===== */
const ifaceHub=new ethers.Interface(ABI_METRICS_HUB);

// --------- FIX: надёжный сбор логов Recorded (постранично) ----------
async function sepoliaBlockNumber() {
  const hex = await sepoliaRpcTry("eth_blockNumber", []);
  return BigInt(hex);
}

async function getLogsPagedOnSepolia({ address, topics, fromBlock, toBlock, step = 9000n }) {
  const out = [];
  let from = fromBlock;
  while (from <= toBlock) {
    let to = from + step;
    if (to > toBlock) to = toBlock;
    try {
      const logs = await sepoliaRpcTry("eth_getLogs", [{
        address,
        topics,
        fromBlock: toHex(from),
        toBlock: toHex(to),
      }]);
      out.push(...logs);
    } catch (e) {
      // уменьшаем окно при ошибках RPC
      step = step > 1000n ? step / 2n : 1000n;
    }
    from = to + 1n;
  }
  return out;
}

async function buildRecordedIdxMaps(src, dst, userAddr) {
  const ev = ifaceHub.getEvent("Recorded");
  const topics = ifaceHub.encodeFilterTopics(ev, [src, dst, userAddr]);

  const latest = await sepoliaBlockNumber();
  const RANGE = 500_000n;
  const from = latest > RANGE ? latest - RANGE : 0n;

  const logs = await getLogsPagedOnSepolia({
    address: CONTRACT_ADDRESS,
    topics,
    fromBlock: from,
    toBlock: latest,
    step: 9000n,
  });

  const originByIdx = new Map();
  const recTxByIdx  = new Map();

  for (const lg of logs) {
    try {
      const dec = ifaceHub.decodeEventLog(ev, lg.data, lg.topics);
      const idx = Number(dec.idx);
      recTxByIdx.set(idx, lg.transactionHash);
      const origin = dec.originTx;
      if (origin && origin !== "0x" + "00".repeat(32)) {
        originByIdx.set(idx, ethers.hexlify(origin));
      }
    } catch {}
  }
  return { originByIdx, recTxByIdx };
}
// -------------------------------------------------------------------

function ensurePagerEl(){
  if(!histPager){ histPager=document.createElement("div"); histPager.id="histPager"; histPager.className="pager"; histList?.insertAdjacentElement("afterend",histPager); }
}
function resetHistoryUI(){
  if(histTitle) histTitle.textContent = activeBridge==="deposit" ? "My history — Sepolia → Base Sepolia" : "My history — Base Sepolia → Sepolia";
  if(histStatus) histStatus.textContent = "";
  if(histList) histList.innerHTML = "";
  ensurePagerEl(); if(histPager) histPager.innerHTML="";
}
function dateOnly(ts){ return new Date(ts*1000).toLocaleDateString(undefined,{year:"numeric",month:"2-digit",day:"2-digit"}); }
function renderHistory(items){
  if(!histList) return;
  histList.innerHTML = items.map(it=>{
    const date=dateOnly(it.ts);
    const amt=(it.amountWei===null)?`<span class="mono">🔒 private</span>`:`<span class="mono"><b>${ethers.formatUnits(it.amountWei,18)}</b> ETH</span>`;
    const txhMini=it.txHash?`${it.txHash.slice(0,10)}…${it.txHash.slice(-6)}`:"—";
    const txRight=it.txHash?`<span class="mono">${txhMini}</span> <button class="copybtn" data-tx="${it.txHash}" title="Copy tx hash">⧉</button>`:`<span class="mono">—</span>`;
    return `<div class="history__row">
      <span class="h-date mono">${date}</span>
      <span class="h-dot">•</span>
      <span class="h-amt">${amt}</span>
      <span class="h-dot">•</span>
      <span class="h-tx">${txRight}</span>
    </div>`;
  }).join("");
}
histList?.addEventListener("click",(e)=>{
  const b=e.target.closest?.(".copybtn"); if(!b) return;
  const tx=b.getAttribute("data-tx"); if(tx){ navigator.clipboard.writeText(tx); toast("Tx hash copied"); }
});
function renderPager(){
  ensurePagerEl(); if(!histPager) return;
  if(histPages<=1){ histPager.innerHTML=""; return; }
  const maxBtns=7; let start=Math.max(1,histPage-Math.floor(maxBtns/2)); let end=Math.min(histPages,start+maxBtns-1); start=Math.max(1,end-maxBtns+1);
  const btn=(p,label=p,cls="")=>`<button class="pager__btn ${cls}" data-page="${p}">${label}</button>`;
  let html=""; if(histPage>1) html+=btn(histPage-1,"«","is-nav"); for(let p=start;p<=end;p++){ html+=btn(p,String(p),p===histPage?"is-active":""); } if(histPage<histPages) html+=btn(histPage+1,"»","is-nav");
  histPager.innerHTML=html;
}
histPager?.addEventListener?.("click",(e)=>{ const b=e.target.closest?.(".pager__btn"); if(!b) return; const p=Number(b.getAttribute("data-page")||1); if(p>=1 && p<=histPages && p!==histPage){ fetchHistoryFromHub(p); } });

async function fetchHistoryFromHub(page=1){
  if(!user){ resetHistoryUI(); return; }
  try{
    resetHistoryUI();
    const dir=(activeBridge==="deposit")?DIR_S2B:DIR_B2S; const {src,dst}=dir;

    // length
    const len = await myHistoryLength(src, dst);
    histTotal=Number(len); histPages=Math.max(1,Math.ceil(histTotal/HIST_PAGE_SIZE)); histPage=Math.min(Math.max(1,page),histPages);
    if(!histTotal){ renderHistory([]); renderPager(); return; }

    // tail window
    const endExclusive=histTotal-(histPage-1)*HIST_PAGE_SIZE;
    const start=Math.max(0,endExclusive-HIST_PAGE_SIZE);
    const count=Math.max(0,endExclusive-start);

    const { amounts, timestamps } = await myHistoryPage(src, dst, start, count);

    let { results, failedIdx } = await userDecryptSafe(amounts);
    if (failedIdx.length > 0) {
      try{
        await ensureSepolia(); await rebuildProviderSigner();
        await grantRange(src, dst, start, count);
        ({ results, failedIdx } = await userDecryptSafe(amounts));
      }catch(e){ logWarn("auto grant range failed:", e?.message||e); }
    }

    // Recorded logs for originTx — устойчиво и кусками
    let originByIdx=new Map(), recTxByIdx=new Map();
    try{
      ({ originByIdx, recTxByIdx } = await buildRecordedIdxMaps(src, dst, user));
    }catch(e){
      // оставим пустые карты — без tx, но UI не упадёт
    }

    const items=[];
    for(let i=0;i<count;i++){
      const globalIdx=start+i;
      const h=amounts[i];
      const ts=Number(timestamps[i]);
      const origin=originByIdx.get(globalIdx)||null;
      const recordTx=recTxByIdx.get(globalIdx)||null;
      const txHash=origin||recordTx;
      const val=results.has(h)?results.get(h):null;
      items.push({ ts, amountWei:val, txHash });
    }
    items.reverse();
    renderHistory(items);
    renderPager();
  }catch(e){
    logWarn("refreshHistory (hub):",e);
    if(histStatus) histStatus.textContent="Failed to load history.";
    if(histList) histList.innerHTML="";
    ensurePagerEl(); if(histPager) histPager.innerHTML="";
  }
}

/* ===== Segmented controls ===== */
function segmentedActivate(group,which){
  const groupEl=group==="bridge"?segDeposit?.closest(".segmented"):segSB?.closest(".segmented"); if(!groupEl) return;
  const a=group==="bridge"?segDeposit:segSB; const b=group==="bridge"?segWithdraw:segBS; const active=(group==="bridge"?which==="deposit":which==="s2b");
  a?.classList.toggle("is-active",active); b?.classList.toggle("is-active",!active);
  const thumb=groupEl.querySelector(".segmented__thumb");
  if(thumb && a){ const el=active?a:b; const r=el.getBoundingClientRect(), p=groupEl.getBoundingClientRect(); thumb.style.setProperty("--seg-w",r.width+"px"); thumb.style.setProperty("--seg-x",(r.left-p.left)+"px"); }
}
segDeposit?.addEventListener("click", async()=>{ activeBridge="deposit"; segmentedActivate("bridge","deposit"); histTitle && (histTitle.textContent="My history — Sepolia → Base Sepolia"); await refreshBalance(); histPage=1; await fetchHistoryFromHub(histPage); });
segWithdraw?.addEventListener("click", async()=>{ activeBridge="withdraw"; segmentedActivate("bridge","withdraw"); histTitle && (histTitle.textContent="My history — Base Sepolia → Sepolia"); await refreshBalance(); histPage=1; await fetchHistoryFromHub(histPage); });
btnRefreshHist?.addEventListener("click",()=>fetchHistoryFromHub(histPage));

/* Bottom segmented (reads/publish) */
segSB?.addEventListener("click", ()=>{ activeDir="s2b"; segmentedActivate("dir","s2b"); });
segBS?.addEventListener("click", ()=>{ activeDir="b2s"; segmentedActivate("dir","b2s"); });

/* MAX */
btnMax?.addEventListener("click", ()=>{
  const gasBuf=ethers.parseUnits("0.002",18);
  let use=lastBalanceWei; if(use>gasBuf) use-=gasBuf; if(use<0n) use=0n;
  amtEth.value=ethers.formatUnits(use,18);
});

/* ===== Bridge actions ===== */
btnDoBridge?.addEventListener("click", async ()=>{
  try{
    setStatus("");
    const amountWei=parseEthRelaxed(amtEth.value);

    if(activeBridge==="deposit"){
      await ensureSepolia(); await rebuildProviderSigner();
      const l1=new Contract(L1_BRIDGE_SEPOLIA,[
        "function depositETH(uint32 _l2Gas, bytes _data) payable",
        "function depositETHTo(address _to, uint32 _l2Gas, bytes _data) payable"
      ], signer);
      const l2Gas=200_000;
      const tx=await l1.depositETH(l2Gas,"0x",{ value:amountWei });
      await tx.wait();
      toast("Deposited to Base Sepolia","good");
      await recordMetric({ src:DIR_S2B.src, dst:DIR_S2B.dst, amountWei, originTxHash:tx.hash });
      await refreshBalance(); histPage=1; await fetchHistoryFromHub(histPage);
      await refreshDirectionalAnalytics();

    } else {
      await ensureBaseSepolia(); await rebuildProviderSigner();
      const bal=await provider.getBalance(await signer.getAddress());
      if(bal<amountWei) throw new Error("Not enough L2 ETH for withdraw");

      const l2=new Contract(L2_BRIDGE_BASE_SEPOLIA,L2_BRIDGE_ABI,signer);
      const l1Gas=200_000; let sent;
      try{
        const tx1=await l2.withdrawTo(L2_ETH,await signer.getAddress(),amountWei,l1Gas,"0x",{ value:amountWei, gasLimit:900_000 });
        sent=tx1; await tx1.wait();
      }catch{
        const tx2=await l2.withdraw(L2_ETH,amountWei,l1Gas,"0x",{ value:amountWei, gasLimit:900_000 });
        sent=tx2; await tx2.wait();
      }
      toast("Withdrew to Sepolia (prove → finalize later on L1)","good");

      await ensureSepolia(); await rebuildProviderSigner();
      await recordMetric({ src:DIR_B2S.src, dst:DIR_B2S.dst, amountWei, originTxHash:sent.hash });
      await refreshBalance(); histPage=1; await fetchHistoryFromHub(histPage);
      await refreshDirectionalAnalytics();
    }

    // After any bridge, refresh top tiles from *current wallet only*
    await refreshAllTiles();

  }catch(e){
    if(isUserRejection(e)){ toast("Cancelled","warn"); return; }
    console.error("Bridge error:",e); setStatusShort(`Bridge failed: ${e?.shortMessage||e?.reason||e?.message||""}`); toast("Bridge failed","bad"); safeClose();
  }
});

/* ===== Metrics record ===== */
async function recordMetric({ src, dst, amountWei, originTxHash }){
  await ensureSepolia();
  openProgress(); markProgress("enc");
  const buf=relayer.createEncryptedInput(getAddress(CONTRACT_ADDRESS),getAddress(user));
  buf.add128(amountWei);
  const { handles, inputProof } = await buf.encrypt();
  markProgress("send");
  const origin=originTxHash ?? ("0x"+"00".repeat(32));
  const tx=await contract.record(src,dst,handles[0],inputProof,origin,{ gasLimit:1_200_000 });
  markProgress("confirm"); await tx.wait();
  const dir = (src === DIR_B2S.src && dst === DIR_B2S.dst) ? "b2s" : "s2b";
  await regrantLastHistory(dir);
  markProgress("decrypt"); safeClose();
}

/* ===== Bottom buttons ===== */
btnPrivateRead?.addEventListener("click", async ()=>{
  try{
    setLoading(btnPrivateRead,true);
    const a = await privateReadStrict("s2b");
    const b = await privateReadStrict("b2s");
    updateTiles(a,b); updateCharts(a,b);
    toast("Private totals (per-wallet) updated","good");
  }catch(e){ console.error(e); setStatusShort(e); toast("Private read failed","bad"); }
  finally{ setLoading(btnPrivateRead,false); }
});
btnPublicRead?.addEventListener("click", async ()=>{
  try{
    setLoading(btnPublicRead, true);
    const volS2B = await getPublic("s2b");
    const volB2S = await getPublic("b2s");
    pvSB && (pvSB.textContent = weiToEthStr(volS2B));
    pvBS && (pvBS.textContent = weiToEthStr(volB2S));
    toast("Public snapshots updated","good");
  }catch(e){ console.error(e); setStatusShort(e); toast("Public read failed","bad"); }
  finally{ setLoading(btnPublicRead,false); }
});
btnPublish?.addEventListener("click", async ()=>{
  try{
    setLoading(btnPublish,true);
    await ensureSepolia(); await rebuildProviderSigner();
    const { src, dst } = activeDir==="s2b" ? DIR_S2B : DIR_B2S;
    const k=BigInt(Math.max(1,Number(kAnon.value||5)));
    const tx=await contract.publish(src,dst,k,{ gasLimit:800_000 });
    await tx.wait(); toast("Snapshot published","good");
  }catch(e){ if(!isUserRejection(e)){ console.error(e); setStatusShort(e); toast("Publish failed","bad"); } }
  finally{ setLoading(btnPublish,false); }
});

/* NEW: Refresh analytics button */
btnRefreshAnalytics?.addEventListener("click", refreshDirectionalAnalytics);

/* ======= Tooltips (fixed, portal to body, high z-index) ======= */
(function initTooltips(){
  let tipEl=null, hideTO=null;

  function ensureTip(){
    if(tipEl) return tipEl;
    tipEl=document.createElement("div");
    tipEl.setAttribute("role","tooltip");
    Object.assign(tipEl.style,{
      position:"fixed", zIndex:"999999",
      maxWidth:"280px", padding:"8px 10px", borderRadius:"10px",
      background:"#111", color:"#fff", fontSize:"12px", lineHeight:"1.25",
      boxShadow:"0 6px 24px rgba(0,0,0,.3)", pointerEvents:"none",
      opacity:"0", transform:"translateY(-4px)", transition:"opacity .12s ease, transform .12s ease"
    });
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function findTipSource(e){
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const candidates = [e.target, ...path];
    for(const n of candidates){
      if(!n || n.nodeType!==1) continue;
      if(n.classList?.contains("tip") || n.hasAttribute?.("data-tip")) return n;
    }
    return null;
  }

  function place(el){
    const box=tipEl;
    const r=el.getBoundingClientRect();
    const tW=box.offsetWidth, tH=box.offsetHeight;
    let top=r.top-8-tH;
    if(top<8) top=r.bottom+8;
    let left=Math.min(Math.max(8, r.left + (r.width/2) - tW/2), window.innerWidth - tW - 8);
    box.style.top=`${Math.round(top)}px`;
    box.style.left=`${Math.round(left)}px`;
  }

  function showFor(el){
    const text=el?.dataset?.tip || el?.getAttribute?.("data-tip") || el?.title || "";
    if(!text) return;
    const box=ensureTip();
    box.textContent=text;
    box.style.opacity="0";
    requestAnimationFrame(()=>{
      place(el);
      box.style.opacity="1";
      box.style.transform="translateY(0)";
    });
  }

  function hideSoon(){
    if(!tipEl) return;
    clearTimeout(hideTO);
    hideTO=setTimeout(()=>{ tipEl && (tipEl.style.opacity="0"); }, 40);
  }

  document.addEventListener("mouseover",(e)=>{
    const src=findTipSource(e);
    if(!src) return;
    clearTimeout(hideTO);
    showFor(src);
  }, true);

  document.addEventListener("mouseout",(e)=>{
    const src=findTipSource(e);
    if(!src) return;
    hideSoon();
  }, true);

  window.addEventListener("scroll", ()=>{ tipEl && (tipEl.style.opacity="0"); }, true);
  window.addEventListener("resize", ()=>{ tipEl && (tipEl.style.opacity="0"); });
})();

/* ===== INIT ===== */
window.addEventListener("load", ()=>{
  segmentedActivate("bridge","deposit");
  segmentedActivate("dir","s2b");
  resetHistoryUI();
  updateNetworkPill(); // ← NEW
});
btnWallet?.addEventListener("mouseenter", ()=>walletMenu?.classList.add("hide"));
