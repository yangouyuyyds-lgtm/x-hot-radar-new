const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

const ACTOR = "automation-lab~twitter-trends-scraper";

const API_URL =
  "https://api.apify.com/v2/acts/" +
  ACTOR +
  "/run-sync-get-dataset-items";

let chinaLocationCache = null;
let chinaLocationCacheTime = 0;

const LOCATION_CACHE_TIME = 6 * 60 * 60 * 1000;

/* =========================
   基础响应
========================= */

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(body);
}

function sendHTML(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(html);
}

/* =========================
   Apify
========================= */

function callApify(input) {
  return new Promise((resolve, reject) => {
    if (!APIFY_TOKEN) {
      reject(new Error("APIFY_TOKEN 没有设置"));
      return;
    }

    const requestUrl =
      API_URL +
      "?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const parsed = new URL(requestUrl);

    const body = JSON.stringify(input);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (response) => {
      let data = "";

      response.on("data", (chunk) => {
        data += chunk;
      });

      response.on("end", () => {
        if (
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          reject(
            new Error(
              "Apify 返回错误 " +
              response.statusCode +
              ": " +
              data.slice(0, 800)
            )
          );
          return;
        }

        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (error) {
          reject(
            new Error(
              "Apify 返回的数据不是有效 JSON：" +
              data.slice(0, 500)
            )
          );
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.setTimeout(120000, () => {
      req.destroy(
        new Error("Apify 请求超过 120 秒")
      );
    });

    req.write(body);
    req.end();
  });
}

/* =========================
   数据数组兼容
========================= */

function getItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && Array.isArray(data.items)) {
    return data.items;
  }

  if (data && Array.isArray(data.data)) {
    return data.data;
  }

  if (data && Array.isArray(data.results)) {
    return data.results;
  }

  if (data && Array.isArray(data.locations)) {
    return data.locations;
  }

  return [];
}

/* =========================
   寻找中国地区
========================= */

async function findChinaLocation() {
  const now = Date.now();

  if (
    chinaLocationCache &&
    now - chinaLocationCacheTime <
      LOCATION_CACHE_TIME
  ) {
    return chinaLocationCache;
  }

  /*
   * 关键：
   * locations 是当前 Actor 要求的字段。
   *
   * 同时开启 getAvailableLocations，
   * 获取 Actor 当前支持的地区目录。
   */
  const result = await callApify({
    locations: ["worldwide"],
    getAvailableLocations: true
  });

  const locations = getItems(result);

  if (!locations.length) {
    throw new Error(
      "Apify 没有返回地区目录。"
    );
  }

  let china = null;

  for (const item of locations) {
    const countryCode = String(
      item.countryCode ||
      item.country_code ||
      ""
    ).toUpperCase();

    const countryName = String(
      item.countryName ||
      item.country_name ||
      ""
    );

    const locationName = String(
      item.locationName ||
      item.location_name ||
      item.name ||
      ""
    );

    const combined =
      countryName +
      " " +
      locationName;

    if (
      countryCode === "CN" ||
      /中国大陆/i.test(combined) ||
      /中国/i.test(combined) ||
      /China/i.test(combined)
    ) {
      china = item;
      break;
    }
  }

  if (!china) {
    throw new Error(
      "当前 X 趋势抓取器没有找到中国地区。为了保证数据真实，系统不会把全球中文热点冒充成中国区。"
    );
  }

  const woeid =
    china.locationWoeid ||
    china.location_woeid ||
    china.woeid ||
    china.WOEID ||
    china.id;

  if (!woeid) {
    throw new Error(
      "找到了中国地区，但是没有找到该地区的 WOEID。"
    );
  }

  chinaLocationCache = {
    woeid: String(woeid),
    name:
      china.locationName ||
      china.location_name ||
      china.name ||
      "中国"
  };

  chinaLocationCacheTime = now;

  return chinaLocationCache;
}

/* =========================
   趋势标准化
========================= */

function normalizeTrend(item, index) {
  const name =
    item.name ||
    item.trend ||
    item.title ||
    item.query ||
    "";

  const volume =
    Number(
      item.tweetVolume ||
      item.tweet_volume ||
      item.volume ||
      0
    ) || 0;

  const rank =
    Number(
      item.rank ||
      item.position ||
      index + 1
    ) || index + 1;

  const location =
    item.locationName ||
    item.location_name ||
    item.location ||
    "";

  const url =
    item.twitterSearchUrl ||
    item.searchUrl ||
    item.url ||
    "";

  return {
    name: String(name).trim(),
    volume,
    rank,
    location: String(location),
    url: String(url)
  };
}

/* =========================
   中文判断
========================= */

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasJapaneseKana(text) {
  return (
    /[\u3040-\u309f]/.test(text) ||
    /[\u30a0-\u30ff]/.test(text)
  );
}

function hasKorean(text) {
  return /[\uac00-\ud7af]/.test(text);
}

/*
 * 这些词即使带有中文，
 * 也尽量排除明显的欧美体育/娱乐热点。
 */

const BLOCK_WORDS = [
  "NBA",
  "NFL",
  "NHL",
  "MLB",
  "FIFA",
  "UFC",
  "WWE",
  "Premier League",
  "Manchester",
  "Liverpool",
  "Arsenal",
  "Chelsea",
  "Real Madrid",
  "Barcelona",
  "Taylor Swift",
  "Donald Trump",
  "Elon Musk",
  "Jeremiah Smith"
];

function isChineseTrend(text) {
  if (!text) {
    return false;
  }

  if (!hasChinese(text)) {
    return false;
  }

  /*
   * 日文假名出现时直接排除。
   */
  if (hasJapaneseKana(text)) {
    return false;
  }

  /*
   * 韩文出现时直接排除。
   */
  if (hasKorean(text)) {
    return false;
  }

  const lower = text.toLowerCase();

  for (const word of BLOCK_WORDS) {
    if (
      lower.includes(
        word.toLowerCase()
      )
    ) {
      return false;
    }
  }

  return true;
}

/* =========================
   起飞指数
========================= */

function getScore(item) {
  let score = 50;

  const rank = Number(item.rank) || 50;
  const volume = Number(item.volume) || 0;

  /*
   * 排名越靠前，指数越高
   */
  score += Math.max(
    0,
    20 - rank
  );

  /*
   * 讨论量
   */
  if (volume >= 1000000) {
    score += 28;
  } else if (volume >= 500000) {
    score += 24;
  } else if (volume >= 100000) {
    score += 20;
  } else if (volume >= 50000) {
    score += 16;
  } else if (volume >= 10000) {
    score += 12;
  } else if (volume >= 1000) {
    score += 7;
  }

  return Math.min(
    99,
    Math.max(
      50,
      Math.round(score)
    )
  );
}

/* =========================
   内容分类
========================= */

function getTags(name) {
  const tags = [];

  if (
    /美女|女生|女孩|小姐姐|女神|穿搭|时尚|裙子|颜值|写真|模特|身材|美妆|护肤/.test(
      name
    )
  ) {
    tags.push("💄 美女时尚");
  }

  if (
    /明星|演员|歌手|综艺|娱乐|艺人|偶像|粉丝/.test(
      name
    )
  ) {
    tags.push("⭐ 明星娱乐");
  }

  if (
    /电影|电视剧|动漫|动画|综艺|电视剧|剧集/.test(
      name
    )
  ) {
    tags.push("🎬 影视");
  }

  if (
    /游戏|电竞|Steam|王者|原神|英雄联盟|LOL/.test(
      name
    )
  ) {
    tags.push("🎮 游戏");
  }

  if (
    /手机|苹果|华为|小米|科技|AI|人工智能|机器人|芯片/.test(
      name
    )
  ) {
    tags.push("🤖 科技");
  }

  if (
    /足球|篮球|网球|体育|比赛|奥运|世界杯/.test(
      name
    )
  ) {
    tags.push("🏆 体育");
  }

  if (tags.length === 0) {
    tags.push("🇨🇳 中文");
  }

  return tags;
}

/* =========================
   中国趋势
========================= */

async function getChinaTrends() {
  const china =
    await findChinaLocation();

  const result = await callApify({
    locations: [
      String(china.woeid)
    ],
    maxTrendsPerLocation: 50
  });

  const items = getItems(result);

  const trends = items
    .map((item, index) =>
      normalizeTrend(
        item,
        index
      )
    )
    .filter((item) =>
      isChineseTrend(
        item.name
      )
    )
    .map((item) => ({
      ...item,
      score: getScore(item),
      tags: getTags(
        item.name
      )
    }))
    .sort((a, b) => {
      if (
        b.score !== a.score
      ) {
        return (
          b.score -
          a.score
        );
      }

      return (
        a.rank -
        b.rank
      );
    })
    .slice(0, 30);

  return {
    location:
      china.name,
    trends
  };
}

/* =========================
   其他地区
========================= */

async function getOtherTrends(
  location
) {
  const result =
    await callApify({
      locations: [
        String(location)
      ],
      maxTrendsPerLocation: 50
    });

  const items =
    getItems(result);

  const trends =
    items
      .map(
        (item, index) =>
          normalizeTrend(
            item,
            index
          )
      )
      .filter(
        (item) =>
          item.name
      )
      .map((item) => ({
        ...item,
        score:
          getScore(item),
        tags:
          getTags(
            item.name
          )
      }))
      .slice(0, 30);

  return {
    location,
    trends
  };
}

/* =========================
   HTML 页面
========================= */

const HTML = `
<!DOCTYPE html>

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
  background: #f5f5f7;
  color: #171717;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}

.header {
  background: #111;
  color: white;
  padding: 24px 18px;
}

.header h1 {
  margin: 0;
  font-size: 25px;
}

.header p {
  margin: 8px 0 0;
  color: #aaa;
  font-size: 13px;
}

.container {
  width: 100%;
  max-width: 760px;
  margin: auto;
  padding: 16px;
}

.panel {
  background: white;
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow:
    0 2px 12px rgba(0,0,0,.05);
}

select {
  width: 100%;
  border: 1px solid #ddd;
  background: white;
  border-radius: 12px;
  padding: 14px;
  font-size: 16px;
}

button {
  width: 100%;
  border: 0;
  background: #111;
  color: white;
  border-radius: 12px;
  padding: 14px;
  margin-top: 10px;
  font-size: 16px;
  font-weight: 700;
}

button:active {
  transform: scale(.99);
}

.stats {
  display: grid;
  grid-template-columns:
    repeat(3, 1fr);
  gap: 8px;
}

.stat {
  background: #f5f5f7;
  border-radius: 12px;
  padding: 13px 5px;
  text-align: center;
}

.stat b {
  display: block;
  font-size: 22px;
}

.stat span {
  color: #777;
  font-size: 12px;
}

.location-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 10px;
}

.item {
  padding: 16px 0;
  border-bottom:
    1px solid #eee;
}

.item:last-child {
  border-bottom: 0;
}

.rank {
  color: #999;
  font-size: 13px;
}

.name {
  font-size: 18px;
  font-weight: 700;
  margin: 6px 0;
  line-height: 1.45;
  word-break: break-word;
}

.score {
  display: inline-block;
  background: #111;
  color: white;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  margin-right: 5px;
}

.tag {
  display: inline-block;
  background: #f0f0f0;
  border-radius: 8px;
  padding: 4px 7px;
  font-size: 12px;
  margin-right: 4px;
  margin-top: 5px;
}

.volume {
  color: #777;
  font-size: 12px;
  margin-top: 8px;
}

.loading {
  text-align: center;
  padding: 35px 10px;
  color: #777;
}

.empty {
  text-align: center;
  color: #888;
  padding: 35px 10px;
}

.error {
  background: #fff0f0;
  color: #c0392b;
  border-radius: 14px;
  padding: 16px;
  line-height: 1.7;
  word-break: break-word;
}

.success {
  color: #16803c;
}

</style>

</head>

<body>

<div class="header">

  <h1>
    🔥 X热点起飞雷达
  </h1>

  <p>
    实时发现正在升温的 X 热点
  </p>

</div>

<div class="container">

  <div class="panel">

    <select id="location">

      <option value="china">
        🇨🇳 中国区
      </option>

      <option value="worldwide">
        🌎 全球
      </option>

      <option value="US">
        🇺🇸 美国
      </option>

      <option value="UK">
        🇬🇧 英国
      </option>

      <option value="JP">
        🇯🇵 日本
      </option>

    </select>

    <button
      onclick="loadTrends()"
    >
      🔍 扫描热点
    </button>

  </div>

  <div class="panel">

    <div class="stats">

      <div class="stat">
        <b id="total">-</b>
        <span>热点</span>
      </div>

      <div class="stat">
        <b id="attention">-</b>
        <span>值得关注</span>
      </div>

      <div class="stat">
        <b id="time">-</b>
        <span>更新时间</span>
      </div>

    </div>

  </div>

  <div class="panel">

    <div
      class="location-title"
      id="locationName"
    >
      🇨🇳 中国区
    </div>

    <div id="results">

      <div class="loading">
        正在扫描...
      </div>

    </div>

  </div>

</div>

<script>

function escapeHTML(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

async function loadTrends() {

  const results =
    document.getElementById(
      "results"
    );

  const location =
    document.getElementById(
      "location"
    ).value;

  results.innerHTML =
    '<div class="loading">' +
    '🔥 正在扫描 X 热点...' +
    '</div>';

  document.getElementById(
    "total"
  ).textContent = "-";

  document.getElementById(
    "attention"
  ).textContent = "-";

  document.getElementById(
    "time"
  ).textContent = "-";

  try {

    const response =
      await fetch(
        "/api/trends?location=" +
        encodeURIComponent(
          location
        )
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      data.error
    ) {
      throw new Error(
        data.error ||
        "请求失败"
      );
    }

    const trends =
      data.trends || [];

    document.getElementById(
      "total"
    ).textContent =
      trends.length;

    document.getElementById(
      "attention"
    ).textContent =
      trends.filter(
        x => x.score >= 80
      ).length;

    document.getElementById(
      "time"
    ).textContent =
      new Date()
        .toLocaleTimeString(
          "zh-CN",
          {
            hour: "2-digit",
            minute: "2-digit"
          }
        );

    document.getElementById(
      "locationName"
    ).textContent =
      "📍 " +
      (
        data.location ||
        "中国区"
      );

    if (
      trends.length === 0
    ) {

      results.innerHTML =
        '<div class="empty">' +
        '目前没有符合条件的热点' +
        '</div>';

      return;
    }

    results.innerHTML =
      trends
        .map(
          (item, index) => {

            const tags =
              (
                item.tags || []
              )
                .map(
                  tag =>
                    '<span class="tag">' +
                    escapeHTML(tag) +
                    '</span>'
                )
                .join("");

            const volume =
              item.volume
                ? "讨论量： " +
                  Number(
                    item.volume
                  ).toLocaleString()
                : "讨论量暂未公开";

            return (

              '<div class="item">' +

              '<div class="rank">' +
              "#" +
              (index + 1) +
              " · 原始排名 " +
              item.rank +
              "</div>" +

              '<div class="name">' +
              escapeHTML(
                item.name
              ) +
              "</div>" +

              "<div>" +

              '<span class="score">' +
              "起飞指数 " +
              item.score +
              "</span>" +

              tags +

              "</div>" +

              '<div class="volume">' +
              volume +
              "</div>" +

              "</div>"

            );

          }
        )
        .join("");

  } catch (error) {

    console.error(error);

    results.innerHTML =
      '<div class="error">' +

      "<b>扫描失败</b>" +

      "<br><br>" +

      escapeHTML(
        error.message
      ) +

      "<br><br>" +

      "如果是第一次扫描中国区，" +
      "系统正在检测 X 当前支持的地区。" +

      "</div>";

  }

}

loadTrends();

</script>

</body>

</html>
`;

/* =========================
   HTTP Server
========================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        const parsed =
          new URL(
            req.url,
            "http://" +
            (
              req.headers.host ||
              "localhost"
            )
          );

        /* 首页 */

        if (
          parsed.pathname === "/"
        ) {

          sendHTML(
            res,
            HTML
          );

          return;
        }

        /* 健康检查 */

        if (
          parsed.pathname ===
          "/health"
        ) {

          sendJSON(
            res,
            200,
            {
              ok: true,
              service:
                "x-hot-radar"
            }
          );

          return;
        }

        /* 趋势 API */

        if (
          parsed.pathname ===
          "/api/trends"
        ) {

          const location =
            parsed.searchParams.get(
              "location"
            ) ||
            "china";

          let data;

          if (
            location === "china"
          ) {

            data =
              await getChinaTrends();

          } else {

            data =
              await getOtherTrends(
                location
              );

          }

          sendJSON(
            res,
            200,
            data
          );

          return;
        }

        sendJSON(
          res,
          404,
          {
            error:
              "页面不存在"
          }
        );

      } catch (error) {

        console.error(
          "SERVER ERROR:",
          error
        );

        sendJSON(
          res,
          500,
          {
            error:
              error &&
              error.message
                ? error.message
                : "服务器内部错误"
          }
        );

      }

    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "🔥 X热点起飞雷达启动成功"
    );

    console.log(
      "PORT:",
      PORT
    );

  }
);