const http = require("http");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

const ACTOR = "myagizm~x-trends-scraper";


/* =========================
   网页
========================= */

const html = `<!DOCTYPE html>
<html lang="zh-CN">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<title>X热点起飞雷达</title>

<style>

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:#f5f7fb;
  color:#111;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.wrap{
  max-width:760px;
  margin:auto;
  padding:18px;
}

h1{
  font-size:30px;
  margin:8px 0;
}

.sub{
  color:#777;
  font-size:16px;
  margin-bottom:18px;
}

.panel{
  background:#fff;
  border-radius:20px;
  padding:16px;
  margin-bottom:14px;
  box-shadow:0 3px 15px #0000000d;
}

.row{
  display:flex;
  gap:10px;
}

select,
button{
  height:50px;
  border-radius:14px;
  font-size:16px;
}

select{
  flex:1;
  background:#fff;
  border:1px solid #ddd;
  padding:0 14px;
}

button{
  min-width:125px;
  padding:0 16px;
  border:0;
  background:#111;
  color:#fff;
  font-weight:700;
}

button:active{
  transform:scale(.98);
}

.stats{
  display:grid;
  grid-template-columns:
    repeat(3,1fr);
  gap:10px;
}

.stat{
  background:#fff;
  border-radius:18px;
  padding:15px 5px;
  text-align:center;
}

.num{
  font-size:27px;
  font-weight:800;
}

.label{
  color:#888;
  font-size:12px;
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
  font-size:13px;
  color:#999;
}

.score{
  color:#e65100;
  font-weight:800;
}

.name{
  font-size:20px;
  font-weight:750;
  margin:7px 0;
  line-height:1.4;
}

.meta{
  color:#888;
  font-size:13px;
}

.tags{
  margin:7px 0;
}

.tag{
  display:inline-block;
  background:#fff0e8;
  color:#e65100;
  border-radius:8px;
  padding:4px 8px;
  font-size:12px;
  margin-right:5px;
}

.cnTag{
  background:#fff1f1;
  color:#d62828;
}

a{
  color:#1769e0;
  text-decoration:none;
  font-weight:600;
}

.loading{
  text-align:center;
  padding:40px 10px;
  color:#888;
}

.error{
  color:#d33;
  line-height:1.7;
}

.empty{
  text-align:center;
  padding:40px 10px;
  color:#888;
  line-height:1.8;
}

.notice{
  background:#f7f7f7;
  border-radius:14px;
  padding:12px;
  color:#777;
  font-size:13px;
  line-height:1.6;
  margin-top:10px;
}

@media(max-width:500px){

  .wrap{
    padding:12px;
  }

  h1{
    font-size:27px;
  }

  .row{
    flex-direction:column;
  }

  button{
    width:100%;
  }

  .stats{
    gap:6px;
  }

  .stat{
    padding:13px 4px;
  }

  .num{
    font-size:24px;
  }

}

</style>

</head>


<body>

<div class="wrap">

<h1>🔥 X热点起飞雷达</h1>

<div class="sub">
实时发现正在升温、值得蹲的 X 热点
</div>


<div class="panel">

<div class="row">

<select id="location">

<option value="china">
🇨🇳 中文区
</option>

<option value="1">
🌎 全球
</option>

<option value="23424977">
🇺🇸 美国
</option>

<option value="23424975">
🇬🇧 英国
</option>

<option value="23424856">
🇯🇵 日本
</option>

</select>


<button onclick="scan()">
立即扫描
</button>

</div>

</div>


<div class="stats">

<div class="stat">

<div
  class="num"
  id="count"
>
-
</div>

<div class="label">
热点数量
</div>

</div>


<div class="stat">

<div
  class="num"
  id="hot"
>
-
</div>

<div class="label">
值得关注
</div>

</div>


<div class="stat">

<div
  class="num"
  id="time"
>
-
</div>

<div class="label">
更新时间
</div>

</div>

</div>


<div
  class="panel"
  style="margin-top:14px"
>

<div
  id="status"
  class="loading"
>
点击「立即扫描」获取中文热点
</div>

<div id="list"></div>

</div>


</div>


<script>

async function scan(){

  const status =
    document.getElementById("status");

  const list =
    document.getElementById("list");


  status.innerHTML =
    "⏳ 正在扫描中文 X 热点...";

  list.innerHTML = "";


  try{

    const location =
      document.getElementById(
        "location"
      ).value;


    const response =
      await fetch(
        "/api/trends?location=" +
        encodeURIComponent(location)
      );


    const data =
      await response.json();


    if(!response.ok){

      throw new Error(
        data.error ||
        "扫描失败"
      );

    }


    const items =
      data.items || [];


    document.getElementById(
      "count"
    ).textContent =
      items.length;


    document.getElementById(
      "hot"
    ).textContent =
      items.filter(
        x => x.score >= 75
      ).length;


    document.getElementById(
      "time"
    ).textContent =
      new Date()
      .toLocaleTimeString(
        "zh-CN",
        {
          hour:"2-digit",
          minute:"2-digit"
        }
      );


    status.innerHTML = "";


    if(!items.length){

      status.innerHTML = `

        <div class="empty">

          暂时没有抓到符合条件的中文热点。

          <br>

          建议过几分钟再扫描一次。

          <div class="notice">

            中文区会自动排除纯英文、
            纯日文以及其他非中文趋势。

          </div>

        </div>

      `;

      return;

    }


    list.innerHTML =
      items.map(
        x => {

          const volume =
            x.tweetVolume
            ? Number(
                x.tweetVolume
              ).toLocaleString()
            : "暂无";


          const tags =
            (x.tags || [])
            .map(
              tag =>
                '<span class="tag">' +
                escapeHtml(tag) +
                '</span>'
            )
            .join("");


          return `

          <div class="item">

            <div class="rank">

              #${x.rank}

              <span class="score">
                🔥 起飞指数 ${x.score}
              </span>

            </div>


            <div class="name">

              ${escapeHtml(x.name)}

            </div>


            <div class="tags">

              <span class="tag cnTag">
                🇨🇳 中文热点
              </span>

              ${tags}

            </div>


            <div class="meta">

              讨论量：
              ${volume}

            </div>


            <div style="margin-top:9px">

              <a
                href="${x.url}"
                target="_blank"
              >
                在 X 查看 →
              </a>

            </div>

          </div>

          `;

        }
      ).join("");


  }catch(error){

    status.innerHTML =
      '<div class="error">' +

      '❌ ' +

      escapeHtml(
        error.message
      ) +

      '<br><br>' +

      '请检查 Render 中的 APIFY_TOKEN 是否正常。' +

      '</div>';

  }

}


function escapeHtml(text){

  return String(text || "")
    .replace(
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

</script>

</body>

</html>`;


/* =========================
   中文判断
========================= */


/*
  中文 Unicode 范围
*/
function hasChinese(text){

  return /[\u4e00-\u9fff]/.test(
    String(text || "")
  );

}


/*
  判断是不是明显的日文
*/
function hasJapanese(text){

  return /[\u3040-\u30ff]/.test(
    String(text || "")
  );

}


/*
  判断是否包含韩文
*/
function hasKorean(text){

  return /[\uac00-\ud7af]/.test(
    String(text || "")
  );

}


/*
  中文热点严格过滤
*/
function isChineseTrend(item){

  const name =
    String(
      item.name ||
      item.query ||
      ""
    ).trim();


  if(!name){

    return false;

  }


  /*
    必须有中文
  */
  if(!hasChinese(name)){

    return false;

  }


  /*
    有明显日文假名
    直接排除
  */
  if(hasJapanese(name)){

    return false;

  }


  /*
    韩文直接排除
  */
  if(hasKorean(name)){

    return false;

  }


  /*
    一些常见英文体育/人物趋势
    即使混有其他字符，也排除
  */
  const badWords = [

    "NBA",
    "NFL",
    "NHL",
    "MLB",
    "FIFA",
    "WWE",
    "UFC",

    "Jeremiah Smith",
    "Taylor Swift",
    "Donald Trump",
    "Elon Musk",

    "Manchester",
    "Liverpool",
    "Arsenal",
    "Chelsea",
    "Real Madrid",
    "Barcelona"

  ];


  const lower =
    name.toLowerCase();


  for(
    const word of badWords
  ){

    if(
      lower.includes(
        word.toLowerCase()
      )
    ){

      return false;

    }

  }


  return true;

}


/* =========================
   中文分类
========================= */

function getTags(name){

  const text =
    String(name || "");


  const tags = [];


  if(
    /美女|女神|写真|模特|穿搭|时尚|美妆|颜值|身材|小姐姐|网红/
    .test(text)
  ){

    tags.push("💄 美女时尚");

  }


  if(
    /明星|演员|歌手|艺人|娱乐|综艺|偶像|八卦/
    .test(text)
  ){

    tags.push("⭐ 明星娱乐");

  }


  if(
    /电影|电视剧|影视|动漫|综艺|剧/
    .test(text)
  ){

    tags.push("🎬 影视");

  }


  if(
    /游戏|电竞|手游|LOL|王者|原神|Steam|Switch/
    .test(text)
  ){

    tags.push("🎮 游戏");

  }


  if(
    /抖音|微博|小红书|直播|网红|社交/
    .test(text)
  ){

    tags.push("📱 社交");

  }


  if(
    /AI|人工智能|科技|手机|苹果|华为|芯片|机器人/
    .test(text)
  ){

    tags.push("🤖 科技");

  }


  if(
    /足球|篮球|网球|体育|奥运|世界杯/
    .test(text)
  ){

    tags.push("🏆 体育");

  }


  if(
    /中国|大陆|台湾|香港|澳门|深圳|上海|北京|广州|杭州|成都|重庆/
    .test(text)
  ){

    tags.push("🇨🇳 中文");

  }


  /*
    如果没有其他分类
  */
  if(tags.length === 0){

    tags.push("🔥 中文热点");

  }


  return tags.slice(0,2);

}


/* =========================
   起飞指数
========================= */

function getScore(item){

  const rank =
    Number(item.rank) || 50;


  let score =
    100 -
    Math.min(
      rank * 2,
      50
    );


  if(item.tweetVolume){

    const volume =
      Number(
        item.tweetVolume
      );


    if(volume >= 100000){

      score += 20;

    }else if(
      volume >= 50000
    ){

      score += 15;

    }else if(
      volume >= 10000
    ){

      score += 10;

    }else if(
      volume >= 1000
    ){

      score += 5;

    }

  }


  return Math.min(
    100,
    Math.max(
      50,
      score
    )
  );

}


/* =========================
   Apify
========================= */

async function getTrends(
  woeid = 1
){

  if(!APIFY_TOKEN){

    throw new Error(
      "APIFY_TOKEN 未配置"
    );

  }


  const url =
    "https://api.apify.com/v2/acts/" +
    encodeURIComponent(
      ACTOR
    ) +
    "/run-sync-get-dataset-items" +
    "?token=" +
    encodeURIComponent(
      APIFY_TOKEN
    );


  const response =
    await fetch(
      url,
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:JSON.stringify({

          woeid:Number(
            woeid
          ),

          resultsLimit:50

        })

      }
    );


  const text =
    await response.text();


  if(!response.ok){

    throw new Error(
      "Apify 请求失败：" +
      text.slice(0,300)
    );

  }


  try{

    return JSON.parse(
      text
    );

  }catch(error){

    throw new Error(
      "Apify 返回的数据无法解析"
    );

  }

}


/* =========================
   处理数据
========================= */

function normalizeItem(
  item,
  index
){

  const name =
    String(
      item.name ||
      item.query ||
      ""
    ).trim();


  const url =
    item.url ||
    (
      "https://x.com/search?q=" +
      encodeURIComponent(
        item.query ||
        name
      )
    );


  return {

    rank:
      Number(
        item.rank
      ) ||
      index + 1,

    name:name,

    query:
      item.query ||
      name,

    url:url,

    tweetVolume:
      item.tweetVolume ||
      null,

    score:
      getScore(item),

    tags:
      getTags(name)

  };

}


/* =========================
   HTTP服务器
========================= */

const server =
  http.createServer(
    async(req,res)=>{

      try{

        const u =
          new URL(
            req.url,
            "http://localhost"
          );


        /* 首页 */

        if(
          u.pathname === "/" ||
          u.pathname === "/index.html"
        ){

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/html; charset=utf-8"
            }
          );

          res.end(
            html
          );

          return;

        }


        /* 热点API */

        if(
          u.pathname ===
          "/api/trends"
        ){

          const location =
            u.searchParams.get(
              "location"
            ) ||
            "china";


          /*
            中文区
          */
          if(
            location === "china"
          ){

            /*
              全球50条
            */
            const global =
              await getTrends(1);


            /*
              严格中文过滤
            */
            let items =
              global
              .map(
                normalizeItem
              )
              .filter(
                isChineseTrend
              );


            /*
              中文热点优先排序：

              1. 中文程度
              2. 起飞指数
              3. 原始排名
            */

            items.sort(
              (a,b)=>{

                const aChinese =
                  (
                    a.name.match(
                      /[\u4e00-\u9fff]/g
                    ) || []
                  ).length;


                const bChinese =
                  (
                    b.name.match(
                      /[\u4e00-\u9fff]/g
                    ) || []
                  ).length;


                if(
                  bChinese !==
                  aChinese
                ){

                  return (
                    bChinese -
                    aChinese
                  );

                }


                if(
                  b.score !==
                  a.score
                ){

                  return (
                    b.score -
                    a.score
                  );

                }


                return (
                  a.rank -
                  b.rank
                );

              }
            );


            /*
              最多显示30条
            */
            items =
              items.slice(
                0,
                30
              );


            res.writeHead(
              200,
              {
                "Content-Type":
                  "application/json; charset=utf-8"
              }
            );


            res.end(
              JSON.stringify({
                items:items,
                mode:"中文区"
              })
            );


            return;

          }


          /*
            全球/美国/英国/日本
          */

          const raw =
            await getTrends(
              location
            );


          const items =
            raw
            .map(
              normalizeItem
            );


          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );


          res.end(
            JSON.stringify({
              items:items,
              mode:"地区热点"
            })
          );


          return;

        }


        /* 404 */

        res.writeHead(
          404,
          {
            "Content-Type":
              "text/plain; charset=utf-8"
          }
        );

        res.end(
          "Not found"
        );


      }catch(error){

        res.writeHead(
          500,
          {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        );


        res.end(
          JSON.stringify({
            error:
              error.message
          })
        );

      }

    }
  );


server.listen(
  PORT,
  "0.0.0.0",
  ()=>{
    console.log(
      "X热点起飞雷达运行中，端口：" +
      PORT
    );
  }
);