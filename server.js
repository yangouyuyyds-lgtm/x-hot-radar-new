const http = require("http");
const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>X 热点起飞雷达</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111}
.wrap{max-width:700px;margin:auto;padding:18px}
h1{font-size:28px;margin:8px 0}
.sub{color:#777;margin-bottom:18px}
.panel{background:white;border-radius:18px;padding:16px;margin-bottom:14px;box-shadow:0 3px 15px #0000000d}
.row{display:flex;gap:10px}
select,button{height:46px;border:1px solid #ddd;border-radius:12px;padding:0 14px;font-size:16px}
select{flex:1;background:white}
button{background:#111;color:white;border:0;font-weight:600}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat{background:white;border-radius:15px;padding:14px;text-align:center}
.num{font-size:25px;font-weight:700}
.label{font-size:12px;color:#888;margin-top:4px}
.item{padding:14px 0;border-bottom:1px solid #eee}
.item:last-child{border-bottom:0}
.rank{font-size:13px;color:#999}
.name{font-size:18px;font-weight:650;margin:5px 0}
.meta{font-size:13px;color:#888}
a{color:#1769e0;text-decoration:none}
.fire{color:#e65100;font-weight:700}
.loading{text-align:center;padding:30px;color:#888}
.error{color:#d33;line-height:1.6}
@media(max-width:500px){.wrap{padding:12px}.stats{gap:6px}.stat{padding:11px 5px}}
</style>
</head>
<body>
<div class="wrap">
<h1>🔥 X 热点起飞雷达</h1>
<div class="sub">实时发现正在升温的 X 热门趋势</div>

<div class="panel">
<div class="row">
<select id="location">
<option value="1">🌎 全球</option>
<option value="23424977">🇺🇸 美国</option>
<option value="23424975">🇬🇧 英国</option>
<option value="23424856">🇯🇵 日本</option>
<option value="23424975">🇨🇳 中文区参考</option>
</select>
<button onclick="scan()">立即扫描</button>
</div>
</div>

<div class="stats">
<div class="stat"><div class="num" id="count">-</div><div class="label">热点数量</div></div>
<div class="stat"><div class="num" id="hot">-</div><div class="label">高热热点</div></div>
<div class="stat"><div class="num" id="time">-</div><div class="label">更新时间</div></div>
</div>

<div class="panel" style="margin-top:14px">
<div id="status" class="loading">点击「立即扫描」获取实时热点</div>
<div id="list"></div>
</div>
</div>

<script>
async function scan(){
 const status=document.getElementById("status");
 const list=document.getElementById("list");
 status.innerHTML="⏳ 正在扫描 X 热点，请稍等...";
 list.innerHTML="";
 try{
   const woeid=document.getElementById("location").value;
   const r=await fetch("/api/trends?woeid="+woeid);
   const data=await r.json();
   if(!r.ok) throw new Error(data.error||"扫描失败");
   const items=data.items||[];
   document.getElementById("count").textContent=items.length;
   document.getElementById("hot").textContent=items.filter(x=>x.rank<=10).length;
   document.getElementById("time").textContent=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
   status.innerHTML="";
   if(!items.length){status.innerHTML="暂时没有获取到热点";return}
   list.innerHTML=items.map(x=>{
     const score=Math.max(50,100-Math.min(x.rank*2,50));
     const volume=x.tweetVolume?Number(x.tweetVolume).toLocaleString():"暂无";
     return '<div class="item">'+
       '<div class="rank">#'+x.rank+'　<span class="fire">起飞指数 '+score+'</span></div>'+
       '<div class="name">'+escapeHtml(x.name)+'</div>'+
       '<div class="meta">讨论量：'+volume+'</div>'+
       '<div style="margin-top:7px"><a href="'+x.url+'" target="_blank">在 X 查看 →</a></div>'+
       '</div>';
   }).join("");
 }catch(e){
   status.innerHTML='<div class="error">❌ '+escapeHtml(e.message)+'<br><br>如果是第一次部署，请检查 Render 里的 APIFY_TOKEN 是否已经设置。</div>';
 }
}
function escapeHtml(s){
 return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
</script>
</body>
</html>`;

async function getTrends(woeid){
  if(!APIFY_TOKEN) throw new Error("服务器还没有设置 APIFY_TOKEN");
  const url =
    "https://api.apify.com/v2/acts/myagizm~x-trends-scraper/run-sync-get-dataset-items?token="
    + encodeURIComponent(APIFY_TOKEN);

  const response = await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      woeid:Number(woeid),
      resultsLimit:50
    })
  });

  const text=await response.text();

  if(!response.ok){
    throw new Error("Apify 请求失败："+text.slice(0,300));
  }

  try{
    return JSON.parse(text);
  }catch{
    throw new Error("Apify 返回的数据无法解析");
  }
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,"http://localhost");

    if(u.pathname==="/api/trends"){
      const woeid=u.searchParams.get("woeid")||"1";
      const items=await getTrends(woeid);
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
      res.end(JSON.stringify({items}));
      return;
    }

    if(u.pathname==="/"||u.pathname==="/index.html"){
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
      res.end(html);
      return;
    }

    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});
    res.end("Not found");
  }catch(e){
    res.writeHead(500,{"Content-Type":"application/json; charset=utf-8"});
    res.end(JSON.stringify({error:e.message}));
  }
});

server.listen(PORT,"0.0.0.0",()=>{
  console.log("X热点起飞雷达运行中，端口："+PORT);
});