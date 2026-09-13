const http = require("http");
const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>X热点起飞雷达</title>

<style>
*{box-sizing:border-box}
body{
 margin:0;
 background:#f5f7fb;
 color:#111;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}
.wrap{max-width:760px;margin:auto;padding:18px 14px 40px}
h1{font-size:29px;margin:8px 0}
.sub{color:#777;font-size:16px;margin-bottom:18px}

.panel{
 background:#fff;
 border-radius:22px;
 padding:16px;
 margin-bottom:14px;
 box-shadow:0 3px 18px #00000008
}

.row{display:flex;gap:10px}
select,button{
 height:48px;
 border-radius:14px;
 border:1px solid #ddd;
 font-size:16px
}
select{
 flex:1;
 padding:0 12px;
 background:#fff
}
button{
 padding:0 18px;
 background:#111;
 color:#fff;
 border:0;
 font-weight:700
}

.filters{
 display:flex;
 gap:8px;
 overflow-x:auto;
 padding-bottom:2px
}
.filter{
 white-space:nowrap;
 background:#f0f1f4;
 color:#555;
 border-radius:18px;
 padding:10px 15px;
 font-size:15px;
 font-weight:600
}
.filter.active{
 background:#111;
 color:#fff
}

.stats{
 display:grid;
 grid-template-columns:repeat(3,1fr);
 gap:8px;
 margin-bottom:14px
}
.stat{
 background:#fff;
 border-radius:18px;
 padding:13px 5px;
 text-align:center
}
.num{font-size:24px;font-weight:800}
.label{font-size:12px;color:#888;margin-top:3px}

.item{
 padding:17px 0;
 border-bottom:1px solid #eee
}
.item:last-child{border-bottom:0}

.topline{
 display:flex;
 justify-content:space-between;
 align-items:center
}
.rank{color:#999;font-size:14px}
.score{
 color:#e65100;
 font-size:17px;
 font-weight:800
}
.name{
 font-size:19px;
 font-weight:750;
 margin:8px 0
}
.badge{
 display:inline-block;
 padding:4px 9px;
 border-radius:10px;
 background:#fff0e8;
 color:#e45b20;
 font-size:12px;
 margin-left:5px
}
.meta{
 color:#888;
 font-size:13px;
 line-height:1.7
}
.advice{
 margin-top:9px;
 background:#f7f8fa;
 border-radius:12px;
 padding:10px 12px;
 font-size:14px;
 line-height:1.6
}
.good{color:#e65100;font-weight:800}
.mid{color:#d28a00;font-weight:800}
.bad{color:#888;font-weight:700}

.actions{
 display:flex;
 gap:8px;
 margin-top:10px
}
.actions a,.fav{
 flex:1;
 text-align:center;
 padding:10px;
 border-radius:12px;
 text-decoration:none;
 font-size:14px;
 font-weight:650
}
.actions a{
 background:#eef3ff;
 color:#1769e0
}
.fav{
 background:#f0f1f4;
 color:#333;
 border:0;
 height:auto
}
.fav.on{
 background:#111;
 color:#fff
}

.loading{
 text-align:center;
 padding:35px 10px;
 color:#888
}
.error{
 color:#d33;
 line-height:1.7;
 padding:15px 0
}

.empty{
 text-align:center;
 padding:35px 10px;
 color:#888
}

@media(max-width:500px){
 .wrap{padding:14px 12px 30px}
 h1{font-size:27px}
 .name{font-size:18px}
}
</style>
</head>

<body>

<div class="wrap">

<h1>🔥 X 热点起飞雷达</h1>
<div class="sub">实时发现正在升温、值得蹭的 X 热点</div>

<div class="panel">
 <div class="row">
  <select id="location">
   <option value="1">🌎 全球</option>
   <option value="23424977">🇺🇸 美国</option>
   <option value="23424975">🇬🇧 英国</option>
   <option value="23424856">🇯🇵 日本</option>
   <option value="23424775">🇨🇦 加拿大</option>
   <option value="23424748">🇦🇺 澳大利亚</option>
  </select>
  <button onclick="scan()">立即扫描</button>
 </div>
</div>

<div class="panel">
 <div class="filters">
  <div class="filter active" onclick="setFilter('all',this)">🔥 全部</div>
  <div class="filter" onclick="setFilter('cn',this)">🇨🇳 中文</div>
  <div class="filter" onclick="setFilter('beauty',this)">👙 美女时尚</div>
  <div class="filter" onclick="setFilter('ent',this)">🎬 娱乐明星</div>
  <div class="filter" onclick="setFilter('photo',this)">📸 摄影穿搭</div>
 </div>
</div>

<div class="stats">
 <div class="stat">
  <div class="num" id="count">-</div>
  <div class="label">热点数量</div>
 </div>
 <div class="stat">
  <div class="num" id="hot">-</div>
  <div class="label">值得关注</div>
 </div>
 <div class="stat">
  <div class="num" id="time">-</div>
  <div class="label">更新时间</div>
 </div>
</div>

<div class="panel">
 <div id="status" class="loading">
  点击「立即扫描」获取实时热点
 </div>
 <div id="list"></div>
</div>

</div>

<script>

let allItems=[];
let currentFilter="all";

const beautyWords=[
 "美女","美人","女生","女孩","小姐姐","模特","model",
 "fashion","beauty","outfit","dress","穿搭","时尚","美妆",
 "写真","摄影","photo","photography","cosplay","cos",
 "idol","偶像","女神","网红","明星","艺人"
];

const entertainmentWords=[
 "明星","演员","歌手","艺人","电影","电视剧","综艺",
 "music","movie","actor","actress","singer","concert",
 "celebrity","idol","anime","manga"
];

const photoWords=[
 "photo","photography","camera","写真","摄影","穿搭",
 "outfit","fashion","model","模特","街拍","旅行"
];

const chineseRegex=/[\\u3400-\\u9fff]/;

function hasWord(name,words){
 const s=String(name||"").toLowerCase();
 return words.some(w=>s.includes(w.toLowerCase()));
}

function isChinese(name){
 return chineseRegex.test(String(name||""));
}

function getCategory(name){
 if(hasWord(name,beautyWords)) return "美女时尚";
 if(hasWord(name,entertainmentWords)) return "娱乐";
 if(hasWord(name,photoWords)) return "摄影穿搭";
 if(isChinese(name)) return "中文";
 return "";
}

function scoreItem(x){

 let rank=Number(x.rank)||50;
 let score=100-Math.min(rank*1.5,55);

 const name=String(x.name||"");

 if(isChinese(name)) score+=12;
 if(hasWord(name,beautyWords)) score+=18;
 if(hasWord(name,entertainmentWords)) score+=8;
 if(hasWord(name,photoWords)) score+=10;

 const volume=Number(x.tweetVolume)||0;

 if(volume>=100000) score+=15;
 else if(volume>=50000) score+=12;
 else if(volume>=10000) score+=8;
 else if(volume>=1000) score+=4;

 return Math.max(1,Math.min(100,Math.round(score)));
}

function advice(score,category){

 if(score>=85){
  return {
   text:"🚀 强烈建议蹭",
   cls:"good",
   idea:category==="美女时尚"
    ?"💡 推荐：美女图片 + 热点关键词 + 一个简单问题，引导评论。"
    :"💡 推荐：围绕热点快速发布相关内容，并在评论区参与讨论。"
  };
 }

 if(score>=65){
  return {
   text:"🟠 可以蹭",
   cls:"mid",
   idea:"💡 推荐：先观察热度，再决定是否发帖，不要硬蹭。"
  };
 }

 return {
  text:"⚪ 不建议蹭",
  cls:"bad",
  idea:"💡 推荐：暂时观察，等待热点进一步升温。"
 };
}

function setFilter(type,el){

 currentFilter=type;

 document.querySelectorAll(".filter")
 .forEach(x=>x.classList.remove("active"));

 el.classList.add("active");

 render();
}

function render(){

 let items=allItems.slice();

 if(currentFilter==="cn"){
  items=items.filter(x=>isChinese(x.name));
 }

 if(currentFilter==="beauty"){
  items=items.filter(x=>hasWord(x.name,beautyWords));
 }

 if(currentFilter==="ent"){
  items=items.filter(x=>hasWord(x.name,entertainmentWords));
 }

 if(currentFilter==="photo"){
  items=items.filter(x=>hasWord(x.name,photoWords));
 }

 document.getElementById("count").textContent=items.length;

 document.getElementById("hot").textContent=
 items.filter(x=>x.score>=65).length;

 if(!items.length){
  document.getElementById("list").innerHTML=
   '<div class="empty">这个分类暂时没有匹配热点<br>换一个分类试试</div>';
  return;
 }

 document.getElementById("list").innerHTML=
 items.map((x,i)=>{

  const a=advice(x.score,x.category);

  const volume=x.tweetVolume
   ?Number(x.tweetVolume).toLocaleString()
   :"暂无";

  const cat=x.category
   ?'<span class="badge">'+escapeHtml(x.category)+'</span>'
   :"";

  return '<div class="item">'+

   '<div class="topline">'+
    '<div class="rank">#'+(i+1)+' · 原始排名 '+x.rank+'</div>'+
    '<div class="score">🔥 '+x.score+'</div>'+
   '</div>'+

   '<div class="name">'+
    escapeHtml(x.name)+cat+
   '</div>'+

   '<div class="meta">'+
    '讨论量：'+volume+
   '</div>'+

   '<div class="advice">'+
    '<span class="'+a.cls+'">'+a.text+'</span>'+
    '<br>'+a.idea+
   '</div>'+

   '<div class="actions">'+
    '<a href="'+escapeAttr(x.url)+'" target="_blank">在 X 查看 →</a>'+
    '<button class="fav '+(isFav(x.name)?"on":"")+
    '" onclick="favorite(\\''+escapeJs(x.name)+'\\')">'+
    (isFav(x.name)?"★ 已收藏":"☆ 收藏")+
    '</button>'+
   '</div>'+

  '</div>';

 }).join("");
}

function favorite(name){

 let favs=JSON.parse(localStorage.getItem("x_favs")||"[]");

 if(favs.includes(name)){
  favs=favs.filter(x=>x!==name);
 }else{
  favs.push(name);
 }

 localStorage.setItem("x_favs",JSON.stringify(favs));
 render();
}

function isFav(name){
 const favs=JSON.parse(localStorage.getItem("x_favs")||"[]");
 return favs.includes(name);
}

async function scan(){

 const status=document.getElementById("status");

 status.innerHTML="⏳ 正在扫描 X 实时热点……";
 document.getElementById("list").innerHTML="";

 try{

  const woeid=document.getElementById("location").value;

  const response=
   await fetch("/api/trends?woeid="+encodeURIComponent(woeid));

  const data=await response.json();

  if(!response.ok){
   throw new Error(data.error||"扫描失败");
  }

  allItems=(data.items||[]).map(x=>({
   ...x,
   score:scoreItem(x),
   category:getCategory(x.name)
  }));

  allItems.sort((a,b)=>b.score-a.score);

  document.getElementById("time").textContent=
   new Date().toLocaleTimeString("zh-CN",{
    hour:"2-digit",
    minute:"2-digit"
   });

  status.innerHTML="";

  render();

 }catch(e){

  status.innerHTML=
   '<div class="error">❌ '+escapeHtml(e.message)+
   '<br><br>如果扫描失败，请检查 Render 中的 APIFY_TOKEN。</div>';

 }
}

function escapeHtml(s){
 return String(s||"").replace(
  /[&<>"']/g,
  m=>({
   "&":"&amp;",
   "<":"&lt;",
   ">":"&gt;",
   '"':"&quot;",
   "'":"&#039;"
  }[m])
 );
}

function escapeAttr(s){
 return String(s||"")
  .replace(/&/g,"&amp;")
  .replace(/"/g,"&quot;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;");
}

function escapeJs(s){
 return String(s||"")
  .replace(/\\\\/g,"\\\\\\\\")
  .replace(/'/g,"\\\\'");
}

</script>

</body>
</html>`;

async function getTrends(woeid){

 if(!APIFY_TOKEN){
  throw new Error("服务器还没有设置 APIFY_TOKEN");
 }

 const api=
 "https://api.apify.com/v2/acts/myagizm~x-trends-scraper/run-sync-get-dataset-items?token="+
 encodeURIComponent(APIFY_TOKEN);

 const response=await fetch(api,{
  method:"POST",
  headers:{
   "Content-Type":"application/json"
  },
  body:JSON.stringify({
   woeid:Number(woeid),
   resultsLimit:50
  })
 });

 const text=await response.text();

 if(!response.ok){
  throw new Error(
   "Apify 请求失败："+text.slice(0,300)
  );
 }

 try{
  const data=JSON.parse(text);
  return Array.isArray(data)?data:[];
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

   res.writeHead(200,{
    "Content-Type":"application/json; charset=utf-8"
   });

   res.end(JSON.stringify({items}));
   return;
  }

  if(
   u.pathname==="/" ||
   u.pathname==="/index.html"
  ){

   res.writeHead(200,{
    "Content-Type":"text/html; charset=utf-8"
   });

   res.end(html);
   return;
  }

  res.writeHead(404,{
   "Content-Type":"text/plain; charset=utf-8"
  });

  res.end("Not found");

 }catch(e){

  res.writeHead(500,{
   "Content-Type":"application/json; charset=utf-8"
  });

  res.end(JSON.stringify({
   error:e.message
  }));
 }
});

server.listen(PORT,"0.0.0.0",()=>{
 console.log(
  "X热点起飞雷达 V3 运行中，端口："+PORT
 );
});