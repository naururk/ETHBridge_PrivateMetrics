// public/js/bridgeControls.js
// Блок: Deposit / Withdraw (с сохранением записи метрики)

const L2_ETH = "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000";
const L2_BRIDGE_ABI = [
  "function withdrawTo(address _l2Token, address _to, uint256 _amount, uint32 _l1Gas, bytes _data) payable",
  "function withdraw(address _l2Token, uint256 _amount, uint32 _l1Gas, bytes _data) payable",
];

export function setupBridgeControls({
  getSigner, getUser, getProvider,
  ensureSepolia, ensureBaseSepolia, rebuildProviderSigner,
  refreshBalance, onAfterBridge,
  recordMetric, DIR_S2B, DIR_B2S,
  L1_BRIDGE_SEPOLIA, L2_BRIDGE_BASE_SEPOLIA,
  ethers, parseEthRelaxed, toast, setStatusShort, isUserRejection
}){
  const segDeposit = el("segDeposit"), segWithdraw = el("segWithdraw");
  const amtEth = el("amtEth"), btnDoBridge = el("btnDoBridge"), btnMax = el("btnMax");
  function el(id){ return document.getElementById(id); }

  let active="deposit";

  function setActive(which){
    active=which;
    const group=segDeposit?.closest(".segmented");
    segDeposit?.classList.toggle("is-active",which==="deposit");
    segWithdraw?.classList.toggle("is-active",which!=="deposit");
    const thumb=group?.querySelector(".segmented__thumb");
    if(thumb){ const target=which==="deposit"?segDeposit:segWithdraw;
      const r=target.getBoundingClientRect(), p=group.getBoundingClientRect();
      thumb.style.setProperty("--seg-w",r.width+"px");
      thumb.style.setProperty("--seg-x",(r.left-p.left)+"px");
    }
    refreshBalance?.();
  }

  segDeposit?.addEventListener("click", ()=>setActive("deposit"));
  segWithdraw?.addEventListener("click", ()=>setActive("withdraw"));

  btnMax?.addEventListener("click", async ()=>{
    try{
      const user=getUser(); if(!user) return;
      const wantSepolia = (active==="deposit");
      await (wantSepolia?ensureSepolia():ensureBaseSepolia());
      const bal = await getProvider().getBalance(user);
      const gasBuf=ethers.parseUnits("0.002",18);
      let use=bal; if(use>gasBuf) use-=gasBuf; if(use<0n) use=0n;
      amtEth.value = ethers.formatUnits(use,18);
    }catch{}
  });

  btnDoBridge?.addEventListener("click", async ()=>{
    try{
      setStatusShort("");
      const amountWei=parseEthRelaxed(amtEth.value);
      if(active==="deposit"){
        await ensureSepolia(); await rebuildProviderSigner();
        const l1=new ethers.Contract(L1_BRIDGE_SEPOLIA,[
          "function depositETH(uint32 _l2Gas, bytes _data) payable",
          "function depositETHTo(address _to, uint32 _l2Gas, bytes _data) payable"
        ], getSigner());
        const l2Gas=200_000;
        const tx=await l1.depositETH(l2Gas,"0x",{ value:amountWei });
        await tx.wait();
        // записываем приватную метрику на L1
        await recordMetric({ src:DIR_S2B.src, dst:DIR_S2B.dst, amountWei, originTxHash:tx.hash });
        toast("Deposited to Base Sepolia","good");
      }else{
        await ensureBaseSepolia(); await rebuildProviderSigner();
        const l2=new ethers.Contract(L2_BRIDGE_BASE_SEPOLIA,L2_BRIDGE_ABI,getSigner());
        const l1Gas=200_000; let sent;
        try{ sent=await l2.withdrawTo(L2_ETH, await getSigner().getAddress(), amountWei, l1Gas, "0x", { value:amountWei, gasLimit:900_000 }); await sent.wait(); }
        catch{ sent=await l2.withdraw(L2_ETH, amountWei, l1Gas, "0x", { value:amountWei, gasLimit:900_000 }); await sent.wait(); }
        // после L2 → L1 — также пишем метрику
        await ensureSepolia(); await rebuildProviderSigner();
        await recordMetric({ src:DIR_B2S.src, dst:DIR_B2S.dst, amountWei, originTxHash:sent.hash });
        toast("Withdrew to Sepolia (prove → finalize later on L1)","good");
      }
      await onAfterBridge?.();
    }catch(e){
      if(isUserRejection(e)){ toast("Cancelled","warn"); return; }
      console.error(e); setStatusShort(e); toast("Bridge failed","bad");
    }
  });

  setActive("deposit");
}
