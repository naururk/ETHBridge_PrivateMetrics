// public/js/finalization.js — B→S finalization UI (robust Prove rotation)

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  getAddress,
  parseAbiItem,
} from "https://cdn.jsdelivr.net/npm/viem@2.35.0/+esm";
import { baseSepolia, sepolia } from "https://cdn.jsdelivr.net/npm/viem@2.35.0/chains/+esm";
import {
  getWithdrawals,
  publicActionsL1,
  walletActionsL1,
  buildProveWithdrawal,
} from "https://cdn.jsdelivr.net/npm/viem@2.35.0/op-stack/+esm";

import {
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_EXPLORER,
  CONTRACT_ADDRESS,
  SEPOLIA_RPC_PRIMARY,
  SEPOLIA_RPC_SECONDARY,
  SEPOLIA_RPC_BACKUPS,
  BASE_SEPOLIA_RPC_BACKUPS,
} from "./config.js";

/* ── chains ───────────────────────────────────────────────────── */
const L2_CHAIN = baseSepolia;
const L1_CHAIN = sepolia;

/* ── RPC rotation helpers ─────────────────────────────────────── */
const L1_RPCS = [SEPOLIA_RPC_PRIMARY, SEPOLIA_RPC_SECONDARY, ...(SEPOLIA_RPC_BACKUPS||[])].filter(Boolean);
const L2_RPCS = [BASE_SEPOLIA_RPC, ...(BASE_SEPOLIA_RPC_BACKUPS||[])].filter(Boolean);

const makeL1Public = (url) =>
  (url ? createPublicClient({ chain: L1_CHAIN, transport: http(url) })
       : createPublicClient({ chain: L1_CHAIN, transport: http() }))
  .extend(publicActionsL1());

const makeL2Public = (url) =>
  createPublicClient({ chain: L2_CHAIN, transport: http(url) });

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const isTransient = (e)=>{
  const m=String(e?.message||"").toLowerCase();
  return /timeout|temporar|busy|no backend|server error|bad request|503|service unavailable|429|too many|rate/i.test(m) || e?.code===-32011 || e?.code===35;
};
async function withRetry(fn,{tries=8,delay=300}={}){ let w=delay;
  for(let i=0;i<tries;i++){ try{ return await fn(); }
    catch(e){ if(!isTransient(e)||i===tries-1) throw e; await sleep(w); w=Math.min(4000,Math.floor(w*1.8)); }
  }
}
async function callL1(fn){
  const urls = L1_RPCS.length ? L1_RPCS : [null];
  let lastErr;
  for (const u of urls){
    const client = makeL1Public(u);
    try{ return await withRetry(()=>fn(client)); }
    catch(e){ lastErr=e; if(!isTransient(e)) break; }
  }
  throw lastErr;
}
async function callL2(fn){
  let lastErr;
  for (const u of (L2_RPCS.length?L2_RPCS:[BASE_SEPOLIA_RPC]).filter(Boolean)){
    const client = makeL2Public(u);
    try{ return await withRetry(()=>fn(client)); }
    catch(e){ lastErr=e; if(!isTransient(e)) break; }
  }
  throw lastErr;
}

/* ── small utils ──────────────────────────────────────────────── */
const shortTx = (h)=>`${h.slice(0,10)}…${h.slice(-6)}`;
function fmtEta(sec){ if(!sec||sec<=0) return ""; if(sec<90) return `ETA ~${Math.ceil(sec)}s`; const m=Math.ceil(sec/60); if(m<90) return `ETA ~${m}m`; const h=Math.ceil(m/60); return `ETA ~${h}h`; }
function pill(status,eta){ const e=fmtEta(eta);
  if(status==="finalized")           return `<span class="pill good" title="Message relayed on L1">✅ relayed</span>`;
  if(status==="ready-to-finalize")   return `<span class="pill good" title="Challenge over">${e?`🟢 ready (${e})`:"🟢 ready"}</span>`;
  if(status==="waiting-to-finalize") return `<span class="pill warn" title="Challenge period">${e?`⏳ challenge (${e})`:"⏳ challenge"}</span>`;
  if(status==="ready-to-prove")      return `<span class="pill good" title="L2 output is available">🧾 ready to prove</span>`;
  if(status==="waiting-to-prove")    return `<span class="pill bad"  title="Waiting L2 state root on L1">🕒 waiting state root</span>`;
  return `<span class="pill">unknown</span>`;
}

/* ── ABI/addresses ─────────────────────────────────────────────── */
const RecordedEvt = parseAbiItem("event Recorded(uint32 indexed src, uint32 indexed dst, address indexed user, uint256 idx, bytes32 originTx)");
const PORTAL_SEPOLIA = "0x49f53e41452c74589e85ca1677426ba426459e85";
const WithdrawalProvenEvt    = parseAbiItem("event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from, address indexed to)");
const WithdrawalFinalizedEvt = parseAbiItem("event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success)");
const FinalPeriodFn          = parseAbiItem("function finalizationPeriodSeconds() view returns (uint256)");
const SRC_BASE_SEPOLIA = 84532n;
const DST_SEPOLIA      = 11155111n;
const CHALLENGE_DEFAULT = 7*24*3600;
const MAX_RECENT_TX = 10;

/* ── logs scan (paged) ─────────────────────────────────────────── */
async function getLogsPaged({ client, address, event, args, latest, start, initialStep=9000n, minStep=600n }){
  const out=[]; let step=initialStep; let from=start;
  while(from<=latest){
    let to=from+step; if(to>latest) to=latest;
    try{
      const logs=await withRetry(()=>client.getLogs({address,event,args,fromBlock:from,toBlock:to}));
      out.push(...logs); from=to+1n; await sleep(120);
    }catch(e){
      if(isTransient(e)){ step=step>minStep?(step>>1n):minStep; await sleep(250); continue; }
      console.warn("[getLogsPaged] fatal", {from:String(from),to:String(to)}, e);
      from=to+1n;
    }
  }
  return out;
}

async function getMyOriginTxList(user){
  try{
    const latest = await callL1((c)=>c.getBlockNumber());
    const RANGE = 140_000n; const start = latest>RANGE?latest-RANGE:0n;
    const logs = await callL1((c)=>getLogsPaged({ client:c, address:CONTRACT_ADDRESS, event:RecordedEvt, args:{user:getAddress(user)}, latest, start }));
    const pairs=[];
    for(const lg of logs){ try{
      const src=BigInt(lg.args.src), dst=BigInt(lg.args.dst);
      if(src===SRC_BASE_SEPOLIA && dst===DST_SEPOLIA){
        const ox=(lg.args.originTx||("0x"+"00".repeat(32))).toLowerCase();
        if(ox!=="0x"+"00".repeat(64)) pairs.push({originTx:ox,l1Block:Number(lg.blockNumber||0)});
      }
    }catch{} }
    pairs.sort((a,b)=>b.l1Block-a.l1Block);
    const uniq=[], seen=new Set();
    for(const p of pairs){ if(!seen.has(p.originTx)){ uniq.push(p.originTx); seen.add(p.originTx);} if(uniq.length>=MAX_RECENT_TX) break; }
    return uniq;
  }catch(e){ console.warn("[Recorded scan] failed", e); return []; }
}

/* ── status helpers ────────────────────────────────────────────── */
async function getWithdrawalFromL2Tx(l2TxHash){
  try{
    const receipt = await callL2((c)=>c.getTransactionReceipt({ hash:l2TxHash }));
    const [w] = getWithdrawals(receipt);
    const withdrawalHash = w?.withdrawalHash || w?.hash || null;
    return { receipt, withdrawal:w, withdrawalHash, l2Block:Number(receipt.blockNumber) };
  }catch(e){
    console.warn("[getWithdrawalFromL2Tx] receipt missing, fallback waiting-to-prove for", l2TxHash, e);
    return { receipt:null, withdrawal:null, withdrawalHash:null, l2Block:0 };
  }
}
async function tryStatusViaHelper(receipt){
  if(!receipt) return null;
  try{
    const s = await callL1((c)=>c.getWithdrawalStatus({receipt, targetChain:L2_CHAIN}));
    return typeof s==="string" ? {status:s, meta:null} : {status:s?.status||"unknown", meta:s||null};
  }catch{ return null; }
}
async function statusViaPortalEvents({withdrawalHash,l2Block}){
  const latest = await callL1((c)=>c.getBlockNumber());
  const RANGE=500_000n, fromBlock = latest>RANGE?latest-RANGE:0n;

  const fin = await callL1((c)=>getLogsPaged({ client:c, address:PORTAL_SEPOLIA, event:WithdrawalFinalizedEvt, args:{withdrawalHash}, latest, start:fromBlock }));
  if(fin.length) return { status:"finalized", meta:{finalized:true} };

  const prv = await callL1((c)=>getLogsPaged({ client:c, address:PORTAL_SEPOLIA, event:WithdrawalProvenEvt, args:{withdrawalHash}, latest, start:fromBlock }));
  if(prv.length){
    const proofLog = prv[prv.length-1];
    const block = await callL1((c)=>c.getBlock({ blockNumber: proofLog.blockNumber }));
    const provedTs = Number(block?.timestamp||0);
    let period=0; try{ period = Number(await callL1((c)=>c.readContract({ address:PORTAL_SEPOLIA, abi:[FinalPeriodFn], functionName:"finalizationPeriodSeconds" }))); }catch{ period = CHALLENGE_DEFAULT; }
    const now=Math.floor(Date.now()/1000), left=Math.max(0, provedTs+period-now);
    return { status: left===0 ? "ready-to-finalize" : "waiting-to-finalize", meta:{ provedTs, finalizationPeriodSeconds: period, eta:left } };
  }

  try{ await callL1((c)=>c.getL2Output({ l2BlockNumber: BigInt(l2Block), targetChain:L2_CHAIN })); return { status:"ready-to-prove", meta:null }; }
  catch{ return { status:"waiting-to-prove", meta:null }; }
}
async function getStatusAndBlockByL2Tx(l2TxHash){
  try{
    const { receipt, withdrawal, withdrawalHash, l2Block } = await getWithdrawalFromL2Tx(l2TxHash);
    if(!withdrawal){ console.warn("[status fallback] using waiting-to-prove for", l2TxHash); return { status:"waiting-to-prove", l2Block:l2Block||0, meta:null }; }
    const via = await tryStatusViaHelper(receipt); if(via) return { status:via.status, l2Block, meta:via.meta };
    if(withdrawalHash) return await statusViaPortalEvents({ withdrawalHash, l2Block });
    return { status:"waiting-to-prove", l2Block, meta:null };
  }catch(e){
    console.warn("[status] error; fallback waiting-to-prove for", l2TxHash, e);
    try{ const r=await callL2((c)=>c.getTransactionReceipt({hash:l2TxHash})); return { status:"waiting-to-prove", l2Block:Number(r.blockNumber), meta:null }; }
    catch{ return { status:"waiting-to-prove", l2Block:0, meta:null }; }
  }
}
function extractEtaSeconds(meta){
  try{
    if(!meta) return 0;
    if(typeof meta?.eta==="number") return Math.max(0,Math.floor(meta.eta));
    const now=Math.floor(Date.now()/1000), provedTs=Number(meta?.provedTimestamp??meta?.provedTs??0), fin=Number(meta?.finalizationPeriodSeconds??0);
    if(provedTs && fin){ const eta=provedTs+fin-now; return eta>0?eta:0; }
  }catch{}
  return 0;
}

/* ── Prove / Finalize ─────────────────────────────────────────── */
function makeWalletL1(){ return createWalletClient({ chain: L1_CHAIN, transport: custom(window.ethereum) }).extend(walletActionsL1()); }

// Специальный ротатор для buildProveWithdrawal (где делается eth_getProof)
function isProofIssue(e){
  const m=String(e?.message||"").toLowerCase();
  return /eth_getproof|getproof|no backend|not available|unsupported|503|service unavailable|429|too many|rate/.test(m) || e?.code===-32011;
}
async function buildProveArgsRotating({ account, output, withdrawal }){
  let lastErr;
  for (const url of L2_RPCS){
    const client = makeL2Public(url);
    try{
      // лёгкая проверка, чтобы отсечь мёртвый RPC
      await client.getBlockNumber();
      const args = await buildProveWithdrawal(client, { account, output, withdrawal });
      return args;
    }catch(e){
      lastErr=e;
      if(!isProofIssue(e)) break; // не «понятная» ошибка — дальше нет смысла
      console.warn("[buildProveWithdrawal] rotate L2 RPC due to:", e?.message||e, "url=", url);
      continue;
    }
  }
  throw lastErr;
}

async function proveByL2Tx(l2TxHash, ensureSepolia, getUser){
  // 1) L2 receipt
  const receipt = await callL2((c)=>c.getTransactionReceipt({hash:l2TxHash}))
    .catch((e)=>{ console.warn("[prove] receipt fetch failed", l2TxHash, e); return null; });
  if(!receipt){ alert("Prove failed: L2 receipt not found yet (try again a bit later)."); throw new Error("ReceiptNotFound"); }

  const [withdrawal] = getWithdrawals(receipt);

  // 2) Ждём публикации L2 output на L1
  const output = await callL1((c)=>c.getL2Output({ l2BlockNumber: receipt.blockNumber, targetChain: L2_CHAIN }));

  // 3) Формируем аргументы прува с ротацией RPC для eth_getProof
  const account = getUser?.();
  const args = await buildProveArgsRotating({ account, output, withdrawal });

  // 4) Транзакция на L1
  await ensureSepolia();
  const walletL1 = makeWalletL1();
  return await withRetry(()=>walletL1.proveWithdrawal(args));
}

async function finalizeByL2Tx(l2TxHash, ensureSepolia, getUser){
  await ensureSepolia();
  const walletL1 = makeWalletL1();

  const receipt = await callL2((c)=>c.getTransactionReceipt({ hash:l2TxHash }));
  const [withdrawal] = getWithdrawals(receipt);

  // маленькая защита от преждевременного finalize
  try{
    const st = await callL1((c)=>c.getWithdrawalStatus({ receipt, targetChain:L2_CHAIN }));
    const s = typeof st==="string"?st:st?.status;
    if (s !== "ready-to-finalize") throw new Error("Withdrawal not matured yet");
  }catch(e){
    console.warn("[finalize] helper check", e);
  }
  return await withRetry(()=>walletL1.finalizeWithdrawal({ account:getUser?.(), targetChain:L2_CHAIN, withdrawal }));
}

/* ── UI (без изменений логики вывода) ─────────────────────────── */
let UI={}; let ensureSepoliaCb, getUserCb; let currentEnriched=[];
function renderEmpty(){ if(!UI.finalStatus||!UI.finalList) return; UI.finalStatus.textContent="No pending withdrawals yet."; UI.finalList.innerHTML=""; }

function renderRows(items){
  UI.finalList.innerHTML="";
  for (const it of items){
    const row=document.createElement("div");
    row.className="item";
    row.innerHTML=`
      <div>
        <div><b>B→S</b> <span class="mono">${shortTx(it.l2tx)}</span></div>
        <div class="hint">L2 block ${it.l2Block ?? "…"}</div>
      </div>
      <div class="row gap" data-actions>
        <span class="pill">checking…</span>
        <button class="btn btn--ghost tiny" data-act="l2">🔗 L2 tx</button>
      </div>`;
    row.querySelector('[data-act="l2"]')?.addEventListener("click",()=>window.open(`${BASE_SEPOLIA_EXPLORER}/tx/${it.l2tx}`,"_blank"));
    UI.finalList.appendChild(row);

    (async()=>{
      try{
        const { status, meta } = await getStatusAndBlockByL2Tx(it.l2tx);
        const eta = extractEtaSeconds(meta);
        const box=row.querySelector("[data-actions]");
        box.innerHTML = `${pill(status, eta)} <button class="btn btn--ghost tiny" data-act="l2">🔗 L2 tx</button>`;
        box.querySelector('[data-act="l2"]')?.addEventListener("click",()=>window.open(`${BASE_SEPOLIA_EXPLORER}/tx/${it.l2tx}`,"_blank"));

        if (status==="ready-to-prove"){
          const b=document.createElement("button");
          b.className="btn tiny"; b.textContent="🧾 Prove";
          b.dataset.tx = it.l2tx;
          b.addEventListener("click", async (ev)=>{
            const tx = ev.currentTarget?.dataset?.tx;
            try{
              b.classList.add("loading");
              const txh = await proveByL2Tx(tx, ensureSepoliaCb, getUserCb);
              alert("Proved on L1: "+txh);
              await refreshList();
            }catch(e){
              console.warn("Prove failed", e);
              alert("Prove failed (see console)");
            }finally{ b.classList.remove("loading"); }
          });
          box.appendChild(b);
        } else if (status==="ready-to-finalize"){
          const b=document.createElement("button");
          b.className="btn tiny"; b.textContent="✅ Finalize";
          b.dataset.tx = it.l2tx;
          b.addEventListener("click", async (ev)=>{
            const tx = ev.currentTarget?.dataset?.tx;
            try{
              b.classList.add("loading");
              const txh = await finalizeByL2Tx(tx, ensureSepoliaCb, getUserCb);
              alert("Finalized on L1: "+txh);
              await refreshList();
            }catch(e){
              console.warn("Finalize failed", e);
              alert("Finalize failed (see console)");
            }finally{ b.classList.remove("loading"); }
          });
          box.appendChild(b);
        }
      }catch(e){ console.warn("status error", e); }
    })();
  }
}

/* ── refresh / init ────────────────────────────────────────────── */
async function refreshList(){
  try{
    const user = getUserCb?.();
    if(!user){ renderEmpty(); UI.finalStatus.textContent="Connect a wallet."; return []; }

    UI.finalStatus.textContent="Reading my dapp events on L1…";
    UI.finalList.innerHTML="";

    const originTxs = await getMyOriginTxList(user);
    if(!originTxs.length){ renderEmpty(); currentEnriched=[]; return []; }

    const enriched=[];
    for(const tx of originTxs){
      try{ const { l2Block, status } = await getStatusAndBlockByL2Tx(tx); if(status!=="finalized") enriched.push({ l2tx:tx, l2Block, status }); }
      catch(e){ console.warn("status calc failed; keep item", tx, e); enriched.push({ l2tx:tx, l2Block:0, status:"waiting-to-prove" }); }
    }

    enriched.sort((a,b)=>(b.l2Block||-1)-(a.l2Block||-1));
    UI.finalStatus.textContent = `${enriched.length} pending withdrawals`;
    renderRows(enriched);
    currentEnriched=enriched;
    return enriched;
  }catch(e){
    console.warn("[Finalization] Refresh failed", e);
    UI.finalStatus.textContent="Refresh failed (see console).";
    UI.finalList.innerHTML=""; currentEnriched=[]; return [];
  }
}

export function setupFinalization({ ui, ensureSepolia, getSigner, getUser }){
  UI = ui || {}; ensureSepoliaCb = ensureSepolia; getUserCb = getUser;
  renderEmpty();
  UI.btnRefreshFinal?.addEventListener("click", async()=>{ await refreshList(); });
  UI.btnFinalizeAll?.addEventListener?.("click", async ()=>{
    const list=currentEnriched.length?currentEnriched:await refreshList();
    const ready=list.filter(x=>x.status==="ready-to-finalize");
    if(!ready.length){ alert("No withdrawals are ready to finalize."); return; }
    if(!confirm(`Finalize ${ready.length} withdrawal(s) on L1?`)) return;
    try{
      await ensureSepoliaCb(); const wallet=makeWalletL1();
      for(const it of ready){
        try{
          const receipt = await callL2((c)=>c.getTransactionReceipt({ hash:it.l2tx }));
          const [withdrawal] = getWithdrawals(receipt);
          await withRetry(()=>wallet.finalizeWithdrawal({ account:getUserCb?.(), targetChain:L2_CHAIN, withdrawal }));
          await sleep(200);
        }catch(e){ console.warn("Finalize(one) failed", it.l2tx, e); }
      }
      alert("Finalize transactions sent.");
    } finally { await refreshList(); }
  });
  return { refresh: async ()=>UI.btnRefreshFinal?.click() };
}
