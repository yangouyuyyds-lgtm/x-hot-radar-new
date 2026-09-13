const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

const ACTOR_ID = "feedminer~x-tweet-scraper";
const APIFY_TOKEN = process.env.APIFY_TOKEN;

let previousPosts = new Map();

function formatAge(hours) {
  const h = Number(hours) || 0;

  if (h < 1) {
    return `${Math.max(1, Math.round(h * 60))} 分钟前`;
  }

  if (h < 24) {
    return `${Math.round(h)} 小时前`;
  }

  return `${Math.floor(h / 24)} 天前`;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getText(post) {
  return String(
    post.text ||
    post.fullText ||
    post.full_text ||
    post.content ||
    ""
  ).trim();
}

function getId(post) {
  return String(
    post.id ||
    post.tweetId ||
    post.tweet_id ||
    post.id_str ||
    ""
  );
}

function getUrl(post) {
  if (post.url) return post.url;
  if (post.tweetUrl) return post.tweetUrl;
  if (post.tweet_url) return post.tweet_url;

  const id = getId(post);

  const username =
    post.author?.userName ||
    post.author?.username ||
    post.author?.screen_name ||
    post.username ||
    post.userName ||
    "";

  if (username && id) {
    return `https://x.com/${username}/status/${id}`;
  }

  if (id) {
    return `https://x.com/i/status/${id}`;
  }

  return "";
}

function getAuthor(post) {
  if (typeof post.author === "string") {
    return post.author;
  }

  return (
    post.author?.userName ||
    post.author?.username ||
    post.author?.screen_name ||
    post.username ||
    post.userName ||
    "未知用户"
  );
}

function getCreatedAt(post) {
  return (
    post.createdAt ||
    post.created_at ||
    post.date ||
    post.timestamp ||
    null
  );
}

function getLikes(post) {
  return safeNumber(
    post.likeCount ??
    post.likes ??
    post.favoriteCount ??
    post.favorite_count
  );
}

function getReplies(post) {
  return safeNumber(
    post.replyCount ??
    post.replies ??
    post.commentCount ??
    post.comments
  );
}

function getReposts(post) {
  return safeNumber(
    post.retweetCount ??
    post.reposts ??
    post.retweets
  );
}

function getQuotes(post) {
  return safeNumber(
    post.quoteCount ??
    post.quotes
  );
}

function getBookmarks(post) {
  return safeNumber(
    post.bookmarkCount ??
    post.bookmarks
  );
}

function getViews(post) {
  return safeNumber(
    post.viewCount ??
    post.views ??
    post.view_count
  );
}

function hasChinese(text) {
  const matches = text.match(/[\u4e00-\u9fff]/g);
  return matches && matches.length >= 2;
}

function getAgeHours(createdAt) {
  if (!createdAt) return 9999;

  const time = new Date(createdAt).getTime();

  if (!Number.isFinite(time)) {
    return 9999;
  }

  return Math.max(0, (Date.now() - time) / 3600000);
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

  const elapsed =
    Math.max(
      0.05,
      (Date.now() - old.checkedAt) / 3600000
    );

  const currentEngagement =
    post.likes +
    post.replies * 3 +
    post.reposts * 2 +
    post.quotes * 2 +
    post.bookmarks;

  const previousEngagement =
    old.likes +
    old.replies * 3 +
    old.reposts * 2 +
    old.quotes * 2 +
    old.bookmarks;

  const growth =
    currentEngagement - previousEngagement;

  const acceleration =
    growth / elapsed;

  let label = "➡️ 稳定";

  if (acceleration >= 100) {
    label = "🚀 爆发";
  } else if (acceleration >= 30) {
    label = "🔥 快速升温";
  } else if (acceleration >= 5) {
    label = "📈 正在升温";
  }

  return {
    growth,
    acceleration,
    label
  };
}

function calculateScore(post, momentum) {
  const age = post.ageHours;

  // 越新越重要
  let ageScore = 0;

  if (age <= 1) {
    ageScore = 45;
  } else if (age <= 3) {
    ageScore = 38;
  } else if (age <= 6) {
    ageScore = 30;
  } else if (age <= 12) {
    ageScore = 22;
  } else if (age <= 24) {
    ageScore = 14;
  } else {
    ageScore = 7;
  }

  const engagement =
    Math.log10(
      1 +
      post.likes +
      post.replies * 4 +
      post.reposts * 3 +
      post.quotes * 3 +
      post.bookmarks * 2 +
      post.views / 100
    ) * 10;

  const interaction =
    post.views > 0
      ? Math.min(
          15,
          ((post.likes +
            post.replies +
            post.reposts +
            post.quotes) /
            post.views) *
            1000
        )
      : 0;

  const imageBonus = post.hasImage ? 10 : 0;

  const commentBonus =
    post.replies >= 10
      ? 8
      : post.replies >= 3
      ? 4
      : 0;

  const accelerationBonus =
    Math.min(40, Math.max(0, momentum.acceleration / 10));

  return Math.round(
    ageScore +
    engagement +
    interaction +
    imageBonus +
    commentBonus +
    accelerationBonus
  );
}

function normalizePost(post) {
  const id = getId(post);

  const text = getText(post);

  const likes = getLikes(post);
  const replies = getReplies(post);
  const reposts = getReposts(post);
  const quotes = getQuotes(post);
  const bookmarks = getBookmarks(post);
  const views = getViews(post);

  const createdAt = getCreatedAt(post);

  const media =
    post.media ||
    post.images ||
    post.photos ||
    post.entities?.media ||
    [];

  const mediaArray = Array.isArray(media)
    ? media
    : [];

  const hasImage =
    mediaArray.some((item) => {
      const type =
        item?.type ||
        item?.mediaType ||
        "";

      return (
        type === "photo" ||
        type === "image"
      );
    }) ||
    Boolean(post.hasImage) ||
    Boolean(post.has_image);

  return {
    id,
    text,
    url: getUrl(post),
    author: getAuthor(post),
    createdAt,

    ageHours: getAgeHours(createdAt),

    likes,
    replies,
    reposts,
    quotes,
    bookmarks,
    views,

    hasImage
  };
}

async function fetchTweets() {
  if (!APIFY_TOKEN) {
    throw new Error(
      "Render 没有检测到 APIFY_TOKEN，请检查 Environment Variables。"
    );
  }

  const endpoint =
    `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(APIFY_TOKEN)}`;

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

  const response = await fetch(endpoint, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify(input)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Apify 请求失败 ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Apify 返回的不是有效 JSON：${text.slice(0, 500)}`
    );
  }

  if (!Array.isArray(data)) {
    throw new Error(
      "Apify 返回的数据格式异常，不是帖子数组。"
    );
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(n) {
  n = safeNumber(n);

  if (n >= 1000000) {
    return (n / 1000000).toFixed(1) + "M";
  }

  if (n >= 1000) {
    return (n / 1000).toFixed(1) + "K";
  }

  return String(Math.round(n));
}

function renderPost(post, index) {
  const rank = index + 1;

  const momentumClass =
    post.momentum.acceleration >= 30
      ? "hot"
      : "";

  return `
    <div class="card">

      <div class="topline">
        <span class="rank">#${rank}</span>

        <span class="age">
          ${escapeHtml(formatAge(post.ageHours))}
        </span>

        <span class="author">
          @${escapeHtml(post.author)}
        </span>
      </div>

      <div class="content">
        ${escapeHtml(post.text)}
      </div>

      <div class="stats">

        <span>❤️ ${formatNumber(post.likes)}</span>

        <span>💬 ${formatNumber(post.replies)}</span>

        <span>🔁 ${formatNumber(post.reposts)}</span>

        <span>👀 ${formatNumber(post.views)}</span>

      </div>

      <div class="score-row">

        <span class="score">
          雷达分 ${post.score}
        </span>

        <span class="momentum ${momentumClass}">
          ${escapeHtml(post.momentum.label)}
        </span>

        ${
          post.momentum.growth > 0
            ? `<span class="growth">
                +${formatNumber(post.momentum.growth)}
              </span>`
            : ""
        }

      </div>

      <a
        class="comment"
        href="${escapeHtml(post.url)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        🔥 立即去评论 ↗
      </a>

    </div>
  `;
}

function pageTemplate() {
  return `
<!DOCTYPE html>

<html lang="zh-CN">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
/>

<title>X热帖抢跑雷达</title>

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
      #080b12 45%,
      #030407 100%
    );

  color: #fff;

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;

  min-height: 100vh;
}

.container {
  width: 100%;
  max-width: 760px;

  margin: 0 auto;

  padding:
    32px
    18px
    70px;
}

h1 {
  margin: 0;

  font-size: 34px;

  line-height: 1.15;

  font-weight: 900;

  letter-spacing: -1px;
}

.subtitle {
  margin-top: 12px;

  color: #9ca3af;

  font-size: 17px;
}

.scan {
  width: 100%;

  margin-top: 34px;

  padding: 20px;

  border: 0;

  border-radius: 26px;

  color: #fff;

  font-size: 22px;

  font-weight: 900;

  background:
    linear-gradient(
      135deg,
      #ff176b,
      #ff6338
    );

  box-shadow:
    0 18px 45px
    rgba(255, 55, 100, .22);

  cursor: pointer;

  transition:
    transform .15s,
    opacity .15s;
}

.scan:active {
  transform: scale(.98);
}

.scan:disabled {
  opacity: .6;

  cursor: wait;
}

.status {
  margin-top: 28px;

  color: #9ca3af;

  font-size: 16px;
}

.error {
  margin-top: 20px;

  padding: 22px;

  border-radius: 22px;

  background: #38131d;

  color: #ff9faf;

  line-height: 1.6;

  word-break: break-word;
}

.card {
  margin-top: 18px;

  padding: 20px;

  border-radius: 24px;

  background:
    linear-gradient(
      145deg,
      rgba(28, 34, 48, .96),
      rgba(10, 13, 20, .96)
    );

  border:
    1px solid
    rgba(255,255,255,.06);

  box-shadow:
    0 12px 35px
    rgba(0,0,0,.28);
}

.topline {
  display: flex;

  align-items: center;

  gap: 9px;

  flex-wrap: wrap;
}

.rank {
  font-size: 18px;

  font-weight: 900;

  color: #ff557f;
}

.age {
  color: #aaa;

  font-size: 13px;
}

.author {
  color: #888;

  font-size: 13px;
}

.content {
  margin-top: 15px;

  font-size: 17px;

  line-height: 1.65;

  white-space: pre-wrap;

  word-break: break-word;
}

.stats {
  display: flex;

  gap: 16px;

  flex-wrap: wrap;

  margin-top: 16px;

  color: #aeb4c0;

  font-size: 13px;
}

.score-row {
  display: flex;

  gap: 10px;

  align-items: center;

  flex-wrap: wrap;

  margin-top: 16px;
}

.score {
  padding: 6px 10px;

  border-radius: 10px;

  background: rgba(255,255,255,.07);

  font-weight: 800;

  font-size: 13px;
}

.momentum {
  padding: 6px 10px;

  border-radius: 10px;

  background: rgba(255,255,255,.06);

  color: #bbb;

  font-size: 13px;

  font-weight: 700;
}

.momentum.hot {
  background: rgba(255,70,100,.15);

  color: #ff7190;
}

.growth {
  color: #63e6a2;

  font-size: 13px;

  font-weight: 800;
}

.comment {
  display: block;

  margin-top: 18px;

  padding: 14px;

  border-radius: 16px;

  text-align: center;

  text-decoration: none;

  color: white;

  font-size: 16px;

  font-weight: 900;

  background:
    rgba(255,255,255,.08);
}

.comment:active {
  background:
    rgba(255,255,255,.14);
}

.empty {
  margin-top: 35px;

  text-align: center;

  color: #777;

  line-height: 1.8;
}

.info {
  margin-top: 40px;

  color: #555;

  font-size: 13px;

  line-height: 1.8;
}

</style>

</head>

<body>

<div class="container">

  <h1>🚀 X热帖抢跑雷达</h1>

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

  <div id="status" class="status"></div>

  <div id="results"></div>

  <div class="info">
    每次扫描都会保存当前快照。<br>
    再次扫描后，系统会比较互动变化，判断哪些帖子正在加速。
  </div>

</div>

<script>

async function scan() {

  const button =
    document.getElementById("scan");

  const status =
    document.getElementById("status");

  const results =
    document.getElementById("results");

  button.disabled = true;

  button.textContent =
    "⏳ 正在扫描 X 热帖...";

  status.textContent =
    "正在寻找刚刚开始升温的中文图片帖子";

  results.innerHTML = "";

  try {

    const response =
      await fetch("/api/scan", {
        method: "POST"
      });

    const data =
      await response.json();

    if (!response.ok || !data.ok) {

      throw new Error(
        data.error ||
        "扫描失败"
      );

    }

    status.textContent =
      `找到 ${data.count} 条值得关注的帖子`;

    results.innerHTML =
      data.html ||
      `<div class="empty">
        暂时没有符合条件的帖子。
      </div>`;

  } catch (error) {

    status.textContent =
      "扫描失败";

    results.innerHTML = `
      <div class="error">
        ❌ ${escapeClient(error.message)}
        <br><br>
        这次不会隐藏错误。把这里的截图发给我，我直接定位。
      </div>
    `;

  } finally {

    button.disabled = false;

    button.textContent =
      "🔥 扫描刚刚起飞";
  }

}

function escapeClient(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

</script>

</body>

</html>
`;
}

app.get("/", (req, res) => {
  res.send(pageTemplate());
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "X热帖抢跑雷达",
    actor: ACTOR_ID,
    tokenConfigured: Boolean(APIFY_TOKEN)
  });
});

app.post("/api/scan", async (req, res) => {

  try {

    const rawPosts =
      await fetchTweets();

    let posts =
      rawPosts
        .map(normalizePost)
        .filter(post => post.id)
        .filter(post => post.text)
        .filter(post => hasChinese(post.text))
        .filter(post => post.ageHours <= 72);

    // 去重
    const seen = new Set();

    posts = posts.filter(post => {

      if (seen.has(post.id)) {
        return false;
      }

      seen.add(post.id);

      return true;
    });

    // 老帖子如果互动太低，直接过滤
    posts = posts.filter(post => {

      if (post.ageHours <= 3) {
        return true;
      }

      const engagement =
        post.likes +
        post.replies +
        post.reposts +
        post.quotes;

      return engagement >= 5;
    });

    // 计算增长
    posts = posts.map(post => {

      const momentum =
        calculateAcceleration(post);

      const score =
        calculateScore(
          post,
          momentum
        );

      return {
        ...post,
        momentum,
        score
      };
    });

    // 排序
    posts.sort((a, b) => {

      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return (
        b.momentum.acceleration -
        a.momentum.acceleration
      );
    });

    // 最多显示 30 条
    posts =
      posts.slice(0, 30);

    // 保存本轮快照
    const snapshot =
      new Map();

    posts.forEach(post => {

      snapshot.set(
        post.id,
        {
          likes: post.likes,
          replies: post.replies,
          reposts: post.reposts,
          quotes: post.quotes,
          bookmarks: post.bookmarks,
          checkedAt: Date.now()
        }
      );

    });

    previousPosts = snapshot;

    const html =
      posts.length
        ? posts
            .map(renderPost)
            .join("")
        : `
          <div class="empty">
            这次没有找到符合条件的中文图片热帖。<br>
            稍后再扫一次，才能开始比较互动增长。
          </div>
        `;

    res.json({
      ok: true,
      count: posts.length,
      html
    });

  } catch (error) {

    console.error(
      "SCAN ERROR:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        error?.message ||
        String(error)
    });
  }
});

app.listen(PORT, () => {

  console.log(
    `X热帖抢跑雷达 running on port ${PORT}`
  );

});