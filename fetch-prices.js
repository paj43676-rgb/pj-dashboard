const SYMS = {
  gold:["GC=F",2], eurusd:["EURUSD=X",4], gbpusd:["GBPUSD=X",4], usdjpy:["USDJPY=X",3],
  btc:["BTC-USD",2], aapl:["AAPL",2], tsla:["TSLA",2], nvda:["NVDA",2], msft:["MSFT",2]
};
async function chart(sym, interval, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let a=0;a<3;a++){
    try{
      const r = await fetch(url, {headers:{"User-Agent":"Mozilla/5.0"}});
      if(!r.ok) throw new Error("http "+r.status);
      const j = await r.json();
      const res = j?.chart?.result?.[0]; if(!res) throw new Error("bad");
      const ts = res.timestamp||[], q = res.indicators?.quote?.[0]?.close||[];
      const t=[],c=[];
      for(let i=0;i<ts.length;i++){const v=q[i]; if(v!=null){t.push(ts[i]*1000); c.push(+v.toFixed(6));}}
      const price = res.meta?.regularMarketPrice ?? c[c.length-1];
      const pc = res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null;
      if(!price) throw new Error("noprice");
      return {p:+price, pc: pc?+pc:null, t, c};
    }catch(e){ if(a===2) throw e; await new Promise(r=>setTimeout(r,2000)); }
  }
}
(async ()=>{
  const out = { ts: Date.now(), inst: {} };
  for (const [id,[sym,dec]] of Object.entries(SYMS)){
    try{
      const m5 = await chart(sym,"5m","1d");
      const d1 = await chart(sym,"1d","6mo");
      out.inst[id] = { p:+m5.p.toFixed(dec), pc:m5.pc?+m5.pc.toFixed(dec):null,
        s5:{t:m5.t.slice(-120),c:m5.c.slice(-120)}, s1d:{t:d1.t,c:d1.c} };
      console.log("ok", id, m5.p);
    }catch(e){ console.log("fail", id, e.message); }
    await new Promise(r=>setTimeout(r,1200));
  }
  require("fs").mkdirSync("data",{recursive:true});
  require("fs").writeFileSync("data/prices.json", JSON.stringify(out));
})();
