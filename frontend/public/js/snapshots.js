// public/js/snapshots.js
// Нижний блок: переключатель направлений + Private/Public Read + Publish

export function setupSnapshots({
  privateReadStrict, getPublic,
  updateTiles, updateCharts,
  ensureSepolia, rebuildProviderSigner,
  contractGetter, DIR_S2B, DIR_B2S,
  toast, setStatusShort, isUserRejection, ethers
}){
  const segSB = byId("segSB"), segBS = byId("segBS");
  const btnPrivateRead=byId("btnPrivateRead"), btnPublicRead=byId("btnPublicRead"), btnPublish=byId("btnPublish");
  const kAnon=byId("kAnon");
  function byId(id){ return document.getElementById(id); }

  let activeDir="s2b";
  function segmentedActivate(which){
    activeDir=which;
    const g=segSB?.closest(".segmented");
    segSB?.classList.toggle("is-active",which==="s2b");
    segBS?.classList.toggle("is-active",which!=="s2b");
    const thumb=g?.querySelector(".segmented__thumb");
    if(thumb){ const e=which==="s2b"?segSB:segBS; const r=e.getBoundingClientRect(), p=g.getBoundingClientRect();
      thumb.style.setProperty("--seg-w",r.width+"px"); thumb.style.setProperty("--seg-x",(r.left-p.left)+"px"); }
  }
  segSB?.addEventListener("click", ()=>segmentedActivate("s2b"));
  segBS?.addEventListener("click", ()=>segmentedActivate("b2s"));
  segmentedActivate("s2b");

  btnPrivateRead?.addEventListener("click", async ()=>{
    try{
      btnPrivateRead.classList.add("loading");
      const a=await privateReadStrict("s2b");
      const b=await privateReadStrict("b2s");
      updateTiles(a,b); updateCharts(a,b);
      toast("Private totals (per-wallet) updated","good");
    }catch(e){ console.error(e); setStatusShort(e); toast("Private read failed","bad"); }
    finally{ btnPrivateRead.classList.remove("loading"); }
  });

  btnPublicRead?.addEventListener("click", async ()=>{
    try{
      btnPublicRead.classList.add("loading");
      const volS2B=await getPublic("s2b");
      const volB2S=await getPublic("b2s");
      const pvSB=byId("pvSB"), pvBS=byId("pvBS");
      pvSB && (pvSB.textContent = (Number(volS2B)/1e18).toLocaleString(undefined,{maximumFractionDigits:6}));
      pvBS && (pvBS.textContent = (Number(volB2S)/1e18).toLocaleString(undefined,{maximumFractionDigits:6}));
      toast("Public snapshots updated","good");
    }catch(e){ console.error(e); setStatusShort(e); toast("Public read failed","bad"); }
    finally{ btnPublicRead.classList.remove("loading"); }
  });

  btnPublish?.addEventListener("click", async ()=>{
    try{
      btnPublish.classList.add("loading");
      await ensureSepolia(); await rebuildProviderSigner();
      const { src, dst } = activeDir==="s2b" ? DIR_S2B : DIR_B2S;
      const k=BigInt(Math.max(1,Number(kAnon.value||5)));
      const tx=await contractGetter().publish(src,dst,k,{ gasLimit:800_000 });
      await tx.wait(); toast("Snapshot published","good");
    }catch(e){ if(!isUserRejection(e)){ console.error(e); setStatusShort(e); toast("Publish failed","bad"); } }
    finally{ btnPublish.classList.remove("loading"); }
  });
}
