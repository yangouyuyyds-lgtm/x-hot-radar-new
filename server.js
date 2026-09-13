const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "maximedupre~twitter-scraper";

let lastScan = null;
let scanning = false;

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function html(res, body) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function num(v) {
  if (v === null || v === undefined || v === "") return 0;

  if (typeof v === "number") {
    return Number.isFinite(v) ? v : 0;
  }

  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function text(v) {
  return v === null || v === undefined ? "" : String(v);
}

function escapeHtml(str) {
  return text(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getField(obj, names) {
  for (const name of names) {
    if (obj && obj[name] !== undefined && obj[name] !== null) {
      return obj[name];
    }
  }
  return null;
}

function getAuthor(row) {
  const author = row.author;

  if (author && typeof author === "object") {
    return (
      author.handle ||
      author.username ||
      author.screenName ||
      author.userName ||
      author.name ||
      ""
    );
  }

  return (
    getField(row, [
      "handle",
      "username",
      "screenName",
      "authorHandle",
      "authorUsername"
    ]) || ""
  );
}

function getTweetId(row) {
  return String(
    getField(row, [
      "postId",
      "tweetId",
      "id",
      "tweet_id",
      "statusId"
    ]) || ""
  );
}

function getTweetText(row) {
  return text(
    getField(row, [
      "text",
      "fullText",
      "content",
      "tweetText",
      "body"
    ]) || ""
  );
}

function getTweetUrl(row) {
  return (
    getField(row, [
      "url",
      "tweetUrl",
      "postUrl",
      "statusUrl"
    ]) || ""
  );
}

function getDate(row) {
  return (
    getField(row, [
      "createdAt",
      "created_at",
      "publishedAt",
      "date"
    ]) || ""
  );
}

function getLikes(row) {
  return num(
    getField(row, [
      "likeCount",
      "likes",
      "favoriteCount",
      "favorite_count",
      "favorites"
    ])
  );
}

function getReposts(row) {
  return num(
    getField(row, [
      "repostCount",
      "retweetCount",
      "retweets",
      "retweet_count"
    ])
  );
}

function getReplies(row) {
  return num(
    getField(row, [
      "replyCount",
      "replies",
      "reply_count"
    ])
  );
}

function getQuotes(row) {
  return num(
    getField(row, [
      "quoteCount",
      "quotes",
      "quote_count"
    ])
  );
}

function getBookmarks(row) {
  return num(
    getField(row, [
      "bookmarkCount",
      "bookmarks",
      "bookmark_count"
    ])
  );
}

function getViews(row) {
  return num(
    getField(row, [
      "viewCount",
      "views",
      "view_count"
    ])
  );
}

function extractHashtags(row) {
  const result = [];

  const raw = getField(row, [
    "hashtags",
    "hashTags",
    "hashtagsList"
  ]);

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        result.push(item);
      } else if (item && typeof item === "object") {
        result.push(
          item.text ||
          item.tag ||
          item.hashtag ||
          ""
        );
      }
    }
  }

  const content = getTweetText(row);

  const regex = /#[\p{L}\p{N}_]+/gu;
  const matches = content.match(regex) || [];

  for (const tag of matches) {
    result.push(tag.replace(/^#/, ""));
  }

  return [...new Set(
    result
      .map(x => text(x).replace(/^#/, "").trim())
      .filter(Boolean)
  )];
}

function engagement(row) {
  const likes = getLikes(row);
  const reposts = getReposts(row);
  const replies = getReplies(row);
  const quotes = getQuotes(row);
  const bookmarks = getBookmarks(row);
  const views = getViews(row);

  /*
   * 不再使用简单相加。
   * 使用 log 压缩，避免一个百万浏览帖子把所有其他帖子碾压。
   */
  return (
    Math.log10(likes + 1) * 35 +
    Math.log10(reposts + 1) * 45 +
    Math.log10(replies + 1) * 25 +
    Math.log10(quotes + 1) * 30 +
    Math.log10(bookmarks + 1) * 20 +
    Math.log10(views + 1) * 10
  );
}

function freshness(row) {
  const d = new Date(getDate(row));

  if (Number.isNaN(d.getTime())) {
    return 1;
  }

  const hours = Math.max(
    0,
    (Date.now() - d.getTime()) / 3600000
  );

  /*
   * 越新权重越高。
   */
  if (hours <= 1) return 1.45;
  if (hours <= 3) return 1.30;
  if (hours <= 6) return 1.18;
  if (hours <= 12) return 1.08;
  if (hours <= 24) return 1.0;
  if (hours <= 72) return 0.85;

  return 0.7;
}

function chineseScore(row) {
  const content = getTweetText(row);

  const chinese = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const total = content.replace(/\s/g, "").length;

  if (!total) return 0;

  return chinese / total;
}

function calculatePostScore(row) {
  const e = engagement(row);
  const f = freshness(row);
  const c = chineseScore(row);

  return e * f * (0.65 + c * 0.35);
}

function normalizeRow(row) {
  return {
    id: getTweetId(row),
    text: getTweetText(row),
    url: getTweetUrl(row),
    author: getAuthor(row),
    createdAt: getDate(row),
    likes: getLikes(row),
    reposts: getReposts(row),
    replies: getReplies(row),
    quotes: getQuotes(row),
    bookmarks: getBookmarks(row),
    views: getViews(row),
    hashtags: extractHashtags(row),
    score: calculatePostScore(row)
  };
}

function buildTopics(rows) {
  const map = new Map();

  for (const row of rows) {
    for (const tag of row.hashtags) {
      if (!tag) continue;

      const clean = tag.trim();

      if (clean.length < 2) continue;
      if (clean.length > 40) continue;

      /*
       * 中文雷达优先。
       */
      if (!/[\u4e00-\u9fff]/.test(clean)) {
        continue;
      }

      if (!map.has(clean)) {
        map.set(clean, {
          name: clean,
          posts: 0,
          authors: new Set(),
          engagement: 0,
          views: 0,
          score: 0,
          examples: []
        });
      }

      const item = map.get(clean);

      item.posts += 1;

      if (row.author) {
        item.authors.add(row.author);
      }

      item.engagement +=
        row.likes +
        row.reposts * 2 +
        row.replies +
        row.quotes * 1.5 +
        row.bookmarks;

      item.views += row.views;

      item.score += row.score;

      if (item.examples.length < 3) {
        item.examples.push({
          text: row.text,
          author: row.author,
          url: row.url
        });
      }
    }
  }

  const topics = [...map.values()]
    .map(item => {
      const authors = item.authors.size;

      /*
       * 话题算法：
       *
       * 35% 帖子数量
       * 25% 作者数量
       * 25% 互动
       * 15% 原始帖子热度
       *
       * 再加一个扩散奖励。
       */
      const postScore = Math.log10(item.posts + 1) * 35;
      const authorScore = Math.log10(authors + 1) * 25;
      const engagementScore =
        Math.log10(item.engagement + 1) * 25;
      const rawScore = Math.min(item.score, 100) * 0.15;

      const diversity =
        authors > 1
          ? Math.min(15, authors * 1.5)
          : 0;

      let heat =
        postScore +
        authorScore +
        engagementScore +
        rawScore +
        diversity;

      heat = Math.round(Math.min(100, heat));

      let level = "普通";

      if (heat >= 90) level = "🔥 爆点";
      else if (heat >= 75) level = "🚀 强势";
      else if (heat >= 60) level = "📈 上升";
      else if (heat >= 40) level = "👀 值得观察";

      return {
        name: item.name,
        posts: item.posts,
        authors,
        engagement: Math.round(item.engagement),
        views: Math.round(item.views),
        heat,
        level,
        examples: item.examples
      };
    })
    .sort((a, b) => {
      if (b.heat !== a.heat) {
        return b.heat - a.heat;
      }

      return b.posts - a.posts;
    })
    .slice(0, 30);

  return topics;
}

function callApify(input) {
  return new Promise((resolve, reject) => {
    if (!APIFY_TOKEN) {
      reject(new Error("Render 没有找到 APIFY_TOKEN"));
      return;
    }

    const url =
      "https://api.apify.com/v2/acts/" +
      ACTOR_ID +
      "/run-sync-get-dataset-items?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const body = JSON.stringify(input);

    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 180000
      },
      response => {
        let data = "";

        response.on("data", chunk => {
          data += chunk;
        });

        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            let detail = data;

            try {
              const parsed = JSON.parse(data);
              detail =
                parsed.error?.message ||
                parsed.message ||
                data;
            } catch (_) {}

            reject(
              new Error(
                "Apify HTTP " +
                response.statusCode +
                ": " +
                detail
              )
            );

            return;
          }

          try {
            const parsed = JSON.parse(data);

            if (!Array.isArray(parsed)) {
              reject(
                new Error(
                  "Apify 返回的不是数据数组"
                )
              );
              return;
            }

            resolve(parsed);
          } catch (error) {
            reject(
              new Error(
                "Apify 返回数据解析失败: " +
                error.message
              )
            );
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(
        new Error("Apify 请求超时")
      );
    });

    request.on("error", error => {
      reject(error);
    });

    request.write(body);
    request.end();
  });
}

async function scan() {
  if (scanning) {
    throw new Error("正在扫描，请不要重复点击");
  }

  scanning = true;

  try {
    /*
     * 只调用一次。
     * 这是为了尽量省免费额度。
     *
     * 不声称这是“官方中国区趋势”。
     * 它是真实 X 中文公开内容的热点分析。
     */
    const input = {
      target: "searchPosts",
      postDiscoveryMethod: "searchQuery",

      searchQuery:
        "lang:zh -filter:retweets",

      searchMode: "latestAndTop",

      language: "zh",

      links: "include",
      media: "include",

      shouldIncludeOriginalPosts: true,
      shouldIncludeQuotePosts: true,
      shouldIncludeReplies: true,
      shouldIncludeReposts: false,
      shouldIncludePromotedPosts: false,

      /*
       * 一次最多抓 70 条。
       * 不再并发跑 10 个搜索。
       */
      maxNbItemsToScrape: 70
    };

    const raw = await callApify(input);

    const unique = new Map();

    for (const item of raw) {
      const row = normalizeRow(item);

      /*
       * 没有文本的不参与热点计算。
       */
      if (!row.text.trim()) continue;

      /*
       * 中文比例太低的内容不要。
       */
      if (chineseScore(item) < 0.20) continue;

      const key =
        row.id ||
        row.url ||
        row.text.slice(0, 120);

      if (!unique.has(key)) {
        unique.set(key, row);
      }
    }

    const rows = [...unique.values()]
      .sort((a, b) => b.score - a.score);

    const topics = buildTopics(rows);

    /*
     * 如果本次扫描和上次扫描都有数据，
     * 根据排名变化给出简单“起飞状态”。
     */
    const previousTopics =
      lastScan?.topics || [];

    const previousMap = new Map(
      previousTopics.map((x, index) => [
        x.name,
        {
          heat: x.heat,
          rank: index + 1
        }
      ])
    );

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];

      const old = previousMap.get(topic.name);

      if (!old) {
        topic.momentum = "🆕 新出现";
      } else {
        const heatChange =
          topic.heat - old.heat;

        const rankChange =
          old.rank - (i + 1);

        if (heatChange >= 8 || rankChange >= 5) {
          topic.momentum = "🚀 起飞";
        } else if (
          heatChange >= 3 ||
          rankChange >= 2
        ) {
          topic.momentum = "📈 上升";
        } else if (heatChange <= -8) {
          topic.momentum = "📉 回落";
        } else {
          topic.momentum = "➡️ 稳定";
        }
      }
    }

    lastScan = {
      time: new Date().toISOString(),
      posts: rows.length,
      topics
    };

    return {
      ok: true,
      scanTime: lastScan.time,
      source:
        "X 公开中文内容搜索 + 热度算法",
      posts: rows.length,
      topics
    };
  } finally {
    scanning = false;
  }
}

function renderPage() {
  return `
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta
  name="viewport"
  content="width=device-width,initial-scale=1,maximum-scale=1"
/>
<title>X中文热点雷达</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background:
    radial-gradient(
      circle at top,
      #172033 0,
      #090c12 45%,
      #05070b 100%
    );
  color: #f5f7fb;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {
  max-width: 680px;
  margin: auto;
  padding: 18px 14px 50px;
}

.header {
  padding: 20px 4px 14px;
}

.title {
  font-size: 27px;
  font-weight: 800;
}

.subtitle {
  margin-top: 6px;
  color: #9299a8;
  font-size: 13px;
}

button {
  width: 100%;
  border: 0;
  border-radius: 16px;
  padding: 15px;
  font-size: 17px;
  font-weight: 800;
  color: white;
  background:
    linear-gradient(
      135deg,
      #ff315c,
      #ff6b35
    );
  box-shadow:
    0 12px 30px rgba(255, 65, 80, .22);
}

button:disabled {
  opacity: .55;
}

.status {
  margin: 14px 2px;
  color: #9ba3b2;
  font-size: 13px;
}

.card {
  margin-top: 12px;
  padding: 16px;
  border: 1px solid #1d2430;
  border-radius: 18px;
  background: rgba(16, 20, 28, .92);
  box-shadow:
    0 10px 35px rgba(0,0,0,.22);
}

.rank {
  display: flex;
  align-items: center;
  gap: 10px;
}

.number {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #202735;
  font-weight: 800;
}

.topic {
  flex: 1;
  min-width: 0;
  font-size: 18px;
  font-weight: 800;
  word-break: break-all;
}

.heat {
  font-size: 20px;
  font-weight: 900;
}

.level {
  margin-top: 7px;
  color: #ffb15c;
  font-size: 12px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
  margin-top: 14px;
}

.metric {
  padding: 9px 5px;
  text-align: center;
  border-radius: 10px;
  background: #111620;
}

.metric b {
  display: block;
  font-size: 14px;
}

.metric span {
  display: block;
  margin-top: 3px;
  color: #7e8797;
  font-size: 10px;
}

.momentum {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 9px;
  background: #171d28;
  color: #dce2ec;
  font-size: 12px;
}

.examples {
  margin-top: 12px;
}

.example {
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  background: #0d1118;
  color: #aeb6c4;
  font-size: 12px;
  line-height: 1.5;
}

.example a {
  color: #ff6f91;
  text-decoration: none;
}

.empty {
  text-align: center;
  padding: 45px 20px;
  color: #777f8e;
}

.error {
  padding: 13px;
  border-radius: 12px;
  background: #32151b;
  color: #ff9aa9;
  font-size: 13px;
  line-height: 1.5;
}
</style>
</head>

<body>

<div class="container">

  <div class="header">
    <div class="title">🚀 X中文热点雷达</div>
    <div class="subtitle">
      真实 X 中文公开内容 · 热度算法 · 起飞检测
    </div>
  </div>

  <button id="scanBtn" onclick="scan()">
    🔥 立即扫描热点
  </button>

  <div id="status" class="status">
    点击按钮开始扫描
  </div>

  <div id="results"></div>

</div>

<script>
async function scan() {
  const btn = document.getElementById("scanBtn");
  const status = document.getElementById("status");
  const results = document.getElementById("results");

  btn.disabled = true;
  btn.innerText = "⏳ 正在扫描...";
  status.innerText =
    "正在获取 X 中文公开内容并计算热点...";

  results.innerHTML = "";

  try {
    const response = await fetch(
      "/api/scan?t=" + Date.now()
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error || "扫描失败"
      );
    }

    status.innerText =
      "扫描完成 · 获取 " +
      data.posts +
      " 条中文内容 · 发现 " +
      data.topics.length +
      " 个热点";

    if (!data.topics.length) {
      results.innerHTML =
        '<div class="empty">' +
        "暂时没有发现足够的中文热点<br><br>" +
        "可能是 X 搜索暂时没有返回数据" +
        "</div>";

      return;
    }

    results.innerHTML =
      data.topics.map(function(topic, index) {

        const examples =
          (topic.examples || [])
            .map(function(item) {
              const txt =
                String(item.text || "")
                  .slice(0, 160);

              const author =
                item.author
                  ? " @" + item.author
                  : "";

              const link =
                item.url
                  ? '<br><a href="' +
                    item.url +
                    '" target="_blank">' +
                    "查看原帖 ↗" +
                    "</a>"
                  : "";

              return (
                '<div class="example">' +
                escapeHtml(txt) +
                escapeHtml(author) +
                link +
                "</div>"
              );
            })
            .join("");

        return (
          '<div class="card">' +

            '<div class="rank">' +

              '<div class="number">' +
              (index + 1) +
              "</div>" +

              '<div class="topic">' +
              escapeHtml(topic.name) +
              "</div>" +

              '<div class="heat">' +
              topic.heat +
              "</div>" +

            "</div>" +

            '<div class="level">' +
            escapeHtml(topic.level) +
            "</div>" +

            '<div class="metrics">' +

              '<div class="metric">' +
                "<b>" +
                topic.posts +
                "</b>" +
                "<span>帖子</span>" +
              "</div>" +

              '<div class="metric">' +
                "<b>" +
                topic.authors +
                "</b>" +
                "<span>作者</span>" +
              "</div>" +

              '<div class="metric">' +
                "<b>" +
                formatNumber(topic.engagement) +
                "</b>" +
                "<span>互动</span>" +
              "</div>" +

              '<div class="metric">' +
                "<b>" +
                formatNumber(topic.views) +
                "</b>" +
                "<span>浏览</span>" +
              "</div>" +

            "</div>" +

            '<div class="momentum">' +
            escapeHtml(
              topic.momentum || "➡️ 稳定"
            ) +
            "</div>" +

            (
              examples
                ? '<div class="examples">' +
                  examples +
                  "</div>"
                : ""
            ) +

          "</div>"
        );

      }).join("");

  } catch (error) {

    status.innerText = "扫描失败";

    results.innerHTML =
      '<div class="error">' +
      "❌ " +
      escapeHtml(error.message) +
      "<br><br>" +
      "如果这里出现 Apify 额度或权限错误，把这个页面截图发给我，我直接判断是哪一步。" +
      "</div>";

  } finally {
    btn.disabled = false;
    btn.innerText = "🔥 立即扫描热点";
  }
}

function formatNumber(value) {
  const n = Number(value || 0);

  if (n >= 1000000) {
    return (n / 1000000).toFixed(1) + "M";
  }

  if (n >= 10000) {
    return (n / 10000).toFixed(1) + "万";
  }

  if (n >= 1000) {
    return (n / 1000).toFixed(1) + "K";
  }

  return String(Math.round(n));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
</script>

</body>
</html>
`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url,
      "http://" + (req.headers.host || "localhost")
    );

    if (url.pathname === "/") {
      html(res, renderPage());
      return;
    }

    if (url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        service: "x-hot-radar-new",
        actor: ACTOR_ID,
        hasToken: Boolean(APIFY_TOKEN),
        time: new Date().toISOString()
      });
      return;
    }

    if (url.pathname === "/api/scan") {
      try {
        const data = await scan();
        json(res, 200, data);
      } catch (error) {
        console.error("SCAN ERROR:", error);

        json(res, 500, {
          ok: false,
          error: error.message
        });
      }

      return;
    }

    json(res, 404, {
      ok: false,
      error: "Not Found"
    });

  } catch (error) {
    console.error(error);

    json(res, 500, {
      ok: false,
      error: error.message
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "X中文热点雷达 running on port " + PORT
  );
});