const http=require("http");

const PORT=process.env.PORT||3000;
const TOKEN=process.env.APIFY_TOKEN||"";

const html=`<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>X热点起飞雷达</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f4f6fa;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:auto;padding:18px 14px 40px}
h1{font-size:30px;margin:8px 0 4px}.sub{color:#777;font-size:16px;margin-bottom:18px}
.card{background:#fff;border-radius:22px;padding:16px;margin-bottom:14px;box-shadow:0 4px 18px #0000000b}
.row{display:flex;gap:10px}
select,button{height:48px;border-radius:14px;font-size:16px}
select{flex:1;border:1px solid #ddd;padding:0 12px;background:#fff}
button{border:0;padding:0 18px;background:#111;color:#fff;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat{background:#fff;border-radius:18px;padding:15px 8px;text-align:center}
.num{font-size:25px;font-weight:800}.label{font-size:12px;color:#888;margin-top:4px}
.tabs{display:flex;gap:8px;overflow:auto}
.tab{white-space:nowrap;border:0;background:#f0f1f4;color:#555;padding:11px 15px;border-radius:20px;font-weight:700}
.tab.on{background:#111;color:#fff}
.item{padding:17px 0;border-bottom:1px solid #eee}.item:last-child{border-bottom:0}
.top{display:flex;justify-content:space-between;gap:10px}
.rank{color:#999;font-size:13px}.score{color:#e85d21;font-weight:800}
.name{font-size:19px;font-weight:750;margin:7px 0}
.badge{display:inline-block;font-size:12px;padding:4px 9px;border-radius:12px;background:#fff0e9;color:#d85a21;margin-left:6px}
.meta{color:#888;font-size:13px;line-height:1.7}
.actions{margin-top:9px;display:flex;gap:8px;align-items:center}
a{color:#2467d8;text-decoration:none;font-weight:700}
.fav{border:0;background:#f0f1f4;color:#333;height:38px;padding:0 13px;border-radius:18px;font-weight:700}
.loading{text-align:center;padding:38px 10px;color:#888}
.error{color:#c62828;line-height:1.7}.small{font-size:12px;color:#999;margin-top:8px}
</style></head><body>
<div class="wrap">
<h1>🔥 X 热点起飞雷达</h1>
<div class="sub">实时扫描 X 热门趋势，快速找值得跟的热点</div>

<div class="card"><div class="row">
<select id="location">
<option value="1">🌎 全球</option>
<option value="23424977">🇺🇸 美国</option>
<option value="23424975">🇬🇧 英国</option>
<option value="23424856">🇯🇵 日本</option>
<option value="23424775">🇨🇦 加拿大</option>
<option value="23424748">🇦🇺 澳大利亚</option>
</select>
<button onclick="scan()">立即扫描</button>
</div></div>

<div class="stats">
<div class="stat"><div class="num" id="count">-</div><div class="label">热点数量</div></div>
<div class="stat"><div class="num" id="hot">-</div><div class="label">高热热点</div></div>
<div class="stat"><div class="num" id="time">-</div><div class="label">更新时间</div></div>
</div>

<div class="card" style="margin-top:14px"><div class="tabs">
<button class="tab on" data-cat="all" onclick="setCat(this)">🔥 全部</button>
<button class="tab" data-cat="cn" onclick="setCat(this)">🇨🇳 中文</button>
<button class="tab" data-cat="beauty" onclick="setCat(this)">💃 美女时尚</button>
<button class="tab" data-cat="ent" onclick="setCat(this)">🎬 娱乐</button>
<button class="tab" data-cat="sport" onclick="setCat(this)">⚽ 体育</button>
</div></div>

<div class="card">
<div id="status" class="loading">点击「立即扫描」获取实时热点</div>
<div id="list"></div>
</div></div>

<script>
let allItems=[],category="all";

function esc(s){
return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function classify(n){
let s=String(n||"");
if(/[\\u4e00-\\u9fff]/.test(s))return"cn";
if(/beauty|fashion|model|girl|women|woman|makeup|dress|outfit|style|bikini|swimwear|celebrity/i.test(s))return"beauty";
if(/movie|film|music|singer|actor|actress|tv|show|netflix|grammy|oscar/i.test(s))return"ent";
if(/nba|nfl|mlb|nhl|football|soccer|tennis|f1|formula|olympics|ufc|boxing/i.test(s))return"sport";
return"other";
}

function setCat(b){
document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
b.classList.add("on");category=b.dataset.cat;render();
}

function score(x){
let r=Number(x.rank)||50,v=Number(x.tweetVolume)||0;
let s=100-Math.min(Math.max(r-1,0)*1.5,60);
if(v>=100000)s+=10;else if(v>=50000)s+=7;else if(v>=10000)s+=4;
return Math.min(99,Math.max(50,Math.round(s)));
}

function render(){
let list=document.getElementById("list");
let items=allItems.slice();
if(category!="all")items=items.filter(x=>classify(x.name)==category);
if(!items.length){list.innerHTML='<div class="loading">这个分类暂时没有匹配热点</div>';return}
list.innerHTML=items.map(x=>{
let sc=score(x),v=x.tweetVolume?Number(x.tweetVolume).toLocaleString():"暂无";
let c=classify(x.name);
let label={cn:"中文",beauty:"美女时尚",ent:"娱乐",sport:"体育",other:""}[c];
return '<div class="item">'+
'<div class="top"><div class="rank">#'+(x.rank||"-")+'</div><div class="score">🔥 起飞指数 '+sc+'</div></div>'+
'<div class="name">'+esc(x.name)+(label?'<span class="badge">'+label+'</span>':"")+'</div>'+
'<div class="meta">讨论量：'+v+'<br>趋势排名：第 '+(x.rank||"-")+' 位</div>'+
'<div class="actions"><a href="'+esc(x.url||"#")+'" target="_blank">在 X 查看 →</a>'+
'<button class="fav" onclick="saveHot('+JSON.stringify(String(x.name||""))+')">☆ 收藏</button></div></div>';
}).join("");
}

function saveHot(n){
try{
let a=JSON.parse(localStorage.getItem("x_hot_fav")||"[]");
if(!a.includes(n))a.unshift(n);
localStorage.setItem("x_hot_fav",JSON.stringify(a.slice(0,100)));
alert("已收藏："+n);
}catch(e){}
}

async function scan(){
let status=document.getElementById("status"),list=document.getElementById("list");
status.innerHTML="⏳ 正在扫描 X 热点，请稍等……";list.innerHTML="";
try{
let w=document.getElementById("location").value;
let r=await fetch("/api/trends?woeid="+encodeURIComponent(w));
let d=await r.json();
if(!r.ok)throw new Error(d.error||"扫描失败");
allItems=Array.isArray(d.items)?d.items:[];
document.getElementById("count").textContent=allItems.length;
document.getElementById("hot").textContent=allItems.filter(x=>Number(x.rank)<=10).length;
document.getElementById("time").textContent=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"});
status.innerHTML="";render();
}catch(e){
status.innerHTML='<div class="error">❌ '+esc(e.message)+'</div><div class="small">如果提示 APIFY_TOKEN 未配置，请去 Render → Environment 设置。</div>';
}
}
</script></body></html>`;

async function getTrends(woeid){
if(!TOKEN)throw new Error("服务器还没有设置 APIFY_TOKEN");
const url="https://api.apify.com/v2/acts/myagizm~x-trends-scraper/run-sync-get-dataset-items?token="+encodeURIComponent(TOKEN);
const r=await fetch(url,{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({woeid:Number(woeid),resultsLimit:50})
});
const text=await r.text();
if(!r.ok)throw new Error("Apify 请求失败："+text.slice(0,300));
try{
let d=JSON.parse(text);
return Array.isArray(d)?d:[];
}catch(e){throw new Error("Apify 返回的数据无法解析")}
}

const server=http.createServer(async(req,res)=>{
try{
const u=new URL(req.url,"http://localhost");

if(u.pathname==="/api/trends"){
const items=await getTrends(u.searchParams.get("woeid")||"1");
res.writeHead(200,{"Content-Type":"application/json;charset=utf-8"});
res.end(JSON.stringify({items}));
return;
}

if(u.pathname==="/"||u.pathname==="/index.html"){
res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});
res.end(html);
return;
}

res.writeHead(404,{"Content-Type":"text/plain;charset=utf-8"});
res.end("Not found");
}catch(e){
res.writeHead(500,{"Content-Type":"application/json;charset=utf-8"});
res.end(JSON.stringify({error:e.message}));
}
});

server.listen(PORT,"0.0.0.0",()=>{
console.log("X热点起飞雷达运行中："+PORT);
});