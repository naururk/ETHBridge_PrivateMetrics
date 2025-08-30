// Minimal ABI for MetricsHub (history + originTx in event)
export const ABI_METRICS_HUB = [
  // record(src, dst, amountWeiExt, proof, originTxHash)
  { inputs:[
      {name:"srcChainId",type:"uint32"},
      {name:"dstChainId",type:"uint32"},
      {name:"amountWeiExt",type:"bytes32"},
      {name:"inputProof",type:"bytes"},
      {name:"originTxHash",type:"bytes32"}
    ],
    name:"record", outputs:[], stateMutability:"nonpayable", type:"function"
  },
  // publish(src, dst, kThreshold)
  { inputs:[
      {name:"srcChainId",type:"uint32"},
      {name:"dstChainId",type:"uint32"},
      {name:"kThreshold",type:"uint64"}
    ],
    name:"publish", outputs:[], stateMutility:"nonpayable", type:"function"
  },
  // getters
  { inputs:[{name:"srcChainId",type:"uint32"},{name:"dstChainId",type:"uint32"}],
    name:"getTotals",
    outputs:[{name:"totalVolumeWei",type:"bytes32"},{name:"txCount",type:"bytes32"}],
    stateMutability:"view", type:"function"
  },
  { inputs:[{name:"srcChainId",type:"uint32"},{name:"dstChainId",type:"uint32"}],
    name:"getPublicSnapshots",
    outputs:[{name:"publicVolumeWei",type:"bytes32"},{name:"publicCount",type:"bytes32"}],
    stateMutability:"view", type:"function"
  },
  // history
  { inputs:[{name:"srcChainId",type:"uint32"},{name:"dstChainId",type:"uint32"}],
    name:"myHistoryLength", outputs:[{type:"uint256"}], stateMutability:"view", type:"function"
  },
  { inputs:[
      {name:"srcChainId",type:"uint32"},
      {name:"dstChainId",type:"uint32"},
      {name:"start",type:"uint256"},
      {name:"count",type:"uint256"}
    ],
    name:"getMyHistory",
    outputs:[{name:"amounts",type:"bytes32[]"},{name:"timestamps",type:"uint64[]"}],
    stateMutability:"view", type:"function"
  },
  // optional
  { inputs:[], name:"version", outputs:[{type:"string"}], stateMutability:"pure", type:"function" },

  // Recorded(src,dst,user,idx,originTx)
  { anonymous:false, type:"event", name:"Recorded", inputs:[
      {indexed:true,  name:"src",       type:"uint32"},
      {indexed:true,  name:"dst",       type:"uint32"},
      {indexed:true,  name:"user",      type:"address"},
      {indexed:false, name:"idx",       type:"uint256"},
      {indexed:false, name:"originTx",  type:"bytes32"}
  ]},

  { inputs:[
    {name:"srcChainId",type:"uint32"},
    {name:"dstChainId",type:"uint32"},
    {name:"idxs",type:"uint256[]"}
  ], name:"grantMyHistory", outputs:[], stateMutability:"nonpayable", type:"function"
},
{ inputs:[
    {name:"srcChainId",type:"uint32"},
    {name:"dstChainId",type:"uint32"},
    {name:"start",type:"uint256"},
    {name:"endExclusive",type:"uint256"}
  ], name:"grantMyHistoryRange", outputs:[], stateMutability:"nonpayable", type:"function"
},

];

// quick patch (typo guard)
ABI_METRICS_HUB.forEach((f)=>{ if (f.name==="publish") f.stateMutability="nonpayable"; });
