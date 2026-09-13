const http = require("http");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "atomus~twitter-scraper";

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store"
  });

  if (type === "application/json") {
    res.end(JSON.stringify(data));
  } else {
    res.end(data);
  }
}

function callApify(input) {
  return new Promise((resolve, reject) => {
    if (!APIFY_TOKEN) {
      return reject(new Error("Render 没有找到 APIFY_TOKEN"));
    }

    const url =
      "https://api.apify.com/v2/acts/" +
      ACTOR_ID +
      "/run-sync-get-dataset-items?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const body = JSON.stringify(input);

    const req = require("https").request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 90000
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                "Apify HTTP " +
                  res.statusCode +
                  "：" +
                  data.slice(0, 800)
              )
            );
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(
              new Error(
                "Apify 返回的数据不是 JSON：" +
                  data.slice(0, 500)
              )
            );
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Apify 请求超过 90 秒，可能正在忙"));
    });

    req.on("error", (err) => {
      reject(new Error("连接 Apify 失败：" + err.message));
    });

    req.write(body);
    req.end();
  });
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isChinese(text) {
  const s = cleanText(text);

  if (!s) return false;

  const chinese = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;

  return chinese >= 2 && chinese >= latin;
}

function extractHashtags(text) {
  const matches = String(text || "").match(/#[\w\u4e00-\u9fff]+/g) || [];

  return matches
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
    .slice(0, 10);
}

function getNumber(obj, keys) {
  for (const key of keys) {
    const n = Number(obj && obj[key]);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

async function scanChina() {
  const queries = [
    "lang:zh",
    "lang:zh #美女",
    "lang:zh #穿搭",
    "lang:zh #娱乐",
    "lang:zh #明星",
    "lang:zh #科技",
    "lang:zh #AI"
  ];

  const all = [];

  for (const query of queries) {
    try {
      const rows = await callApify({
        searchType: "search",
        searchQuery: query,
        sortOrder: "Latest",
        language: "zh",
        maxItems: 30,
        excludeRetweets: true
      });

      if (Array.isArray(rows)) {
        all.push(...rows);
      }
    } catch (err) {
      console.log("查询失败:", query, err.message);
    }
  }

  const chinesePosts = all.filter((item) => {
    const text =
      item.text ||
      item.full_text ||
      item.content ||
      "";

    return isChinese(text);
  });

  const topics = {};

  for (const item of chinesePosts) {
    const text =
      item.text ||
      item.full_text ||
      item.content ||
      "";

    const hashtags = extractHashtags(text);

    const likes = getNumber(item, [
      "favorite_count",
      "like_count",
      "likes"
    ]);

    const reposts = getNumber(item, [
      "retweet_count",
      "reposts",
      "repost_count"
    ]);

    const replies = getNumber(item, [
      "reply_count",
      "replies"
    ]);

    const views = getNumber(item, [
      "view_count",
      "views"
    ]);

    const engagement =
      likes +
      reposts * 3 +
      replies * 2 +
      Math.min(views / 100, 5000);

    for (const tag of hashtags) {
      if (!topics[tag]) {
        topics[tag] = {
          topic: tag,
          posts: 0,
          engagement: 0,
          authors: new Set()
        };
      }

      topics[tag].posts += 1;
      topics[tag].engagement += engagement;

      const author =
        item.author?.username ||
        item.username ||
        item.author_username ||
        "";

      if (author) {
        topics[tag].authors.add(author);
      }
    }
  }

  const result = Object.values(topics)
    .map((item) => {
      const authors = item.authors.size;

      const score = Math.min(
        99,
        Math.round(
          item.posts * 8 +
          Math.log10(item.engagement + 1) * 15 +
          authors * 2
        )
      );

      return {
        topic: item.topic,
        score,
        posts: item.posts,
        authors,
        engagement: Math.round(item.engagement)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  return {
    success: true,
    scannedPosts: chinesePosts.length,
    topics: result,
    scannedAt: new Date().toISOString()
  };
}

function html() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>X热点起飞雷达</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #050505;
  color: white;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "PingFang SC",
    "Helvetica Neue",
    Arial,
    sans-serif;
}

.page {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 45px 22px 80px;
}

.title {
  font-size: 42px;
  font-weight: 800;
  margin-bottom: 10px;
}

.subtitle {
  color: #777;
  font-size: 24px;
  margin-bottom: 42px;
}

.scan {
  width: 100%;
  height: 105px;
  border: 0;
  border-radius: 25px;
  background: #f1f1f1;
  color: #1683f8;
  font-size: 29px;
  font-weight: 800;
  cursor: pointer;
}

.scan:active {
  transform: scale(.98);
}

.status {
  color: #888;
  font-size: 22px;
  margin: 32px 0 20px;
}

.card {
  background: #151515;
  border: 1px solid #252525;
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 14px;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.rank {
  font-size: 22px;
  color: #777;
  width: 32px;
}

.topic {
  font-size: 22px;
  font-weight: 700;
  flex: 1;
  word-break: break-all;
}

.score {
  font-size: 22px;
  font-weight: 800;
  color: #ff4d67;
}

.meta {
  color: #777;
  font-size: 15px;
  margin-top: 10px;
}

.error {
  background: #241010;
  border: 1px solid #632020;
  color: #ff8d8d;
  border-radius: 18px;
  padding: 18px;
  line-height: 1.6;
  word-break: break-word;
}

.empty {
  color: #777;
  padding: 20px 0;
  font-size: 18px;
}
</style>
</head>

<body>

<div class="page">

  <div class="title">🚀 X热点起飞雷达</div>

  <div class="subtitle">
    中文 X 热点实时聚合
  </div>

  <button class="scan" id="scanBtn">
    🔥 立即扫描热点
  </button>

  <div class="status" id="status">
    等待扫描
  </div>

  <div id="result"></div>

</div>

<script>
const btn = document.getElementById("scanBtn");
const status = document.getElementById("status");
const result = document.getElementById("result");

btn.addEventListener("click", async function () {

  btn.disabled = true;
  btn.style.opacity = "0.6";

  status.innerText = "🔥 正在扫描 X 中文热点，请稍等……";
  result.innerHTML = "";

  try {

    const response = await fetch("/api/scan", {
      method: "GET",
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "扫描失败");
    }

    status.innerText =
      "扫描完成 · 获取 " +
      data.scannedPosts +
      " 条中文内容";

    if (!data.topics || data.topics.length === 0) {
      result.innerHTML =
        '<div class="empty">暂时没有抓到足够的中文热点。再扫描一次试试。</div>';
      return;
    }

    result.innerHTML = data.topics.map(function(item, index) {

      return (
        '<div class="card">' +
          '<div class="row">' +
            '<div class="rank">' +
              (index + 1) +
            '</div>' +

            '<div class="topic">' +
              escapeHtml(item.topic) +
            '</div>' +

            '<div class="score">' +
              item.score +
            '</div>' +
          '</div>' +

          '<div class="meta">' +
            "内容 " + item.posts +
            " · 作者 " + item.authors +
            " · 热度 " + item.engagement +
          '</div>' +
        '</div>'
      );

    }).join("");

  } catch (err) {

    status.innerText = "❌ 扫描失败";

    result.innerHTML =
      '<div class="error">' +
      escapeHtml(err.message || String(err)) +
      '</div>';

  } finally {

    btn.disabled = false;
    btn.style.opacity = "1";

  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
</script>

</body>
</html>`;
}

const server = http.createServer(async (req, res) => {

  const url = new URL(
    req.url,
    "http://" + (req.headers.host || "localhost")
  );

  console.log(new Date().toISOString(), req.method, url.pathname);

  if (url.pathname === "/") {
    send(res, 200, html(), "text/html");
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      apifyToken: Boolean(APIFY_TOKEN),
      actor: ACTOR_ID
    });
    return;
  }

  if (url.pathname === "/api/scan") {

    try {
      const data = await scanChina();

      send(res, 200, data);
    } catch (err) {

      console.error("SCAN ERROR:", err);

      send(res, 500, {
        success: false,
        error: err.message || "未知错误"
      });
    }

    return;
  }

  send(res, 404, {
    success: false,
    error: "Not Found"
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("X热点起飞雷达启动成功");
  console.log("PORT:", PORT);
  console.log("APIFY_TOKEN:", APIFY_TOKEN ? "已设置" : "未设置");
  console.log("ACTOR:", ACTOR_ID);
});