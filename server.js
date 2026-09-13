const http = require("http");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "atomus~twitter-scraper";


// ==========================
// 调用 Apify
// ==========================

async function callApify(input) {
  if (!APIFY_TOKEN) {
    throw new Error("APIFY_TOKEN 未配置");
  }

  const url =
    "https://api.apify.com/v2/acts/" +
    ACTOR_ID +
    "/run-sync-get-dataset-items?token=" +
    encodeURIComponent(APIFY_TOKEN);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      "Apify HTTP " +
      response.status +
      ": " +
      text.substring(0, 500)
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Apify 返回的数据无法解析");
  }
}


// ==========================
// 中文判断
// ==========================

function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text || "");
}


// ==========================
// 提取 Hashtag
// ==========================

function getHashtags(tweet) {
  const result = [];

  const text = tweet.text || "";

  const matches =
    text.match(/#[\u3400-\u9fffA-Za-z0-9_]+/g) || [];

  for (const item of matches) {
    result.push(item);
  }

  if (Array.isArray(tweet.hashtags)) {
    for (const item of tweet.hashtags) {
      if (typeof item === "string") {
        const tag =
          item.startsWith("#")
            ? item
            : "#" + item;

        result.push(tag);
      }
    }
  }

  return [...new Set(result)];
}


// ==========================
// 计算帖子热度
// ==========================

function getEngagement(tweet) {
  const likes =
    Number(tweet.favorite_count || 0);

  const retweets =
    Number(tweet.retweet_count || 0);

  const replies =
    Number(tweet.reply_count || 0);

  const quotes =
    Number(tweet.quote_count || 0);

  const views =
    Number(tweet.view_count || 0);

  return (
    likes +
    retweets * 3 +
    replies * 2 +
    quotes * 3 +
    Math.sqrt(Math.max(views, 0)) * 0.5
  );
}


// ==========================
// 热点聚合
// ==========================

function buildTopics(tweets) {
  const map = new Map();

  for (const tweet of tweets) {
    const text = tweet.text || "";

    if (!containsChinese(text)) {
      continue;
    }

    const hashtags = getHashtags(tweet);

    if (hashtags.length === 0) {
      continue;
    }

    const engagement =
      getEngagement(tweet);

    for (const tag of hashtags) {
      if (!containsChinese(tag)) {
        continue;
      }

      if (!map.has(tag)) {
        map.set(tag, {
          name: tag,
          posts: 0,
          engagement: 0,
          authors: new Set(),
          examples: []
        });
      }

      const item = map.get(tag);

      item.posts += 1;
      item.engagement += engagement;

      if (
        tweet.author &&
        tweet.author.screen_name
      ) {
        item.authors.add(
          tweet.author.screen_name
        );
      }

      if (item.examples.length < 2) {
        item.examples.push({
          text: text.substring(0, 180),
          url: tweet.url || ""
        });
      }
    }
  }


  const topics = [];

  for (const item of map.values()) {
    const postScore =
      Math.log10(item.posts + 1) * 25;

    const engagementScore =
      Math.log10(item.engagement + 10) * 15;

    const authorScore =
      Math.log10(item.authors.size + 1) * 10;

    let score =
      postScore +
      engagementScore +
      authorScore;

    score =
      Math.min(
        100,
        Math.round(score)
      );

    topics.push({
      name: item.name,

      score: score,

      posts: item.posts,

      authors: item.authors.size,

      examples: item.examples
    });
  }


  topics.sort(
    (a, b) => b.score - a.score
  );

  return topics.slice(0, 30);
}


// ==========================
// 扫描中文热点
// ==========================

async function scan() {

  const queries = [
    "lang:zh",
    "lang:zh #美女",
    "lang:zh #穿搭",
    "lang:zh #娱乐",
    "lang:zh #明星",
    "lang:zh #AI",
    "lang:zh #科技"
  ];

  let allTweets = [];

  for (const query of queries) {

    console.log(
      "正在搜索:",
      query
    );

    try {

      const result =
        await callApify({
          searchType: "search",

          searchQuery: query,

          sortOrder: "Latest",

          language: "zh",

          maxItems: 30,

          excludeRetweets: true
        });


      if (Array.isArray(result)) {
        allTweets =
          allTweets.concat(result);
      }

    } catch (error) {

      console.error(
        "查询失败:",
        query,
        error.message
      );

    }
  }


  if (allTweets.length === 0) {
    throw new Error(
      "没有获取到 X 中文帖子"
    );
  }


  const topics =
    buildTopics(allTweets);


  return {
    success: true,

    region: "中文热点",

    scannedTweets:
      allTweets.length,

    scanTime:
      new Date().toISOString(),

    data:
      topics
  };
}


// ==========================
// HTML
// ==========================

function getHTML() {

  return [
    "<!DOCTYPE html>",
    "<html lang='zh-CN'>",
    "<head>",
    "<meta charset='UTF-8'>",

    "<meta name='viewport' content='width=device-width,initial-scale=1'>",

    "<title>X热点起飞雷达</title>",

    "<style>",

    "body{",
    "margin:0;",
    "background:#080808;",
    "color:#fff;",
    "font-family:-apple-system,BlinkMacSystemFont,Arial;",
    "}",

    ".box{",
    "max-width:700px;",
    "margin:auto;",
    "padding:20px;",
    "}",

    "h1{",
    "font-size:26px;",
    "margin-bottom:5px;",
    "}",

    ".sub{",
    "color:#888;",
    "font-size:14px;",
    "margin-bottom:20px;",
    "}",

    "button{",
    "width:100%;",
    "padding:15px;",
    "border:0;",
    "border-radius:12px;",
    "font-size:16px;",
    "font-weight:bold;",
    "}",

    ".status{",
    "margin:15px 0;",
    "color:#999;",
    "font-size:13px;",
    "}",

    ".card{",
    "background:#151515;",
    "border:1px solid #292929;",
    "border-radius:15px;",
    "padding:15px;",
    "margin-bottom:10px;",
    "}",

    ".rank{",
    "color:#777;",
    "font-size:12px;",
    "}",

    ".name{",
    "font-size:18px;",
    "font-weight:bold;",
    "margin:7px 0;",
    "}",

    ".score{",
    "font-size:14px;",
    "color:#aaa;",
    "}",

    ".flight{",
    "font-size:20px;",
    "font-weight:bold;",
    "color:#fff;",
    "}",

    ".example{",
    "margin-top:10px;",
    "color:#888;",
    "font-size:12px;",
    "line-height:1.5;",
    "}",

    "a{",
    "color:#aaa;",
    "}",

    "</style>",

    "</head>",

    "<body>",

    "<div class='box'>",

    "<h1>🚀 X热点起飞雷达</h1>",

    "<div class='sub'>中文 X 热点实时聚合</div>",

    "<button id='btn' onclick='scan()'>🔥 立即扫描热点</button>",

    "<div id='status' class='status'>等待扫描</div>",

    "<div id='list'></div>",

    "</div>",


    "<script>",

    "async function scan(){",

    "const btn=document.getElementById('btn');",

    "const status=document.getElementById('status');",

    "const list=document.getElementById('list');",

    "btn.disabled=true;",

    "btn.innerText='⏳ 正在扫描...';",

    "status.innerText='正在获取 X 中文公开内容';",

    "list.innerHTML='';",


    "try{",

    "const response=await fetch('/api/scan');",

    "const data=await response.json();",

    "if(!response.ok || !data.success){",

    "throw new Error(data.error || '扫描失败');",

    "}",


    "status.innerText='扫描完成：'+data.scannedTweets+' 条帖子';",


    "data.data.forEach(function(item,index){",

    "const card=document.createElement('div');",

    "card.className='card';",


    "let example='';",

    "if(item.examples && item.examples.length){",

    "example='<div class=\"example\">'+",
    "escapeHTML(item.examples[0].text)+",
    "'</div>';",

    "}",


    "card.innerHTML=",
    "'<div class=\"rank\">#'+",
    "(index+1)+",
    "'</div>'+",

    "'<div class=\"name\">'+",
    "escapeHTML(item.name)+",
    "'</div>'+",

    "'<div class=\"score\">'+",
    "item.posts+' 条相关帖子 · '+",
    "item.authors+' 位作者</div>'+",

    "'<div class=\"flight\">🚀 热度 '+",
    "item.score+",
    "</div>'+",

    "example;",


    "list.appendChild(card);",

    "});",


    "}catch(error){",

    "status.innerText='❌ '+error.message;",

    "}finally{",

    "btn.disabled=false;",

    "btn.innerText='🔥 再次扫描热点';",

    "}",

    "}",


    "function escapeHTML(text){",

    "return String(text||'')",
    ".replace(/&/g,'&amp;')",
    ".replace(/</g,'&lt;')",
    ".replace(/>/g,'&gt;')",
    ".replace(/\"/g,'&quot;')",

    "}",

    "</script>",

    "</body>",
    "</html>"
  ].join("");
}


// ==========================
// HTTP 服务
// ==========================

const server =
  http.createServer(
    async function(req,res){

      if(req.url === "/"){

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );

        res.end(
          getHTML()
        );

        return;
      }


      if(req.url === "/api/scan"){

        try{

          const result =
            await scan();

          res.writeHead(
            200,
            {
              "Content-Type":
                "application/json; charset=utf-8"
            }
          );

          res.end(
            JSON.stringify(result)
          );

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
              success:false,
              error:error.message
            })
          );
        }

        return;
      }


      res.writeHead(404);

      res.end("Not Found");

    }
  );


server.listen(
  PORT,
  function(){
    console.log(
      "X热点起飞雷达启动成功，端口:",
      PORT
    );
  }
);