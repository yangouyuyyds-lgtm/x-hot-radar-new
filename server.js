const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN || "";

// 使用支持多地区查询的 Actor
const ACTOR = "automation-lab~twitter-trends-scraper";

const API_URL =
  "https://api.apify.com/v2/acts/" +
  ACTOR +
  "/run-sync-get-dataset-items";

let chinaLocationCache = null;
let chinaLocationCacheTime = 0;

const CACHE_TIME = 60 * 60 * 1000;

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
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

function callApify(input) {
  return new Promise((resolve, reject) => {
    if (!APIFY_TOKEN) {
      reject(new Error("APIFY_TOKEN 未设置"));
      return;
    }

    const url =
      API_URL +
      "?token=" +
      encodeURIComponent(APIFY_TOKEN);

    const parsed = new URL(url);

    const requestData = JSON.stringify(input);

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestData)
      }
    };

    const req = https.request(options, (response) => {
      let data = "";

      response.on("data", (chunk) => {
        data += chunk;
      });

      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(
            new Error(
              "Apify 返回错误 " +
                response.statusCode +
                ": " +
                data.slice(0, 500)
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(
            new Error(
              "Apify 返回的不是有效 JSON: " +
                data.slice(0, 500)
            )
          );
        }
      });
    });

    req.on("error", reject);

    req.setTimeout(120000, () => {
      req.destroy(new Error("Apify 请求超时"));
    });

    req.write(requestData);
    req.end();
  });
}

/*
 * 兼容不同 Actor 返回结构
 */
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

/*
 * 找中国地区
 *
 * 不写死 WOEID。
 * 先让 Actor 自己告诉我们它支持哪些地区。
 */
async function findChinaLocation() {
  const now = Date.now();

  if (
    chinaLocationCache &&
    now - chinaLocationCacheTime < CACHE_TIME
  ) {
    return chinaLocationCache;
  }

  const result = await callApify({
    getAvailableLocations: true
  });

  const locations = getItems(result);

  if (!locations.length) {
    throw new Error(
      "抓取器没有返回可用地区列表"
    );
  }

  let china = null;

  for (const item of locations) {
    const countryCode = String(
      item.countryCode ||
        item.country_code ||
        item.country ||
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

    if (
      countryCode === "CN" ||
      /中国|China/i.test(countryName) ||
      /中国大陆|中国|China/i.test(locationName)
    ) {
      china = item;
      break;
    }
  }

  if (!china) {
    throw new Error(
      "当前抓取器没有找到中国地区。为了保证数据真实，系统不会把全球中文内容冒充成中国区。"
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
      "找到了中国地区，但没有找到该地区的 WOEID。"
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

/*
 * 统一处理趋势数据
 */
function normalizeTrend(item, index) {
  const name =
    item.trend ||
    item.name ||
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
    item.url ||
    item.queryUrl ||
    item.query_url ||
    "";

  return {
    name: String(name).trim(),
    volume,
    rank,
    location: String(location),
    url: String(url)
  };
}

/*
 * 判断是否包含中文
 */
function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

/*
 * 排除明显的日文/韩文
 */
function looksJapaneseOrKorean(text) {
  // 平假名
  if (/[\u3040-\u309f]/.test(text)) {
    return true;
  }

  // 片假名
  if (/[\u30a0-\u30ff]/.test(text)) {
    return true;
  }

  // 韩文
  if (/[\uac00-\ud7af]/.test(text)) {
    return true;
  }

  return false;
}

/*
 * 排除一些明显不是我们想要的体育/欧美娱乐热点
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

  if (looksJapaneseOrKorean(text)) {
    return false;
  }

  const lower = text.toLowerCase();

  for (const word of BLOCK_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/*
 * 中文热点排序
 */
function chineseScore(item) {
  const text = item.name;

  const chineseCount =
    (text.match(/[\u4e00-\u9fff]/g) || []).length;

  let score = 50;

  score += chineseCount * 4;

  if (item.volume > 100000) {
    score += 25;
  } else if (item.volume > 50000) {
    score += 20;
  } else if (item.volume > 10000) {
    score += 15;
  } else if (item.volume > 1000) {
    score += 8;
  }

  score += Math.max(0, 15 - item.rank);

  return Math.min(99, Math.max(50, Math.round(score)));
}

/*
 * 内容分类
 */
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
    /明星|演员|歌手|综艺|娱乐|艺人|偶像|电影|电视剧/.test(
      name
    )
  ) {
    tags.push("⭐ 娱乐");
  }

  if (
    /电影|电视剧|动漫|动画|综艺|剧/.test(
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
    /手机|苹果|华为|小米|科技|AI|人工智能|机器人/.test(
      name
    )
  ) {
    tags.push("🤖 科技");
  }

  if (
    /足球|篮球|网球|体育|比赛|奥运/.test(
      name
    )
  ) {
    tags.push("🏆 体育");
  }

  if (!tags.length) {
    tags.push("🇨🇳 中文");
  }

  return tags;
}

/*
 * 获取中国区趋势
 */
async function getChinaTrends() {
  const china = await findChinaLocation();

  const result = await callApify({
    locations: [String(china.woeid)],
    maxTrendsPerLocation: 50
  });

  const items = getItems(result);

  const trends = items
    .map((item, index) =>
      normalizeTrend(item, index)
    )
    .filter((item) =>
      isChineseTrend(item.name)
    )
    .map((item) => ({
      ...item,
      score: chineseScore(item),
      tags: getTags(item.name)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.rank - b.rank;
    })
    .slice(0, 30);

  return {
    location: china.name,
    trends
  };
}

/*
 * 获取其他地区
 */
async function getOtherTrends(location) {
  const result = await callApify({
    locations: [String(location)],
    maxTrendsPerLocation: 50
  });

  const items = getItems(result);

  return {
    location,
    trends: items
      .map((item, index) =>
        normalizeTrend(item, index)
      )
      .filter((item) => item.name)
      .map((item) => ({
        ...item,
        score: chineseScore(item),
        tags: getTags(item.name)
      }))
      .slice(0, 30)
  };
}

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
  padding: 22px 18px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.header h1 {
  margin: 0;
  font-size: 24px;
}

.header p {
  margin: 7px 0 0;
  color: #aaa;
  font-size: 13px;
}

.container {
  max-width: 760px;
  margin: auto;
  padding: 16px;
}

.panel {
  background: white;
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,.05);
}

select {
  width: 100%;
  border: 1px solid #ddd;
  background: white;
  border-radius: 12px;
  padding: 13px;
  font-size: 16px;
}

button {
  width: 100%;
  border: 0;
  background: #111;
  color: white;
  border-radius: 12px;
  padding: 13px;
  margin-top: 10px;
  font-size: 16px;
  font-weight: 600;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.stat {
  background: #f5f5f7;
  border-radius: 12px;
  padding: 12px;
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

.item {
  padding: 16px 0;
  border-bottom: 1px solid #eee;
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
  margin: 5px 0;
  word-break: break-word;
}

.score {
  display: inline-block;
  background: #111;
  color: white;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  margin-right: 6px;
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

.error {
  background: #fff0f0;
  color: #c00;
  padding: 14px;
  border-radius: 12px;
  line-height: 1.6;
}

.empty {
  text-align: center;
  color: #888;
  padding: 35px 10px;
}
</style>
</head>

<body>

<div class="header">
  <h1>🔥 X热点起飞雷达</h1>
  <p>实时发现正在升温的 X 热点</p>
</div>

<div class="container">

  <div class="panel">

    <select id="location">
      <option value="china">🇨🇳 中国区</option>
      <option value="1">🌎 全球</option>
      <option value="23424977">🇺🇸 美国</option>
      <option value="23424975">🇬🇧 英国</option>
      <option value="23424856">🇯🇵 日本</option>
    </select>

    <button onclick="loadTrends()">
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

    <div id="locationName"
      style="font-weight:700;margin-bottom:8px;">
      🇨🇳 中国区
    </div>

    <div id="results">
      <div class="loading">
        正在等待扫描...
      </div>
    </div>

  </div>

</div>

<script>
async function loadTrends() {

  const results =
    document.getElementById("results");

  const location =
    document.getElementById("location").value;

  results.innerHTML =
    '<div class="loading">🔥 正在扫描 X 热点...</div>';

  try {

    const response =
      await fetch(
        "/api/trends?location=" +
        encodeURIComponent(location)
      );

    const data =
      await response.json();

    if (!response.ok || data.error) {
      throw new Error(
        data.error || "请求失败"
      );
    }

    const trends =
      data.trends || [];

    document.getElementById("total")
      .textContent = trends.length;

    document.getElementById("attention")
      .textContent =
      trends.filter(x => x.score >= 80).length;

    document.getElementById("time")
      .textContent =
      new Date().toLocaleTimeString(
        "zh-CN",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      );

    document.getElementById("locationName")
      .textContent =
      "📍 " + (data.location || location);

    if (!trends.length) {
      results.innerHTML =
        '<div class="empty">' +
        '暂时没有符合条件的热点' +
        '</div>';

      return;
    }

    results.innerHTML =
      trends.map((item, index) => {

        const tags =
          (item.tags || [])
            .map(tag =>
              '<span class="tag">' +
              escapeHTML(tag) +
              '</span>'
            )
            .join("");

        return (
          '<div class="item">' +

          '<div class="rank">' +
          '#' + (index + 1) +
          '</div>' +

          '<div class="name">' +
          escapeHTML(item.name) +
          '</div>' +

          '<div>' +

          '<span class="score">' +
          '起飞指数 ' +
          item.score +
          '</span>' +

          tags +

          '</div>' +

          '<div class="volume">' +
          (
            item.volume
              ? "讨论量： " +
                Number(item.volume).toLocaleString()
              : "正在快速升温"
          ) +
          '</div>' +

          '</div>'
        );

      }).join("");

  } catch (error) {

    results.innerHTML =
      '<div class="error">' +
      '<b>扫描失败</b><br><br>' +
      escapeHTML(error.message) +
      '<br><br>' +
      '如果这是第一次扫描中国区，可能需要等待抓取器完成地区检测。' +
      '</div>';

  }
}

function escapeHTML(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

loadTrends();
</script>

</body>
</html>
`;

const server = http.createServer(
  async (req, res) => {

    try {

      const parsed =
        new URL(
          req.url,
          "http://" +
          (req.headers.host || "localhost")
        );

      if (parsed.pathname === "/") {
        sendHTML(res, HTML);
        return;
      }

      if (parsed.pathname === "/health") {
        sendJSON(res, 200, {
          ok: true,
          service: "x-hot-radar"
        });
        return;
      }

      if (parsed.pathname === "/api/trends") {

        const location =
          parsed.searchParams.get("location") ||
          "china";

        let data;

        if (location === "china") {
          data = await getChinaTrends();
        } else {
          data = await getOtherTrends(location);
        }

        sendJSON(res, 200, data);
        return;
      }

      sendJSON(res, 404, {
        error: "Not Found"
      });

    } catch (error) {

      console.error(error);

      sendJSON(res, 500, {
        error:
          error && error.message
            ? error.message
            : "服务器错误"
      });

    }

  }
);

server.listen(PORT, "0.0.0.0", () => {

  console.log(
    "X热点起飞雷达已启动，端口：" +
    PORT
  );

});