// public/js/historyBlock.js
// Блок: My history — Sepolia ↔ Base Sepolia (пагинация)

export function setupHistoryBlock({
  getUser, contractGetter,
  DIR_S2B, DIR_B2S, ifaceHub,
  sepoliaRpcTry, myHistoryLength, myHistoryPage,
  userDecryptSafe, grantRange,
  ensureSepolia, rebuildProviderSigner,
  ethers, toast
}){
  const histTitle = byId("histTitle");
  const histStatus = byId("histStatus"), histList = byId("histList");
  let histPager = byId("histPager");

  const HIST_PAGE_SIZE=10;
  let histTotal=0, histPages=1, histPage=1;
  let mode="deposit"; // deposit = S→B, withdraw = B→S

  function byId(id){ return document.getElementById(id); }
  function ensurePagerEl(){
    if(!histPager){ histPager=document.createElement("div"); histPager.id="histPager"; histPager.className="pager"; histList?.insertAdjacentElement("afterend",histPager); }
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
    let html=""; if(histPage>1) html+=btn(histPage-1,"«","is-nav");
    for(let p=start;p<=end;p++) html+=btn(p,String(p),p===histPage?"is-active":"");
    if(histPage<histPages) html+=btn(histPage+1,"»","is-nav");
    histPager.innerHTML=html;
  }
  histPager?.addEventListener?.("click",(e)=>{ const b=e.target.closest?.(".pager__btn"); if(!b) return;
    const p=Number(b.getAttribute("data-page")||1); if(p>=1 && p<=histPages && p!==histPage){ fetchHistoryFromHub(p); } });

  function resetHistoryUI(){
    if(histTitle) histTitle.textContent = mode==="deposit" ? "My history — Sepolia → Base Sepolia" : "My history — Base Sepolia → Sepolia";
    if(histStatus) histStatus.textContent="";
    if(histList) histList.innerHTML="";
    ensurePagerEl(); if(histPager) histPager.innerHTML="";
  }

  async function fetchHistoryFromHub(page=1){
    if(!getUser()){ resetHistoryUI(); return; }
    try{
      resetHistoryUI();
      const dir = (mode==="deposit") ? DIR_S2B : DIR_B2S;
      const {src,dst}=dir;

      const len=await myHistoryLength(src,dst);
      histTotal=Number(len); histPages=Math.max(1,Math.ceil(histTotal/HIST_PAGE_SIZE)); histPage=Math.min(Math.max(1,page),histPages);
      if(!histTotal){ renderHistory([]); renderPager(); return; }

      const endExclusive=histTotal-(histPage-1)*HIST_PAGE_SIZE;
      const start=Math.max(0,endExclusive-HIST_PAGE_SIZE);
      const count=Math.max(0,endExclusive-start);

      const {amounts,timestamps}=await myHistoryPage(src,dst,start,count);
      let {results,failedIdx}=await userDecryptSafe(amounts);
      if(failedIdx.length){ try{ await ensureSepolia(); await rebuildProviderSigner(); await grantRange(src,dst,start,count); ({results}=await userDecryptSafe(amounts)); }catch{} }

      // Recorded events → originTx
      let originByIdx=new Map(), recTxByIdx=new Map();
      try{
        const ev=ifaceHub.getEvent("Recorded");
        const topics=ifaceHub.encodeFilterTopics(ev,[src,dst,getUser()]);
        const logs=await sepoliaRpcTry("eth_getLogs",[{address:contractGetter()?.target,topics,fromBlock:"0x0",toBlock:"latest"}]);
        for(const lg of logs){
          const dec=ifaceHub.decodeEventLog(ev,lg.data,lg.topics);
          const idx=Number(dec.idx);
          recTxByIdx.set(idx,lg.transactionHash);
          const origin=dec.originTx;
          if(origin && origin!=="0x"+"00".repeat(32)) originByIdx.set(idx, ethers.hexlify(origin));
        }
      }catch{}

      const items=[];
      for(let i=0;i<count;i++){
        const globalIdx=start+i;
        const h=amounts[i], ts=Number(timestamps[i]);
        const origin=originByIdx.get(globalIdx)||null;
        const recordTx=recTxByIdx.get(globalIdx)||null;
        const txHash=origin||recordTx;
        const val=results.has(h)?results.get(h):null;
        items.push({ ts, amountWei:val, txHash });
      }
      items.reverse();
      renderHistory(items); renderPager();
    }catch(e){
      if(histStatus) histStatus.textContent="Failed to load history.";
      if(histList) histList.innerHTML="";
      ensurePagerEl(); if(histPager) histPager.innerHTML="";
    }
  }

  return {
    setModeDeposit: ()=>{ mode="deposit"; resetHistoryUI(); },
    setModeWithdraw: ()=>{ mode="withdraw"; resetHistoryUI(); },
    fetchHistoryFromHub
  };
}
