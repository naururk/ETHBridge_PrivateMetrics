// public/js/app.js (orchestrator)

import {
  BrowserProvider, JsonRpcProvider, Contract, ethers, getAddress,
} from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import { initSDK, createInstance, SepoliaConfig } from "https://cdn.zama.ai/relayer-sdk-js/0.1.2/relayer-sdk-js.js";

import {
  CONTRACT_ADDRESS, KMS_ADDRESS, RELAYER_URL, GATEWAY_URL,
  SEPOLIA_BIG, SEPOLIA_HEX, BASE_SEPOLIA_BIG, BASE_SEPOLIA_HEX,
  L1_BRIDGE_SEPOLIA, L2_BRIDGE_BASE_SEPOLIA, BASE_SEPOLIA_RPC,
  SEPOLIA_RPC_PRIMARY, SEPOLIA_RPC_SECONDARY, SEPOLIA_RPC_BACKUPS
} from "./config.js";
import { ABI_METRICS_HUB } from "./abi.js";
import { setupFinalization } from "./finalization.js";

// подключаемые модули из public/js/
import { setupMetrics }        from "./metrics.js";
import { setupBridgeControls } from "./bridgeControls.js";
import { setupHistoryBlock }   from "./historyBlock.js";
import { setupSnapshots }      from "./snapshots.js";

/* ========= helpers / DOM ========= */
const $ = (id)=>document.getElementById(id);
const toasts = $("toasts");
const btnWallet = $("btnWallet"), walletMenu = $("walletMenu"), btnDisconnect=$("btnDisconnect");
const walletModal=$("walletModal"), modalClose=$("modalClose"), optMetaMask=$("optMetaMask");
const pillAddress=$("pillAddress"), pillContract=$("pillContract"), contractMini=$("contractMini");
const pillNetwork=$("pillNetwork");
const statusEl=$("status");
const setStatus=(t="")=>{ if(statusEl) statusEl.textContent=t; };
const toast=(msg,type="good",ms=2600)=>{ const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=msg; toasts.appendChild(el); setTimeout(()=>el.remove(),ms); };
const isUserRejection=(e)=>e?.code===4001||e?.code==="ACTION_REJECTED"||/denied|rejected/i.test(e?.message||"");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const weiToEthStr=(n)=> (Number(n)/1e18).toLocaleString(undefined,{maximumFractionDigits:6});
function setStatusShort(eOrMsg){
  let msg=typeof eOrMsg==="string"?eOrMsg:(eOrMsg?.shortMessage||eOrMsg?.reason||eOrMsg?.message||"Unknown error");
  statusEl.textContent=String(msg).replace(/^Error:\s*/,'').replace(/\s{2,}/g,' ').slice(0,180);
}

/* ========= Состояние ========= */
let provider, signer, user, contract, relayer;
let activeBridge="deposit"; // deposit | withdraw

/* ========= Провайдеры (RO) ========= */
const roBase = new JsonRpcProvider(BASE_SEPOLIA_RPC, { chainId:Number(BASE_SEPOLIA_BIG), name:"base-sepolia" });

/* ========= Sepolia RPC rotation ========= */
const ENDPOINTS=[SEPOLIA_RPC_PRIMARY,SEPOLIA_RPC_SECONDARY,...(SEPOLIA_RPC_BACKUPS||[])].filter(Boolean);
async function rpc(url, method, params, timeoutMs=3500){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeoutMs);
  try{
    const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:Math.random()*1e6|0,method,params}),signal:ctl.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j=await r.json(); if(j.error) throw new Error(j.error.message||"RPC error"); return j.result;
  } finally{ clearTimeout(t); }
}
async function sepoliaRpcTry(method, params){
  let last; for(const u of ENDPOINTS){ try{ return await rpc(u,method,params); }catch(e){ last=e; } } throw last||new Error("All Sepolia RPC failed");
}
const sepoliaGetCode    = (addr)=>sepoliaRpcTry("eth_getCode",[addr,"latest"]);
const sepoliaGetBalance = async (addr)=> BigInt(await sepoliaRpcTry("eth_getBalance",[addr,"latest"]));

/* ========= Wallet / Network ========= */
async function rebuildProviderSigner(){ if(!window.ethereum) return; provider=new BrowserProvider(window.ethereum); signer=await provider.getSigner(); }
async function updateNetworkPill(){
  try{
    const idHex = await window.ethereum?.request?.({method:"eth_chainId"});
    let label="–"; if(idHex){ const id=BigInt(idHex);
      if(id===SEPOLIA_BIG) label="Sepolia";
      else if(id===BASE_SEPOLIA_BIG) label="Base Sepolia";
      else label=`Chain ${Number(id)}`;
    }
    pillNetwork && (pillNetwork.textContent=`Network: ${label}`);
  }catch{ pillNetwork && (pillNetwork.textContent="Network: –"); }
}
async function ensureSepolia(){
  const idHex=await window.ethereum.request({method:"eth_chainId"});
  if(BigInt(idHex)!==SEPOLIA_BIG){
    await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:SEPOLIA_HEX}]});
    await sleep(250); if(user) await rebuildProviderSigner();
  }
  await updateNetworkPill();
}
async function ensureBaseSepolia(){
  const idHex=await window.ethereum.request({method:"eth_chainId"});
  if(BigInt(idHex)!==BASE_SEPOLIA_BIG){
    await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:BASE_SEPOLIA_HEX}]});
    await sleep(250); if(user) await rebuildProviderSigner();
  }
  await updateNetworkPill();
}

/* ========= UD helpers / шифровка ========= */
let _udCtx=null;
async function getUdCtx(){
  const now=Date.now(); if(_udCtx && _udCtx.addr===user && (now-_udCtx.t)<60_000) return _udCtx;
  const kp=await relayer.generateKeypair();
  const startTs=Math.floor(now/1000).toString(); const days="7";
  const eip712=relayer.createEIP712(kp.publicKey,[CONTRACT_ADDRESS],startTs,days);
  const sig=await signer.signTypedData(eip712.domain,{UserDecryptRequestVerification:eip712.types.UserDecryptRequestVerification},eip712.message);
  _udCtx={addr:user,t:now,kp,startTs,days,sig}; return _udCtx;
}
async function userDecryptOne(handle){
  const ctx=await getUdCtx();
  const out=await relayer.userDecrypt([{handle,contractAddress:CONTRACT_ADDRESS}],
    ctx.kp.privateKey, ctx.kp.publicKey, ctx.sig.replace("0x",""),
    [CONTRACT_ADDRESS], user, ctx.startTs, ctx.days);
  return BigInt(out[handle] ?? 0);
}
async function userDecryptSafe(handles){
  const results=new Map(), failedIdx=[];
  for(let i=0;i<handles.length;i++){
    try{ results.set(handles[i], await userDecryptOne(handles[i])); }catch{ failedIdx.push(i); }
  }
  return { results, failedIdx };
}

/* ========= Контрактные обёртки истории ========= */
const ifaceHub = new ethers.Interface(ABI_METRICS_HUB);
async function myHistoryLength(src,dst){ return Number(await contract.myHistoryLength(src,dst)||0); }
async function myHistoryPage(src,dst,start,count){
  const res = await contract.getMyHistory(src,dst,start,count);
  return { amounts:res[0], timestamps:res[1] };
}
async function grantRange(src,dst,start,count){
  const endExclusive = BigInt(start+count);
  const tx=await contract.grantMyHistoryRange(src,dst, BigInt(start), endExclusive, { gasLimit:800_000 });
  await tx.wait(); _udCtx=null;
}

/* ========= Высокоуровневые чтения ========= */
const DIR_S2B = { src:Number(SEPOLIA_BIG), dst:Number(BASE_SEPOLIA_BIG) };
const DIR_B2S = { src:Number(BASE_SEPOLIA_BIG), dst:Number(SEPOLIA_BIG) };

async function readMyAll(dir, pageSize=300){
  const d = dir==="s2b"?DIR_S2B:DIR_B2S;
  const total = await myHistoryLength(d.src,d.dst); if(!total) return [];
  const out=[];
  for(let start=0; start<total; start+=pageSize){
    const count=Math.min(pageSize,total-start);
    const {amounts,timestamps}=await myHistoryPage(d.src,d.dst,start,count);
    let {results,failedIdx}=await userDecryptSafe(amounts);
    if(failedIdx.length){
      try{ await ensureSepolia(); await rebuildProviderSigner(); await grantRange(d.src,d.dst,start,count);
           ({results,failedIdx}=await userDecryptSafe(amounts)); }catch{}
    }
    for(let i=0;i<count;i++) if(results.has(amounts[i])) out.push({wei:results.get(amounts[i]), ts:Number(timestamps[i])});
    await sleep(60);
  }
  return out;
}
async function privateReadStrict(dir){
  try{
    const rows=await readMyAll(dir,350);
    const volWei=rows.reduce((a,b)=>a+(b?.wei??0n),0n);
    return { volWei, cnt: BigInt(rows.length) };
  }catch{ return { volWei:0n, cnt:0n }; }
}
async function readMyLastN(dir,N=300){
  const d = dir==="s2b"?DIR_S2B:DIR_B2S;
  const total=await myHistoryLength(d.src,d.dst); if(!total) return [];
  const start=Math.max(0,total-N), count=total-start;
  const {amounts,timestamps}=await myHistoryPage(d.src,d.dst,start,count);
  let {results,failedIdx}=await userDecryptSafe(amounts);
  if(failedIdx.length){ try{ await ensureSepolia(); await rebuildProviderSigner(); await grantRange(d.src,d.dst,start,count); ({results}=await userDecryptSafe(amounts)); }catch{} }
  const out=[];
  for(let i=0;i<count;i++){ if(results.has(amounts[i])) out.push({wei:results.get(amounts[i]), ts:Number(timestamps[i])}); }
  return out.reverse();
}

/* ========= Паблик снапшоты ========= */
async function getPublic(dir){
  try{
    const d = dir==="s2b"?DIR_S2B:DIR_B2S;
    const { publicVolumeWei } = await contract.getPublicSnapshots(d.src,d.dst);
    const arr=[publicVolumeWei].filter(x=>x && x!=="0x"+"00".repeat(64));
    if(!arr.length) return 0n;
    const out=await relayer.publicDecrypt(arr); return BigInt(out[publicVolumeWei] ?? 0);
  }catch{ return 0n; }
}

/* ========= Баланс ========= */
async function refreshBalance(){
  const el=$("amtBalance"); if(!el) return;
  const wantSepolia = (activeBridge==="deposit"); const label=`Balance on ${wantSepolia?"Sepolia":"Base Sepolia"}: `;
  try{
    if(!user){ el.textContent=label+"—"; return; }
    const bal = wantSepolia? await sepoliaGetBalance(user) : await roBase.getBalance(user);
    el.textContent = `${label}${weiToEthStr(bal)} ETH`;
  }catch{ el.textContent = label+"—"; }
}
function parseEthRelaxed(inp){
  const s=String(inp??"").trim().replace(",",".").replace(/\s+/g,"");
  if(!/^\d*\.?\d+$/.test(s)) throw new Error("Enter a valid amount");
  const w=ethers.parseUnits(s,18); if(w<=0n) throw new Error("Amount must be > 0"); return w;
}

/* ========= Wallet UI ========= */
function showWalletModal(show){
  walletModal?.classList.toggle("hide",!show);
  const ok=!!window.ethereum?.request;
  $("mmStatus").textContent=ok?"Detected":"Not found";
  $("mmInstall")?.classList.toggle("hide",ok);
}
btnWallet?.addEventListener("click",()=>{ if(user) walletMenu.classList.toggle("hide"); else showWalletModal(true); });
modalClose?.addEventListener("click",()=>showWalletModal(false));
btnDisconnect?.addEventListener("click",()=>{
  provider=signer=user=contract=relayer=undefined; _udCtx=null;
  btnWallet.textContent="Connect";
  pillAddress?.classList.add("hide"); if(pillAddress) pillAddress.textContent="–";
  walletMenu?.classList.add("hide");
  setStatus(""); toast("Disconnected","warn");
  pillNetwork && (pillNetwork.textContent="Network: –");
});

async function connectWallet(){
  try{
    showWalletModal(false); btnWallet.classList.add("loading");
    await ensureSepolia();
    provider=new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts",[]);
    signer=await provider.getSigner();
    user=await signer.getAddress();

    pillAddress?.classList.remove("hide");
    pillAddress && (pillAddress.textContent=`${user.slice(0,6)}…${user.slice(-4)}`);
    btnWallet.textContent="Connected";
    await updateNetworkPill();

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
    await refreshBalance();

    // сообщаем модулям
    metrics.refreshAllTiles();
    metrics.refreshDirectionalAnalytics();
    history.fetchHistoryFromHub(1);
  }catch(e){ if(!isUserRejection(e)){ console.error(e); setStatusShort(e); toast("Connect failed","bad"); } }
  finally{ btnWallet.classList.remove("loading"); }
}
$("optMetaMask")?.addEventListener("click",connectWallet);

if(window.ethereum?.on){
  window.ethereum.on("chainChanged", async ()=>{ try{ await rebuildProviderSigner(); await refreshBalance(); await updateNetworkPill(); }catch{} });
  window.ethereum.on("accountsChanged", ()=>{ btnDisconnect?.click(); });
}

/* ========= Финализация ========= */
setupFinalization({
  ui: { finalStatus:$("finalStatus"), finalList:$("finalList"), btnRefreshFinal:$("btnRefreshFinal"), btnFinalizeAll:$("btnFinalizeAll") },
  ensureSepolia, getSigner:()=>signer, getUser:()=>user
});

/* ========= Запись метрики (перенесено сюда и пробрасывается в bridgeControls) ========= */
async function regrantLastHistory(dir){
  try{
    await ensureSepolia(); await rebuildProviderSigner();
    const { src, dst } = (dir === "b2s") ? DIR_B2S : DIR_S2B;
    const len = Number(await contract.myHistoryLength(src, dst));
    if (len <= 0) return;
    const tx = await contract.grantMyHistoryRange(src, dst, BigInt(len - 1), BigInt(len), { gasLimit: 500_000 });
    await tx.wait();
  }catch{}
}
async function recordMetric({ src, dst, amountWei, originTxHash }){
  await ensureSepolia();
  const buf=relayer.createEncryptedInput(getAddress(CONTRACT_ADDRESS),getAddress(user));
  buf.add128(amountWei);
  const { handles, inputProof } = await buf.encrypt();
  const origin=originTxHash ?? ("0x"+"00".repeat(32));
  const tx=await contract.record(src,dst,handles[0],inputProof,origin,{ gasLimit:1_200_000 });
  await tx.wait();
  const dir = (src === DIR_B2S.src && dst === DIR_B2S.dst) ? "b2s" : "s2b";
  await regrantLastHistory(dir);
}

/* ========= Модули UI (инициализация) ========= */

// 1) Метрики
const metrics = setupMetrics({
  getUser: ()=>user,
  privateReadStrict,
  readMyLastN,
  weiToEthStr
});

// 2) Бридж-контролы
setupBridgeControls({
  getSigner: ()=>signer,
  getUser:   ()=>user,
  getProvider: ()=>provider,
  ensureSepolia, ensureBaseSepolia, rebuildProviderSigner,
  refreshBalance,
  onAfterBridge: async ()=>{
    await refreshBalance();
    await metrics.refreshAllTiles();
    await metrics.refreshDirectionalAnalytics();
    await history.fetchHistoryFromHub(1);
  },
  recordMetric, DIR_S2B, DIR_B2S,
  L1_BRIDGE_SEPOLIA, L2_BRIDGE_BASE_SEPOLIA,
  ethers,
  parseEthRelaxed,
  toast, setStatusShort, isUserRejection
});

// 3) История
const history = setupHistoryBlock({
  getUser: ()=>user,
  contractGetter: ()=>contract,
  DIR_S2B, DIR_B2S,
  ifaceHub,
  sepoliaRpcTry,
  myHistoryLength, myHistoryPage,
  userDecryptSafe, grantRange,
  ensureSepolia, rebuildProviderSigner,
  ethers, toast
});

// 4) Нижний блок (Private/Public/Publish)
setupSnapshots({
  privateReadStrict, getPublic,
  updateTiles: metrics.updateTiles,
  updateCharts: metrics.updateCharts,
  ensureSepolia, rebuildProviderSigner,
  contractGetter: ()=>contract,
  DIR_S2B, DIR_B2S,
  toast, setStatusShort, isUserRejection, ethers
});

/* ========= INIT ========= */
window.addEventListener("load", ()=>{ metrics.resetCharts(); updateNetworkPill(); });
btnWallet?.addEventListener("mouseenter", ()=>walletMenu?.classList.add("hide"));
