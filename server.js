const http = require("http");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>X 热点起飞雷达</title>

<style>
*{box-sizing:border-box}

body{
 margin:0;
 background:#f4f6fa;
 color:#111;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

.wrap{
 max-width:720px;
 margin:auto;
 padding:16px;
}

h1{
 font-size:28px;
 margin:8px 0 4px;
}

.sub{
 color:#777;
 margin-bottom:16px;
}

.panel{
 background:#fff;
 border-radius:20px;
 padding:16px;
 margin-bottom:14px;
 box-shadow:0 3px 18px #0000000b;
}

.row{
 display:flex;
 gap:10px;
}

select,button{
 height:46px;
 border-radius:13px;
 border:1px solid #ddd;
 padding:0 14px;
 font-size:16px;
}

select{
 flex:1;
 background:#fff;
}

button{
 background:#111;
 color:#fff;
 border:0;
 font-weight:700;
}

.stats{
 display:grid;
 grid-template-columns:repeat(3,1fr);
 gap:8px;
 margin-bottom:14px;
}

.stat{
 background:#fff;
 border-radius:17px;
 padding:14px 5px;
 text-align:center;
}

.num{
 font-size:25px;
 font-weight:800;
}

.label{
 color:#888;
 font-size:12px;
 margin-top:4px;
}

.tabs{
 display:flex;
 gap:8px;
 overflow-x:auto;
 padding-bottom:4px;
}

.tab{
 white-space:nowrap;
 background:#f1f2f5;
 color:#555;
 border:0;
 height:40px;
 padding:0 14px;
}

.tab.active{
 background:#111;
 color:#fff;
}

.item{
 padding:16px 0;
 border-bottom:1px solid #eee;
}

.item:last-child{
 border-bottom:0;
}

.topline{
 display:flex;
 justify-content:space-between;
 align-items:center;
}

.rank{
 color:#999;
 font-size:13px;
}

.score{
 color:#e65319;
 font-weight:800;
 font-size:15px;
}

.name{
 font-size:19px;
 font-weight:750;
 margin:7px 0;
 word-break:break-word;
}

.meta{
 color:#888;
 font-size:13px;
 line-height:1.7;
}

.actions{
 display:flex;
 gap:12px;
 align-items:center;
 margin-top:9px;
}

.xlink{
 color:#1769e0;
 text-decoration:none;
 font-weight:600;
}

.star{
 background:#f1f2f5;
 color:#333;
 height:36px;
 padding:0 12px;
}

.star.on{
 background:#fff0c2;
 color:#a66b00;
}

.badge{
 display:inline-block;
 font-size:11px;
 padding:3px 8px;
 border-radius:20px;
 background:#f0f0f0;
 color:#666;
 margin-left:6px;
}

.badge.cn{
 background:#ffe9e2;
 color:#d94b16;
}

.badge.beauty{
 background:#ffe8f0;
 color:#c23668;
}

.badge.ent{
 background:#eee9ff;
 color:#6845c5;
}

.badge.sport{
 background:#e6f5e9;
 color:#28763d;
}

.loading{
 text-align:center;
 padding:32px 10px;
 color:#888;
}

.error{
 color:#d33;
 line-height:1.6;
}

.empty{
 text-align:center;
 padding:35px 10px;
 color:#888;
}

@media(max-width:500px){
 .wrap{padding:12px}
 h1{font-size:26px}
 .name{font-size:18px}
}
</style>
</head>

<body>

<div class="wrap">

<h1>🔥 X 热点起飞雷达</h1>
<div class="sub">
实时扫描 X 热门趋势，快速找值得跟的热点
</div>

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

<div class="stats">

<div class="stat">
<div class="num" id="count">-</div>
<div class="label">热点数量</div>
</div>

<div class="stat">
<div class="num" id="hot">-</div>
<div class="label">高热热点</div>
</div>

<div class="stat">
<div class="num" id="time">-</div>
<div class="label">更新时间</div>
</div>

</div>

<div class="panel">

<div class="tabs">

<button class="tab active" onclick="filterType('all',this)">🔥 全部</button>
<button class="tab" onclick="filterType('cn',this)">🇨🇳 中文</button>
<button class="tab" onclick="filterType('beauty',this)">👙 美女时尚</button>
<button class="tab" onclick="filterType('ent',this)">🎬 娱乐</button>
<button class="tab" onclick="filterType('sport',this)">⚽ 体育</button>

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
"beauty","girl","girls","model","fashion","style","makeup",
"美女","女生","女孩","模特","写真","时尚","穿搭","颜值",
"cosplay","coser","idol","アイドル"
];

const entWords=[
"movie","film","music","singer","actor","actress","celebrity",
"concert","album","show","netflix","disney",
"明星","娱乐","电影","音乐","歌手","演员","综艺","演唱会",
"电视剧","偶像"
];

const sportWords=[
"nba","nfl","mlb","nhl","football","soccer","basketball",
"tennis","ufc","boxing","formula","f1",
"体育","足球","篮球","网球","拳击","赛车","冠军"
];

function hasChinese(s){
 return /[\\u3400-\\u9fff]/.test(String(s||""));
}

function containsAny(s,arr){
 s=String(s||"").toLowerCase();
 return arr.some(x=>s.includes(x.toLowerCase()));
}

function getType(item){

 const name=String(item.name||"");

 if(containsAny(name,beautyWords)) return "beauty";

 if(containsAny(name,entWords)) return "ent";

 if(containsAny(name,sportWords)) return "sport";

 if(hasChinese(name)) return "cn";

 return "other";
}

function getScore(item){

 const rank=Number(item.rank)||50;
 const volume=Number(item.tweetVolume)||0;

 let score=100-(rank-1)*1.3;

 if(volume>=1000000) score+=12;
 else if(volume>=500000) score+=9;
 else if(volume>=100000) score+=6;
 else if(volume>=50000) score+=4;
 else if(volume>=10000) score+=2;

 score=Math.round(Math.max(50,Math.min(99,score)));

 return score;
}

function badge(type){

 if(type==="cn")
   return '<span class="badge cn">中文</span>';

 if(type==="beauty")
   return '<span class="badge beauty">美女时尚</span>';

 if(type==="ent")
   return '<span class="badge ent">娱乐</span>';

 if(type==="sport")
   return '<span class="badge sport">体育</span>';

 return "";
}

function isSaved(name){
 return localStorage.getItem("saved_"+name)==="1";
}

function toggleSave(name){

 const key="saved_"+name;

 if(isSaved(name)){
   localStorage.removeItem(key);
 }else{
   localStorage.setItem(key,"1");
 }

 render();
}

function filterType(type,btn){

 currentFilter=type;

 document.querySelectorAll(".tab").forEach(x=>{
   x.classList.remove("active");
 });

 btn.classList.add("active");

 render();
}

function render(){

 const list=document.getElementById("list");

 let items=allItems.filter(x=>{

   if(currentFilter==="all") return true;

   return getType(x)===currentFilter;

 });

 if(!items.length){

   list.innerHTML='<div class="empty">这个分类暂时没有热点<br>换一个分类试试</div>';

   return;
 }

 list.innerHTML=items.map(x=>{

   const name=String(x.name||"");
   const score=getScore(x);
   const type=getType(x);
   const volume=x.tweetVolume
      ? Number(x.tweetVolume).toLocaleString()
      : "暂无";

   const saved=isSaved(name);

   return '<div class="item">'+

     '<div class="topline">'+
     '<div class="rank">#'+x.rank+'</div>'+
     '<div class="score">🔥 起飞指数 '+score+'</div>'+
     '</div>'+

     '<div class="name">'+
     escapeHtml(name)+
     badge(type)+
     '</div>'+

     '<div class="meta">'+
     '讨论量：'+volume+
     '<br>'+
     '趋势排名：第 '+x.rank+' 位'+
     '</div>'+

     '<div class="actions">'+

     '<a class="xlink" href="'+
     escapeAttr(x.url)+
     '" target="_blank">在 X 查看 →</a>'+

     '<button class="star '+(saved?"on":"")+
     '" onclick="toggleSave('+JSON.stringify(name)+')">'+
     (saved?"★ 已收藏":"☆ 收藏")+
     '</button>'+

     '</div>'+

     '</div>';

 }).join("");

}

async function scan(){

 const status=document.getElementById("status");

 status.innerHTML="⏳ 正在扫描 X 实时热点……";

 document.getElementById("list").innerHTML="";

 try{

   const woeid=document.getElementById("location").value;

   const r=await fetch("/api/trends?woeid="+encodeURIComponent(woeid));

   const data=await r.json();

   if(!r.ok){
     throw new Error(data.error||"扫描失败");
   }

   allItems=Array.isArray(data.items)?data.items:[];

   document.getElementById("count").textContent=allItems.length;

   document.getElementById("hot").textContent=
     allItems.filter(x=>getScore(x)>=85).length;

   document.getElementById("time").textContent=
     new Date().toLocaleTimeString("zh-CN",{
       hour:"2-digit",
       minute:"2-digit"
     });

   status.innerHTML="";

   render();

 }catch(e){

   status.innerHTML=
   '<div class="error">'+
   '❌ '+escapeHtml(e.message)+
   '<br><br>'+
   '如果扫描失败，请检查 Render 的 APIFY_TOKEN。'+
   '</div>';

 }

}

function escapeHtml(s){

 return String(s||"").replace(/[&<>"']/g,m=>({

   "&":"&amp;",
   "<":"&lt;",
   ">":"&gt;",
   '"':"&quot;",
   "'":"&#039;"

 }[m]));

}

function escapeAttr(s){

 return String(s||"").replace(/"/g,"%22");

}

</script>

</body>
</html>`;

async function getTrends(woeid){

 if(!APIFY_TOKEN){
   throw new Error("服务器还没有设置 APIFY_TOKEN");
 }

 const url =
 "https://api.apify.com/v2/acts/myagizm~x-trends-scraper/run-sync-get-dataset-items?token="+
 encodeURIComponent(APIFY_TOKEN);

 const response=await fetch(url,{
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

     res.writeHead(200,{
       "Content-Type":"application/json; charset=utf-8"
     });

     res.end(JSON.stringify({
       items:items
     }));

     return;
   }

   if(u.pathname==="/"||u.pathname==="/index.html"){

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
