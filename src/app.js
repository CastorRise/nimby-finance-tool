/* NIMBY Finance · main application controller */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const A = {};
  const core = NS.core, engine = NS.engine, store = NS.store, charts = NS.charts;

  /* ---------------- app state ---------------- */
  const DEFAULTS = {
    activeId: null, per: "daily", ts: null,
    tab: "overview", scheme: "seq", scale: "sqrt",
    metricStation: "paxBoard", metricLine: "opProfit",
    showLines: true, showStations: true, showLabels: true,
    regionOff: [], adj: false, staCharts: false,
  };
  const st = Object.assign({}, DEFAULTS);
  let imp = null; // active import (in-memory)
  let busy = false;
  const activeCharts = [];
  const impCache = new Map();
  let fitRequested = false;
  let currentCSV = null;
  let csvFileName = "表格";

  /* ---------------- boot ---------------- */
  A.init = async function () {
    NS.app = A;
    await store.init();
    Object.assign(st, DEFAULTS, store.ws().settings || {});
    bindStatic();
    await refreshImportListMeta();
    if (st.activeId && store.listImportsMeta().find((m) => m.id === st.activeId)) {
      await setActive(st.activeId, true);
    } else {
      const metas = store.listImportsMeta();
      if (metas.length) await setActive(metas[metas.length - 1].id, true);
      else renderEmpty(true);
    }
  };
  A.reloadAll = async function (selectId) {
    store.ws().settings = st;
    await refreshImportListMeta();
    const metas = store.listImportsMeta();
    if (selectId) { await setActive(selectId, true); return; }
    if (st.activeId && metas.find((m) => m.id === st.activeId)) await setActive(st.activeId, true);
    else if (metas.length) await setActive(metas[metas.length - 1].id, true);
    else renderEmpty(true);
  };

  function persistState() {
    store.setSettings({
      activeId: st.activeId, per: st.per, ts: st.ts, tab: st.tab, scheme: st.scheme, scale: st.scale,
      metricStation: st.metricStation, metricLine: st.metricLine,
      showLines: st.showLines, showStations: st.showStations, showLabels: st.showLabels,
      regionOff: st.regionOff, adj: st.adj, staCharts: !!st.staCharts,
    });
  }
  function toast(msg, kind) {
    const root = document.getElementById("toast-root");
    const t = core.el("div", "toast" + (kind ? " " + kind : ""), core.esc(msg));
    root.appendChild(t);
    setTimeout(() => t.remove(), kind === "err" ? 6000 : 3200);
  }
  A.toast = toast;

  /* ---------------- static bindings ---------------- */
  function bindStatic() {
    document.getElementById("btn-open-import").onclick = () => NS.exportcenter.openImportDialog();
    document.getElementById("btn-export-center").onclick = () => NS.exportcenter.open();
    document.getElementById("btn-help").onclick = showHelp;
    document.getElementById("btn-compare").onclick = () => switchTab("compare");
    const selActive = document.getElementById("sel-active-import");
    selActive.onchange = async () => { if (selActive.value) await setActive(selActive.value, true); };
    // granularity
    document.getElementById("seg-granularity").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-g]");
      if (b && !b.disabled) {
        st.per = b.dataset.g;
        st.ts = null;
        refresh();
      }
    });
    document.getElementById("sel-bucket").onchange = (e) => {
      st.ts = e.target.value || null;
      refresh();
    };
    ["chk-lines", "chk-stations", "chk-labels"].forEach((id) => {
      document.getElementById(id).onchange = (e) => {
        if (id === "chk-lines") st.showLines = e.target.checked;
        if (id === "chk-stations") st.showStations = e.target.checked;
        if (id === "chk-labels") st.showLabels = e.target.checked;
        persistState();
        renderMap(false);
      };
    });
    const ms = document.getElementById("sel-metric-station");
    ms.onchange = () => { st.metricStation = ms.value; autoScheme(ms.value); persistState(); refresh(); };
    const ml = document.getElementById("sel-metric-line");
    ml.onchange = () => { st.metricLine = ml.value; autoScheme(ml.value); persistState(); refresh(); };
    document.getElementById("sel-scheme").onchange = (e) => { st.scheme = e.target.value; st._schemeManual = true; persistState(); refresh(); };
    document.getElementById("sel-scale").onchange = (e) => { st.scale = e.target.value; persistState(); refresh(); };
    document.getElementById("btn-fit-world").onclick = () => { NS.mapview.fitNetwork(true); };
    document.getElementById("btn-region-all").onclick = () => { st.regionOff = []; persistState(); refreshRegionUI(); refresh(); };
    document.getElementById("btn-region-fit").onclick = () => { fitVisible(); };
    // tabs
    document.getElementById("tabsbar").addEventListener("click", (e) => {
      const t = e.target.closest("button.tab");
      if (t) switchTab(t.dataset.tab);
    });
    // rank tabs
    document.querySelector("#rankpanel").addEventListener("click", (e) => {
      const t = e.target.closest("button.rank-tab");
      if (t) {
        document.querySelectorAll(".rank-tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        renderRanklist(t.dataset.rank);
      }
    });
    window.addEventListener("resize", () => { activeCharts.forEach((c) => c.resize && c.resize()); });
  }

  /* ---------------- import list ---------------- */
  async function refreshImportListMeta() {
    const metas = store.listImportsMeta();
    const ul = document.getElementById("import-list");
    ul.innerHTML = "";
    const emptyEl = document.getElementById("import-list-empty");
    emptyEl.classList.toggle("hidden", metas.length > 0);
    document.getElementById("imp-count").textContent = metas.length ? metas.length + " 档" : "";
    const sel = document.getElementById("sel-active-import");
    const cur = sel.value;
    sel.innerHTML = metas.map((m) => `<option value="${core.esc(m.id)}">${core.esc(m.label)}</option>`).join("");
    if (cur && metas.find((m) => m.id === cur)) sel.value = cur;
    metas.slice().reverse().forEach((m) => {
      const li = core.el("li", "");
      li.dataset.id = m.id;
      li.innerHTML = `<div class="imp-name"><span>${core.esc(m.label)}</span>${m.id === st.activeId ? '<span class="imp-badge">当前</span>' : ""}</div>
        <div class="imp-sub"><span>${core.esc(m.company || "")}${m.geoOk && m.finOk ? "" : m.geoOk ? " · 仅几何" : m.finOk ? " · 仅财务" : ""}</span>
        <span>${m.exportClock ? core.shortEpoch(m.exportClock) : ""}</span></div>
        <div class="imp-actions">
          <button class="btn xs" data-act="rename">重命名</button>
          <button class="btn xs" data-act="export">导出</button>
          <button class="btn xs danger" data-act="del">删除</button>
        </div>`;
      li.onclick = async (e) => {
        if (e.target.closest("[data-act]")) return;
        if (m.id !== st.activeId) await setActive(m.id, true);
      };
      li.querySelector('[data-act="rename"]').onclick = async () => {
        const v = prompt("档案名称:", m.label);
        if (v && v.trim()) { await store.updateImportMeta(m.id, { label: v.trim() }); refreshImportListMeta(); }
      };
      li.querySelector('[data-act="export"]').onclick = () => NS.exportcenter.exportSingleImport(m);
      li.querySelector('[data-act="del"]').onclick = async () => {
        const yes = await NS.exportcenter.confirm(`删除档案「${m.label}」？相关对比也会一并删除。`);
        if (!yes) return;
        await store.removeImport(m.id);
        impCache.delete(m.id);
        A.reloadAll();
      };
      ul.appendChild(li);
    });
  }

  /* ---------------- active import ---------------- */
  async function setActive(id, fit) {
    st.activeId = id;
    imp = await store.getImport(id);
    if (!imp) { renderEmpty(true); return; }
    store.rehydrate(imp);
    engine.prepare(imp);
    impCache.set(id, imp);
    persistState();
    fitRequested = fit;
    renderEmpty(false);
    refresh(true);
  }

  /* ---------------- empty state ---------------- */
  function renderEmpty(empty) {
    document.getElementById("kpis").classList.toggle("hidden", empty);
    document.getElementById("mapwrap").classList.toggle("hidden", empty);
    document.getElementById("tabsbar").classList.toggle("hidden", empty);
    document.getElementById("rankpanel").classList.toggle("hidden", empty);
    let hero = document.getElementById("empty-hero");
    if (empty) {
      if (!hero) {
        hero = core.el("div", "", "");
        hero.id = "empty-hero";
        hero.style.cssText = "flex:1;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #e3e8f0;border-radius:14px;margin:0 12px 12px";
        hero.innerHTML = `
          <div style="text-align:center;padding:30px;max-width:520px">
            <div style="font-size:34px;margin-bottom:10px">🚆</div>
            <div style="font-size:17px;font-weight:650;margin-bottom:8px">欢迎使用 NIMBY · 财务地图分析台</div>
            <div class="step-hint" style="line-height:2;margin-bottom:14px">
              1. 在 NIMBY Rails 中把线路/车站导出为 <b>JSON(时刻表)</b> 与 <b>TSV(会计账目)</b><br>
              2. 点击右上「＋ 导入游戏导出数据」，两个文件一起拖入<br>
              3. 即可在世界地图上查看线路与站点热度、线路盈亏表格、走势与历史对比
            </div>
            <div style="display:flex;gap:10px;justify-content:center">
              <button class="btn primary" id="empty-import">＋ 立即导入数据</button>
              <button class="btn" id="empty-help">使用说明</button>
            </div>
            <div style="margin-top:12px;font-size:11.4px;color:#93a0b4">数据只保存在本机浏览器中 · 可打包导出到其它设备继续分析</div>
          </div>`;
        document.getElementById("main").appendChild(hero);
        hero.querySelector("#empty-import").onclick = () => NS.exportcenter.openImportDialog();
        hero.querySelector("#empty-help").onclick = showHelp;
      }
      hero.classList.remove("hidden");
      document.getElementById("tabview").innerHTML = "";
      document.getElementById("map").innerHTML = "";
    } else {
      if (hero) hero.classList.add("hidden");
      // re-init map if cleared
      if (!NS.mapview.map() || !document.getElementById("map")._leaflet_id) {
        document.getElementById("map").innerHTML = "";
        NS.mapview.init(document.getElementById("map"), {
          onNeedToken: openMapboxTokenDialog,
          onBaseChange: (k) => store.setSettings({ baseMap: k }),
        });
        NS.mapview.setToken((store.ws().settings || {}).mapboxToken || "");
        const baseMap = (store.ws().settings || {}).baseMap;
        if (baseMap && baseMap !== "osm") NS.mapview.setBase(baseMap);
      }
      // ensure correct sizing after being hidden
      setTimeout(() => { const m = NS.mapview.map(); if (m) m.invalidateSize(); }, 60);
    }
  }

  /* Mapbox access token dialog (saved locally, never uploaded) */
  function openMapboxTokenDialog() {
    const body = core.el("div", "", "");
    body.innerHTML = `<div class="step-hint" style="margin-bottom:10px">选择 <b>Mapbox</b> 底图需要一枚公开访问令牌（Access Token，以 <span style="font-family:var(--mono)">pk.</span> 开头）。
      获取方式：登录 <b>mapbox.com</b> → 账号 → <b>Tokens</b> → 新建默认公共令牌并复制。
      Token 只保存在<b>本机浏览器</b>，仅用于向 Mapbox 请求地图瓦片。</div>
      <label class="field-label" style="margin-top:4px">Mapbox Access Token
        <input id="mb-token-input" type="password" autocomplete="off" spellcheck="false" style="border:1px solid #d4dbe7;border-radius:9px;padding:9px 11px;font-family:var(--mono);font-size:12px"
          placeholder="pk.eyJ1Ijoi…">
      </label>
      <div id="mb-token-hint" class="rt" style="margin-top:6px"></div>`;
    const inp = body.querySelector("#mb-token-input");
    inp.value = (store.ws().settings || {}).mapboxToken || "";
    const hint = body.querySelector("#mb-token-hint");
    const btnSave = core.el("button", "btn primary", "保存并使用 Mapbox");
    const btnClear = core.el("button", "btn ghost", "清除 Token(回到普通底图)");
    const m = NS.exportcenter.showModal({
      title: "Mapbox 底图设置", body, narrow: true,
      footer: [btnClear, btnSave],
    });
    inp.addEventListener("input", () => {
      const v = inp.value.trim();
      hint.textContent = v && !v.startsWith("pk.") ? "注意：公开令牌通常以 pk. 开头" : "";
    });
    btnSave.onclick = async () => {
      const v = inp.value.trim();
      if (!v) { hint.textContent = "请粘贴令牌"; return; }
      await store.setSettings({ mapboxToken: v });
      NS.mapview.setToken(v);
      NS.mapview.setBase("mb:streets");
      m.close();
      toast("Mapbox Token 已保存，已切换 Mapbox 街道底图", "ok");
    };
    btnClear.onclick = async () => {
      await store.setSettings({ mapboxToken: "" });
      NS.mapview.setToken("");
      NS.mapview.setBase("osm");
      m.close();
      toast("已清除 Token，底图回到 OpenStreetMap", "ok");
    };
  }
  A.openMapboxTokenDialog = openMapboxTokenDialog;

  /* ---------------- refresh pipeline ---------------- */
  function refresh(first) {
    if (!imp) return;
    refreshControlsUI();
    refreshAnalysis();
    renderMap(true);
  }

  /* refresh control widgets based on active import availability */
  function refreshControlsUI() {
    const metas = store.listImportsMeta();
    refreshImportListMeta();
    document.getElementById("tb-center").classList.toggle("hidden", !metas.length);    // granularity buttons
    const seg = document.getElementById("seg-granularity");
    seg.innerHTML = "";
    core.PERIODS.forEach((p) => {
      const b = core.el("button", "", p.label);
      b.dataset.g = p.id;
      const avail = engine.buckets(imp, p.id, "li").length || engine.buckets(imp, p.id, "st").length || engine.buckets(imp, p.id, "co").length;
      if (!avail) b.disabled = true;
      if (p.id === st.per) b.classList.add("active");
      seg.appendChild(b);
    });
    // bucket select
    const sel = document.getElementById("sel-bucket");
    const list = engine.buckets(imp, st.per, "li");
    const use = list.length ? list : engine.buckets(imp, st.per, "st");
    const used = list.length ? list : (engine.buckets(imp, st.per, "st").length ? engine.buckets(imp, st.per, "st") : engine.buckets(imp, st.per, "co"));
    if (!st.ts || !used.includes(st.ts)) st.ts = used.length ? used[used.length - 1] : null;
    sel.innerHTML = used.length
      ? used.map((t) => `<option value="${core.esc(t)}">${core.fmtBucket(st.per, t)}</option>`).join("")
      : '<option value="">（无账期）</option>';
    sel.value = st.ts || "";
    // metric options
    const fillMetric = (selId, ent, cur) => {
      const s = document.getElementById(selId);
      const prev = s.value;
      s.innerHTML = engine.METRICS
        .filter((m) => m.ent.includes(ent))
        .map((m) => `<option value="${m.id}">${core.esc(m.label)}${m.unit === "money" ? " (金额)" : m.unit === "pct" ? " (比率)" : ""}</option>`).join("");
      s.value = st[cur] && engine.METRIC_BY_ID[st[cur]] ? st[cur] : prev;
      if (!s.value && s.options.length) s.value = s.options[0].value;
      st[cur] = s.value;
    };
    fillMetric("sel-metric-station", "st", "metricStation");
    fillMetric("sel-metric-line", "li", "metricLine");
    refreshRegionUI();
  }
  function refreshRegionUI() {
    const chipsEl = document.getElementById("region-chips");
    chipsEl.innerHTML = "";
    if (!imp || !imp.regions) return;
    const off = new Set(st.regionOff);
    const regionCountEl = document.getElementById("region-count");
    regionCountEl.textContent = imp.regions.length + " 区";
    imp.regions.forEach((rg) => {
      const chip = core.el("span", "chip" + (off.has(rg.name) ? " off" : " on"), "");
      chip.innerHTML = `${core.esc(rg.name)}<span class="n">${rg.n}</span>`;
      chip.onclick = () => {
        if (off.has(rg.name)) off.delete(rg.name); else off.add(rg.name);
        st.regionOff = Array.from(off);
        persistState();
        refreshRegionUI();
        renderMap(true);
      };
      chipsEl.appendChild(chip);
    });
  }

  /* ---------------- analysis-side refresh ---------------- */
  function refreshAnalysis() {
    killCharts();
    renderKpis();
    renderScopePanel();
    renderRanklist(document.querySelector(".rank-tab.active")?.dataset.rank || "worst");
    renderDataTips();
    renderActiveTab();
  }

  /* ---------------- KPIs ---------------- */
  function aggOf(kind) { return engine.aggBucket(imp, kind, st.per, st.ts); }
  function kpiVal(kind, metricId) {
    if (!st.ts) return null;
    const m = aggOf(kind);
    if (kind === "co") return m.size ? engine.metricOn(metricId, m.values().next().value) : null;
    let sum = 0, any = false;
    for (const a of m.values()) {
      const v = engine.metricOn(metricId, a);
      if (v != null) { sum += v; any = true; }
    }
    return any ? sum : null;
  }
  function renderKpis() {
    const el = document.getElementById("kpis");
    const rev = kpiVal("co", "revenue"), cost = kpiVal("co", "opex"), profit = kpiVal("co", "opProfit");
    const board = kpiVal("co", "paxBoard");
    const scope = st.ts ? `账期 ${core.fmtBucket(st.per, st.ts)}` : "无账期";
    // previous daily bucket delta for profit/rev
    let dProfit = null;
    if (st.per === "daily" && st.ts) {
      const list = engine.buckets(imp, "daily", "co");
      const i = list.indexOf(st.ts);
      if (i > 0) {
        const m = engine.aggBucket(imp, "co", "daily", list[i - 1]);
        if (m.size) {
          const pv = engine.metricOn("opProfit", m.values().next().value);
          if (pv != null && profit != null) dProfit = profit - pv;
        }
      }
    }
    const cards = [
      ["运营利润(毛利)", profit, "money", dProfit, profit == null ? "" : core.moneyClass(profit)],
      ["票款收入", rev, "money", null, rev == null ? "" : core.moneyClass(rev)],
      ["运营成本", cost, "money", null, cost == null ? "" : core.moneyClass(-cost)],
      ["登乘客流", board, "pax", null, ""],
    ];
    el.innerHTML = cards.map(([l, v, unit, d, cls]) => `
      <div class="kpi"><div class="k-l"><span>${l}</span><span class="rt">${scope}</span></div>
        <div class="k-v ${unit === "money" ? "money " : ""}${cls || ""}">${fmtMetric(v, unit)}</div>
        <div class="k-s">${d != null ? deltaHtml(d, v - d) : unit === "money" ? "金额·游戏货币" : "单位:人次"}</div></div>`).join("");
  }
  function deltaHtml(d, base) {
    if (d == null) return "";
    const cls = d >= 0 ? "up" : "down";
    const p = base ? (d / Math.abs(base)) * 100 : 0;
    return `较前日 <span class="dlta ${cls}">${d >= 0 ? "+" : ""}${core.fmtMoney(d, false)} (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)</span>`;
  }
  function fmtMetric(v, unit) {
    if (v == null) return "—";
    if (unit === "pax") return core.fmtNum(v);
    return core.fmtMoney(v);
  }

  /* ---------------- scope panel (rankpanel cards + tips) ---------------- */
  function renderScopePanel() {
    const el = document.getElementById("metriccards");
    const liAggs = aggOf("li");
    let nLines = 0, sumBoard = 0, sumDep = 0, sumFares = 0;
    for (const a of liAggs.values()) {
      nLines++;
      sumBoard += engine.metricOn("paxBoard", a) || 0;
      sumDep += engine.metricOn("departures", a) || 0;
      sumFares += engine.metricOn("fares", a) || 0;
    }
    const stAggs = aggOf("st");
    const nSt = stAggs.size;
    const co = kpiVal("co", "cash");
    el.innerHTML = `
      <div class="mcard"><span class="m-l">线路数(有账)</span><span class="m-v">${nLines}</span></div>
      <div class="mcard"><span class="m-l">站点数(有账)</span><span class="m-v">${nSt || "—"}</span></div>
      <div class="mcard"><span class="m-l">线路票款合计</span><span class="m-v">${core.fmtMoney(sumFares)}</span></div>
      <div class="mcard"><span class="m-l">全网客流</span><span class="m-v">${core.fmtNum(sumBoard)}</span></div>
      <div class="mcard"><span class="m-l">全网发车</span><span class="m-v">${core.fmtNum(sumDep)}</span></div>
      <div class="mcard"><span class="m-l">公司现金流</span><span class="m-v ${core.moneyClass(co ?? 0)}">${fmtMetric(co, "money")}</span></div>`;
  }
  function renderDataTips() {
    const el = document.getElementById("datatips");
    const tips = [];
    tips.push(`口径: <b>运营利润</b>=票款净额(票款+退票+补偿) + 运行/维护/干预成本(负)。线路级未含建设与购车等资本支出(公司级现金流才含)。`);
    if (imp) {
      const liDaily = engine.buckets(imp, "daily", "li");
      const hasLifetime = engine.buckets(imp, "lifetime", "co").length;
      if (liDaily.length) tips.push(`日账覆盖 <b>${liDaily.length} 天</b>(${liDaily[0]} ~ ${liDaily[liDaily.length - 1]})，切换粒度可看周/月/季/年趋势。`);
      if (hasLifetime) tips.push(`「累计」粒度给出自开线以来的<b>终身合计</b>，适合看总盈亏。`);
    }
    if (st.ts && kpiVal("co", "opProfit") == null) tips.push("当前账期没有公司级行(可能该日无运营或仅部分线路)，部分卡片为—。");
    const ab = store.ws().settings || {};
    tips.push(`导入的数据已<b>自动保存在本机浏览器</b>(刷新/重开不丢)${ab.autoBackup === false ? "；自动文件备份当前为关(可在导出中心打开)" : "；且每次导入会自动在“下载”生成备份文件(可在导出中心关闭)"}。`);
    el.innerHTML = tips.map((t) => `<div>· ${t}</div>`).join("");
  }

  /* ---------------- ranks ---------------- */
  function renderRanklist(kind) {
    const el = document.getElementById("ranklist");
    el.innerHTML = "";
    if (!st.ts) { el.innerHTML = '<div class="empty-hint">暂无账期</div>'; return; }
    const liMap = aggOf("li");
    const items = [];
    if (kind === "busy") {
      const stMap = aggOf("st");
      for (const [id, a] of stMap) {
        const sd = NS.engine.describeStations(imp).get(id);
        const v = engine.metricOn("paxBoard", a);
        items.push({ key: id, name: (sd && sd.name) || ("站#" + id), sub: "登乘 " + core.fmtNum(v), v, kind: "st" });
      }
      items.sort((a, b) => b.v - a.v);
    } else {
      for (const [name, a] of liMap) {
        const v = engine.metricOn("opProfit", a);
        const rev = engine.metricOn("fares", a);
        items.push({ key: name, name, sub: `票款 ${core.fmtMoney(rev)}`, v, kind: "li" });
      }
      items.sort((a, b) => (kind === "best" ? b.v - a.v : a.v - b.v));
    }
    items.slice(0, 8).forEach((it, i) => {
      const row = core.el("div", "rank-item");
      const cls = core.moneyClass(it.v ?? 0);
      row.innerHTML = `<div class="rank-r1"><span class="rank-no">${i + 1}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${core.esc(it.name)}</span><span class="rank-val ${cls}">${it.v == null ? "—" : core.fmtMoney(it.v)}</span></div>
        <div class="rank-r2"><span></span><span>${core.esc(it.sub || "")}</span></div>`;
      row.onclick = () => {
        if (it.kind === "st") focusStation(it.key);
        else focusLine(String(it.key));
      };
      el.appendChild(row);
    });
    if (!items.length) el.innerHTML = '<div class="empty-hint">无数据</div>';
  }

  /* ---------------- heat / map ---------------- */
  const SIGNED_METRICS = new Set(["opProfit", "cash", "marginRatio", "profitPerKm", "refunds", "compensations", "interest"]);
  function autoScheme(metricId) {
    if (st._schemeManual) return;
    if (SIGNED_METRICS.has(metricId)) {
      if (st.scheme !== "div") {
        st.scheme = "div";
        const sel = document.getElementById("sel-scheme");
        if (sel) sel.value = "div";
      }
    } else if (st.scheme === "div" && !SIGNED_METRICS.has(st.metricLine) && !SIGNED_METRICS.has(st.metricStation)) {
      st.scheme = "seq";
      const sel = document.getElementById("sel-scheme");
      if (sel) sel.value = "seq";
    }
  }
  function visibleStationSet() {
    if (!imp) return new Set();
    const off = new Set(st.regionOff || []);
    const set = new Set();
    for (const s of imp.stations) {
      if (s.lon == null) continue;
      if (off.size && off.has(imp.regionKeyOfStation(s.id))) continue;
      set.add(s.id);
    }
    return set;
  }
  function computeHeat() {
    const out = { lineVals: new Map(), stationVals: new Map(), lineDomain: null, stationDomain: null, ok: false };
    if (!imp || !st.ts || !imp.finOk) return out;
    const lm = aggOf("li");
    const sm = aggOf("st");
    const mLine = engine.METRIC_BY_ID[st.metricLine], mStation = engine.METRIC_BY_ID[st.metricStation];
    for (const [name, a] of lm) {
      const v = mLine ? engine.metricOn(mLine.id, a) : null;
      out.lineVals.set(name, v);
    }
    for (const [id, a] of sm) {
      const v = mStation ? engine.metricOn(mStation.id, a) : null;
      out.stationVals.set(id, v);
    }
    const lineArr = Array.from(out.lineVals.values()).filter((v) => v != null && isFinite(v));
    const stArr = Array.from(out.stationVals.values()).filter((v) => v != null && isFinite(v));
    out.lineDomain = lineArr.length ? [Math.min(...lineArr), Math.max(...lineArr)] : null;
    out.stationDomain = stArr.length ? [Math.min(...stArr), Math.max(...stArr)] : null;
    out.ok = !!(out.lineDomain || out.stationDomain);
    return out;
  }
  function scaleNormFor(scheme, mode, v, domain, mid) {
    if (v == null || !domain) return null;
    return core.scaleNorm(scheme, mode, v, domain[0], domain[1], mid);
  }
  function renderMap(fit) {
    if (!imp || imp.stations.length === 0) return;
    fitRequested = fit || fitRequested;
    const vis = visibleStationSet();
    const heat = computeHeat();
    const off = new Set(st.regionOff || []);
    const scheme = st.scheme;
    const mode = st.scale;
    const visShow = (id) => {
      if (off.size && off.has(imp.regionKeyOfStation(id))) return false;
      return true;
    };
    const heatC = (vals, domain, mid) => (id) => {
      const v = vals.get(id);
      if (v == null) return null;
      const t = scaleNormFor(scheme, mode, v, domain, mid);
      if (t == null) return null;
      return core.heatColor(scheme, t);
    };
    const lineHeatC = heatC(heat.lineVals, heat.lineDomain, 0);
    const stationHeatC = heatC(heat.stationVals, heat.stationDomain, 0);
    const metricStationLabel = (engine.METRIC_BY_ID[st.metricStation] || {}).label || "";
    const metricLineLabel = (engine.METRIC_BY_ID[st.metricLine] || {}).label || "";
    const hd = heat;
    NS.mapview.render(imp, {
      showLines: st.showLines,
      showStations: st.showStations,
      showLabels: st.showLabels,
      stationShown: visShow,
      fitAll: fitRequested,
      lineColor: (name) => {
        if (st.showLines && scheme !== "route" && lineHeatC) {
          const c = lineHeatC(name);
          if (c) return c;
        }
        const d = NS.engine.describeLines(imp).get(name);
        return (d && d.color) || [110, 120, 140];
      },
      lineWidth: (name) => {
        const v = heat.lineVals.get(name);
        if (v == null) return 2.2;
        const mag = Math.abs(v);
        const maxAbs = heat.lineDomain ? Math.max(Math.abs(heat.lineDomain[0]), Math.abs(heat.lineDomain[1]), 1e-9) : 1;
        const t = core.scaleNorm("seq", mode, mag, 0, maxAbs, 0);
        return 2.8 + t * 10;
      },
      lineOpacity: (name) => (heat.lineVals.has(name) ? 1 : 0.45),
      linePopup: (name) => popupLine(name, heat),
      stationColor: (id) => {
        if (stationHeatC) {
          const c = stationHeatC(id);
          if (c) return c;
        }
        return [150, 160, 175];
      },
      stationRadius: (id) => {
        const v = heat.stationVals.get(id);
        if (v == null) return 4;
        const maxAbs = heat.stationDomain ? Math.max(Math.abs(heat.stationDomain[0]), Math.abs(heat.stationDomain[1]), 1e-9) : 1;
        const t = core.scaleNorm("seq", mode, Math.abs(v), 0, maxAbs, 0);
        return 3.5 + t * 8;
      },
      stationPopup: (id) => popupStation(id, heat),
      heatInfo: { metricStationLabel, metricLineLabel, hd },
    });
    fitRequested = false;
    renderLegend(heat, metricStationLabel, metricLineLabel);
  }
  function renderLegend(heat, stationLabel, lineLabel) {
    const box = document.getElementById("legend-heat");
    const unitOf = (m) => {
      const u = (engine.METRIC_BY_ID[st[m]] || {}).unit;
      return u === "money" ? "(金额)" : u === "pax" ? "(人次)" : u === "pct" ? "(%)" : "";
    };
    let html = "";
    if (heat.stationDomain && st.showStations) {
      html += `<div class="legend-title">站点热度 · ${core.esc(stationLabel)} ${unitOf("metricStation")}</div>
        <div class="legend-gradient" style="background:${core.heatGradientCss(st.scheme)}"></div>
        <div class="legend-labels"><span>${fmtLegend(st.metricStation, heat.stationDomain[0])}</span><span>${fmtLegend(st.metricStation, heat.stationDomain[1])}</span></div>`;
    }
    if (heat.lineDomain && st.showLines) {
      html += `<div class="legend-title" style="margin-top:7px">线路热度(线宽=幅度) · ${core.esc(lineLabel)} ${unitOf("metricLine")}</div>
        <div class="legend-labels" style="margin-top:3px"><span>${fmtLegend(st.metricLine, heat.lineDomain[0])}</span><span>${fmtLegend(st.metricLine, heat.lineDomain[1])}</span></div>
        <div class="heat-row" style="margin-top:4px"><span>低</span><span style="flex:1;height:6px;background:linear-gradient(90deg,#c9d2e0,#3a465c);border-radius:4px"></span><span>高</span></div>`;
    }
    if (!html) html = '<div class="legend-title" style="color:#93a0b4">当前账期无热度数据<br>(选有账目的粒度/账期)</div>';
    box.innerHTML = html;
  }
  function fmtLegend(metricId, v) {
    const def = engine.METRIC_BY_ID[metricId] || {};
    if (v == null) return "—";
    if (def.unit === "money") return core.fmtMoney(v);
    if (def.unit === "pct") return (v * 100).toFixed(1) + "%";
    if (def.unit === "km") return v.toFixed(0) + " km";
    return core.fmtNum(v);
  }

  /* ---------------- popups ---------------- */
  function popupStation(id, heat) {
    const sd = engine.describeStations(imp).get(id);
    const m = NS.engine.stationAggAt(imp, st.per, st.ts, id);
    const rows = m ? [
      ["登乘客流", core.fmtNum(engine.metricOn("paxBoard", m))],
      ["到达目的地", core.fmtNum(engine.metricOn("dest", m))],
      ["换乘人次", core.fmtNum(engine.metricOn("transfer", m))],
      ["新出行需求", core.fmtNum(engine.metricOn("paxSpawn", m))],
      ["等待超时", core.fmtNum(engine.metricOn("wait", m))],
      ["票款收入", core.fmtMoney(engine.metricOn("fares", m))],
      ["平均票价", core.fmtMoney(engine.metricOn("fareAvg", m))],
      ["发车趟次", core.fmtNum(engine.metricOn("departures", m))],
    ].filter(([, v]) => v !== "—" && v != null) : [];
    const lines = (sd && sd.lines) || [];
    const sv = heat.stationVals.get(id);
    const heatLine = sv == null ? "" : `热度(${(engine.METRIC_BY_ID[st.metricStation] || {}).label || ""}) = <b>${fmtLegend(st.metricStation, sv)}</b><br>`;
    const busBtn = `<div style="margin-top:7px"><button class="btn xs primary" onclick="NFB.app.focusStation(${id})">在地图中查看</button> <button class="btn xs" onclick="NFB.app.jumpToStationTab(${id})">站点表定位</button></div>`;
    return `<b>${core.esc((sd && sd.name) || "站点")}</b> <span class="tag-line">${core.esc((sd && sd.region) || "")}</span><br>
      ${heatLine}<span class="rt">账期 ${core.fmtBucket(st.per, st.ts)}</span><br>
      ${rows.map(([k, v]) => `${k}: <b>${v}</b>`).join("<br>")}
      ${lines.length ? `<br><span class="rt">服务线路: ${lines.map(core.esc).join(" · ")}</span>` : ""}${busBtn}`;
  }
  function popupLine(name, heat) {
    const d = engine.describeLines(imp).get(name) || {};
    const m = engine.lineAggAt(imp, st.per, st.ts, name);
    const metrics = m ? [
      ["营业收入", engine.metricOn("revenue", m), "money"],
      ["运营成本", engine.metricOn("opex", m), "money"],
      ["运营利润", engine.metricOn("opProfit", m), "money"],
      ["利润率", engine.metricOn("marginRatio", m), "pct"],
      ["登乘客流", engine.metricOn("paxBoard", m), "pax"],
      ["发车趟次", engine.metricOn("departures", m), "pax"],
      ["列车里程", engine.metricOn("distKm", m), "km"],
      ["平均票价", engine.metricOn("fareAvg", m), "money"],
      ["每公里利润", engine.metricOn("profitPerKm", m), "money"],
    ].filter(([, v]) => v != null) : [];
    const col = (d.color || [120, 130, 150]).slice();
    const f = (v, u) => u === "money" ? core.fmtMoney(v) : u === "pct" ? core.fmtPct(v) : u === "km" ? core.fmtKm(v * 1000) : core.fmtNum(v);
    const lv = heat.lineVals.get(name);
    const heatLine = lv == null ? "" : `<br>线路热度(${(engine.METRIC_BY_ID[st.metricLine] || {}).label || ""}) = <b>${fmtLegend(st.metricLine, lv)}</b>`;
    return `<span class="name-cell"><span class="dot" style="background:${core.hexCss(col)}"></span><b>${core.esc(name)}</b></span>
      <span class="tag-line">${core.esc(d.code || "")} · ${core.esc(d.region || "")}${d.lenKm ? " · " + d.lenKm.toFixed(1) + " km" : ""}${d.stopsN ? " · " + d.stopsN + " 站" : ""}</span>
      ${(function () { const pm = engine.variantParentOf(imp, name); return pm ? `<br><span class="tag-line" style="color:#8a63d2">🚄 特快/附属线：走向沿主线「${core.esc(pm)}」对齐(虚线)</span>` : ""; })()}<br>
      <span class="rt">账期 ${core.fmtBucket(st.per, st.ts)}</span>${heatLine}<br>
      ${metrics.map(([k, v, u]) => `${k}: <b>${f(v, u)}</b>`).join("<br>")}
      ${m ? "" : "<br><span class='rt'>该账期无此线路账目(可能未开行)</span>"}
      <div style="margin-top:7px"><button class="btn xs primary" onclick="NFB.app.focusLine('${core.esc(name).replace(/'/g, "\\'")}')">在线路表中定位</button></div>`;
  }

  function focusStation(id) {
    NS.mapview.highlightStation(id);
  }
  A.jumpToStationTab = function (id) {
    st._focusStation = id;
    switchTab("stations");
  };
  function focusLine(name) {
    // fit bounds of that line
    if (imp) {
      const ln = imp.lines.find((x) => x.name === name);
      if (ln) {
        const pts = [];
        for (const sid of ln.staIds) {
          const s = imp.stById.get(sid);
          if (s && s.lon != null) pts.push([s.lat, s.lon]);
        }
        if (pts.length) NS.mapview.fitRect(L.latLngBounds(pts), 13);
      }
    }
    st._focusLine = name;
    switchTab("lines");
  }
  function fitVisible() {
    const vis = visibleStationSet();
    if (!vis.size) return;
    const pts = [];
    for (const s of imp.stations) if (vis.has(s.id) && s.lon != null) pts.push([s.lat, s.lon]);
    if (pts.length) NS.mapview.fitRect(L.latLngBounds(pts), 13);
  }

  /* ---------------- tabs ---------------- */
  const tabs = ["overview", "lines", "stations", "trend", "compare"];
  function switchTab(tab) {
    if (!tabs.includes(tab)) tab = "overview";
    st.tab = tab;
    persistState();
    document.querySelectorAll("#tabsbar .tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
    if (tab === "compare") {
      const need2 = store.listImportsMeta().length >= 2;
      if (!need2) {
        toast("对比至少需要两个档案：请先导入第二个财务快照(同一公司不同日期的导出)", "err");
        return;
      }
    }
    renderActiveTab();
  }
  function renderActiveTab() {
    const view = document.getElementById("tabview");
    view.innerHTML = "";
    currentCSV = null;
    if (!imp) return;
    const t = st.tab;
    const hint = document.getElementById("view-hint");
    if (t === "compare") {
      hint.textContent = "对比使用各档案各自“最新账期”";
      view.classList.add("tabpage", "scroll");
      NS.compare.open(view, { auto: true });
      return;
    }
    hint.textContent = "";
    if (t === "overview") renderOverview(view);
    else if (t === "lines") renderLines(view);
    else if (t === "stations") renderStations(view);
    else if (t === "trend") renderTrend(view);
  }
  function killCharts() { activeCharts.forEach((c) => charts.dispose(c)); activeCharts.length = 0; }
  function mkChart(elId) {
    const el = document.getElementById(elId);
    if (!el) return null;
    const c = charts.mk(el);
    activeCharts.push(c);
    return c;
  }
  const unitFmt = (m) => { const u = (engine.METRIC_BY_ID[m] || {}).unit; return u === "money" ? "money" : u === "pct" ? "pct" : "pax"; };

  /* ============ OVERVIEW ============ */
  function renderOverview(view) {
    view.classList.add("tabpage", "scroll");
    const title = (t, sub) => `<div class="cc-head">${t}<span class="sub">${sub || ""}</span></div>`;
    const row1 = core.el("div", "charts-row");
    const c1 = core.el("div", "chart-card");
    c1.innerHTML = title("公司经营走势", `按${core.periodLabel(st.per)}账期 · 金额`);
    c1.innerHTML += '<div id="ov-trend-money" class="chart sm"></div>';
    const c2 = core.el("div", "chart-card");
    c2.innerHTML = title("客流与运力走势", `按${core.periodLabel(st.per)}账期`);
    c2.innerHTML += '<div id="ov-trend-pax" class="chart sm"></div>';
    row1.append(c1, c2);
    view.appendChild(row1);
    const row2 = core.el("div", "charts-row");
    const c3 = core.el("div", "chart-card");
    c3.innerHTML = title("线路运营利润构成", "前12名+其余");
    c3.innerHTML += '<div id="ov-donut" class="chart sm"></div>';
    const c4 = core.el("div", "chart-card");
    c4.innerHTML = title("盈亏最大线路 Top 12", st.ts ? core.fmtBucket(st.per, st.ts) : "");
    c4.innerHTML += '<div id="ov-bar" class="chart sm"></div>';
    row2.append(c3, c4);
    view.appendChild(row2);

    const tr = engine.trend(imp, st.per);
    const xLbl = tr.map((x) => core.fmtBucket(st.per, x.ts));
    const pick = (f) => tr.map((x) => (x.co ? f(x.co) : null));
    if (xLbl.length) {
      const cA = mkChart("ov-trend-money");
      charts.lineTrend(cA, xLbl, [
        { name: "营业收入", data: pick((a) => a.revenue), color: "#3457d5" },
        { name: "运营成本", data: pick((a) => a.opex), color: "#e0a321" },
        { name: "运营利润", data: pick((a) => a.opProfit), color: "#1d9a63" },
      ], { unit: "money", legend: true });
      const cB = mkChart("ov-trend-pax");
      charts.lineTrend(cB, xLbl, [
        { name: "登乘客流", data: pick((a) => a.paxBoard), color: "#3457d5" },
        { name: "发车趟次", data: pick((a) => a.departures), color: "#8a63d2" },
      ], { unit: "pax", legend: true });
    } else {
      view.appendChild(core.el("div", "note-box", "当前粒度没有账期数据 → 请切换「日/周/月…累计」等有账目的粒度，或先导入会计 TSV。"));
      return;
    }
    const liMap = aggOf("li");
    if (!liMap.size) {
      view.appendChild(core.el("div", "note-box", "当前账期没有线路账目 → 请在左栏选择有数据的账期(如最新日期)，或改为「累计」粒度。"));
      return;
    }
    const arr = [];
    for (const [name, a] of liMap) {
      const v = engine.metricOn("opProfit", a);
      if (v != null && Math.abs(v) > 1e-6) arr.push({ name, value: v });
    }
    arr.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    const donutItems = arr.slice(0, 12).map((x) => ({ name: x.name, value: x.value }));
    if (arr.length > 12) donutItems.push({ name: `其余 ${arr.length - 12} 线`, value: arr.slice(12).reduce((s, x) => s + x.value, 0) });
    charts.donut(mkChart("ov-donut"), donutItems, { unit: "money" });
    const desc = engine.describeLines(imp);
    const barTop = arr.slice(0, 12).map((x) => ({ name: x.name, value: x.value, color: (desc.get(x.name) || {}).color || [120, 130, 150] }));
    charts.barH(mkChart("ov-bar"), barTop.map(({ name, value }) => ({ name, value })), {
      colorBy: (n) => (barTop.find((x) => x.name === n) || {}).color || [120, 130, 150], unit: "money",
    });
  }

  /* ============ LINES ============ */
  function renderLines(view) {
    view.classList.add("tabpage", "fit");
    const card = core.el("div", "tbl-card");
    card.style.flex = "1";
    const head = core.el("div", "tbl-head");
    const title = core.el("span", "t", "线路财务明细");
    head.appendChild(title);
    const tools = core.el("div", "tbl-tools");
    const adjLbl = core.el("label", "chk");
    adjLbl.innerHTML = `<input type="checkbox" id="ln-adj" ${st.adj ? "checked" : ""}><span>含公司级分摊</span>`;
    const search = core.el("div", "searchbox");
    search.innerHTML = `<input id="ln-search" placeholder="搜索线路…"><span class="sx" title="清除">✕</span>`;
    search.querySelector(".sx").onclick = () => { search.querySelector("input").value = ""; applyFilter(); };
    const csvBtn = core.el("button", "btn xs", "⤓ 导出CSV");
    const note = core.el("div", "foot-note", "");
    tools.append(adjLbl, search, csvBtn);
    head.appendChild(tools);
    card.appendChild(head);
    const wrap = core.el("div", "");
    wrap.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column";
    const tableHost = core.el("div", "");
    tableHost.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column";
    wrap.appendChild(tableHost);
    card.appendChild(wrap);
    card.appendChild(note);
    view.appendChild(card);

    const desc = engine.describeLines(imp);
    const liMap = aggOf("li");
    const co = st.ts ? engine.companyAgg(imp, st.per, st.ts) : null;
    // compute line rows
    function buildRows() {
      const rows = [];
      let sumOp = 0, sumFaresAll = 0;
      if (co) {
        const opCo = engine.metricOn("opProfit", co);
        if (opCo != null) sumOp = opCo;
      }
      const fareTotal = Array.from(liMap.values()).reduce((s, a) => s + (engine.metricOn("fares", a) || 0), 0);
      for (const [name, a] of liMap) {
        const d = desc.get(name) || {};
        const fares = engine.metricOn("fares", a);
        const prof = engine.metricOn("opProfit", a);
        const row = {
          __key: name,
          name, code: d.code || "", region: d.region || "",
          stopsN: d.stopsN ?? null, lenKm: d.lenKm ?? null,
          fares, opex: engine.metricOn("opex", a), opProfit: prof,
          paxBoard: engine.metricOn("paxBoard", a), departures: engine.metricOn("departures", a),
          marginRatio: engine.metricOn("marginRatio", a), fareAvg: engine.metricOn("fareAvg", a),
          profitPerKm: engine.metricOn("profitPerKm", a),
          adjShare: null, adjProfit: null,
          _color: d.color || [120, 130, 150],
          _share: fareTotal ? (fares || 0) / fareTotal : 0,
        };
        rows.push(row);
      }
      // adjustment based on company - sum(lines)
      if (st.adj && co && rows.length) {
        const sumProf = rows.reduce((s, r) => s + (r.opProfit || 0), 0);
        const d = (engine.metricOn("opProfit", co) || 0) - sumProf;
        for (const r of rows) {
          r.adjShare = d * r._share;
          r.adjProfit = (r.opProfit ?? 0) + r.adjShare;
        }
      }
      return rows;
    }
    let rows = buildRows();
    let tbl = null;
    function fmtMoneyOrDash(v) { return v == null ? "—" : core.fmtMoney(v); }
    function cols() {
      const c = [
        { k: "name", label: "线路", fmt: (v, r) => `<span class="name-cell"><span class="dot" style="background:${core.hexCss(r._color)}"></span>${core.esc(v)}</span>`, csv: (v) => v },
        { k: "code", label: "代码", fmt: (v) => core.esc(v || "—") },
        { k: "region", label: "区域", fmt: (v) => core.esc(v || "—") },
        { k: "stopsN", label: "站点", num: true, fmt: (v) => v ?? "—" },
        { k: "lenKm", label: "里程km", num: true, fmt: (v) => (v == null ? "—" : v.toFixed(1)) },
        { k: "fares", label: "票款收入", num: true, fmt: fmtMoneyOrDash, title: "票款(不含退票补偿)" },
        { k: "opex", label: "运营成本", num: true, fmt: (v) => `<span class="${core.moneyClass(-(v ?? 0))}">${fmtMoneyOrDash(v)}</span>` },
        { k: "opProfit", label: "运营利润", num: true, fmt: (v) => `<span class="${core.moneyClass(v ?? 0)}">${fmtMoneyOrDash(v)}</span>`, title: "票款净额+成本(负)" },
        ...(st.adj ? [
          { k: "adjShare", label: "分摊差额", num: true, fmt: (v) => `<span class="${core.moneyClass(v ?? 0)}">${fmtMoneyOrDash(v)}</span>` },
          { k: "adjProfit", label: "含分摊利润", num: true, fmt: (v) => `<span class="${core.moneyClass(v ?? 0)}">${fmtMoneyOrDash(v)}</span>` },
        ] : []),
        { k: "paxBoard", label: "登乘客流", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
        { k: "departures", label: "发车趟次", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
        { k: "marginRatio", label: "利润率", num: true, fmt: (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%") },
        { k: "fareAvg", label: "平均票价", num: true, fmt: fmtMoneyOrDash },
        { k: "profitPerKm", label: "每km利润", num: true, fmt: fmtMoneyOrDash },
      ];
      return c;
    }
    function draw() {
      const host = tableHost;
      host.innerHTML = "";
      tbl = NS.tables.mkTable(host, {
        cols: cols(),
        rows: rows,
        sortBy: "opProfit",
        emptyText: "当前账期没有线路账目（请换粒度/账期，或导入财务TSV）",
        onSelect: (r) => focusLine(String(r.name)),
      });
      const sumF = rows.reduce((s, r) => s + (r.fares || 0), 0);
      const sumP = rows.reduce((s, r) => s + (r.opProfit || 0), 0);
      const n = rows.length;
      note.innerHTML = `显示 ${n} 条线路 · 票款合计 ${core.fmtMoney(sumF)} · 运营利润合计 ${core.fmtMoney(sumP)}。` +
        (st.adj ? ` 分摊差额=公司级运营利润(${fmtMoneyOrDash(co ? engine.metricOn("opProfit", co) : null)}) − 线路合计，按票款占比分摊。` : ` 提示：退票/补偿及少量维护差异记在公司级；勾选「含公司级分摊」后按票款比例摊到各线路。`);
    }
    const applyFilter = () => {
      const q = (document.getElementById("ln-search").value || "").trim().toLowerCase();
      rows = buildRows();
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
      draw();
    };
    search.querySelector("input").oninput = applyFilter;
    adjLbl.querySelector("input").onchange = (e) => { st.adj = e.target.checked; persistState(); rows = buildRows(); draw(); };
    csvBtn.onclick = () => {
      if (!tbl) return;
      core.download(`线路财务_${core.fmtBucket(st.per, st.ts || "")}.csv`, tbl.getCSV(), "text/csv;charset=utf-8");
    };
    draw();
  }

  /* ============ STATIONS ============ */
  function renderStations(view) {
    view.classList.add("tabpage", "fit");
    const row1 = core.el("div", "charts-row");
    const mk = (titleTxt, id) => {
      const c = core.el("div", "chart-card");
      c.innerHTML = `<div class="cc-head">${titleTxt}<span class="sub">${st.ts ? core.fmtBucket(st.per, st.ts) : ""}</span></div><div id="${id}" class="chart sm"></div>`;
      return c;
    };
    const chartsVisible = !!st.staCharts;
    if (chartsVisible) {
      row1.appendChild(mk("登乘客流 Top 12 站点", "st-bar-board"));
      row1.appendChild(mk("票款收入 Top 12 站点", "st-bar-fare"));
      view.appendChild(row1);
    }
    const card = core.el("div", "tbl-card");
    card.style.flex = "1";
    const head = core.el("div", "tbl-head");
    head.appendChild(core.el("span", "t", "站点客流明细"));
    const tools = core.el("div", "tbl-tools");
    const search = core.el("div", "searchbox");
    search.innerHTML = `<input id="st-search" placeholder="搜索站点…"><span class="sx">✕</span>`;
    search.querySelector(".sx").onclick = () => { search.querySelector("input").value = ""; apply(); };
    const chkCharts = core.el("label", "chk");
    chkCharts.innerHTML = `<input type="checkbox" ${chartsVisible ? "checked" : ""}><span>排行图</span>`;
    chkCharts.querySelector("input").onchange = (e) => {
      st.staCharts = e.target.checked;
      persistState();
      switchTab("stations");
    };
    const csvBtn = core.el("button", "btn xs", "⤓ 导出CSV");
    tools.append(chkCharts, search, csvBtn);
    head.appendChild(tools);
    card.appendChild(head);
    const wrap = core.el("div", "");
    wrap.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column";
    const host = core.el("div", "");
    host.style.cssText = "flex:1;min-height:0";
    wrap.appendChild(host);
    card.appendChild(wrap);
    const stDi = engine.derivedInfo(imp, "st", st.per, st.ts);
    const stNat = engine.hasNativeRows(imp, "st", st.per);
    let noteTxt = "按站点行账目统计。点击行可在地图上定位。";
    let emptyTxt = "当前账期没有站点账目";
    if (!stNat && st.per !== "daily" && st.per !== "lifetime") {
      if (stDi) {
        noteTxt += ` 站点账目导出仅有「日/累计」，本表已在“${core.periodLabel(st.per)}”粒度下由日账自动汇总：覆盖 ${stDi.days} 天（${stDi.from} ~ ${stDi.to}）。`;
      } else {
        const avail = engine.buckets(imp, st.per, "st").slice(-4);
        noteTxt += ` 站点账目导出仅有「日/累计」，需要由日账汇总；但当前账期（${core.fmtBucket(st.per, st.ts)}）在日账覆盖范围之外，故无站点数据。`;
        if (avail.length) noteTxt += ` 请选择有覆盖的账期，例如：${avail.map((t) => core.fmtBucket(st.per, t)).join("、")}。`;
        emptyTxt = "当前账期不在站点日账覆盖范围内，请换一个账期（见下方说明）";
      }
    }
    const noteEl = core.el("div", "foot-note", noteTxt);
    card.appendChild(noteEl);
    view.appendChild(card);

    const sd = engine.describeStations(imp);
    const stMap = aggOf("st");
    function buildRows() {
      const out = [];
      for (const [id, a] of stMap) {
        const d = sd.get(id) || {};
        out.push({
          __key: String(id),
          name: d.name || ("#" + id),
          region: d.region || "其他区域",
          lines: (d.lines || []).slice(0, 6).join(", "),
          board: engine.metricOn("paxBoard", a),
          dest: engine.metricOn("dest", a),
          transfer: engine.metricOn("transfer", a),
          spawn: engine.metricOn("paxSpawn", a),
          wait: engine.metricOn("wait", a),
          fares: engine.metricOn("fares", a),
          fareAvg: engine.metricOn("fareAvg", a),
          departures: engine.metricOn("departures", a),
          _lon: d.lon, _lat: d.lat,
        });
      }
      return out;
    }
    let rows = buildRows();
    let tbl = null;
    const cols = [
      { k: "name", label: "站点", fmt: (v) => core.esc(v) },
      { k: "region", label: "区域", fmt: (v) => core.esc(v) },
      { k: "lines", label: "服务线路", fmt: (v) => core.esc(v || "—"), title: "最多显示6条" },
      { k: "board", label: "登乘", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
      { k: "dest", label: "到达", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
      { k: "transfer", label: "换乘", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
      { k: "spawn", label: "新需求", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
      { k: "wait", label: "等待超时", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
      { k: "fares", label: "票款", num: true, fmt: (v) => (v == null ? "—" : core.fmtMoney(v)) },
      { k: "fareAvg", label: "人均票价", num: true, fmt: (v) => (v == null ? "—" : core.fmtMoney(v)) },
      { k: "departures", label: "发车", num: true, fmt: (v) => (v == null ? "—" : core.fmtNum(v)) },
    ];
    function draw() {
      host.innerHTML = "";
      tbl = NS.tables.mkTable(host, {
        cols, rows, sortBy: "board",
        emptyText: emptyTxt,
        onSelect: (r) => focusStation(Number(r.__key)),
      });
    }
    const apply = () => {
      const q = (document.getElementById("st-search").value || "").trim().toLowerCase();
      rows = buildRows();
      if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.region.toLowerCase().includes(q));
      draw();
      renderCharts();
    };
    function renderCharts() {
      if (!chartsVisible) return;
      const topB = rows.slice().sort((a, b) => (b.board ?? 0) - (a.board ?? 0)).slice(0, 12).map((r) => ({ name: r.name, value: r.board ?? 0 }));
      charts.barH(mkChart("st-bar-board"), topB, { unit: "pax" });
      const topF = rows.slice().sort((a, b) => (b.fares ?? 0) - (a.fares ?? 0)).slice(0, 12).map((r) => ({ name: r.name, value: r.fares ?? 0 }));
      charts.barH(mkChart("st-bar-fare"), topF, { unit: "money" });
    }
    search.querySelector("input").oninput = apply;
    csvBtn.onclick = () => core.download(`站点客流_${core.fmtBucket(st.per, st.ts || "")}.csv`, tbl.getCSV(), "text/csv;charset=utf-8");
    draw();
    renderCharts();
  }

  /* ============ TREND ============ */
  function renderTrend(view) {
    view.classList.add("tabpage", "scroll");
    const row1 = core.el("div", "charts-row");
    const c1 = core.el("div", "chart-card");
    c1.innerHTML = `<div class="cc-head">公司经营趋势(多指标)<span class="sub">按${core.periodLabel(st.per)}账期 · 可在左侧切换粒度</span></div><div id="tr-company" class="chart"></div>`;
    row1.appendChild(c1);
    const c2 = core.el("div", "chart-card");
    c2.innerHTML = `<div class="cc-head">线路运营利润趋势<span class="sub">点击曲线图例可增减线路</span></div><div id="tr-lines" class="chart"></div>`;
    row1.appendChild(c2);
    view.appendChild(row1);
    // company chart with metric chips
    const chipRow = core.el("div", "chips", "");
    const trMetrics = ["opProfit", "revenue", "opex", "cash", "paxBoard", "departures"];
    const selChips = new Set(["opProfit", "revenue", "opex"]);
    trMetrics.forEach((id) => {
      const chip = core.el("span", "chip" + (selChips.has(id) ? " on" : ""));
      chip.textContent = (engine.METRIC_BY_ID[id] || {}).label;
      chip.onclick = () => {
        if (selChips.has(id)) { selChips.delete(id); chip.classList.remove("on"); }
        else { selChips.add(id); chip.classList.add("on"); }
        drawCompany();
      };
      chipRow.appendChild(chip);
    });
    view.appendChild(chipRow);
    const xs = engine.buckets(imp, st.per, "co").length ? engine.buckets(imp, st.per, "co") : engine.buckets(imp, st.per, "li");
    const xLbl = xs.map((t) => core.fmtBucket(st.per, t));
    function drawCompany() {
      const c = mkChart("tr-company");
      if (!c) return;
      const series = [];
      trMetrics.forEach((id) => {
        if (!selChips.has(id)) return;
        const data = xs.map((t) => {
          const m = engine.aggBucket(imp, "co", st.per, t);
          return m.size ? engine.metricOn(id, m.values().next().value) : null;
        });
        series.push({ name: (engine.METRIC_BY_ID[id] || {}).label, data });
      });
      const unit = selChips.has("paxBoard") || selChips.has("departures") ? "pax" : "money";
      charts.lineTrend(c, xLbl, series, { unit: unit === "pax" ? "pax" : "money", legend: true });
    }
    const liMap = aggOf("li");
    const ranked = Array.from(liMap.entries())
      .map(([name, a]) => ({ name, v: engine.metricOn("opProfit", a) ?? -Infinity }))
      .sort((x, y) => y.v - x.v).slice(0, 6);
    function drawLines() {
      const c = mkChart("tr-lines");
      if (!c) return;
      const series = ranked.map((r) => {
        const vm = new Map(engine.seriesLine(imp, st.per, r.name, "opProfit").map((p) => [p.ts, p.v]));
        return { name: r.name, data: xs.map((t) => (vm.has(t) ? vm.get(t) : null)) };
      });
      charts.lineTrend(c, xLbl, series, { unit: "money", legend: true });
    }
    if (xs.length) {
      drawCompany();
      drawLines();
    } else {
      view.appendChild(core.el("div", "note-box", "当前粒度没有账期数据，请切换为 日/周/月/累计 等有账目的粒度。"));
    }
  }

  /* ---------------- help ---------------- */
  function showHelp() {
    const body = core.el("div", "step-hint", `
      <h4 style="margin:2px 0 8px">📖 使用说明</h4>
      <b>1 · 导入</b><br>
      在 NIMBY Rails 游戏里依次导出两个文件：<b>会计账目 (Accounting · .tsv)</b> 与 <b>时刻表/线路 (Timetable · .json)</b>，
      点顶部「＋ 导入游戏导出数据」把它们一起拖入。只导入其中一个也可以（只有几何或只有财务）。
      <br><br><b>2 · 查看</b><br>
      地图：站点圆点颜色=站点热度(左栏可选指标/配色/缩放)，线路粗细=线路热度、颜色=盈亏或路线色；
      支持区域筛选、缩放标签。底图：右上角按钮可切 OSM/CARTO/Esri；点 <b>M(Mapbox)</b> 选
      Mapbox 街道/浅色/深色/卫星——首次使用请在弹窗粘贴一次 Mapbox Access Token(仅存本机，不上传)。
      下方面板：运营总览 / 线路财务 / 站点客流 / 走势趋势，均随左侧“周期粒度+账期”变化。
      <br><br><b>3 · 对比历史</b><br>
      再次导入一次较新(或扩建前)的导出 → 顶部「⇄ 对比分析」，选择两个档案与主指标，可看线路/站点逐条变化并保存对比。
      <br><br><b>4 · 保存与导出</b><br>
      数据自动保存在本机浏览器。右上「导出中心」可：逐个导出档案 / 打包为单文件 / 整库备份；
      得到 <b>.nb.json</b> 文件后可拷贝到其它电脑，导入即可继续(跨设备使用)。表格可随时“导出CSV”。
      <br><br><b>5 · 口径说明</b><br>
      票款净额=票款+退票+补偿；运营成本=运行+维护+干预(支出为负)；运营利润=票款净额−运营成本。
      线路级不含建设/购车/融资(仅公司现金流含)；可勾选“含公司级分摊”按票款比例摊入。
      单位均为游戏货币；数字为 0 表示该期无记录。
    `);
    NS.exportcenter.showModal({ title: "使用说明", body, wide: true });
  }

  /* auto disk backup after each import (if enabled) */
  A.autoBackup = function (imp) {
    try {
      const set = store.ws().settings || {};
      if (set.autoBackup === false) return;
      const obj = { type: "nb-import", app: "nimby-finance", ver: 1, exportedAt: Date.now(), import: store.serializeImp(imp) };
      const label = String(imp.label || imp.companyName || "import").replace(/[\/:*?"<>|\s]+/g, "_").slice(0, 40);
      const d = new Date(); const p2 = (n) => String(n).padStart(2, "0");
      const nm = `Nimby自动备份_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}_${label}.nb.json`;
      core.download(nm, JSON.stringify(obj), "application/json");
      toast(`已自动生成备份文件: ${nm}`, "ok");
    } catch (e) { console.warn("自动备份失败", e); }
  };

  A.refresh = refresh;
  A.switchTab = switchTab;
  A.focusLine = focusLine;
  A.fitNetwork = () => NS.mapview.fitNetwork(true);
  NS.app = A;
  // boot (script runs at end of <body>, DOM is ready)
  A.init().catch((e) => {
    console.error("应用启动失败", e);
    const box = document.getElementById("kpis");
    if (box) box.innerHTML = `<div class="panel" style="grid-column:1/-1;color:#b91c1c">启动失败: ${core.esc(e.message || e)}</div>`;
  });
})(window.NFB);
