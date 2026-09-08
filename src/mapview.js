/* NIMBY Finance · Leaflet map rendering (OSM/CARTO/Esri + Mapbox raster) */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const V = {};
  const core = NS.core;
  let map, lineLayer, stationLayer, labelLayer, baseLayer = null;
  let imp = null, opt = {};
  let baseKey = "osm";
  let mbToken = "";

  const BASES = {
    osm: { name: "OpenStreetMap 标准", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", att: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 },
    voyage: { name: "CARTO 暖色", url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", att: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 20, sub: "abcd" },
    dark: { name: "CARTO 深色", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", att: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>', maxZoom: 20, sub: "abcd" },
    sat: { name: "Esri 卫星", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", att: "Tiles &copy; Esri", maxZoom: 19 },
    plain: { name: "纯色底图(离线可用)", url: "", att: "", maxZoom: 18 },
  };
  const MB_STYLES = [
    ["streets", "Mapbox 街道", "mapbox/streets-v11", "linear-gradient(135deg,#3b5cd9,#6f8bff)"],
    ["light", "Mapbox 浅色", "mapbox/light-v10", "linear-gradient(135deg,#e8ecf2,#fbfcfe)"],
    ["dark", "Mapbox 深色", "mapbox/dark-v10", "linear-gradient(135deg,#2a3242,#14181f)"],
    ["satellite", "Mapbox 卫星", "mapbox/satellite-v9", "linear-gradient(135deg,#2e4a33,#9fb7a0)"],
  ];
  const MB_ATTR = '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  V.init = function (el, hooks) {
    V.hooks = hooks || {};
    map = L.map(el, {
      center: [35.0, 113.6], zoom: 5, worldCopyJump: true,
      minZoom: 2, maxZoom: 18, zoomControl: false, attributionControl: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.on("mousemove", (e) => {
      const elc = document.getElementById("map-coords");
      if (elc) elc.textContent = e.latlng.lat.toFixed(4) + "°, " + e.latlng.lng.toFixed(4) + "°";
    });
    const ctl = L.control({ position: "topright" });
    ctl.onAdd = () => {
      const div = L.DomUtil.create("div", "base-switch");
      div.addEventListener("click", (e) => { e.stopPropagation(); });
      V._ctlDiv = div;
      drawControl(div);
      return div;
    };
    ctl.addTo(map);
    V.setBase(baseKey);
    return V;
  };
  V.map = () => map;
  V.setToken = function (token) {
    mbToken = (token || "").trim();
    if (mbToken && baseKey.indexOf("mb:") === 0) V.setBase(baseKey);
    if (V._ctlDiv) drawControl(V._ctlDiv);
  };
  V.hasToken = () => !!mbToken;

  function drawControl(div) {
    div.innerHTML = "";
    const cols = ["osm", "voyage", "dark", "sat", "plain"];
    const row = core.el("div", "row");
    cols.forEach((k) => row.appendChild(swBtn(k, BASES[k].name)));
    div.appendChild(row);
    // Mapbox button + menu
    const mbWrap = core.el("div", "", "");
    const b = swBtn("mb:menu", "Mapbox");
    mbWrap.appendChild(b);
    div.appendChild(mbWrap);
    b.onclick = () => toggleMbMenu(mbWrap);
    function swBtn(k, title) {
      const btn = document.createElement("button");
      btn.className = "bs" + (activeKey(k) ? " on" : "");
      btn.title = title;
      btn.innerHTML = `<span class="sw sw-${k === "mb:menu" ? "tok" : k}"></span>`;
      btn.onclick = () => {
        if (k === "mb:menu") return;
        V.setBase(k);
      };
      return btn;
    }
    function activeKey(k) {
      if (k.indexOf("mb:") === 0) return false;
      return baseKey === k;
    }
  }
  function toggleMbMenu(wrap) {
    const old = wrap.querySelector(".mb-menu");
    if (old) { old.remove(); return; }
    const menu = core.el("div", "mb-menu");
    // token status
    const tokItem = core.el("button", "", "");
    tokItem.innerHTML = `<span class="sw sw-tok">M</span><span class="lbl tok-set">${mbToken ? "✓ 已设置 Token · 更换" : "⚙ 设置 Mapbox Token…"}</span>`;
    tokItem.onclick = () => { menu.remove(); if (V.hooks.onNeedToken) V.hooks.onNeedToken(); };
    menu.appendChild(tokItem);
    menu.appendChild(core.el("div", "sep"));
    const disabled = !mbToken;
    MB_STYLES.forEach(([key, name]) => {
      const it = core.el("button", "", "");
      it.style.cursor = disabled ? "not-allowed" : "pointer";
      it.title = disabled ? "请先设置 Mapbox Token" : "";
      it.innerHTML = `<span class="sw" style="background:${name.indexOf("卫星") >= 0 ? "linear-gradient(135deg,#2e4a33,#9fb7a0)" : "linear-gradient(135deg,#dfe6f2,#ffffff);border-color:#b9c8ee"}"></span><span class="lbl">${name}</span>`;
      it.onclick = () => {
        if (!mbToken) { menu.remove(); if (V.hooks.onNeedToken) V.hooks.onNeedToken(); return; }
        V.setBase("mb:" + key);
        menu.remove();
      };
      menu.appendChild(it);
    });
    wrap.appendChild(menu);
  }

  V.setBase = function (key) {
    if (key === "mb:menu") return;
    hideTileWarn();
    let cfg;
    if (key === "plain") {
      baseKey = "plain";
      if (baseLayer) map.removeLayer(baseLayer);
      baseLayer = null;
      const c = map.getContainer();
      c.style.background = "#e8edf4";
      c.querySelectorAll("img.leaflet-tile").forEach((i) => i.remove());
      const attr = c.querySelector(".leaflet-control-attribution");
      if (attr) attr.textContent = "纯色底图(离线)";
      if (V._ctlDiv) drawControl(V._ctlDiv);
      if (V.hooks.onBaseChange) V.hooks.onBaseChange(baseKey);
      return;
    }
    const c0 = map.getContainer();
    c0.style.background = "";
    if (key.indexOf("mb:") === 0) {
      if (!mbToken) { if (V.hooks.onNeedToken) V.hooks.onNeedToken(); return; }
      const id = key.slice(3);
      const st = MB_STYLES.find((x) => x[0] === id);
      if (!st) return;
      cfg = {
        name: st[1],
        url: `https://api.mapbox.com/styles/v1/${st[2]}/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(mbToken)}`,
        att: MB_ATTR, maxZoom: 20,
      };
      baseKey = key;
    } else {
      cfg = BASES[key];
      baseKey = key;
    }
    if (baseLayer) map.removeLayer(baseLayer);
    const params = { attribution: cfg.att, maxZoom: cfg.maxZoom };
    if (cfg.sub) params.subdomains = cfg.sub;
    baseLayer = L.tileLayer(cfg.url, params);
    baseLayer.addTo(map);
    if (cfg.url.indexOf("api.mapbox.com") >= 0) {
      V._mbStyle = cfg.name;
    } else V._mbStyle = null;
    if (V._ctlDiv) drawControl(V._ctlDiv);
    if (V.hooks.onBaseChange) V.hooks.onBaseChange(baseKey);
    armTileCheck();
  };
  V.baseLabel = () => {
    if (baseKey.indexOf("mb:") === 0) {
      const id = baseKey.slice(3);
      const st = MB_STYLES.find((x) => x[0] === id);
      return st ? st[1] : baseKey;
    }
    return (BASES[baseKey] || {}).name || baseKey;
  };

  /* ---------------- layers ---------------- */
  V.render = function (theImp, o) {
    imp = theImp;
    opt = o || {};
    if (lineLayer) map.removeLayer(lineLayer);
    if (stationLayer) map.removeLayer(stationLayer);
    if (labelLayer) map.removeLayer(labelLayer);
    lineLayer = L.layerGroup().addTo(map);
    stationLayer = L.layerGroup().addTo(map);
    labelLayer = L.layerGroup().addTo(map);
    V._netShapes = [];
    if (V._zoomShapes) { map.off("zoomend", V._zoomShapes); V._zoomShapes = null; }
    const onZoomShapes = () => applyShapeScale();
    map.on("zoomend", onZoomShapes);
    V._zoomShapes = onZoomShapes;
    if (!imp) return;

    if (opt.showLines) {
      const eng = NS.engine;
      imp.lines.forEach((ln, li) => {
        if (opt.lineShown && !opt.lineShown(ln.name)) return;
        const c = opt.lineColor ? opt.lineColor(ln.name) : [52, 87, 213];
        const w = opt.lineWidth ? opt.lineWidth(ln.name) : 2.5;
        const op = opt.lineOpacity ? opt.lineOpacity(ln.name) : 1;
        const isVar = eng.isVariant(imp, li);
        let items = null;
        if (isVar) {
          const rw = eng.routeWalk(imp, li);
          if (rw) items = rw.pts.map((pt, i) => ({ pt, id: rw.ids[i] }));
        }
        if (!items) {
          items = ln.staIds.map((sid) => {
            const s = imp.stById.get(sid);
            const pt = s && s.lon != null ? [s.lat, s.lon] : (imp.stFb[sid] ? [imp.stFb[sid][1], imp.stFb[sid][0]] : null);
            return { pt, id: sid };
          });
        }
        const polylines = [];
        let run = [];
        const flush = () => { if (run.length >= 2) polylines.push(run.slice()); run = []; };
        for (const it of items) {
          const show = it.pt != null && (!opt.stationShown || opt.stationShown(it.id));
          if (show) run.push(it.pt); else flush();
        }
        flush();
        if (!polylines.length) return;
        polylines.forEach((pts) => {
          const isDarkBase = /dark|sat/.test(baseKey);
          const isGray = Math.abs(c[0] - c[1]) < 6 && Math.abs(c[1] - c[2]) < 6;
          const bodyCol = isGray ? c : core.boostRGB(c, 0.62, 0.6);
          const casingCol = isDarkBase ? "rgba(240,244,250,0.85)" : "rgba(30,38,56,0.5)";
          const baseW = Math.max(2.6, w);
          const dash = isVar ? (w > 6 ? "9 6" : "6 5") : undefined;
          const casing = L.polyline(pts, { color: casingCol, weight: 3, opacity: 1, interactive: false });
          const body = L.polyline(pts, {
            color: core.rgbCss(bodyCol, op), weight: 2.8, opacity: 1, dashArray: dash,
          });
          casing.addTo(lineLayer);
          body.addTo(lineLayer);
          V._netShapes.push({ body, casing, base: baseW, dash });
          if (opt.linePopup) {
            body.bindPopup(opt.linePopup(ln.name), { maxWidth: 460, autoPanPadding: [30, 30] });
          }
        });
      });
    }
    if (opt.showStations) {
      const circles = [];
      for (const s of imp.stations) {
        if (s.lon == null) continue;
        if (opt.stationShown && !opt.stationShown(s.id)) continue;
        const col = opt.stationColor ? opt.stationColor(s.id) : [90, 120, 170];
        const c = L.circleMarker([s.lat, s.lon], {
          radius: opt.stationRadius ? opt.stationRadius(s.id) : 5,
          color: "#ffffff", weight: 1.2, fillColor: core.rgbCss(col, 0.95), fillOpacity: 0.92,
        });
        if (opt.stationPopup) c.bindPopup(opt.stationPopup(s.id), { maxWidth: 470, autoPanPadding: [30, 30] });
        V._netShapes.push({ circle: c, base: (opt.stationRadius ? opt.stationRadius(s.id) : 5) });
        circles.push(c);
      }
      circles.forEach((c) => c.addTo(stationLayer));
    }
    if (V._zoomFn) { map.off("zoomend", V._zoomFn); V._zoomFn = null; }
    if (opt.showLabels) {
      const onZoom = () => {
        labelLayer.clearLayers();
        if (map.getZoom() < 11) return;
        for (const s of imp.stations) {
          if (s.lon == null) continue;
          if (opt.stationShown && !opt.stationShown(s.id)) continue;
          const ic = L.divIcon({ className: "sta-label", html: `<span>${core.esc(s.name)}</span>`, iconSize: null });
          L.marker([s.lat, s.lon], { icon: ic, interactive: false }).addTo(labelLayer);
        }
      };
      map.on("zoomend", onZoom);
      V._zoomFn = onZoom;
      setTimeout(onZoom, 50);
    }
    applyShapeScale();
    if (opt.fit !== false && opt.fitAll) V.fitNetwork(true);
  };

  V.fitNetwork = function (force) {
    if (!imp || !imp.stations.length) return;
    const pts = [];
    for (const s of imp.stations) {
      if (s.lon == null) continue;
      if (opt.stationShown && !opt.stationShown(s.id)) continue;
      pts.push([s.lat, s.lon]);
    }
    if (!pts.length) return;
    if (pts.length === 1) { map.setView(pts[0], 12); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [26, 26], maxZoom: 14 });
  };
  V.fitRect = function (bounds, maxZoom) {
    if (bounds) map.fitBounds(bounds, { padding: [26, 26], maxZoom: maxZoom || 14 });
  };
  V.highlightStation = function (id) {
    const s = imp && imp.stById.get(id);
    if (!s) return;
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 13));
    L.circleMarker([s.lat, s.lon], { radius: 16, color: "#111", weight: 2, fill: false, interactive: false }).addTo(stationLayer);
  };

  /* ---- tile failure detection & fallback banner ---- */
  let tileTimer = null;
  let warnShown = false;
  function armTileCheck() {
    clearTimeout(tileTimer);
    if (baseKey === "plain") { hideTileWarn(); return; }
    tileTimer = setTimeout(() => {
      const el = map.getContainer();
      const imgs = el ? Array.from(el.querySelectorAll("img.leaflet-tile")) : [];
      if (!imgs.length) return;
      const loaded = imgs.some((i) => i.complete && i.naturalWidth > 0);
      if (!loaded) showTileWarn();
      else hideTileWarn();
    }, 4200);
  }
  function ensureWarnEl() {
    let el = document.getElementById("map-tile-warn");
    if (!el) {
      const wrap = document.getElementById("mapwrap");
      el = document.createElement("div");
      el.id = "map-tile-warn";
      el.className = "map-tile-warn hidden";
      wrap.appendChild(el);
    }
    return el;
  }
  function showTileWarn() {
    if (warnShown || baseKey === "plain") return;
    warnShown = true;
    const el = ensureWarnEl();
    const cur = V.baseLabel();
    const btn = (label, fn) => {
      const b = document.createElement("button");
      b.className = "btn xs";
      b.textContent = label;
      b.onclick = (e) => { e.stopPropagation(); hideTileWarn(); fn(); };
      return b;
    };
    el.innerHTML = "";
    const txt = document.createElement("div");
    txt.className = "tw-txt";
    txt.innerHTML = `<b>“${cur}”底图瓦片加载失败</b>（网络受限或被屏蔽）。线路/站点/热度不受影响。<br>可切换底图源：`;
    el.appendChild(txt);
    const ops = document.createElement("div");
    ops.className = "tw-ops";
    ops.appendChild(btn("Mapbox", () => {
      if (mbToken) V.setBase("mb:streets");
      else if (V.hooks.onNeedToken) V.hooks.onNeedToken();
    }));
    ops.appendChild(btn("CARTO 暖色", () => V.setBase("voyage")));
    ops.appendChild(btn("Esri 卫星", () => V.setBase("sat")));
    ops.appendChild(btn("纯色底图(离线可用)", () => V.setBase("plain")));
    ops.appendChild(btn("重试", () => { V.setBase(baseKey); }));
    el.appendChild(ops);
    el.classList.remove("hidden");
  }
  function hideTileWarn() {
    warnShown = false;
    const el = document.getElementById("map-tile-warn");
    if (el) el.classList.add("hidden");
  }
  V._armTileCheck = armTileCheck;

  /* ---- zoom-dependent stroke/marker scaling (thin at overview, bold when zoomed) ---- */
  function zoomFactor() {
    const z = map ? map.getZoom() : 9;
    return 0.3 + Math.min(1, Math.max(0, (z - 4) / 8)) * 0.7; // z<=4: .3, z=12+: 1
  }
  function applyShapeScale() {
    if (!V._netShapes) return;
    const f = zoomFactor();
    for (const rec of V._netShapes) {
      if (rec.body) {
        const bw = Math.max(1.1, rec.base * f);
        rec.body.setStyle({ weight: bw });
        rec.casing.setStyle({ weight: Math.max(1.4, bw + 1.2 + 2.6 * f) });
      } else if (rec.circle) {
        rec.circle.setRadius(Math.max(1.6, rec.base * f));
      }
    }
  }
  applyShapeScale._ = zoomFactor;
  V.zoomFactor = zoomFactor;
  V._applyScale = applyShapeScale;

  NS.mapview = V;
})(window.NFB);
