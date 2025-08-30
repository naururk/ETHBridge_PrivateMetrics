// public/js/metrics.js
// Блоки: Bridge ETH & keep metrics private  +  Analytics (private) — by direction

export function setupMetrics({ getUser, privateReadStrict, readMyLastN, weiToEthStr }){
  const vSB = byId("vSB"), cSB = byId("cSB"), vBS = byId("vBS"), cBS = byId("cBS"),
        pvSB = byId("pvSB"), pvBS = byId("pvBS");
  const sb24v=byId("sb24v"), sb7dv=byId("sb7dv"), sbMed=byId("sbMed"), sbP90=byId("sbP90");
  const bs24v=byId("bs24v"), bs7dv=byId("bs7dv"), bsMed=byId("bsMed"), bsP90=byId("bsP90");

  let splitChart=null, countChart=null, trendChart=null, sizeChartSB=null, sizeChartBS=null;

  function byId(id){ return document.getElementById(id); }

  function ensureCharts(){
    if(!window.Chart) return;
    if(!splitChart){
      const el=byId("splitChart"); if(el) splitChart=new Chart(el,{type:"doughnut",
        data:{labels:["S→B","B→S"],datasets:[{data:[0,0],backgroundColor:["#111","#4f46e5"]}]},
        options:{plugins:{legend:{position:"bottom"}}}});
    }
    if(!countChart){
      const el=byId("countChart"); if(el) countChart=new Chart(el,{type:"bar",
        data:{labels:["S→B","B→S"],datasets:[{label:"Transfers",data:[0,0],backgroundColor:["#10b981","#3b82f6"]}]},
        options:{scales:{y:{beginAtZero:true,precision:0}},plugins:{legend:{display:false}}}});
    }
    if(!trendChart){
      const el=byId("trendChart"); if(el) trendChart=new Chart(el,{type:"line",
        data:{labels:[],datasets:[{label:"S→B Volume (ETH)",data:[],borderColor:"#111",fill:false,tension:.2}]},
        options:{plugins:{legend:{display:false}}}});
    }
    if(!sizeChartSB){
      const el=byId("sizeChartSB"); if(el) sizeChartSB=new Chart(el,{type:"doughnut",
        data:{labels:["Small","Medium","Large"],datasets:[{data:[0,0,0],backgroundColor:["#9ca3af","#4f46e5","#111827"]}]},
        options:{plugins:{legend:{position:"bottom"}}}});
    }
    if(!sizeChartBS){
      const el=byId("sizeChartBS"); if(el) sizeChartBS=new Chart(el,{type:"doughnut",
        data:{labels:["Small","Medium","Large"],datasets:[{data:[0,0,0],backgroundColor:["#9ca3af","#10b981","#111827"]}]},
        options:{plugins:{legend:{position:"bottom"}}}});
    }
  }
  function resetCharts(){
    ensureCharts();
    try{
      if(splitChart){ splitChart.data.datasets[0].data=[0,0]; splitChart.update(); }
      if(countChart){ countChart.data.datasets[0].data=[0,0]; countChart.update(); }
      if(trendChart){ trendChart.data.labels=[]; trendChart.data.datasets[0].data=[]; trendChart.update(); }
      if(sizeChartSB){ sizeChartSB.data.datasets[0].data=[0,0,0]; sizeChartSB.update(); }
      if(sizeChartBS){ sizeChartBS.data.datasets[0].data=[0,0,0]; sizeChartBS.update(); }
    }catch{}
  }

  function updateTiles(a,b){
    const s=weiToEthStr(a.volWei), c=weiToEthStr(b.volWei);
    vSB && (vSB.textContent=s); vBS && (vBS.textContent=c);
    cSB && (cSB.textContent=a.cnt.toString()); cBS && (cBS.textContent=b.cnt.toString());
  }
  function updateCharts(a,b){
    ensureCharts(); if(!splitChart||!countChart||!trendChart) return;
    splitChart.data.datasets[0].data=[Number(a.volWei)/1e18, Number(b.volWei)/1e18]; splitChart.update();
    countChart.data.datasets[0].data=[Number(a.cnt), Number(b.cnt)]; countChart.update();
    const t=new Date().toLocaleTimeString(); trendChart.data.labels.push(t);
    trendChart.data.datasets[0].data.push((Number(a.volWei)/1e18).toFixed(6));
    if(trendChart.data.labels.length>50){ trendChart.data.labels.shift(); trendChart.data.datasets[0].data.shift(); }
    trendChart.update();
  }

  function formatEth(wei){ return weiToEthStr(wei); }
  function medianBig(sorted){ const n=sorted.length; if(!n) return 0n; const m=Math.floor(n/2); return (n%2)?sorted[m]:(sorted[m-1]+sorted[m])/2n; }
  function pTileBig(sorted,p){ const n=sorted.length; if(!n) return 0n; const i=Math.min(n-1,Math.max(0,Math.floor((n-1)*p))); return sorted[i]; }

  async function computeDirectional(dir){
    const rows = await readMyLastN(dir,300);
    const now=Math.floor(Date.now()/1000), dayAgo=now-86400, weekAgo=now-7*86400;
    const r24=rows.filter(r=>r.ts>=dayAgo), r7d=rows.filter(r=>r.ts>=weekAgo);
    const vol24=r24.reduce((a,b)=>a+(b?.wei??0n),0n), vol7d=r7d.reduce((a,b)=>a+(b?.wei??0n),0n);
    const vals7d=r7d.map(r=>r.wei).sort((a,b)=>a<b?-1:a>b?1:0);
    const med=medianBig(vals7d), p90=pTileBig(vals7d,.9);

    if(dir==="s2b"){
      sb24v&&(sb24v.textContent=formatEth(vol24));
      sb7dv&&(sb7dv.textContent=formatEth(vol7d));
      sbMed&&(sbMed.textContent=formatEth(med));
      sbP90&&(sbP90.textContent=formatEth(p90));
      ensureCharts();
      if(sizeChartSB){ let s=0,m=0,l=0; for(const w of vals7d){ if(vals7d.length===0)break; else if(w<med)s++; else if(w<p90)m++; else l++; } sizeChartSB.data.datasets[0].data=[s,m,l]; sizeChartSB.update(); }
    }else{
      bs24v&&(bs24v.textContent=formatEth(vol24));
      bs7dv&&(bs7dv.textContent=formatEth(vol7d));
      bsMed&&(bsMed.textContent=formatEth(med));
      bsP90&&(bsP90.textContent=formatEth(p90));
      ensureCharts();
      if(sizeChartBS){ let s=0,m=0,l=0; for(const w of vals7d){ if(vals7d.length===0)break; else if(w<med)s++; else if(w<p90)m++; else l++; } sizeChartBS.data.datasets[0].data=[s,m,l]; sizeChartBS.update(); }
    }
  }

  async function refreshDirectionalAnalytics(){
    if(!getUser()){ ["sb24v","sb7dv","sbMed","sbP90","bs24v","bs7dv","bsMed","bsP90"].forEach(id=>{ const el=byId(id); if(el) el.textContent="—"; }); resetCharts(); return; }
    await computeDirectional("s2b");
    await computeDirectional("b2s");
  }

  async function refreshAllTiles(){
    const a=await privateReadStrict("s2b");
    const b=await privateReadStrict("b2s");
    updateTiles(a,b); updateCharts(a,b);
    pvSB && (pvSB.textContent="—"); pvBS && (pvBS.textContent="—");
  }

  byId("btnRefreshAnalytics")?.addEventListener("click", refreshDirectionalAnalytics);

  return { refreshAllTiles, refreshDirectionalAnalytics, updateTiles, updateCharts, resetCharts };
}
