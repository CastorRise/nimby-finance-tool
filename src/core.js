/* NIMBY Finance · core utilities & shared schema */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const C = {};

  /* ---------- small utils ---------- */
  C.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  C.el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  C.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  C.uid = (p) => (p || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- game export color: stored little-endian uint32, "0xRRGGBBAA" shown as ARGB in text ---------- */
  C.colorFromGame = function (hexStr) {
    // value like "0xff0000ff" -> numeric 0xff0000ff; in-memory bytes little endian: R = low byte
    let v = parseInt(String(hexStr), 16);
    if (!isFinite(v)) v = 0xff8080ff;
    const r = v & 255, g = (v >>> 8) & 255, b = (v >>> 16) & 255;
    return [r, g, b];
  };
  C.rgbCss = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a == null ? 1 : a})`;
  /* make a line color more vivid & visible on maps */
  C.boostRGB = function (rgb, satMin, lightMax) {
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let l = (mx + mn) / 2;
    let s = 0;
    if (mx !== mn) s = (mx - mn) / (1 - Math.abs(2 * l - 1));
    l = Math.min(l, lightMax == null ? 0.55 : lightMax);
    s = Math.max(s, satMin == null ? 0.55 : satMin);
    const hue = C._hue(r, g, b, mx, mn);
    const out = C._hslToRgb(hue, s, l);
    return [Math.round(out[0] * 255), Math.round(out[1] * 255), Math.round(out[2] * 255)];
  };
  C._hue = function (r, g, b, mx, mn) {
    const d = mx - mn;
    if (d === 0) return 0;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h / 360;
  };
  C._hslToRgb = function (h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const pp = 2 * l - q;
      const f = (t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return pp + (q - pp) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return pp + (q - pp) * (2 / 3 - t) * 6;
        return pp;
      };
      r = f(h + 1 / 3); g = f(h); b = f(h - 1 / 3);
    }
    return [r, g, b];
  };
  C.hexCss = (rgb) => "#" + rgb.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

  /* ---------- number formatting ---------- */
  const _th = (n) => {
    const s = Math.abs(n).toFixed(n % 1 === 0 && Math.abs(n) < 1e15 ? 0 : 2);
    const [i, d] = s.split(".");
    return (n < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d ? "." + d : "");
  };
  C.fmtMoney = function (v, compact) {
    if (v == null || !isFinite(v)) return "—";
    if (compact !== false && Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (compact !== false && Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (compact !== false && Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + "K";
    return _th(v);
  };
  C.fmtNum = function (v, dec) {
    if (v == null || !isFinite(v)) return "—";
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
    return _th(v, dec);
  };
  C.fmtPct = function (v, dec) {
    if (v == null || !isFinite(v)) return "—";
    return (v * 100).toFixed(dec == null ? 1 : dec) + "%";
  };
  C.fmtDur = function (sec) {
    if (sec == null || !isFinite(sec)) return "—";
    const m = sec / 60;
    if (m >= 60) return (m / 60).toFixed(1) + "h";
    if (m >= 1) return m.toFixed(0) + "min";
    return sec.toFixed(0) + "s";
  };
  C.fmtKm = function (m) {
    if (m == null || !isFinite(m)) return "—";
    if (m >= 1000) return (m / 1000).toFixed(1) + " km";
    return Math.round(m) + " m";
  };
  C.moneyClass = (v) => (v < -1e-9 ? "neg" : v > 1e-9 ? "pos" : "");

  /* ---------- periods & buckets ---------- */
  C.PERIODS = [
    { id: "daily", label: "日" },
    { id: "weekly", label: "周" },
    { id: "monthly", label: "月" },
    { id: "quarterly", label: "季" },
    { id: "yearly", label: "年" },
    { id: "lifetime", label: "累计" },
  ];
  C.periodLabel = (p) => (C.PERIODS.find((x) => x.id === p) || {}).label || p;
  C.QN = { "一": 1, "二": 2, "三": 3, "四": 4 };
  // sort tuple for a bucket ts string under a period
  C.tsTuple = function (per, ts) {
    if (per === "lifetime") return [0];
    if (per === "quarterly") {
      const m = /^(\d{4})-第([一二三四])季度$/.exec(ts);
      return m ? [+m[1], C.QN[m[2]]] : [1e9, ts];
    }
    const parts = String(ts).split("-").map((x) => parseInt(x, 10));
    if (!parts.length || parts.some(isNaN)) return [1e9, ts];
    return parts;
  };
  C.tsSort = (per, list) =>
    list.slice().sort((a, b) => {
      const ta = C.tsTuple(per, a), tb = C.tsTuple(per, b);
      for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
        const x = ta[i] || 0, y = tb[i] || 0;
        if (x !== y) return x - y;
      }
      return 0;
    });
  C.fmtBucket = function (per, ts) {
    if (per === "lifetime") return "全部周期(累计)";
    if (per === "daily" || per === "weekly") {
      const p = ts.split("-").map(Number);
      if (per === "weekly") return `${p[0]}年 第${C.weekOf(p[0], p[1], p[2])}周 · ${p[1]}月${p[2]}日`;
      return `${p[0]}-${String(p[1]).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
    }
    if (per === "monthly") { const p = ts.split("-").map(Number); return `${p[0]}年${p[1]}月`; }
    if (per === "quarterly") return ts.replace("第", "第").replace("季度", "季度");
    if (per === "yearly") return ts + "年";
    return ts;
  };
  C.weekOf = function (y, m, d) {
    // ISO week number
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - y0) / 86400000 + 1) / 7);
  };

  /* ---------- metric heat colors ---------- */
  const STOPS_SEQ = [0.0, 0.28, 0.55, 0.78, 1.0];
  const COLS_SEQ = [
    [232, 241, 255], [130, 175, 255], [255, 213, 110], [255, 156, 90], [212, 66, 66],
  ];
  const STOPS_DIV = [-1, -0.45, 0, 0.45, 1];
  const COLS_DIV = [
    [208, 66, 66], [250, 190, 178], [246, 246, 246], [176, 226, 190], [34, 150, 86],
  ];
  function ramp(t, stops, cols) {
    t = C.clamp(t, 0, 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1]) i++;
    const lo = stops[i], hi = stops[i + 1];
    const f = hi === lo ? 0 : (t - lo) / (hi - lo);
    const a = cols[i], b = cols[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  C.heatColor = function (scheme, t) {
    const rgb = scheme === "div" ? ramp((t + 1) / 2, STOPS_DIV, COLS_DIV) : ramp(t, STOPS_SEQ, COLS_SEQ);
    return rgb;
  };
  C.heatGradientCss = function (scheme) {
    const cols = scheme === "div" ? COLS_DIV : COLS_SEQ;
    const stops = scheme === "div" ? STOPS_DIV : STOPS_SEQ;
    const parts = stops.map((s, i) => `rgba(${cols[i][0]},${cols[i][1]},${cols[i][2]},1) ${(s * 50 + 50).toFixed(0)}%`);
    return `linear-gradient(90deg, ${parts.join(",")})`;
  };
  // transform value -> t in [0,1] for seq, [-1,1] for div
  C.scaleNorm = function (scheme, scaleMode, v, lo, hi, mid) {
    if (scheme === "div") {
      const m = mid == null ? 0 : mid;
      const pos = Math.max(hi - m, 1e-12), neg = Math.max(m - lo, 1e-12);
      if (v >= m) return Math.min(1, Math.abs(v - m) / pos);
      return -Math.min(1, Math.abs(v - m) / neg);
    }
    // sequential: scale positive magnitude
    const a = Math.max(0, lo), b = Math.max(0, hi);
    const f = (x) => {
      if (scaleMode === "log") return x <= 0 ? 0 : Math.log10(1 + x);
      if (scaleMode === "sqrt") return Math.sqrt(x);
      return x;
    };
    const bn = f(b - a) || 1;
    return C.clamp(f(Math.max(0, v) - a) / bn, 0, 1);
  };

  /* ---------- geometry ---------- */
  C.haversineKm = function (lon1, lat1, lon2, lat2) {
    const R = 6371.0088;
    const r1 = (lat1 * Math.PI) / 180, r2 = (lat2 * Math.PI) / 180;
    const dr = ((lat2 - lat1) * Math.PI) / 180, dl = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dr / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  /* ---------- gazetteer (for region naming) ---------- */
  C.GAZETTEER = [
    ["郑州", 113.62, 34.75], ["洛阳", 112.45, 34.62], ["西安", 108.94, 34.34], ["北京", 116.4, 39.9],
    ["天津", 117.2, 39.13], ["长沙", 112.94, 28.23], ["武汉", 114.3, 30.59], ["上海", 121.47, 31.23],
    ["杭州", 120.15, 30.27], ["南京", 118.8, 32.06], ["苏州", 120.62, 31.3], ["合肥", 117.23, 31.82],
    ["徐州", 117.18, 34.26], ["青岛", 120.38, 36.07], ["济南", 117.12, 36.65], ["石家庄", 114.5, 38.04],
    ["太原", 112.55, 37.87], ["沈阳", 123.43, 41.8], ["大连", 121.61, 38.91], ["长春", 125.32, 43.82],
    ["哈尔滨", 126.53, 45.8], ["重庆", 106.55, 29.56], ["成都", 104.06, 30.57], ["昆明", 102.83, 24.88],
    ["贵阳", 106.63, 26.65], ["南宁", 108.37, 22.82], ["广州", 113.26, 23.13], ["深圳", 114.06, 22.55],
    ["佛山", 113.12, 23.02], ["东莞", 113.75, 23.02], ["珠海", 113.58, 22.27], ["厦门", 118.09, 24.48],
    ["福州", 119.3, 26.08], ["南昌", 115.86, 28.68], ["宁波", 121.55, 29.87], ["无锡", 120.3, 31.57],
    ["常州", 119.97, 31.81], ["兰州", 103.83, 36.06], ["乌鲁木齐", 87.62, 43.83], ["呼和浩特", 111.75, 40.84],
    ["香港", 114.17, 22.32], ["澳门", 113.55, 22.2], ["台北", 121.56, 25.03], ["高雄", 120.31, 22.62],
    ["东京", 139.69, 35.69], ["横滨", 139.64, 35.44], ["大阪", 135.5, 34.69], ["京都", 135.77, 35.01],
    ["神户", 135.19, 34.69], ["名古屋", 136.9, 35.18], ["福冈", 130.4, 33.59], ["札幌", 141.35, 43.06],
    ["仙台", 140.87, 38.27], ["广岛", 132.46, 34.39], ["釜山", 129.08, 35.18], ["首尔", 126.98, 37.57],
    ["仁川", 126.71, 37.46], ["新加坡", 103.82, 1.35], ["吉隆坡", 101.69, 3.14], ["曼谷", 100.5, 13.76],
    ["马尼拉", 120.98, 14.6], ["雅加达", 106.85, -6.21], ["胡志明市", 106.66, 10.76], ["河内", 105.83, 21.03],
    ["德里", 77.21, 28.63], ["孟买", 72.88, 19.08], ["迪拜", 55.27, 25.2], ["伊斯坦布尔", 28.98, 41.01],
    ["伦敦", -0.13, 51.51], ["巴黎", 2.35, 48.85], ["柏林", 13.41, 52.52], ["马德里", -3.7, 40.42],
    ["巴塞罗那", 2.17, 41.39], ["罗马", 12.5, 41.9], ["米兰", 9.19, 45.46], ["阿姆斯特丹", 4.9, 52.37],
    ["布鲁塞尔", 4.35, 50.85], ["维也纳", 16.37, 48.21], ["苏黎世", 8.54, 47.38], ["慕尼黑", 11.58, 48.14],
    ["法兰克福", 8.68, 50.11], ["莫斯科", 37.62, 55.76], ["圣彼得堡", 30.36, 59.93], ["斯德哥尔摩", 18.07, 59.33],
    ["哥本哈根", 12.57, 55.68], ["奥斯陆", 10.75, 59.91], ["赫尔辛基", 24.94, 60.17], ["华沙", 21.01, 52.23],
    ["雅典", 23.73, 37.98], ["里斯本", -9.14, 38.72], ["都柏林", -6.26, 53.35], ["爱丁堡", -3.19, 55.95],
    ["纽约", -74.01, 40.71], ["洛杉矶", -118.24, 34.05], ["芝加哥", -87.63, 41.88], ["旧金山", -122.42, 37.77],
    ["西雅图", -122.33, 47.61], ["波士顿", -71.06, 42.36], ["华盛顿", -77.04, 38.91], ["费城", -75.17, 39.95],
    ["多伦多", -79.38, 43.65], ["蒙特利尔", -73.57, 45.5], ["温哥华", -123.12, 49.28], ["渥太华", -75.7, 45.42],
    ["墨西哥城", -99.13, 19.43], ["迈阿密", -80.19, 25.76], ["达拉斯", -96.8, 32.78], ["休斯顿", -95.37, 29.76],
    ["亚特兰大", -84.39, 33.75], ["丹佛", -104.99, 39.74], ["波特兰", -122.68, 45.52], ["圣迭戈", -117.16, 32.72],
    ["圣保罗", -46.63, -23.55], ["里约热内卢", -43.17, -22.91], ["布宜诺斯艾利斯", -58.38, -34.6],
    ["圣地亚哥", -70.65, -33.45], ["波哥大", -74.07, 4.71], ["利马", -77.04, -12.05],
    ["悉尼", 151.21, -33.87], ["墨尔本", 144.96, -37.81], ["布里斯班", 153.03, -27.47], ["珀斯", 115.86, -31.95],
    ["奥克兰", 174.76, -36.85], ["惠灵顿", 174.78, -41.29], ["约翰内斯堡", 28.05, -26.2], ["开罗", 31.24, 30.04],
    ["拉各斯", 3.39, 6.52], ["内罗毕", 36.82, -1.29], ["卡萨布兰卡", -7.59, 33.57],
  ];
  C.cityName = function (lon, lat) {
    let best = null, bd = Infinity;
    for (const [name, x, y] of C.GAZETTEER) {
      const d = C.haversineKm(lon, lat, x, y);
      if (d < bd) { bd = d; best = name; }
    }
    return bd <= 90 ? best : null;
  };

  /* ---------- file helpers ---------- */
  C.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  };
  C.toCSV = function (headers, rows) {
    const q = (v) => {
      if (v == null) return "";
      let s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "\uFEFF" + [headers.map(q).join("\t"), ...rows.map((r) => r.map(q).join("\t"))].join("\r\n");
  };
  C.fmtSize = function (bytes) {
    if (bytes == null) return "";
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + " KB";
    return bytes + " B";
  };
  C.parseFileNameTime = function (name) {
    // "... Export 20260610T213222Z.json"
    const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(name);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
  };
  C.epochLabel = function (sec) {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };
  C.shortEpoch = function (sec) {
    const d = new Date(sec * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  };

  NS.core = C;
})(window.NFB);
