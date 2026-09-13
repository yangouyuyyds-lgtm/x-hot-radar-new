const http = require("http");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>X 热点起飞雷达</title>

<style>
*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#f5f7fb;
  color:#111;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}

.wrap{
  max-width:760px;
  margin:auto;
  padding:18px 14px 40px;
}

h1{
  font-size:32px;
  margin:8px 0;
  font-weight:800;
}

.sub{
  color:#777;
  font-size:17px;
  margin-bottom:20px;
}

.panel{
  background:#fff;
  border-radius:22px;
  padding:18px;
  margin-bottom:15px;
  box-shadow:0 4px 18px rgba(0,0,0,.05);
}

.row{
  display:flex;
  gap:10px;
}

select,
button{
  height:52px;
  border-radius:15px;
  font-size:17px;
}

select{
  flex:1;
  min-width:0;
  padding:0 14px;
  border:1px solid #ddd;
  background:#fff;
}

button{
  padding:0 20px;
  border:0;
  background:#111;
  color:#fff;
  font-weight:700;
  white-space:nowrap;
}

button:active{
  transform:scale(.98);
}

.filters{
  display:flex;
  gap:10px;
  overflow-x:auto;
  padding-bottom:2px;
}

.filter{
  height:46px;
  border-radius:23px;
  padding:0 18px;
  background:#f0f1f4;
  color:#555;
  border:0;
  white-space:nowrap;
  font-weight:600;
}

.filter.active{
  background:#111;
  color:#fff;
}

.stats{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:10px;
  margin-bottom:15px;
}

.stat{
  background:#fff;
  border-radius:20px;
  padding:16px 8px;
  text-align:center;
}

.num{
  font-size:27px;
  font-weight:800;
}

.label{
  font-size:13px;
  color:#888;
  margin-top:5px;
}

.item{
  padding:17px 0;
  border-bottom:1px solid #eee;
}

.item:last-child{
  border-bottom:0;
}

.rank{
  color:#999;
  font-size:13px;
}

.name{
  font-size:19px;
  font-weight:700;
  margin:7px 0;
  line-height:1.4;
}

.meta{
  color:#888;
  font-size:13px;
}

.fire{
  color:#e65100;
  font-weight:800;
}

.tag{
  display:inline-block;
  padding:4px 9px;
  margin-left:5px;
  border-radius:8px;
  background:#fff0e5;
  color:#e65100;
  font-size:12px;
  font-weight:700;
}

.xlink{
  display:inline-block;
  margin-top:9px;
  color:#1769e0;
  text-decoration:none;
  font-size:14px;
  font-weight:600;
}

.loading{
  text-align:center;
  padding:38px 10px;
  color:#888;
  font-size:16px;
}

.error{
  color:#d33;
  line-height:1.7;
}

.empty{
  text-align:center;
  padding:40px 10px;
  color:#888;
}

@media(max-width:500px){
  .wrap{
    padding:14px 12px 35px;
  }

  h1{
    font-size:29px;
  }

  .row{
    gap:8px;
  }

  button{
    padding:0 16px;
  }

  .name{
    font-size:18px;
  }
}
</style>
</head>

<body>

<div class="wrap">

  <h1>🔥 X 热点起飞雷达</h1>

  <div class="sub">
    实时发现正在升温、值得蹭的 X 热点
  </div>

  <div class="panel">

    <div class="row">

      <select id="location">
        <option value="1">🌎 全球</option>
        <option value="cn">🇨🇳 中文区</option>
        <option value="23424977">🇺🇸 美国</option>
        <option value="23424975">🇬🇧 英国</option>
        <option value="23424856">🇯🇵 日本</option>
      </select>

      <button onclick="scan()">立即扫描</button>

    </div>

  </div>

  <div class="panel">

    <div class="filters">

      <button class="filter active" data-filter="all" onclick="setFilter('all',this)">
        🔥 全部
      </button>

      <button class="filter" data-filter="cn" onclick="setFilter('cn',this)">
        🇨🇳 中文
      </button>

      <button class="filter" data-filter="beauty" onclick="setFilter('beauty',this)">
        💄 美女时尚
      </button>

      <button class="filter" data-filter="entertainment" onclick="setFilter('entertainment',this)">
        🎬 影视娱乐
      </button>

      <button class="filter" data-filter="sports" onclick="setFilter('sports',this)">
        ⚽ 体育
      </button>

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

let allItems = [];
let currentFilter = "all";

async function scan(){

  const status = document.getElementById("status");
  const list = document.getElementById("list");

  status.innerHTML = "⏳ 正在扫描 X 实时热点，请稍等...";
  list.innerHTML = "";

  try{

    const location = document.getElementById("location").value;

    const response = await fetch(
      "/api/trends?woeid=" + encodeURIComponent(location)
    );

    const data = await response.json();

    if(!response.ok){
      throw new Error(data.error || "扫描失败");
    }

    allItems = Array.isArray(data.items) ? data.items : [];

    document.getElementById("time").textContent =
      new Date().toLocaleTimeString("zh-CN",{
        hour:"2-digit",
        minute:"2-digit"
      });

    status.innerHTML = "";

    render();

  }catch(error){

    status.innerHTML =
      '<div class="error">❌ ' +
      escapeHtml(error.message) +
      '<br><br>如果第一次使用，请确认 Render 里的 APIFY_TOKEN 已经设置。</div>';

  }

}


function setFilter(filter, element){

  currentFilter = filter;

  document.querySelectorAll(".filter").forEach(function(btn){
    btn.classList.remove("active");
  });

  element.classList.add("active");

  render();

}


function render(){

  const list = document.getElementById("list");

  let items = allItems.filter(function(item){

    const text =
      String(item.name || "") +
      " " +
      String(item.query || "");

    return matchFilter(text,currentFilter);

  });

  document.getElementById("count").textContent = items.length;

  document.getElementById("hot").textContent =
    items.filter(function(x){
      return Number(x.rank || 999) <= 10;
    }).length;

  if(!items.length){

    list.innerHTML =
      '<div class="empty">暂时没有匹配到热点<br><br>可以切换「全部」再看看</div>';

    return;
  }

  list.innerHTML = items.map(function(x){

    const rank = Number(x.rank || 99);

    const score =
      Math.max(
        50,
        100 - Math.min(rank * 2,50)
      );

    const volume =
      x.tweetVolume
      ? Number(x.tweetVolume).toLocaleString()
      : "暂无";

    const text =
      String(x.name || "") +
      " " +
      String(x.query || "");

    let tag = "";

    if(matchFilter(text,"cn")){
      tag = '<span class="tag">中文</span>';
    }

    if(matchFilter(text,"beauty")){
      tag = '<span class="tag">美女时尚</span>';
    }

    return (

      '<div class="item">' +

        '<div class="rank">' +
          '#' + rank +
          '　<span class="fire">🔥 起飞指数 ' +
          score +
          '</span>' +
          tag +
        '</div>' +

        '<div class="name">' +
          escapeHtml(x.name || "") +
        '</div>' +

        '<div class="meta">' +
          '讨论量：' + volume +
        '</div>' +

        '<a class="xlink" href="' +
          escapeAttr(x.url || "#") +
          '" target="_blank">' +
          '在 X 查看 →' +
        '</a>' +

      '</div>'

    );

  }).join("");

}


function matchFilter(text,filter){

  const t = String(text || "").toLowerCase();

  if(filter === "all"){
    return true;
  }

  if(filter === "cn"){

    return /[\\u3400-\\u9fff]/.test(text) ||
      /中国|中文|大陆|香港|澳门|台湾|华人|微博|抖音|小红书|深圳|上海|北京|广州|成都|杭州|重庆|武汉|南京|苏州|明星|美女|网红|主播|娱乐|电影|电视剧/.test(text);

  }

  if(filter === "beauty"){

    return /美女|美人|模特|写真|时尚|穿搭|美妆|颜值|网红|女神|明星|模特|fashion|beauty|model|makeup|outfit|cosplay|cosplayer/.test(t);

  }

  if(filter === "entertainment"){

    return /电影|电视剧|明星|演员|歌手|音乐|综艺|娱乐|anime|movie|film|actor|actress|singer|music|netflix|disney/.test(t);

  }

  if(filter === "sports"){

    return /足球|篮球|网球|棒球|体育|比赛|冠军|nba|nfl|mlb|nhl|ufc|fifa|football|basketball|tennis|baseball/.test(t);

  }

  return true;

}


function escapeHtml(value){

  return String(value || "").replace(
    /[&<>"']/g,
    function(m){

      return {
        "&":"&amp;",
        "<":"&lt;",
        ">":"&gt;",
        '"':"&quot;",
        "'":"&#039;"

      }[m];

    }
  );

}


function escapeAttr(value){

  return String(value || "#")
    .replace(/"/g,"&quot;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");

}

</script>

</body>
</html>`;


async function getTrends(woeid){

  if(!APIFY_TOKEN){

    throw new Error(
      "服务器还没有设置 APIFY_TOKEN"
    );

  }

  const isChinese =
    String(woeid) === "cn";

  const url =
    "https://api.apify.com/v2/acts/" +
    "myagizm~x-trends-scraper" +
    "/run-sync-get-dataset-items?token=" +
    encodeURIComponent(APIFY_TOKEN);

  const response = await fetch(
    url,
    {
      method:"POST",

      headers:{
        "Content-Type":"application/json"
      },

      body:JSON.stringify({

        /*
         * 中文区没有使用错误的中国 WOEID。
         * 这里先抓全球实时热点，再在服务器端
         * 自动筛选中文内容。
         */

        woeid:1,

        resultsLimit:50

      })
    }
  );

  const text = await response.text();

  if(!response.ok){

    throw new Error(
      "Apify 请求失败：" +
      text.slice(0,300)
    );

  }

  let data;

  try{

    data = JSON.parse(text);

  }catch(error){

    throw new Error(
      "Apify 返回的数据无法解析"
    );

  }

  if(!Array.isArray(data)){
    return [];
  }

  /*
   * 中文区：
   * 从全球实时热点中筛选中文相关趋势。
   */

  if(isChinese){

    return data.filter(function(item){

      const text =
        String(item.name || "") +
        " " +
        String(item.query || "");

      return (
        /[\\u3400-\\u9fff]/.test(text) ||
        /中国|中文|大陆|香港|澳门|台湾|华人|微博|抖音|小红书|深圳|上海|北京|广州|成都|杭州|重庆|武汉|南京|苏州|明星|美女|网红|主播|娱乐|电影|电视剧/.test(text)
      );

    });

  }

  return data;

}


const server = http.createServer(
  async function(req,res){

    try{

      const url =
        new URL(
          req.url,
          "http://localhost"
        );

      if(url.pathname === "/api/trends"){

        const woeid =
          url.searchParams.get("woeid") || "1";

        const items =
          await getTrends(woeid);

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json; charset=utf-8",
            "Cache-Control":
              "no-store"
          }
        );

        res.end(
          JSON.stringify({
            items:items
          })
        );

        return;

      }


      if(
        url.pathname === "/" ||
        url.pathname === "/index.html"
      ){

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8",
            "Cache-Control":
              "no-store"
          }
        );

        res.end(html);

        return;

      }


      res.writeHead(
        404,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end("Not found");

    }catch(error){

      console.error(error);

      res.writeHead(
        500,
        {
          "Content-Type":
            "application/json; charset=utf-8"
        }
      );

      res.end(
        JSON.stringify({
          error:error.message
        })
      );

    }

  }
);


server.listen(
  PORT,
  "0.0.0.0",
  function(){

    console.log(
      "X热点起飞雷达运行中，端口：" +
      PORT
    );

  }
);