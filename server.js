const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR = "powerai~twitter-trends-scraper";
const APIFY_URL =
  "https://api.apify.com/v2/acts/" +
  ACTOR +
  "/run-sync-get-dataset-items";

if (!APIFY_TOKEN) {
  console.error("缺少 APIFY_TOKEN 环境变量");
}

function callApify(input) {
  return new Promise((resolve, reject) => {
    const target =
      APIFY_URL +
      "?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const body = JSON.stringify(input);

    const req = https.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 120000
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch (e) {
            return reject(
              new Error(
                "Apify 返回了无法解析的数据：" +
                  data.slice(0, 500)
              )
            );
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message =
              parsed &&
              parsed.error &&
              parsed.error.message
                ? parsed.error.message
                : JSON.stringify(parsed);

            return reject(
              new Error(
                "Apify 返回错误 " +
                  res.statusCode +
                  ": " +
                  message
              )
            );
          }

          resolve(parsed);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Apify 请求超时，请稍后再试"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

function parseVolume(text) {
  if (text === null || text === undefined) {
    return 0;
  }

  const str = String(text).replace(/,/g, "");
  const match = str.match(/([\d.]+)\s*([KMB])?/i);

  if (!match) {
    return 0;
  }

  let number = parseFloat(match[1]);

  if (Number.isNaN(number)) {
    return 0;
  }

  const unit = (match[2] || "").toUpperCase();

  if (unit === "K") {
    number *= 1000;
  }

  if (unit === "M") {
    number *= 1000000;
  }

  if (unit === "B") {
    number *= 1000000000;
  }

  return Math.round(number);
}

function isChinese(text) {
  if (!text) {
    return false;
  }

  const str = String(text);

  return /[\u4e00-\u9fff]/.test(str);
}

function categoryOf(name, context) {
  const text = (
    String(name || "") +
    " " +
    String(context || "")
  ).toLowerCase();

  if (
    /美女|美人|颜值|写真|小姐姐|女神|穿搭|时尚|裙子|衣服|模特|摄影|写真集|かわいい|cute|beauty|fashion|model/.test(
      text
    )
  ) {
    return "美女时尚";
  }

  if (
    /娱乐|明星|演员|电影|电视剧|综艺|歌手|音乐|idol|movie|music|actor|entertainment/.test(
      text
    )
  ) {
    return "娱乐";
  }

  if (
    /足球|篮球|nba|体育|比赛|球员|冠军|世界杯|sport|football|basketball/.test(
      text
    )
  ) {
    return "体育";
  }

  if (
    /ai|人工智能|科技|互联网|iphone|apple|openai|chatgpt|technology|tech/.test(
      text
    )
  ) {
    return "科技";
  }

  if (
    /游戏|电竞|steam|lol|valorant|genshin|game|gaming/.test(
      text
    )
  ) {
    return "游戏";
  }

  if (
    /新闻|政治|总统|政府|政策|战争|选举|politic|news|president/.test(
      text
    )
  ) {
    return "新闻";
  }

  return "综合";
}

function calcScore(item, index) {
  const volume = parseVolume(item.description);

  const rankScore = Math.max(0, 100 - index * 2);

  let volumeScore = 0;

  if (volume > 0) {
    volumeScore = Math.min(
      100,
      Math.round(Math.log10(volume + 1) * 14)
    );
  }

  return Math.min(
    99,
    Math.max(
      1,
      Math.round(rankScore * 0.7 + volumeScore * 0.3)
    )
  );
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => {
      const name =
        item.name ||
        item.trend_title ||
        item.trend ||
        item.title ||
        "";

      const description =
        item.description ||
        item.tweets_volume ||
        item.volume ||
        "";

      const context =
        item.context ||
        item.trend_category ||
        item.category ||
        "";

      return {
        rank:
          Number(item.rank) ||
          index + 1,

        name: String(name),

        description: String(description),

        volume: parseVolume(description),

        context: String(context),

        category: categoryOf(name, context),

        score: calcScore(
          {
            description: description
          },
          index
        ),

        scrapedAt:
          item.scrapedAt ||
          new Date().toISOString()
      };
    })
    .filter((item) => item.name);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getChinaTrends() {
  if (!APIFY_TOKEN) {
    throw new Error(
      "服务器没有配置 APIFY_TOKEN"
    );
  }

  const result = await callApify({
    country: "China",
    maxResults: 50
  });

  return normalizeItems(result);
}

async function getTrends(country) {
  if (!APIFY_TOKEN) {
    throw new Error(
      "服务器没有配置 APIFY_TOKEN"
    );
  }

  const input = {
    country: country || "China",
    maxResults: 50
  };

  const result = await callApify(input);

  return normalizeItems(result);
}

function pageHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>X热点起飞雷达</title>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #080b12;
  color: #f5f7fa;
  font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",
    "PingFang SC","Microsoft YaHei",sans-serif;
}

.container {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 18px 14px 50px;
}

.header {
  padding: 8px 4px 18px;
}

.title {
  font-size: 25px;
  font-weight: 800;
  letter-spacing: -0.5px;
}

.subtitle {
  margin-top: 7px;
  color: #8e98a8;
  font-size: 13px;
}

.tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 14px;
}

.tab {
  border: 1px solid #252c39;
  background: #111621;
  color: #aeb7c5;
  border-radius: 999px;
  padding: 9px 15px;
  white-space: nowrap;
  font-size: 13px;
}

.tab.active {
  color: #fff;
  background: #1d2635;
  border-color: #46536a;
}

.scan {
  width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 14px;
  font-size: 16px;
  font-weight: 700;
  background: #fff;
  color: #080b12;
  margin-bottom: 14px;
}

.scan:active {
  transform: scale(.99);
}

.status {
  display: none;
  padding: 13px 14px;
  background: #111621;
  border: 1px solid #252c39;
  border-radius: 12px;
  color: #aeb7c5;
  font-size: 13px;
  margin-bottom: 14px;
}

.error {
  color: #ff8f8f;
}

.empty {
  text-align: center;
  padding: 45px 20px;
  color: #8791a1;
}

.card {
  background: #101520;
  border: 1px solid #202837;
  border-radius: 16px;
  padding: 15px;
  margin-bottom: 10px;
}

.cardTop {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.rank {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #1a2130;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aeb7c5;
  font-size: 13px;
  font-weight: 800;
  flex: 0 0 auto;
}

.content {
  min-width: 0;
  flex: 1;
}

.name {
  font-size: 17px;
  font-weight: 750;
  line-height: 1.35;
  word-break: break-word;
}

.meta {
  margin-top: 7px;
  color: #7f8999;
  font-size: 12px;
  line-height: 1.5;
}

.tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.tag {
  font-size: 11px;
  color: #aeb7c5;
  border: 1px solid #293243;
  background: #151b27;
  border-radius: 999px;
  padding: 4px 8px;
}

.score {
  flex: 0 0 auto;
  text-align: center;
  min-width: 58px;
}

.scoreNum {
  font-size: 22px;
  font-weight: 850;
}

.scoreLabel {
  color: #6f7989;
  font-size: 10px;
  margin-top: 2px;
}

.footer {
  margin-top: 20px;
  text-align: center;
  color: #596273;
  font-size: 11px;
  line-height: 1.6;
}
</style>
</head>

<body>

<div class="container">

  <div class="header">
    <div class="title">🚀 X热点起飞雷达</div>
    <div class="subtitle">
      实时发现正在升温的 X 热点
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="selectCountry('China', this)">
      🇨🇳 中国区
    </button>

    <button class="tab" onclick="selectCountry('UnitedStates', this)">
      🇺🇸 美国区
    </button>

    <button class="tab" onclick="selectCountry('Japan', this)">
      🇯🇵 日本区
    </button>

    <button class="tab" onclick="selectCountry('UnitedKingdom', this)">
      🇬🇧 英国区
    </button>
  </div>

  <button class="scan" onclick="scan()">
    🔥 立即扫描热点
  </button>

  <div id="status" class="status"></div>

  <div id="list">
    <div class="empty">
      点击「立即扫描热点」获取最新趋势
    </div>
  </div>

  <div class="footer">
    数据来自 X 趋势抓取服务<br>
    「起飞指数」为趋势排序与讨论量综合计算值
  </div>

</div>

<script>

let currentCountry = "China";

function selectCountry(country, button) {
  currentCountry = country;

  document
    .querySelectorAll(".tab")
    .forEach(function(el) {
      el.classList.remove("active");
    });

  button.classList.add("active");

  scan();
}

function setStatus(text, isError) {
  const el = document.getElementById("status");

  el.style.display = "block";

  el.className = isError
    ? "status error"
    : "status";

  el.innerText = text;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function render(items) {
  const list = document.getElementById("list");

  if (!items || !items.length) {
    list.innerHTML =
      '<div class="empty">当前地区暂时没有返回趋势数据</div>';

    return;
  }

  list.innerHTML = items
    .map(function(item) {

      const context =
        item.context || "Trending";

      const category =
        item.category || "综合";

      const description =
        item.description || "";

      return (
        '<div class="card">' +

          '<div class="cardTop">' +

            '<div class="rank">' +
              escapeHtml(item.rank) +
            '</div>' +

            '<div class="content">' +

              '<div class="name">' +
                escapeHtml(item.name) +
              '</div>' +

              '<div class="meta">' +
                escapeHtml(description) +
                " · " +
                escapeHtml(context) +
              '</div>' +

              '<div class="tags">' +

                '<span class="tag">' +
                  escapeHtml(category) +
                '</span>' +

                '<span class="tag">🇨🇳 中国区</span>' +

              '</div>' +

            '</div>' +

            '<div class="score">' +

              '<div class="scoreNum">' +
                escapeHtml(item.score) +
              '</div>' +

              '<div class="scoreLabel">起飞指数</div>' +

            '</div>' +

          '</div>' +

        '</div>'
      );

    })
    .join("");
}

async function scan() {

  const button =
    document.querySelector(".scan");

  button.disabled = true;
  button.innerText = "⏳ 正在扫描...";

  setStatus(
    "正在抓取 " +
    countryName(currentCountry) +
    " 最新趋势，请稍候...",
    false
  );

  try {

    const response =
      await fetch(
        "/api/trends?country=" +
        encodeURIComponent(currentCountry)
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "扫描失败"
      );
    }

    render(data.items || []);

    setStatus(
      "✅ 已获取 " +
      (data.items || []).length +
      " 条 " +
      countryName(currentCountry) +
      " 趋势",
      false
    );

  } catch (error) {

    console.error(error);

    document.getElementById("list").innerHTML =
      '<div class="empty">' +
      escapeHtml(error.message) +
      "</div>";

    setStatus(
      "扫描失败：" +
      error.message,
      true
    );

  } finally {

    button.disabled = false;
    button.innerText = "🔥 立即扫描热点";

  }
}

function countryName(country) {

  const map = {
    China: "🇨🇳 中国区",
    UnitedStates: "🇺🇸 美国区",
    Japan: "🇯🇵 日本区",
    UnitedKingdom: "🇬🇧 英国区"
  };

  return map[country] || country;
}

</script>

</body>
</html>
`;
}

const server = http.createServer(async (req, res) => {

  const parsedUrl = url.parse(
    req.url,
    true
  );

  if (parsedUrl.pathname === "/") {

    res.writeHead(200, {
      "Content-Type":
        "text/html; charset=utf-8"
    });

    res.end(pageHtml());

    return;
  }

  if (parsedUrl.pathname === "/api/health") {

    res.writeHead(200, {
      "Content-Type":
        "application/json; charset=utf-8"
    });

    res.end(
      JSON.stringify({
        ok: true,
        actor: ACTOR,
        hasToken: !!APIFY_TOKEN
      })
    );

    return;
  }

  if (parsedUrl.pathname === "/api/trends") {

    const country =
      parsedUrl.query.country || "China";

    const allowed = [
      "China",
      "UnitedStates",
      "Japan",
      "UnitedKingdom"
    ];

    if (!allowed.includes(country)) {

      res.writeHead(400, {
        "Content-Type":
          "application/json; charset=utf-8"
      });

      res.end(
        JSON.stringify({
          error: "不支持的地区"
        })
      );

      return;
    }

    try {

      console.log(
        "开始抓取地区:",
        country
      );

      const items =
        await getTrends(country);

      console.log(
        "抓取完成:",
        country,
        items.length
      );

      res.writeHead(200, {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      });

      res.end(
        JSON.stringify({
          success: true,
          country: country,
          items: items,
          count: items.length,
          fetchedAt:
            new Date().toISOString()
        })
      );

    } catch (error) {

      console.error(
        "抓取失败:",
        error
      );

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

    return;
  }

  res.writeHead(404, {
    "Content-Type":
      "application/json; charset=utf-8"
  });

  res.end(
    JSON.stringify({
      error: "Not Found"
    })
  );
});

server.listen(PORT, () => {
  console.log(
    "X热点起飞雷达 running on port " +
      PORT
  );
});