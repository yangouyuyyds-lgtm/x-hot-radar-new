const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "atomus~twitter-scraper";

// =========================
// 内存历史
// =========================

let previousTopics = new Map();
let lastScanTime = null;

// =========================
// HTTP 工具
// =========================

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

// =========================
// Apify
// =========================

function callApify(input) {
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
                  data.slice(0, 1000)
              )
            );
            return;
          }

          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(
              new Error(
                "Apify 返回的数据无法解析：" +
                  data.slice(0, 500)
              )
            );
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Apify 请求超过 90 秒"));
    });

    req.on("error", (err) => {
      reject(new Error("连接 Apify 失败：" + err.message));
    });

    req.write(body);
    req.end();
  });
}

// =========================
// 数字处理
// =========================

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getEngagement(tweet) {
  const likes = num(tweet.favorite_count);
  const retweets = num(tweet.retweet_count);
  const replies = num(tweet.reply_count);
  const quotes = num(tweet.quote_count);
  const bookmarks = num(tweet.bookmark_count);
  const views = num(tweet.view_count);

  /*
   * 不直接把浏览量原样加入。
   * 否则一个大号几十万浏览会完全碾压其他内容。
   */

  const viewScore =
    views > 0
      ? Math.log10(views + 1) * 8
      : 0;

  return (
    likes +
    retweets * 3 +
    replies * 2 +
    quotes * 3 +
    bookmarks * 1.5 +
    viewScore
  );
}

// =========================
// 作者
// =========================

function getAuthor(tweet) {
  if (tweet.author) {
    return (
      tweet.author.screen_name ||
      tweet.author.username ||
      tweet.author.name ||
      ""
    );
  }

  return (
    tweet.username ||
    tweet.author_username ||
    ""
  );
}

// =========================
// 文本
// =========================

function getText(tweet) {
  return String(
    tweet.text ||
    tweet.full_text ||
    tweet.content ||
    ""
  ).trim();
}

// =========================
// 中文判断
// =========================

function isChineseTweet(tweet) {
  const text = getText(tweet);

  if (!text) {
    return false;
  }

  const chinese =
    (text.match(/[\u4e00-\u9fff]/g) || []).length;

  const letters =
    (text.match(/[A-Za-z]/g) || []).length;

  return chinese >= 2 && chinese >= letters;
}

// =========================
// Hashtag 提取
// =========================

function getHashtags(tweet) {
  let tags = [];

  if (Array.isArray(tweet.hashtags)) {
    tags = tweet.hashtags
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object") {
          return (
            item.text ||
            item.tag ||
            item.hashtag ||
            ""
          );
        }

        return "";
      })
      .filter(Boolean);
  }

  /*
   * 如果 Actor 没有返回 hashtags，
   * 从正文重新提取。
   */

  if (tags.length === 0) {
    const matches =
      getText(tweet).match(
        /#[\w\u4e00-\u9fff]+/g
      ) || [];

    tags = matches.map((x) =>
      x.replace(/^#/, "")
    );
  }

  return [...new Set(
    tags
      .map((x) =>
        String(x)
          .trim()
          .replace(/^#/, "")
      )
      .filter((x) => x.length >= 2)
  )];
}

// =========================
// 生成话题
// =========================

function normalizeTopic(tag) {
  let t = String(tag || "").trim();

  if (!t) {
    return "";
  }

  if (!t.startsWith("#")) {
    t = "#" + t;
  }

  return t;
}

// =========================
// 查询
// =========================

const SEARCHES = [
  "lang:zh",
  "lang:zh min_faves:20",
  "lang:zh min_retweets:5",
  "lang:zh #美女",
  "lang:zh #穿搭",
  "lang:zh #娱乐",
  "lang:zh #明星",
  "lang:zh #情感",
  "lang:zh #AI",
  "lang:zh #科技"
];

// =========================
// 扫描
// =========================

async function collectTweets() {
  const jobs = SEARCHES.map(async (query) => {
    try {
      const rows = await callApify({
        searchType: "search",
        searchQuery: query,

        // 这次用 Top
        // 不只是抓最新，而是优先拿互动高的内容
        sortOrder: "Top",

        language: "zh",

        maxItems: 40,

        excludeRetweets: true
      });

      if (!Array.isArray(rows)) {
        return [];
      }

      return rows;
    } catch (err) {
      console.log(
        "查询失败:",
        query,
        err.message
      );

      return [];
    }
  });

  const results = await Promise.all(jobs);

  const map = new Map();

  for (const list of results) {
    for (const tweet of list) {
      const id =
        tweet.tweet_id ||
        tweet.id ||
        tweet.url ||
        getText(tweet);

      if (!id) {
        continue;
      }

      if (!map.has(id)) {
        map.set(id, tweet);
      }
    }
  }

  return [...map.values()];
}

// =========================
// 计算热点
// =========================

function calculateTopics(tweets) {
  const topics = new Map();

  for (const tweet of tweets) {
    if (!isChineseTweet(tweet)) {
      continue;
    }

    const tags = getHashtags(tweet);

    if (tags.length === 0) {
      continue;
    }

    const engagement =
      getEngagement(tweet);

    const author =
      getAuthor(tweet);

    const tweetId =
      tweet.tweet_id ||
      tweet.id ||
      tweet.url ||
      "";

    /*
     * 一条推文里面出现多个 hashtag，
     * 不让它们全部拿满分。
     */

    const perTopicWeight =
      1 / Math.sqrt(tags.length);

    for (const rawTag of tags) {
      const topic =
        normalizeTopic(rawTag);

      if (!topic) {
        continue;
      }

      if (!topics.has(topic)) {
        topics.set(topic, {
          topic,
          posts: new Set(),
          authors: new Set(),
          engagement: 0,
          likes: 0,
          retweets: 0,
          replies: 0,
          quotes: 0,
          views: 0
        });
      }

      const item = topics.get(topic);

      if (tweetId) {
        item.posts.add(tweetId);
      }

      if (author) {
        item.authors.add(author);
      }

      item.engagement +=
        engagement * perTopicWeight;

      item.likes +=
        num(tweet.favorite_count) *
        perTopicWeight;

      item.retweets +=
        num(tweet.retweet_count) *
        perTopicWeight;

      item.replies +=
        num(tweet.reply_count) *
        perTopicWeight;

      item.quotes +=
        num(tweet.quote_count) *
        perTopicWeight;

      item.views +=
        num(tweet.view_count) *
        perTopicWeight;
    }
  }

  const output = [];

  for (const item of topics.values()) {
    const posts = item.posts.size;
    const authors = item.authors.size;

    if (posts === 0) {
      continue;
    }

    /*
     * 基础热度：
     *
     * 内容数量
     * +
     * 不同作者数量
     * +
     * 真实互动
     */

    const base =
      Math.log10(
        item.engagement + 1
      ) * 14;

    const postScore =
      Math.log10(posts + 1) * 15;

    const authorScore =
      Math.log10(authors + 1) * 12;

    /*
     * 作者多，说明不是一个人刷屏。
     */

    const diversityBonus =
      Math.min(
        20,
        authors * 2
      );

    let heat =
      base +
      postScore +
      authorScore +
      diversityBonus;

    /*
     * 最高 99
     */

    heat = Math.max(
      1,
      Math.min(
        99,
        Math.round(heat)
      )
    );

    output.push({
      topic: item.topic,
      heat,
      posts,
      authors,
      engagement: Math.round(
        item.engagement
      ),
      likes: Math.round(item.likes),
      retweets: Math.round(item.retweets),
      replies: Math.round(item.replies),
      quotes: Math.round(item.quotes),
      views: Math.round(item.views)
    });
  }

  return output;
}

// =========================
// 计算起飞速度
// =========================

function calculateMomentum(topics) {
  return topics.map((item) => {
    const old =
      previousTopics.get(item.topic);

    let change = 0;

    if (old) {
      change =
        item.heat -
        old.heat;
    }

    let label = "新出现";

    if (old) {
      if (change >= 15) {
        label = "🚀 暴涨";
      } else if (change >= 8) {
        label = "🔥 上升";
      } else if (change >= 3) {
        label = "📈 微涨";
      } else if (change <= -8) {
        label = "📉 下降";
      } else {
        label = "稳定";
      }
    }

    return {
      ...item,
      change,
      momentum: label
    };
  });
}

// =========================
// 扫描接口
// =========================

async function scan() {
  console.log("开始扫描...");

  const tweets =
    await collectTweets();

  console.log(
    "抓到推文:",
    tweets.length
  );

  const topics =
    calculateTopics(tweets);

  const ranked =
    calculateMomentum(topics)
      .sort((a, b) => {
        /*
         * 先看起飞变化，
         * 再看当前热度。
         */

        if (
          b.change !== a.change
        ) {
          return (
            b.change -
            a.change
          );
        }

        return (
          b.heat -
          a.heat
        );
      })
      .slice(0, 30);

  /*
   * 保存本次结果
   */

  previousTopics =
    new Map(
      ranked.map((item) => [
        item.topic,
        item
      ])
    );

  lastScanTime =
    new Date().toISOString();

  return {
    success: true,

    scannedPosts:
      tweets.filter(
        isChineseTweet
      ).length,

    totalTweets:
      tweets.length,

    topics: ranked,

    scannedAt:
      lastScanTime
  };
}

// =========================
// HTML
// =========================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function html() {
  return `<!DOCTYPE html>
<html lang="zh-CN">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1,maximum-scale=1"
/>

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
  border: 1px solid #292929;
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 14px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rank {
  font-size: 22px;
  color: #777;
  width: 32px;
}

.topic {
  font-size: 22px;
  font-weight: 800;
  flex: 1;
  word-break: break-all;
}

.heat {
  font-size: 22px;
  font-weight: 900;
  color: #ff4d67;
}

.momentum {
  margin-top: 12px;
  font-size: 17px;
  font-weight: 700;
}

.up {
  color: #ff4d67;
}

.new {
  color: #ff9d3d;
}

.stable {
  color: #888;
}

.meta {
  color: #777;
  font-size: 14px;
  line-height: 1.7;
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

  <div class="title">
    🚀 X热点起飞雷达
  </div>

  <div class="subtitle">
    中文 X 热点实时聚合
  </div>

  <button
    class="scan"
    id="scanBtn"
  >
    🔥 立即扫描热点
  </button>

  <div
    class="status"
    id="status"
  >
    等待扫描
  </div>

  <div id="result"></div>

</div>

<script>

const btn =
  document.getElementById(
    "scanBtn"
  );

const status =
  document.getElementById(
    "status"
  );

const result =
  document.getElementById(
    "result"
  );

btn.addEventListener(
  "click",
  async function () {

    btn.disabled = true;

    btn.style.opacity = "0.6";

    status.innerText =
      "🔥 正在扫描中文 X 热点……";

    result.innerHTML = "";

    try {

      const response =
        await fetch(
          "/api/scan?time=" +
          Date.now(),
          {
            cache: "no-store"
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
          "扫描失败"
        );
      }

      status.innerText =
        "扫描完成 · 获取 " +
        data.scannedPosts +
        " 条中文内容";

      if (
        !data.topics ||
        data.topics.length === 0
      ) {

        result.innerHTML =
          '<div class="empty">' +
          '暂时没有发现足够的中文热点。' +
          '</div>';

        return;
      }

      result.innerHTML =
        data.topics
          .map(
            function(item, index) {

              let cls =
                "stable";

              if (
                item.momentum
                  .includes("暴涨") ||
                item.momentum
                  .includes("上升")
              ) {
                cls = "up";
              }

              if (
                item.momentum
                  .includes("新出现")
              ) {
                cls = "new";
              }

              const changeText =
                item.change > 0
                  ? "+" + item.change
                  : item.change;

              return (

                '<div class="card">' +

                  '<div class="row">' +

                    '<div class="rank">' +
                      (index + 1) +
                    '</div>' +

                    '<div class="topic">' +
                      escapeHtml(
                        item.topic
                      ) +
                    '</div>' +

                    '<div class="heat">' +
                      item.heat +
                    '</div>' +

                  '</div>' +

                  '<div class="momentum ' +
                    cls +
                  '">' +

                    escapeHtml(
                      item.momentum
                    ) +

                    " " +

                    "(" +
                    changeText +
                    ")" +

                  '</div>' +

                  '<div class="meta">' +

                    "内容 " +
                    item.posts +

                    " · 作者 " +
                    item.authors +

                    " · 点赞 " +
                    formatNumber(
                      item.likes
                    ) +

                    " · 转发 " +
                    formatNumber(
                      item.retweets
                    ) +

                    " · 评论 " +
                    formatNumber(
                      item.replies
                    ) +

                    " · 浏览 " +
                    formatNumber(
                      item.views
                    ) +

                  '</div>' +

                '</div>'

              );

            }
          )
          .join("");

    } catch (err) {

      status.innerText =
        "❌ 扫描失败";

      result.innerHTML =
        '<div class="error">' +
        escapeHtml(
          err.message ||
          String(err)
        ) +
        '</div>';

    } finally {

      btn.disabled = false;

      btn.style.opacity = "1";

    }

  }
);

function formatNumber(n) {

  n = Number(n) || 0;

  if (n >= 1000000) {
    return (
      (n / 1000000)
        .toFixed(1)
        .replace(".0", "") +
      "M"
    );
  }

  if (n >= 1000) {
    return (
      (n / 1000)
        .toFixed(1)
        .replace(".0", "") +
      "K"
    );
  }

  return String(
    Math.round(n)
  );
}

function escapeHtml(str) {

  return String(str)
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
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

</script>

</body>

</html>`;
}

// =========================
// Server
// =========================

const server =
  http.createServer(
    async (req, res) => {

      const url =
        new URL(
          req.url,
          "http://" +
          (
            req.headers.host ||
            "localhost"
          )
        );

      console.log(
        new Date().toISOString(),
        req.method,
        url.pathname
      );

      // 首页
      if (
        url.pathname === "/"
      ) {

        send(
          res,
          200,
          html(),
          "text/html"
        );

        return;
      }

      // 健康检查
      if (
        url.pathname === "/health"
      ) {

        send(
          res,
          200,
          {
            ok: true,
            apifyToken:
              Boolean(
                APIFY_TOKEN
              ),
            actor:
              ACTOR_ID,
            lastScan:
              lastScanTime
          }
        );

        return;
      }

      // 扫描
      if (
        url.pathname === "/api/scan"
      ) {

        try {

          const data =
            await scan();

          send(
            res,
            200,
            data
          );

        } catch (err) {

          console.error(
            "SCAN ERROR:",
            err
          );

          send(
            res,
            500,
            {
              success: false,
              error:
                err.message ||
                "未知错误"
            }
          );
        }

        return;
      }

      send(
        res,
        404,
        {
          success: false,
          error: "Not Found"
        }
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "🚀 X热点起飞雷达启动成功"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "APIFY_TOKEN:",
      APIFY_TOKEN
        ? "已设置"
        : "未设置"
    );

    console.log(
      "ACTOR:",
      ACTOR_ID
    );

    console.log(
      "================================"
    );

  }
);