const http = require("http");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR_ID = "atomus~twitter-scraper";

// =========================
// 基础配置
// =========================

const CHINESE_QUERIES = [
  "中国",
  "中文",
  "美女",
  "穿搭",
  "娱乐",
  "明星",
  "电影",
  "音乐",
  "游戏",
  "科技",
  "AI",
  "体育",
  "足球",
  "NBA",
  "美食",
  "旅行",
  "深圳",
  "上海",
  "北京",
  "香港"
];

const MAX_ITEMS_PER_QUERY = 20;

// 内存历史
// 用来比较本次扫描和上一次扫描
let previousSnapshot = new Map();
let lastScanTime = null;


// =========================
// 调用 Apify
// =========================

async function callApify(input) {
  if (!APIFY_TOKEN) {
    throw new Error("服务器没有配置 APIFY_TOKEN");
  }

  const url =
    `https://api.apify.com/v2/acts/${ACTOR_ID}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(APIFY_TOKEN)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Apify HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Apify 返回的数据不是有效 JSON");
  }
}


// =========================
// 中文判断
// =========================

function hasChinese(text) {
  if (!text) return false;

  return /[\u3400-\u9fff]/.test(text);
}


// =========================
// 提取话题
// =========================

function extractTopics(tweet) {
  const topics = [];

  // X 原始 hashtag
  if (Array.isArray(tweet.hashtags)) {
    for (const h of tweet.hashtags) {
      let tag = "";

      if (typeof h === "string") {
        tag = h;
      } else if (h && typeof h === "object") {
        tag = h.text || h.tag || "";
      }

      tag = String(tag).trim();

      if (tag) {
        topics.push("#" + tag.replace(/^#/, ""));
      }
    }
  }

  // 从正文提取中文 hashtag
  const text = tweet.text || "";

  const hashtagMatches = text.match(
    /#[\u3400-\u9fffA-Za-z0-9_]+/g
  ) || [];

  for (const tag of hashtagMatches) {
    topics.push(tag);
  }

  // 如果没有 hashtag，则提取一些较明显的中文短语
  if (topics.length === 0 && hasChinese(text)) {
    const cleaned = text
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // 提取 2~12 个字的连续中文片段
    const matches =
      cleaned.match(/[\u3400-\u9fff]{2,12}/g) || [];

    for (const item of matches.slice(0, 3)) {
      topics.push(item);
    }
  }

  return [...new Set(topics)];
}


// =========================
// 计算单条推文热度
// =========================

function tweetEngagement(tweet) {
  const likes = Number(tweet.favorite_count || 0);
  const retweets = Number(tweet.retweet_count || 0);
  const replies = Number(tweet.reply_count || 0);
  const quotes = Number(tweet.quote_count || 0);
  const views = Number(tweet.view_count || 0);

  // 第一版简单权重
  return (
    likes * 1 +
    retweets * 3 +
    replies * 2 +
    quotes * 3 +
    Math.sqrt(Math.max(views, 0)) * 0.5
  );
}


// =========================
// 计算新鲜度
// =========================

function freshness(createdAt) {
  if (!createdAt) return 0.5;

  const time = new Date(createdAt).getTime();

  if (!Number.isFinite(time)) {
    return 0.5;
  }

  const ageHours =
    Math.max(0, Date.now() - time) / 3600000;

  // 越新越高
  if (ageHours <= 1) return 1.0;
  if (ageHours <= 3) return 0.9;
  if (ageHours <= 6) return 0.8;
  if (ageHours <= 12) return 0.65;
  if (ageHours <= 24) return 0.5;
  if (ageHours <= 48) return 0.3;

  return 0.15;
}


// =========================
// 聚合热点
// =========================

function buildTopics(tweets) {
  const map = new Map();

  for (const tweet of tweets) {
    // 必须有中文
    const text = tweet.text || "";

    if (!hasChinese(text)) {
      continue;
    }

    // 排除明显错误记录
    if (tweet._error) {
      continue;
    }

    const topics = extractTopics(tweet);

    if (!topics.length) {
      continue;
    }

    const engagement = tweetEngagement(tweet);
    const fresh = freshness(tweet.created_at);

    for (const topic of topics) {
      if (!hasChinese(topic)) {
        continue;
      }

      const key = topic.toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          name: topic,
          posts: 0,
          engagement: 0,
          recentPosts: 0,
          authors: new Set(),
          examples: []
        });
      }

      const item = map.get(key);

      item.posts += 1;
      item.engagement += engagement;

      if (fresh >= 0.8) {
        item.recentPosts += 1;
      }

      if (tweet.author?.screen_name) {
        item.authors.add(tweet.author.screen_name);
      }

      if (item.examples.length < 3) {
        item.examples.push({
          text: text.slice(0, 160),
          url: tweet.url || "",
          author:
            tweet.author?.screen_name || ""
        });
      }
    }
  }

  const topics = [];

  for (const item of map.values()) {
    const authorCount = item.authors.size;

    // 基础热度
    const engagementScore =
      Math.log10(item.engagement + 10) * 20;

    // 讨论数量
    const postScore =
      Math.log10(item.posts + 1) * 15;

    // 新鲜度
    const freshScore =
      item.recentPosts * 4;

    // 作者扩散
    const authorScore =
      Math.log10(authorCount + 1) * 10;

    let score =
      engagementScore +
      postScore +
      freshScore +
      authorScore;

    score = Math.min(100, Math.round(score));

    topics.push({
      name: item.name,
      score,
      posts: item.posts,
      recentPosts: item.recentPosts,
      authors: authorCount,
      examples: item.examples
    });
  }

  return topics
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);
}


// =========================
// 计算“起飞指数”
// =========================

function calculateFlightScore(topic) {
  const old = previousSnapshot.get(topic.name);

  // 第一次扫描
  if (!old) {
    return Math.min(
      100,
      Math.round(topic.score * 0.75 + 10)
    );
  }

  const scoreChange =
    topic.score - old.score;

  const postChange =
    topic.posts - old.posts;

  // 越短时间增长越明显
  let flight =
    topic.score * 0.55 +
    Math.max(scoreChange, 0) * 2.5 +
    Math.max(postChange, 0) * 3;

  flight = Math.min(100, Math.round(flight));

  return flight;
}


// =========================
// 保存快照
// =========================

function saveSnapshot(topics) {
  previousSnapshot = new Map(
    topics.map(item => [
      item.name,
      {
        score: item.score,
        posts: item.posts
      }
    ])
  );

  lastScanTime = new Date().toISOString();
}


// =========================
// 扫描中文热点
// =========================

async function scanChineseTrends() {
  const allTweets = [];

  // 分批请求，避免一次过大
  for (const query of CHINESE_QUERIES) {
    try {
      const input = {
        searchType: "search",

        searchQuery: query,

        sortOrder: "Latest",

        language: "zh",

        maxItems: MAX_ITEMS_PER_QUERY,

        excludeRetweets: true,

        excludeReplies: false
      };

      const result = await callApify(input);

      if (Array.isArray(result)) {
        allTweets.push(...result);
      }

    } catch (error) {
      console.error(
        `查询 ${query} 失败:`,
        error.message
      );
    }
  }

  if (!allTweets.length) {
    throw new Error(
      "没有获取到中文 X 数据，请检查 APIFY_TOKEN 或 Actor 权限"
    );
  }

  const topics = buildTopics(allTweets);

  if (!topics.length) {
    throw new Error(
      "获取到了 X 数据，但没有识别到有效中文热点"
    );
  }

  const result = topics.map((topic, index) => ({
    rank: index + 1,

    name: topic.name,

    score: topic.score,

    flightScore:
      calculateFlightScore(topic),

    posts: topic.posts,

    recentPosts:
      topic.recentPosts,

    authors:
      topic.authors,

    examples:
      topic.examples
  }));

  saveSnapshot(result);

  return {
    success: true,

    region: "中文热点",

    disclaimer:
      "这是基于 X 中文公开内容聚合的热点，不代表 X 官方中国地区趋势榜",

    scannedTweets:
      allTweets.length,

    scanTime:
      lastScanTime,

    data: result
  };
}


// =========================
// HTML
// =========================

function htmlPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
/>

<title>X热点起飞雷达</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #070707;
  color: white;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.container {
  max-width: 700px;
  margin: auto;
  padding: 18px;
}

.header {
  padding: 18px 4px 12px;
}

.title {
  font-size: 27px;
  font-weight: 800;
}

.subtitle {
  color: #999;
  margin-top: 6px;
  font-size: 14px;
}

.tabs {
  display: flex;
  gap: 8px;
  margin: 15px 0;
}

.tab {
  flex: 1;
  border: 1px solid #292929;
  background: #111;
  color: #aaa;
  padding: 10px 4px;
  border-radius: 12px;
  text-align: center;
  font-size: 13px;
}

.tab.active {
  color: white;
  border-color: #555;
  background: #191919;
}

.scan {
  width: 100%;
  border: 0;
  background: white;
  color: black;
  padding: 15px;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  margin-bottom: 15px;
}

.scan:disabled {
  opacity: .5;
}

.status {
  color: #888;
  font-size: 13px;
  margin: 8px 2px 15px;
}

.card {
  background: #111;
  border: 1px solid #252525;
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 10px;
}

.rank {
  color: #777;
  font-size: 12px;
}

.name {
  font-size: 18px;
  font-weight: 750;
  margin: 5px 0 9px;
  word-break: break-word;
}

.meta {
  color: #888;
  font-size: 12px;
}

.score {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.flight {
  font-size: 21px;
  font-weight: 800;
}

.badge {
  background: #191919;
  border-radius: 9px;
  padding: 5px 8px;
  font-size: 12px;
}

.example {
  margin-top: 12px;
  color: #aaa;
  font-size: 12px;
  line-height: 1.5;
}

.example a {
  color: #aaa;
}

.warning {
  color: #777;
  font-size: 11px;
  line-height: 1.5;
  margin: 20px 3px;
}

</style>
</head>

<body>

<div class="container">

  <div class="header">

    <div class="title">
      🚀 X热点起飞雷达
    </div>

    <div class="subtitle">
      中文热点实时聚合 · 起飞指数
    </div>

  </div>

  <div class="tabs">

    <div class="tab active">
      🇨🇳 中文热点
    </div>

    <div class="tab">
      🇺🇸 美国
    </div>

    <div class="tab">
      🇯🇵 日本
    </div>

    <div class="tab">
      🇬🇧 英国
    </div>

  </div>

  <button
    id="scan"
    class="scan"
    onclick="scan()"
  >
    🔥 立即扫描热点
  </button>

  <div
    id="status"
    class="status"
  >
    等待扫描
  </div>

  <div id="list"></div>

  <div class="warning">
    数据源：X 中文公开内容聚合。
    本页面的“中文热点”不等同于 X 官方“中国地区趋势榜”。
    起飞指数为本系统根据公开帖文热度、讨论量、新鲜度及连续扫描变化计算的指标。
  </div>

</div>


<script>

async function scan() {

  const button =
    document.getElementById("scan");

  const status =
    document.getElementById("status");

  const list =
    document.getElementById("list");

  button.disabled = true;

  button.innerText =
    "⏳ 正在扫描 X 中文热点...";

  status.innerText =
    "正在抓取中文公开内容，请稍等";

  list.innerHTML = "";

  try {

    const response =
      await fetch("/api/scan");

    const json =
      await response.json();

    if (!response.ok || !json.success) {
      throw new Error(
        json.error || "扫描失败"
      );
    }

    status.innerText =
      "本次扫描 " +
      json.scannedTweets +
      " 条中文内容 · " +
      new Date(json.scanTime)
        .toLocaleString();

    for (const item of json.data) {

      const card =
        document.createElement("div");

      card.className = "card";

      const example =
        item.examples &&
        item.examples[0];

      card.innerHTML = \`
        <div class="rank">
          #\${item.rank}
        </div>

        <div class="name">
          \${escapeHtml(item.name)}
        </div>

        <div class="meta">
          \${item.posts} 条相关内容
          · \${item.authors} 位作者
        </div>

        <div class="score">

          <div>
            <span class="flight">
              🚀 \${item.flightScore}
            </span>
            <span class="badge">
              起飞指数
            </span>
          </div>

          <div class="meta">
            热度 \${item.score}
          </div>

        </div>

        ${
          example
            ? \`
              <div class="example">
                \${escapeHtml(
                  example.text
                )}

                ${
                  example.url
                    ? \`
                      <br>
                      <a
                        href="\${example.url}"
                        target="_blank"
                      >
                        查看原帖 →
                      </a>
                    \`
                    : ""
                }

              </div>
            \`
            : ""
        }

      \`;

      list.appendChild(card);
    }

  } catch (error) {

    status.innerText =
      "❌ " + error.message;

  } finally {

    button.disabled = false;

    button.innerText =
      "🔥 再次扫描热点";
  }
}


function escapeHtml(text) {

  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

</script>

</body>
</html>
`;
}


// =========================
// HTTP Server
// =========================

const server = http.createServer(
  async (req, res) => {

    try {

      if (req.url === "/") {

        res.writeHead(200, {
          "Content-Type":
            "text/html; charset=utf-8"
        });

        res.end(htmlPage());

        return;
      }


      if (req.url === "/api/scan") {

        const result =
          await scanChineseTrends();

        res.writeHead(200, {
          "Content-Type":
            "application/json; charset=utf-8"
        });

        res.end(
          JSON.stringify(result)
        );

        return;
      }


      res.writeHead(404, {
        "Content-Type":
          "application/json"
      });

      res.end(
        JSON.stringify({
          error: "Not Found"
        })
      );

    } catch (error) {

      console.error(error);

      res.writeHead(500, {
        "Content-Type":
          "application/json; charset=utf-8"
      });

      res.end(
        JSON.stringify({
          success: false,
          error: error.message
        })
      );
    }
  }
);


server.listen(PORT, () => {

  console.log(
    `X热点起飞雷达运行在端口 ${PORT}`
  );

});