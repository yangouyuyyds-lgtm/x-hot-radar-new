const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 10000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const ACTOR = "simpleapi~twitter-trends-scraper";

const APIFY_URL =
  "https://api.apify.com/v2/acts/" +
  ACTOR +
  "/run-sync-get-dataset-items";

if (!APIFY_TOKEN) {
  console.error("❌ APIFY_TOKEN 未配置");
}

/* =========================
   Apify 请求
========================= */

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
        timeout: 180000
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          let result;

          try {
            result = JSON.parse(data);
          } catch (err) {
            return reject(
              new Error(
                "Apify 返回的数据无法解析：" +
                  data.slice(0, 500)
              )
            );
          }

          if (
            res.statusCode < 200 ||
            res.statusCode >= 300
          ) {
            const message =
              result?.error?.message ||
              JSON.stringify(result);

            return reject(
              new Error(
                "Apify HTTP " +
                  res.statusCode +
                  ": " +
                  message
              )
            );
          }

          resolve(result);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(
        new Error("Apify 请求超时")
      );
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

/* =========================
   工具
========================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const text = String(value)
    .replace(/,/g, "")
    .trim();

  const match = text.match(
    /([\d.]+)\s*([KMB])?/i
  );

  if (!match) {
    return 0;
  }

  let number = parseFloat(match[1]);

  if (Number.isNaN(number)) {
    return 0;
  }

  const unit =
    (match[2] || "").toUpperCase();

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

/* =========================
   第一步：
   找 X 真正支持的中国地点
========================= */

async function findChinaLocation() {
  console.log(
    "🇨🇳 正在查询 X 可用地区目录..."
  );

  const rows = await callApify({
    listAvailableLocations: true,
    catalogueTypeFilter: "country"
  });

  if (!Array.isArray(rows)) {
    throw new Error(
      "地区目录返回格式异常"
    );
  }

  console.log(
    "地区目录数量:",
    rows.length
  );

  /*
   * 只接受真正的中国国家级地点。
   *
   * 不接受：
   * China, Hong Kong
   * China, Taiwan
   * Chinese-language trend
   * 全球趋势
   */

  const china = rows.find((item) => {
    const countryCode =
      String(
        item.countryCode || ""
      ).toUpperCase();

    const countryName =
      String(
        item.countryName || ""
      ).toLowerCase();

    const locationName =
      String(
        item.locationName || ""
      ).toLowerCase();

    const locationType =
      String(
        item.locationType || ""
      ).toLowerCase();

    return (
      countryCode === "CN" &&
      (
        countryName === "china" ||
        locationName === "china" ||
        locationName === "中国"
      ) &&
      locationType === "country"
    );
  });

  if (!china) {
    console.log(
      "❌ 地区目录中没有找到真正的 China country location"
    );

    return null;
  }

  console.log(
    "✅ 找到中国地区:",
    china
  );

  return china;
}

/* =========================
   第二步：
   用中国真实 WOEID 抓趋势
========================= */

async function getChinaTrends() {
  const china =
    await findChinaLocation();

  if (!china) {
    throw new Error(
      "X 当前可验证的地区目录中没有找到中国全国级 Trends。为了保证数据真实，本次不会使用全球趋势冒充中国区。"
    );
  }

  const woeid =
    china.woeid;

  if (!woeid) {
    throw new Error(
      "找到了中国地区，但没有返回 WOEID，无法安全抓取。"
    );
  }

  console.log(
    "🇨🇳 使用中国 WOEID:",
    woeid
  );

  const rows = await callApify({
    locations: [
      String(woeid)
    ],
    maxTrendsPerLocation: 50
  });

  if (!Array.isArray(rows)) {
    throw new Error(
      "中国趋势返回格式异常"
    );
  }

  /*
   * 再做一次地区硬验证。
   *
   * 只有：
   * countryCode === CN
   * 并且 locationType === country
   *
   * 才允许进入中国区列表。
   */

  const verified =
    rows.filter((item) => {

      const countryCode =
        String(
          item.countryCode || ""
        ).toUpperCase();

      const locationType =
        String(
          item.locationType || ""
        ).toLowerCase();

      const itemWoeid =
        String(
          item.woeid || ""
        );

      return (
        countryCode === "CN" &&
        locationType === "country" &&
        itemWoeid === String(woeid)
      );
    });

  console.log(
    "原始趋势:",
    rows.length
  );

  console.log(
    "通过中国地区验证:",
    verified.length
  );

  /*
   * 如果返回了全球 / 韩国 / 美国 / 日本等数据，
   * 直接丢弃。
   */

  if (rows.length > 0 && verified.length === 0) {
    throw new Error(
      "抓取结果没有通过中国地区验证，已阻止错误数据进入中国区。"
    );
  }

  return {
    location: china,
    items: verified
  };
}

/* =========================
   分类
========================= */

function detectCategory(name) {
  const text =
    String(name || "").toLowerCase();

  if (
    /美女|美人|女神|小姐姐|写真|穿搭|时尚|模特|裙子|颜值|摄影|beauty|fashion|model/.test(
      text
    )
  ) {
    return "美女时尚";
  }

  if (
    /娱乐|明星|演员|歌手|电影|电视剧|综艺|idol|movie|music/.test(
      text
    )
  ) {
    return "娱乐";
  }

  if (
    /ai|人工智能|科技|互联网|chatgpt|openai|iphone|apple|tech/.test(
      text
    )
  ) {
    return "科技";
  }

  if (
    /足球|篮球|nba|体育|世界杯|球员|比赛|sport|football|basketball/.test(
      text
    )
  ) {
    return "体育";
  }

  if (
    /游戏|电竞|steam|lol|valorant|genshin|gaming|game/.test(
      text
    )
  ) {
    return "游戏";
  }

  if (
    /政治|政府|总统|选举|战争|新闻|政策|politic|president|news/.test(
      text
    )
  ) {
    return "新闻";
  }

  return "综合";
}

/* =========================
   趋势标准化
========================= */

function normalizeTrends(rows) {
  return rows
    .map((item, index) => {

      const name =
        item.trend ||
        item.name ||
        item.title ||
        item.trendName ||
        "";

      const rank =
        Number(item.rank) ||
        index + 1;

      const volume =
        item.tweetVolume ??
        item.volume ??
        item.tweets ??
        item.tweetCount ??
        "";

      const locationName =
        item.locationName || "";

      const locationType =
        item.locationType || "";

      const countryCode =
        item.countryCode || "";

      const woeid =
        item.woeid || "";

      return {
        rank,
        name: String(name),
        volume: String(volume),
        volumeNumber:
          parseNumber(volume),

        category:
          detectCategory(name),

        locationName:
          String(locationName),

        locationType:
          String(locationType),

        countryCode:
          String(countryCode),

        woeid:
          String(woeid),

        score:
          Math.max(
            1,
            Math.min(
              99,
              100 -
                Math.min(
                  90,
                  (rank - 1) * 2
                )
            )
          )
      };
    })
    .filter((item) => item.name);
}

/* =========================
   HTML
========================= */

function pageHtml() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"
/>

<title>X热点起飞雷达</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #080b12;
  color: #f5f7fa;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
}

.container {
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
  flex: 0 0 auto;
  border: 1px solid #252c39;
  background: #111621;
  color: #aeb7c5;
  border-radius: 999px;
  padding: 10px 17px;
  font-size: 14px;
}

.tab.active {
  color: white;
  border-color: #53627a;
  background: #1a2333;
}

.scan {
  width: 100%;
  border: 0;
  border-radius: 16px;
  padding: 17px;
  font-size: 17px;
  font-weight: 800;
  background: white;
  color: #080b12;
  margin-bottom: 14px;
}

.status {
  display: none;
  padding: 14px;
  background: #111621;
  border: 1px solid #252c39;
  border-radius: 14px;
  color: #aeb7c5;
  font-size: 13px;
  margin-bottom: 14px;
  line-height: 1.6;
}

.status.error {
  color: #ff9999;
}

.card {
  background: #101520;
  border: 1px solid #202837;
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 11px;
}

.cardTop {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.rank {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #192132;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-weight: 800;
  color: #b7c0cf;
}

.content {
  min-width: 0;
  flex: 1;
}

.name {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.4;
  word-break: break-word;
}

.meta {
  margin-top: 7px;
  color: #7f8999;
  font-size: 12px;
}

.tags {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.tag {
  border: 1px solid #293243;
  background: #151b27;
  border-radius: 999px;
  padding: 5px 9px;
  color: #aeb7c5;
  font-size: 11px;
}

.score {
  min-width: 58px;
  text-align: center;
}

.scoreNum {
  font-size: 23px;
  font-weight: 900;
}

.scoreLabel {
  margin-top: 3px;
  color: #707b8d;
  font-size: 10px;
}

.empty {
  padding: 55px 20px;
  text-align: center;
  color: #7f8999;
  line-height: 1.7;
}

.footer {
  text-align: center;
  margin-top: 22px;
  color: #566071;
  font-size: 11px;
  line-height: 1.7;
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
      只展示通过真实地区验证的 X 趋势
    </div>

  </div>

  <div class="tabs">

    <button
      class="tab active"
      onclick="selectCountry('China',this)"
    >
      🇨🇳 中国区
    </button>

    <button
      class="tab"
      onclick="selectCountry('UnitedStates',this)"
    >
      🇺🇸 美国区
    </button>

    <button
      class="tab"
      onclick="selectCountry('Japan',this)"
    >
      🇯🇵 日本区
    </button>

    <button
      class="tab"
      onclick="selectCountry('UnitedKingdom',this)"
    >
      🇬🇧 英国区
    </button>

  </div>

  <button
    class="scan"
    onclick="scan()"
  >
    🔥 立即扫描热点
  </button>

  <div
    id="status"
    class="status"
  ></div>

  <div id="list">

    <div class="empty">
      点击「立即扫描热点」开始
    </div>

  </div>

  <div class="footer">

    数据源：X 地区趋势抓取<br>

    中国区必须通过 CN + country + WOEID 三重验证

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

function setStatus(text, error) {

  const el =
    document.getElementById("status");

  el.style.display = "block";

  el.className =
    error
      ? "status error"
      : "status";

  el.innerText = text;
}

function escapeHtml(text) {

  return String(text || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

function render(items) {

  const list =
    document.getElementById("list");

  if (!items.length) {

    list.innerHTML =
      '<div class="empty">' +
      '当前没有通过地区验证的趋势数据' +
      '</div>';

    return;
  }

  list.innerHTML =
    items.map(function(item) {

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

                (item.volume
                  ? '讨论量 · ' +
                    escapeHtml(item.volume)
                  : 'X Trending') +

              '</div>' +

              '<div class="tags">' +

                '<span class="tag">' +
                  escapeHtml(item.category) +
                '</span>' +

                '<span class="tag">' +
                  '🇨🇳 中国区' +
                '</span>' +

              '</div>' +

            '</div>' +

            '<div class="score">' +

              '<div class="scoreNum">' +
                escapeHtml(item.score) +
              '</div>' +

              '<div class="scoreLabel">' +
                '起飞指数' +
              '</div>' +

            '</div>' +

          '</div>' +

        '</div>'

      );

    }).join("");
}

async function scan() {

  const button =
    document.querySelector(".scan");

  button.disabled = true;

  button.innerText =
    "⏳ 正在验证中国地区...";

  document.getElementById("list")
    .innerHTML =
    '<div class="empty">' +
    '正在查询 X 地区目录...<br>' +
    '然后验证中国 WOEID...' +
    '</div>';

  setStatus(
    "正在获取真实地区数据，请稍候...",
    false
  );

  try {

    const response =
      await fetch(
        "/api/trends?country=" +
        encodeURIComponent(
          currentCountry
        )
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        "扫描失败"
      );
    }

    render(
      data.items || []
    );

    setStatus(
      "✅ " +
      data.locationName +
      " · 已通过地区验证 · " +
      data.items.length +
      " 条趋势",
      false
    );

  } catch (error) {

    console.error(error);

    document.getElementById("list")
      .innerHTML =
      '<div class="empty">' +
      '⚠️ ' +
      escapeHtml(error.message) +
      '</div>';

    setStatus(
      error.message,
      true
    );

  } finally {

    button.disabled = false;

    button.innerText =
      "🔥 立即扫描热点";
  }
}

</script>

</body>

</html>
`;
}

/* =========================
   HTTP Server
========================= */

const server =
  http.createServer(
    async (req, res) => {

      const parsed =
        url.parse(
          req.url,
          true
        );

      /* 首页 */

      if (parsed.pathname === "/") {

        res.writeHead(200, {
          "Content-Type":
            "text/html; charset=utf-8"
        });

        res.end(
          pageHtml()
        );

        return;
      }

      /* 健康检查 */

      if (
        parsed.pathname ===
        "/api/health"
      ) {

        res.writeHead(200, {
          "Content-Type":
            "application/json; charset=utf-8"
        });

        res.end(
          JSON.stringify({
            ok: true,
            actor: ACTOR,
            hasToken:
              !!APIFY_TOKEN
          })
        );

        return;
      }

      /* 趋势 */

      if (
        parsed.pathname ===
        "/api/trends"
      ) {

        const country =
          parsed.query.country ||
          "China";

        /*
         * 目前这一版先把中国区
         * 做成真正的 WOEID 验证。
         *
         * 其他地区暂时不允许走旧逻辑，
         * 防止再次出现“全球数据冒充地区”。
         */

        if (country !== "China") {

          res.writeHead(400, {
            "Content-Type":
              "application/json; charset=utf-8"
          });

          res.end(
            JSON.stringify({
              error:
                "这一版正在先验证中国区真实地区源。美国、日本、英国暂不启用旧数据源。"
            })
          );

          return;
        }

        try {

          console.log(
            "=========================="
          );

          console.log(
            "🇨🇳 开始中国区真实地区扫描"
          );

          const result =
            await getChinaTrends();

          const items =
            normalizeTrends(
              result.items
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

              country: "China",

              locationName:
                result.location.locationName,

              countryCode:
                result.location.countryCode,

              locationType:
                result.location.locationType,

              woeid:
                result.location.woeid,

              items,

              count:
                items.length,

              fetchedAt:
                new Date().toISOString()
            })
          );

          console.log(
            "🇨🇳 中国区扫描完成:",
            items.length
          );

        } catch (error) {

          console.error(
            "❌ 中国区扫描失败:",
            error
          );

          res.writeHead(500, {
            "Content-Type":
              "application/json; charset=utf-8"
          });

          res.end(
            JSON.stringify({
              success: false,
              error:
                error.message
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
    }
  );

server.listen(
  PORT,
  () => {
    console.log(
      "🚀 X热点起飞雷达运行中，端口:",
      PORT
    );
  }
);