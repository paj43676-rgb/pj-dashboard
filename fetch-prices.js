const SYMS={
 gold:["GC=F",2],eurusd:["EURUSD=X",4],gbpusd:["GBPUSD=X",4],usdjpy:["USDJPY=X",3],
 btc:["BTC-USD",2],aapl:["AAPL",2],tsla:["TSLA",2],nvda:["NVDA",2],msft:["MSFT",2]
};
const INTRA=[["s1m","1m","1d",240],["s5","5m","5d",160],["s15","15m","1mo",160],["s1h","60m","3mo",200],["s1w","1wk","2y",120]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function chart(sym,interval,range){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  for(let a=0;a<3;a++){
    try{
      const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
      if(!r.ok)throw new Error("http "+r.status);
      const res=(await r.json())?.chart?.result?.[0];
      if(!res)throw new Error("bad");
      const ts=res.timestamp||[],q=res.indicators?.quote?.[0]?.close||[];
      const t=[],c=[];
      for(let i=0;i<ts.length;i++){const v=q[i];if(v!=null){t.push(ts[i]*1000);c.push(+v.toFixed(6));}}
      const p=res.meta?.regularMarketPrice??c[c.length-1];
      const pc=res.meta?.chartPreviousClose??res.meta?.previousClose??null;
      if(!p)throw new Error("noprice");
      return{p:+p,pc:pc?+pc:null,t,c};
    }catch(e){if(a===2)throw e;await sleep(2000);}
  }
}
function parseRSS(xml,defSrc){
  const items=[];const rx=/<item>([\s\S]*?)<\/item>/g;let m;
  while((m=rx.exec(xml))){
    const b=m[1];
    const pick=tag=>{const mm=b.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)<\\/"+tag+"\\s*>"));return mm?mm[1].replace(/<!\[CDATA\[|\]\]>/g,"").replace(/<[^>]+>/g,"").trim():"";};
    const title=pick("title");
    let link=pick("link");
    if(!link){const lm=b.match(/<link[^>]*href="([^"]+)"/);if(lm)link=lm[1];}
    const pd=pick("pubDate");
    const sm=b.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const src=sm?sm[1].replace(/<!\[CDATA\[|\]\]>/g,"").trim():defSrc;
    if(title&&link)items.push({title,link,dt:pd?new Date(pd).getTime():Date.now(),src});
  }
  return items;
}
const FEEDS=[
 ["https://news.google.com/rss/search?q=gold+OR+xauusd+OR+bullion&hl=en-US&gl=US&ceid=US:en","Google News"],
 ["https://news.google.com/rss/search?q=forex+OR+dollar+OR+federal+reserve&hl=en-US&gl=US&ceid=US:en","Google News"],
 ["https://news.google.com/rss/search?q=bitcoin+OR+crypto&hl=en-US&gl=US&ceid=US:en","Google News"],
 ["https://news.google.com/rss/search?q=stock+market&hl=en-US&gl=US&ceid=US:en","Google News"],
 ["https://www.fxstreet.com/rss/news","FXStreet"],
 ["https://www.forexlive.com/feed/news","ForexLive"],
 ["https://www.coindesk.com/arc/outboundfeeds/rss/","CoinDesk"],
 ["https://www.investing.com/rss/news_301.rss","Investing.com"]
];
async function fetchNews(){
  let all=[];
  for(const [u,src] of FEEDS){
    try{const r=await fetch(u,{headers:{"User-Agent":"Mozilla/5.0"}});if(r.ok)all=all.concat(parseRSS(await r.text(),src));}catch(e){}
    await sleep(300);
  }
  const seen=new Set();
  return all.sort((a,b)=>b.dt-a.dt).filter(x=>{const k=x.title.toLowerCase().slice(0,70);if(seen.has(k))return false;seen.add(k);return true}).slice(0,70);
}
async function fetchCalendar(){
  const r=await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json",{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!r.ok)throw new Error("http "+r.status);
  const j=await r.json();
  return j.map(x=>({t:new Date(x.date).getTime(),e:x.title,c:x.country,i:(x.impact||"low").toLowerCase(),a:x.previous||"",f:x.forecast||x.estimate||"",act:x.actual||""})).filter(x=>!isNaN(x.t)).sort((a,b)=>a.t-b.t);
}
(async()=>{
  const out={ts:Date.now(),inst:{}};
  for(const [id,[sym,dec]] of Object.entries(SYMS)){
    try{
      const d1=await chart(sym,"1d","6mo");
      const inst={p:+d1.p.toFixed(dec),pc:d1.pc?+d1.pc.toFixed(dec):null,s1d:{t:d1.t,c:d1.c}};
      for(const [key,iv,rg,cap] of INTRA){
        try{const s=await chart(sym,iv,rg);inst[key]={t:s.t.slice(-cap),c:s.c.slice(-cap)};}catch(e){}
        await sleep(600);
      }
      out.inst[id]=inst;console.log("ok",id,inst.p);
    }catch(e){console.log("fail",id,e.message);}
    await sleep(800);
  }
  try{out.news=await fetchNews();console.log("news",out.news.length);}catch(e){}
  try{out.cal=await fetchCalendar();console.log("cal",out.cal.length);}catch(e){}
  require("fs").mkdirSync("data",{recursive:true});
  require("fs").writeFileSync("data/prices.json",JSON.stringify(out));
})();
