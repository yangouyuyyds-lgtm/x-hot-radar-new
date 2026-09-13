const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "feedminer~x-tweet-scraper";

let previousPosts = new Map();
let lastScanTime = null;
let scanning = false;

function requestApify(input) {
  return new Promise((resolve, reject) => {
    if (!APIFY_TOKEN) {
      reject(new Error("没有找到 APIFY_TOKEN"));
      return;
    }

    const url =
      "https://api.apify.com/v2/acts/" +
      ACTOR_ID +
      "/run-sync-get-dataset-items?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const body = JSON.stringify(input);

    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 180000
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let message = data;

            try {
              const parsed = JSON.parse(data);
              message =
                parsed.error?.message ||
                parsed.message ||
                data;
            } catch (_) {}

            reject(
              new Error(
                "Apify HTTP " +
                res.statusCode +
                ": " +
                message
              )
            );
            return;
          }

          try {
            const parsed = JSON.parse(data);

            if (!Array.isArray(parsed)) {
              reject(
                new Error("Apify 返回的不是数组")
              );
              return;
            }

            resolve(parsed);
          } catch (err) {
            reject(
              new Error(
                "Apify 数据解析失败: " +
                err.message
              )
            );
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(
        new Error("Apify 请求超时")
      );
    });

    req.on("error", reject);

    req.write(body);
    req.end();
  });
}

function n(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  const x = Number(
    String(value).replace(/,/g, "")
  );

  return Number.isFinite(x) ? x : 0;
}

function s(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function escapeHtml(value) {
  return s(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function field(row, names) {
  for (const name of names) {
    if (
      row[name] !== undefined &&
      row[name] !== null
    ) {
      return row[name];
    }
  }

  return null;
}

function getId(row) {
  return s(
    field(row, [
      "id",
      "tweetId",
      "tweet_id",
      "postId",
      "statusId"
    ])
  );
}

function getText(row) {
  return s(
    field(row, [
      "text",
      "fullText",
      "full_text",
      "content"
    ])
  );
}

function getUrl(row) {
  return s(
    field(row, [
      "url",
      "tweetUrl",
      "tweet_url",
      "statusUrl"
    ])
  );
}

function getCreated(row) {
  return s(
    field(row, [
      "createdAt",
      "created_at",
      "date",
      "timestamp"
    ])
  );
}

function getLikes(row) {
  return n(
    field(row, [
      "likeCount",
      "favoriteCount",
      "favorite_count",
      "likes"
    ])
  );
}

function getReplies(row) {
  return n(
    field(row, [
      "replyCount",
      "reply_count",
      "replies"
    ])
  );
}

function getReposts(row) {
  return n(
    field(row, [
      "repostCount",
      "retweetCount",
      "retweet_count",
      "retweets"
    ])
  );
}

function getQuotes(row) {
  return n(
    field(row, [
      "quoteCount",
      "quote_count",
      "quotes"
    ])
  );
}

function getBookmarks(row) {
  return n(
    field(row, [
      "bookmarkCount",
      "bookmark_count",
      "bookmarks"
    ])
  );
}

function getViews(row) {
  return n(
    field(row, [
      "viewCount",
      "view_count",
      "views"
    ])
  );
}

function getAuthor(row) {
  const author = row.author;

  if (author && typeof author === "object") {
    return (
      author.username ||
      author.handle ||
      author.screenName ||
      author.name ||
      ""
    );
  }

  return s(
    field(row, [
      "username",
      "handle",
      "authorUsername",
      "authorHandle"
    ])
  );
}

function getMedia(row) {
  const media =
    row.media ||
    row.mediaUrls ||
    row.media_urls ||
    row.images ||
    [];

  if (Array.isArray(media)) {
    return media.length;
  }

  return 0;
}

function normalize(row) {
  const created = getCreated(row);

  return {
    id: getId(row),
    text: getText(row),
    url: getUrl(row),
    createdAt: created,

    author: getAuthor(row),

    likes: getLikes(row),
    replies: getReplies(row),
    reposts: getReposts(row),
    quotes: getQuotes(row),
    bookmarks: getBookmarks(row),
    views: getViews(row),

    media: getMedia(row)
  };
}

function minutesOld(createdAt) {
  const time = new Date(createdAt).getTime();

  if (!Number.isFinite(time)) {
    return 999999;
  }

  return Math.max(
    0,
    (Date.now() - time) / 60000
  );
}

function engagement(post) {
  return (
    post.likes +
    post.replies * 2.2 +
    post.reposts * 2.8 +
    post.quotes * 2.4 +
    post.bookmarks * 1.5
  );
}

function interactionRate(post) {
  const hours = Math.max(
    0.25,
    minutesOld(post.createdAt) / 60
  );

  return engagement(post) / hours;
}

function calculateBaseScore(post) {
  const age = minutesOld(post.createdAt);

  if (age > 72 * 60) {
    return 0;
  }

  const ageWeight =
    age <= 30 ? 1.8 :
    age <= 60 ? 1.65 :
    age <= 180 ? 1.45 :
    age <= 360 ? 1.25 :
    age <= 720 ? 1.05 :
    0.8;

  const interaction =
    Math.log10(
      engagement(post) + 1
    ) * 16;

  const speed =
    Math.log10(
      interactionRate(post) + 1
    ) * 22;

  const mediaBonus =
    post.media > 0 ? 10 : 0;

  const commentBonus =
    post.replies >= 20 ? 8 :
    post.replies >= 10 ? 5 :
    0;

  return (
    interaction * ageWeight +
    speed * ageWeight +
    mediaBonus +
    commentBonus
  );
}

function calculateAcceleration(post) {
  const old = previousPosts.get(post.id);

  if (!old) {
    return {
      growth: 0,
      acceleration: 0,
      label: "🆕 新发现"
    };
  }

  const oldEngagement = old.engagement;

  const nowEngagement =
    engagement(post);

  if (oldEngagement <= 0) {
    return {
      growth: 0,
      acceleration: 0,
      label: "📈 开始升温"
    };
  }

  const growth =
    ((nowEngagement - oldEngagement) /
      oldEngagement) *
    100;

  const oldMinutes = old.ageMinutes;

  const newMinutes =
    Math.max(
      1,
      minutesOld(post.createdAt)
    );

  const oldRate =
    oldEngagement /
    Math.max(
      0.25,
      oldMinutes / 60
    );

  const newRate =
    nowEngagement /
    Math.max(
      0.25,
      newMinutes / 60
    );

  let acceleration = 0;

  if (oldRate > 0) {
    acceleration =
      ((newRate - oldRate) /
        oldRate) *
      100;
  }

  let label = "➡️ 稳定";

  if (
    growth >= 100 ||
    acceleration >= 100
  ) {
    label = "🚀 疯狂起飞";
  } else if (
    growth >= 50 ||
    acceleration >= 50
  ) {
    label = "🔥 快速上升";
  } else if (
    growth >= 20 ||
    acceleration >= 20
  ) {
    label = "📈 正在升温";
  }

  return {
    growth: Math.round(growth),
    acceleration: Math.round(acceleration),
    label
  };
}

function buildResults(rows) {
  const unique = new Map();

  for (const raw of rows) {
    const post = normalize(raw);

    if (!post.text) {
      continue;
    }

    if (!post.id) {
      continue;
    }

    /*
     * 中文内容优先。
     */
    const chinese =
      (
        post.text.match(
          /[\u4e00-\u9fff]/g
        ) || []
      ).length;

    if (chinese < 2) {
      continue;
    }

    /*
     * 72小时以后不作为“抢热点”。
     */
    if (
      minutesOld(post.createdAt) >
      72 * 60
    ) {
      continue;
    }

    /*
     * 不要只看总赞。
     * 至少有一定互动才进入雷达。
     */
    if (
      engagement(post) < 3 &&
      minutesOld(post.createdAt) > 180
    ) {
      continue;
    }

    if (!unique.has(post.id)) {
      unique.set(post.id, post);
    }
  }

  const posts = [...unique.values()];

  const results = posts.map((post) => {
    const base =
      calculateBaseScore(post);

    const acceleration =
      calculateAcceleration(post);

    let score =
      base +
      Math.min(
        25,
        Math.max(
          0,
          acceleration.acceleration / 8
        )
      );

    /*
     * 评论很多，对“抢评论区”特别有价值。
     */
    if (post.replies >= 50) {
      score += 12;
    } else if (post.replies >= 20) {
      score += 8;
    } else if (post.replies >= 10) {
      score += 4;
    }

    /*
     * 图片内容额外加权。
     */
    if (post.media > 0) {
      score += 8;
    }

    score =
      Math.round(
        Math.min(100, score)
      );

    return {
      ...post,
      score,
      growth: acceleration.growth,
      acceleration:
        acceleration.acceleration,
      momentum: acceleration.label
    };
  });

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return (
      engagement(b) -
      engagement(a)
    );
  });

  return results.slice(0, 30);
}

async function scan() {
  if (scanning) {
    throw new Error(
      "正在扫描，请稍等"
    );
  }

  scanning = true;

  try {
    /*
     * 一次扫描只请求一次 Actor。
     *
     * 重点：
     * lang:zh
     * has:images
     * -is:retweet
     *
     * Latest + Top 合并。
     */
    const input = {
      searchTerms: [
        "lang:zh has:images -is:retweet"
      ],

      maxItems: 120,

      sort: "Latest + Top",

      tweetLanguage: "zh",

      onlyImage: true,

      includeSearchTerms: true
    };

    const rows =
      await requestApify(input);

    const results =
      buildResults(rows);

    /*
     * 保存当前快照。
     * 下一次扫描就可以计算增长。
     */
    const nextSnapshot = new Map();

    for (const post of results) {
      nextSnapshot.set(
        post.id,
        {
          engagement:
            engagement(post),

          ageMinutes:
            minutesOld(
              post.createdAt
            )
        }
      );
    }

    previousPosts = nextSnapshot;

    lastScanTime =
      new Date().toISOString();

    return {
      ok: true,

      scanTime: lastScanTime,

      fetched: rows.length,

      results
    };
  } finally {
    scanning = false;
  }
}

function formatNumber(value) {
  const n = Number(value || 0);

  if (n >= 1000000) {
    return (
      (n / 1000000).toFixed(1) +
      "M"
    );
  }

  if (n >= 10000) {
    return (
      (n / 10000).toFixed(1) +
      "万"
    );
  }

  if (n >= 1000) {
    return (
      (n / 1000).toFixed(1) +
      "K"
    );
  }

  return String(
    Math.round(n)
  );
}

function formatAge(createdAt) {
  const mins =
    minutesOld(createdAt);

  if (mins < 1) {
    return "刚刚";
  }

  if (mins < 60) {
    return (
      Math.floor(mins) +
      "分钟前"
    );
  }

  if (mins < 1440) {
    return (
      Math.floor(mins / 60) +
      "小时前"
    );
  }

  return (
    Math.floor(mins / 1440) +
    "天前"
  );
}

function page() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>

<meta charset="UTF-8">

<meta
 name="viewport"
 content="width=device-width,
 initial-scale=1,
 maximum-scale=1"
/>

<title>X热帖抢跑雷达</title>

<style>

* {
 box-sizing:border-box;
}

body {
 margin:0;
 background:
 radial-gradient(
   circle at top,
   #182235,
   #070a10 55%,
   #040507
 );
 color:#f5f7fb;
 font-family:
 -apple-system,
 BlinkMacSystemFont,
 "Segoe UI",
 sans-serif;
}

.container {
 max-width:700px;
 margin:auto;
 padding:18px 14px 50px;
}

.title {
 font-size:28px;
 font-weight:900;
}

.subtitle {
 color:#929aaa;
 margin-top:6px;
 font-size:13px;
}

.scan {
 margin-top:18px;
 width:100%;
 padding:17px;
 border:0;
 border-radius:17px;
 background:
 linear-gradient(
   135deg,
   #ff2d62,
   #ff6937
 );
 color:#fff;
 font-size:17px;
 font-weight:900;
 box-shadow:
 0 15px 35px
 rgba(255,60,80,.25);
}

.scan:disabled {
 opacity:.55;
}

.status {
 margin:15px 3px;
 color:#9da5b4;
 font-size:13px;
}

.hot {
 margin-top:14px;
 padding:16px;
 border-radius:18px;
 background:
 rgba(15,19,27,.94);
 border:1px solid #202633;
}

.top {
 display:flex;
 align-items:center;
 gap:9px;
}

.rank {
 font-size:17px;
 font-weight:900;
}

.time {
 margin-left:auto;
 color:#858e9f;
 font-size:11px;
}

.author {
 margin-top:10px;
 color:#dbe0e9;
 font-size:14px;
 font-weight:800;
}

.post {
 margin-top:9px;
 font-size:15px;
 line-height:1.55;
 white-space:pre-wrap;
 word-break:break-word;
}

.metrics {
 display:grid;
 grid-template-columns:
 repeat(4,1fr);
 gap:7px;
 margin-top:13px;
}

.metric {
 background:#10151e;
 border-radius:10px;
 padding:9px 3px;
 text-align:center;
}

.metric b {
 display:block;
 font-size:14px;
}

.metric span {
 display:block;
 margin-top:3px;
 color:#737d8e;
 font-size:10px;
}

.score {
 display:flex;
 align-items:center;
 margin-top:14px;
 padding:10px;
 border-radius:10px;
 background:#151b25;
}

.score b {
 font-size:20px;
 color:#ffb25f;
}

.score span {
 margin-left:9px;
 font-size:12px;
 color:#d8dee8;
}

.growth {
 margin-top:9px;
 color:#ff718e;
 font-size:12px;
 font-weight:800;
}

.comment {
 display:block;
 margin-top:14px;
 padding:12px;
 border-radius:12px;
 background:
 linear-gradient(
   135deg,
   #ff315d,
   #ff6339
 );
 color:#fff;
 text-decoration:none;
 text-align:center;
 font-size:14px;
 font-weight:900;
}

.empty {
 text-align:center;
 padding:55px 15px;
 color:#777f8d;
 line-height:1.8;
}

.error {
 margin-top:15px;
 padding:15px;
 border-radius:12px;
 background:#34151c;
 color:#ff9dab;
 font-size:13px;
 line-height:1.6;
}

.note {
 margin-top:20px;
 color:#646d7c;
 font-size:11px;
 line-height:1.6;
}

</style>

</head>

<body>

<div class="container">

 <div class="title">
 🚀 X热帖抢跑雷达
 </div>

 <div class="subtitle">
 发现正在升温的中文图片热帖
 </div>

 <button
  id="scan"
  class="scan"
  onclick="scan()"
 >
 🔥 扫描刚刚起飞
 </button>

 <div
  id="status"
  class="status"
 >
 点击扫描，寻找正在上涨的帖子
 </div>

 <div id="results"></div>

 <div class="note">
 每次扫描都会保存当前快照。<br>
 再次扫描后，系统会比较互动变化，
 判断哪些帖子正在加速。
 </div>

</div>

<script>

async function scan() {

 const btn =
 document.getElementById("scan");

 const status =
 document.getElementById("status");

 const results =
 document.getElementById("results");

 btn.disabled = true;

 btn.innerText =
 "⏳ 正在寻找正在起飞的帖子...";

 status.innerText =
 "正在搜索最新中文图片内容...";

 results.innerHTML = "";

 try {

  const res =
   await fetch(
    "/api/scan?t=" +
    Date.now()
   );

  const data =
   await res.json();

  if (!res.ok || !data.ok) {
   throw new Error(
    data.error ||
    "扫描失败"
   );
  }

  status.innerText =
   "扫描完成 · 获取 " +
   data.fetched +
   " 条 · 找到 " +
   data.results.length +
   " 条值得抢的热帖";

  if (!data.results.length) {

   results.innerHTML =
    '<div class="empty">' +
    "暂时没有发现正在起飞的热帖<br><br>" +
    "换一轮再扫描看看" +
    "</div>";

   return;
  }

  results.innerHTML =
   data.results
   .map(function(post,index) {

    const growth =
     post.growth > 0
      ? "📈 互动增长 +" +
        post.growth +
        "%"
      : post.momentum;

    const author =
     post.author
      ? "@" + post.author
      : "未知账号";

    const url =
     post.url || "#";

    return (

     '<div class="hot">' +

      '<div class="top">' +

       '<div class="rank">' +
       (
        index === 0
         ? "🥇"
         : index === 1
          ? "🥈"
          : index === 2
           ? "🥉"
           : "#" + (index + 1)
       ) +
       "</div>" +

       '<div class="time">' +
       escapeHtml(
        formatAge(
         post.createdAt
        )
       ) +
       "</div>" +

      "</div>" +

      '<div class="author">' +
      escapeHtml(author) +
      "</div>" +

      '<div class="post">' +
      escapeHtml(
       post.text
      ) +
      "</div>" +

      '<div class="metrics">' +

       metric(
        formatNumber(
         post.likes
        ),
        "点赞"
       ) +

       metric(
        formatNumber(
         post.replies
        ),
        "评论"
       ) +

       metric(
        formatNumber(
         post.reposts
        ),
        "转发"
       ) +

       metric(
        formatNumber(
         post.views
        ),
        "浏览"
       ) +

      "</div>" +

      '<div class="score">' +
       "<b>" +
       post.score +
       "</b>" +
       '<span>' +
       escapeHtml(
        post.momentum
       ) +
       "</span>" +
      "</div>" +

      '<div class="growth">' +
       escapeHtml(growth) +
      "</div>" +

      '<a ' +
       'class="comment" ' +
       'href="' +
       escapeHtml(url) +
       '" ' +
       'target="_blank">' +
       "🔥 立即去评论 ↗" +
      "</a>" +

     "</div>"
    );

   })
   .join("");

 } catch(err) {

  status.innerText =
   "扫描失败";

  results.innerHTML =
   '<div class="error">' +
   "❌ " +
   escapeHtml(
    err.message
   ) +
   "<br><br>" +
   "这次不会隐藏错误。把这里截图给我，我直接定位。" +
   "</div>";

 } finally {

  btn.disabled = false;

  btn.innerText =
   "🔥 扫描刚刚起飞";
 }
}

function metric(
 value,
 label
) {

 return (
  '<div class="metric">' +
   "<b>" +
   value +
   "</b>" +
   "<span>" +
   label +
   "</span>" +
  "</div>"
 );
}

function escapeHtml(value) {

 return String(
  value || ""
 )
 .replace(
  /&/g,
  "&amp;"
 )
 .replace(
  /</g,
  "&lt;"
 )
 .replace(
  />/g,
  "&gt;"
 )
 .replace(
  /"/g,
  "&quot;"
 );
}

</script>

</body>
</html>
`;
}

const server =
 http.createServer(
  async (req,res) => {

   try {

    const url =
     new URL(
      req.url,
      "http://" +
      (req.headers.host ||
       "localhost")
     );

    if (
     url.pathname === "/"
    ) {

     res.writeHead(
      200,
      {
       "Content-Type":
        "text/html; charset=utf-8"
      }
     );

     res.end(
      page()
     );

     return;
    }

    if (
     url.pathname === "/health"
    ) {

     res.writeHead(
      200,
      {
       "Content-Type":
        "application/json"
      }
     );

     res.end(
      JSON.stringify({
       ok:true,
       actor:ACTOR_ID,
       token:Boolean(
        APIFY_TOKEN
       )
      })
     );

     return;
    }

    if (
     url.pathname ===
     "/api/scan"
    ) {

     try {

      const data =
       await scan();

      res.writeHead(
       200,
       {
        "Content-Type":
         "application/json; charset=utf-8"
       }
      );

      res.end(
       JSON.stringify(data)
      );

     } catch(err) {

      console.error(
       "SCAN ERROR:",
       err
      );

      res.writeHead(
       500,
       {
        "Content-Type":
         "application/json; charset=utf-8"
       }
      );

      res.end(
       JSON.stringify({
        ok:false,
        error:err.message
       })
      );
     }

     return;
    }

    res.writeHead(
     404,
     {
      "Content-Type":
       "application/json"
     }
    );

    res.end(
     JSON.stringify({
      ok:false,
      error:"Not Found"
     })
    );

   } catch(err) {

    res.writeHead(
     500,
     {
      "Content-Type":
       "application/json"
     }
    );

    res.end(
     JSON.stringify({
      ok:false,
      error:err.message
     })
    );
   }
  }
 );

server.listen(
 PORT,
 "0.0.0.0",
 () => {
  console.log(
   "X热帖抢跑雷达启动，端口:",
   PORT
  );
 }
);