/* NIMBY Finance · historical comparison between imports */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const Cmp = {};
  const core = NS.core, engine = NS.engine, store = NS.store, charts = NS.charts;

  const cmpMetrics = ["opProfit", "revenue", "opex", "paxBoard", "dest", "departures", "fares", "marginRatio"];
  const state = {
    baseId: null, targetId: null, per: "daily",
    main: "opProfit", ent: "li", busy: false, seq: 0,
    baseImp: null, targetImp: null,
  };
  const cache = new Map();
  const chartInstances = [];
  Cmp.dispose = function () {
    chartInstances.splice(0).forEach((chart) => charts.dispose(chart));
  };

  async function getImp(id) {
    if (cache.has(id)) return cache.get(id);
    const p = (async () => {
      const clean = await store.getImport(id);
      return clean ? store.rehydrate(clean) : null;
    })();
    cache.set(id, p);
    return p;
  }
  function sideAt(imp, kind, per) {
    const tsList = engine.buckets(imp, per, kind);
    const ts = tsList.length ? tsList[tsList.length - 1] : null;
    if (!ts) return null;
    const bucket = engine.aggBucket(imp, kind, per, ts);
    const aggCo = engine.companyAgg(imp, per, ts);
    return { ts, map: bucket, aggCo, n: bucket.size };
  }
  function valOn(agg, id) { return engine.metricOn(id, agg); }
  function fmtAny(v, unit) {
    if (v == null) return "—";
    if (unit === "pct") return core.fmtPct(v);
    if (unit === "money") return core.fmtMoney(v);
    return core.fmtNum(v);
  }
  function deltaPct(a, b) {
    if (a == null || b == null) return null;
    if (a === 0) return b === 0 ? 0 : null;
    return (b - a) / Math.abs(a);
  }

  Cmp.open = async function (rootEl, opts) {
    opts = opts || {};
    Cmp.dispose();
    state.rootEl = rootEl;
    const metas = store.ws().imports;
    if (opts.auto) {
      if (metas.length >= 2) {
        state.baseId = opts.baseId || metas[metas.length - 2].id;
        state.targetId = opts.targetId || metas[metas.length - 1].id;
      } else state.baseId = state.targetId = null;
    }
    rootEl.innerHTML = "";
    buildShell(metas);
    await loadImports();
    render();
  };

  function buildShell(metas) {
    const root = state.rootEl;
    const optsHtml = () => metas.map((m) => `<option value="${core.esc(m.id)}">${core.esc(m.label)}</option>`).join("");
    root.innerHTML = `
      <div class="panel" style="flex:none">
        <div class="p-head"><span>对比两个财务快照 · 选择数据来源</span><span class="count">${metas.length} 个档案</span></div>
        <div class="cmp-setup" style="border:none;box-shadow:none;padding:4px 0">
          <label class="field-label" style="margin:0">基准(较早)
            <select id="cmp-base">${optsHtml()}</select></label>
          <div class="cmp-vs">→</div>
          <label class="field-label" style="margin:0">对比(较新)
            <select id="cmp-target">${optsHtml()}</select></label>
          <label class="field-label" style="margin:0">粒度
            <select id="cmp-per">${core.PERIODS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}</select></label>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <button id="cmp-run" class="btn primary">⇄ 生成对比</button>
            <button id="cmp-save" class="btn ghost">＋ 保存</button>
          </div>
        </div>
        <div class="p-sub" style="margin-top:6px;padding-top:6px">对比主指标</div>
        <div id="cmp-metrics" class="chips"></div>
        <div id="cmp-saved" style="margin-top:8px"></div>
      </div>
      <div id="cmp-body" style="display:flex;flex-direction:column;gap:10px;min-height:0"></div>`;
    const bSel = document.getElementById("cmp-base"), tSel = document.getElementById("cmp-target"), pSel = document.getElementById("cmp-per");
    if (state.baseId && metas.find((m) => m.id === state.baseId)) bSel.value = state.baseId;
    if (state.targetId && metas.find((m) => m.id === state.targetId)) tSel.value = state.targetId;
    pSel.value = state.per;
    const mBox = document.getElementById("cmp-metrics");
    mBox.innerHTML = "";
    cmpMetrics.forEach((id) => {
      const def = engine.METRIC_BY_ID[id];
      const chip = core.el("button", "chip" + (id === state.main ? " on" : ""));
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(id === state.main));
      chip.textContent = def.label;
      chip.onclick = () => {
        state.main = id;
        mBox.querySelectorAll(".chip").forEach((c) => { c.classList.remove("on"); c.setAttribute("aria-pressed", "false"); });
        chip.classList.add("on");
        chip.setAttribute("aria-pressed", "true");
        render();
      };
      mBox.appendChild(chip);
    });
    document.getElementById("cmp-run").onclick = async () => {
      state.baseId = bSel.value; state.targetId = tSel.value; state.per = pSel.value;
      await loadImports(); render();
    };
    document.getElementById("cmp-save").onclick = async () => {
      const label = prompt("为本次对比命名(取消则用自动名):", "");
      const name = (label && label.trim()) || `对比 ${new Date().toISOString().slice(0, 10)}`;
      await store.addComparison({ name, baseId: state.baseId, targetId: state.targetId, per: state.per, main: state.main });
      buildSaved();
      NS.app && NS.app.toast && NS.app.toast("对比已保存，可在「导出中心」打包", "ok");
    };
    buildSaved();
  }
  function buildSaved() {
    const box = document.getElementById("cmp-saved");
    if (!box) return;
    const saved = store.ws().comparisons;
    box.innerHTML = saved.length ? '<span class="count" style="margin-right:6px">已保存:</span>' : "";
    saved.forEach((c) => {
      const span = core.el("button", "chip", core.esc(c.name));
      span.type = "button";
      span.onclick = async () => {
        state.baseId = c.baseId; state.targetId = c.targetId;
        state.per = c.per || "daily"; state.main = c.main || "opProfit";
        const bSel = document.getElementById("cmp-base"), tSel = document.getElementById("cmp-target"), pSel = document.getElementById("cmp-per");
        if (bSel) bSel.value = c.baseId;
        if (tSel) tSel.value = c.targetId;
        if (pSel) pSel.value = c.per || "daily";
        document.getElementById("cmp-metrics").querySelectorAll(".chip").forEach((x) => {
          const def = engine.METRIC_BY_ID[state.main];
          x.classList.toggle("on", x.textContent === (def || {}).label);
          x.setAttribute("aria-pressed", String(x.textContent === (def || {}).label));
        });
        await loadImports(); render();
      };
      box.appendChild(span);
    });
  }
  async function loadImports() {
    if (!state.baseId || !state.targetId || state.baseId === state.targetId) { state.baseImp = state.targetImp = null; return; }
    const seq = ++state.seq;
    const [a, b] = await Promise.all([getImp(state.baseId), getImp(state.targetId)]);
    if (seq !== state.seq) return;
    state.baseImp = a; state.targetImp = b;
  }

  function render() {
    Cmp.dispose();
    const body = document.getElementById("cmp-body");
    if (!body) return;
    body.innerHTML = "";
    const base = state.baseImp, target = state.targetImp;
    const metas = store.listImportsMeta();
    const metaA = metas.find((m) => m.id === state.baseId);
    const metaB = metas.find((m) => m.id === state.targetId);
    if (!base || !target) {
      body.innerHTML = `<div class="panel empty-hint" style="padding:44px">请选择两个不同档案 → 「生成对比」。<br>提示：同一家公司 <b>扩建前/扩建后</b>（或两次不同日期）的导出最适合对比。</div>`;
      return;
    }
    const per = state.per, main = state.main;
    const mDef = engine.METRIC_BY_ID[main] || {};
    const unit = mDef.unit;
    const A = sideAt(base, "li", per), B = sideAt(target, "li", per);
    if (!A || !B) {
      body.innerHTML = `<div class="panel empty-hint" style="padding:30px">所选粒度「${core.periodLabel(per)}」下至少一个档案没有线路账期数据</div>`;
      return;
    }
    /* union lines */
    const allNames = new Set([...A.map.keys(), ...B.map.keys()]);
    const descA = engine.describeLines(base), descB = engine.describeLines(target);
    const lrows = [];
    for (const name of allNames) {
      const a = A.map.get(name), b = B.map.get(name);
      const va = a ? valOn(a, main) : null, vb = b ? valOn(b, main) : null;
      lrows.push({
        key: name, name, region: (descA.get(name) || descB.get(name) || {}).region || "其他区域",
        color: (descA.get(name) || descB.get(name) || {}).color || [120, 130, 150],
        va, vb, _d: (vb ?? 0) - (va ?? 0), _p: deltaPct(va, vb),
        revA: a ? valOn(a, "revenue") : null, revB: b ? valOn(b, "revenue") : null,
        paxA: a ? valOn(a, "paxBoard") : null, paxB: b ? valOn(b, "paxBoard") : null,
        state: a && b ? "same" : a ? "gone" : "new",
      });
    }
    /* station side */
    const SA = sideAt(base, "st", per), SB = sideAt(target, "st", per);
    const sdescA = engine.describeStations(base), sdescB = engine.describeStations(target);
    const srows = [];
    if (SA && SB) {
      const allSt = new Set([...SA.map.keys(), ...SB.map.keys()]);
      for (const sid of allSt) {
        const a = SA.map.get(sid), b = SB.map.get(sid);
        const da = sdescA.get(sid) || sdescB.get(sid);
        const db = sdescB.get(sid) || sdescA.get(sid);
        const va = a ? valOn(a, "paxBoard") : null, vb = b ? valOn(b, "paxBoard") : null;
        srows.push({
          key: sid, name: (db && db.name) || (da && da.name) || String(sid),
          region: (db && db.region) || (da && da.region) || "其他区域",
          va, vb, _d: (vb ?? 0) - (va ?? 0), _p: deltaPct(va, vb),
          fareA: a ? valOn(a, "fares") : null, fareB: b ? valOn(b, "fares") : null,
          destA: a ? valOn(a, "dest") : null, destB: b ? valOn(b, "dest") : null,
          state: a && b ? "same" : a ? "gone" : "new",
          lines: (db && db.lines) || (da && da.lines) || [],
        });
      }
    }
    /* summary (company) */
    const bothSide = [["票款收入", "fares"], ["营业收入(净)", "revenue"], ["运营成本", "opex"], ["运营利润", "opProfit"], ["登乘客流", "paxBoard"], ["发车趟次", "departures"]]
      .map(([k, id]) => {
        const av = A.aggCo ? valOn(A.aggCo, id) : null;
        const bv = B.aggCo ? valOn(B.aggCo, id) : null;
        return { k, av, bv, unit: engine.METRIC_BY_ID[id].unit };
      });
    const nNewL = lrows.filter((r) => r.state === "new").length, nGoneL = lrows.filter((r) => r.state === "gone").length;
    const nNewS = srows.filter((r) => r.state === "new").length, nGoneS = srows.filter((r) => r.state === "gone").length;
    body.innerHTML = `
      <div class="panel" style="flex:none">
        <div class="p-head"><span>对比摘要 · 主指标: ${mDef.label}</span>
          <span class="count">账期: 基准 ${core.fmtBucket(per, A.ts)}　对比 ${core.fmtBucket(per, B.ts)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 18px">
          ${bothSide.map(({ k, av, bv, unit: u }) => `
            <div class="vs-row"><span class="k">${k}</span><span class="d">
              <span style="color:var(--muted)">${fmtAny(av, u)}</span> →
              <b class="${(bv ?? 0) >= (av ?? 0) ? "pos" : "neg"}">${fmtAny(bv, u)}</b>
              <span class="rt">${fmtDeltaHtml(av, bv, u)}</span></span></div>`).join("")}
          <div class="vs-row"><span class="k">网络变化</span><span class="d">
            <span>线路 ${A.n} → ${B.n}</span><span class="rt">${nNewL ? `<span class="badge-new">+${nNewL} 新增</span>` : ""}${nGoneL ? ` <span class="badge-gone">-${nGoneL} 停运</span>` : ""}</span></span></div>
          ${SA && SB ? `<div class="vs-row"><span class="k">站点变化</span><span class="d"><span>${SA.n} → ${SB.n} 站点有账</span><span class="rt">${nNewS ? `<span class="badge-new">+${nNewS}</span>` : ""}${nGoneS ? ` <span class="badge-gone">-${nGoneS}</span>` : ""}</span></span></div>` : ""}
        </div>
      </div>
      <div class="charts-row">
        <div class="chart-card"><div class="cc-head">线路「${mDef.label}」差额 Top 12<span class="sub">条形颜色=线路颜色</span></div><div id="cmp-bar" class="chart sm"></div></div>
        <div class="chart-card"><div class="cc-head">公司「${mDef.label}」两档案走势<span class="sub">时间轴=两档案账期并集</span></div><div id="cmp-trend" class="chart sm"></div></div>
      </div>
      <div class="panel" style="flex:1;display:flex;flex-direction:column;min-height:280px">
        <div class="p-head"><span id="cmp-tbl-title">明细对比 · 线路</span>
          <span class="tbl-tools">
            <button id="cmp-ent-li" class="rank-tab ${state.ent === "li" ? "active" : ""}">线路</button>
            <button id="cmp-ent-st" class="rank-tab ${state.ent === "st" ? "active" : ""}">站点</button>
            <button id="cmp-csv" class="btn xs">⤓ CSV</button>
          </span></div>
        <div id="cmp-tbl" style="flex:1;min-height:0"></div>
      </div>`;
    /* bar */
    const barItems = lrows.slice().sort((x, y) => Math.abs(y._d) - Math.abs(x._d)).slice(0, 12)
      .map((r) => ({ name: r.name, value: r._d, color: r.color }));
    const c1 = charts.mk(document.getElementById("cmp-bar"));
    chartInstances.push(c1);
    charts.barH(c1, barItems.map(({ name, value }) => ({ name, value })), { colorBy: (n) => (barItems.find((x) => x.name === n) || {}).color || [120, 130, 150], unit });
    /* trend over union of daily/company or li buckets */
    const buck = (imp, kind) => engine.buckets(imp, per, kind);
    const bA = buck(base, "co").length ? buck(base, "co") : buck(base, "li");
    const bB = buck(target, "co").length ? buck(target, "co") : buck(target, "li");
    const union = Array.from(new Set([...bA, ...bB]));
    const xs = core.tsSort(per, union);
    const ser = (imp, list) => xs.map((ts) => {
      const m = engine.aggBucket(imp, "co", per, ts);
      const kind = m.size;
      if (!kind) return null;
      const agg = m.size ? m.values().next().value : null;
      return valOn(agg, main);
    });
    const c2 = charts.mk(document.getElementById("cmp-trend"));
    chartInstances.push(c2);
    charts.lineTrend(c2, xs.map((x) => core.fmtBucket(per, x)), [
      { name: metaA ? metaA.label : "基准", data: ser(base, bA), color: charts.color("--muted") },
      { name: metaB ? metaB.label : "对比", data: ser(target, bB), color: charts.color("--accent") },
    ], { unit, legend: true });
    /* table */
    let tbl = null;
    const drawTable = () => {
      const ent = state.ent;
      document.getElementById("cmp-tbl-title").textContent = "明细对比 · " + (ent === "li" ? "线路" : "站点");
      document.getElementById("cmp-ent-li").classList.toggle("active", ent === "li");
      document.getElementById("cmp-ent-st").classList.toggle("active", ent === "st");
      if (ent === "st" && !SA) { document.getElementById("cmp-tbl").innerHTML = '<div class="empty-hint" style="padding:22px">站点账目不足，无法对比</div>'; return; }
      const isLine = ent === "li";
      const R = isLine ? lrows : srows;
      const mainLabel = (isLine ? "运营利润/客流" : "登乘客流");
      const cols = [
        { k: "name", label: isLine ? "线路" : "站点", fmt: (v, r) => `<span class="name-cell">${isLine ? `<span class="dot" style="background:${core.hexCss(r.color)}"></span>` : ""}<span>${core.esc(v)}</span>${r.state === "new" ? ' <span class="badge-new">新增</span>' : r.state === "gone" ? ' <span class="badge-gone">已消失</span>' : ""}</span>`, csv: (v) => v },
        { k: "region", label: "区域", fmt: (v) => core.esc(v || "—") },
        { k: "va", label: `基准值`, num: true, fmt: (v, r) => fmtAny(v, isLine ? unit : "pax"), title: "基准账期数值" },
        { k: "vb", label: `对比值`, num: true, fmt: (v, r) => fmtAny(v, isLine ? unit : "pax") },
        { k: "_d", label: "差额", num: true, fmt: (v, r) => `<span class="${v >= 0 ? "pos" : "neg"}">${fmtAny(v, isLine ? unit : "pax")}</span>` },
        { k: "_p", label: "变化%", num: true, fmt: (v, r) => v == null ? "—" : `<span class="${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%</span>` },
      ];
      if (isLine) {
        cols.push({ k: "revA", label: "票款A", num: true, fmt: (v) => fmtAny(v, "money") });
        cols.push({ k: "revB", label: "票款B", num: true, fmt: (v) => fmtAny(v, "money") });
        cols.push({ k: "paxA", label: "客流A", num: true, fmt: (v) => fmtAny(v, "pax") });
        cols.push({ k: "paxB", label: "客流B", num: true, fmt: (v) => fmtAny(v, "pax") });
      } else {
        cols.push({ k: "fareA", label: "票款A", num: true, fmt: (v) => fmtAny(v, "money") });
        cols.push({ k: "fareB", label: "票款B", num: true, fmt: (v) => fmtAny(v, "money") });
        cols.push({ k: "destA", label: "到达A", num: true, fmt: (v) => fmtAny(v, "pax") });
        cols.push({ k: "destB", label: "到达B", num: true, fmt: (v) => fmtAny(v, "pax") });
      }
      const rows = R.slice().map((r) => ({ ...r, __key: String(r.key) }));
      tbl = NS.tables.mkTable(document.getElementById("cmp-tbl"), { cols, rows, sortBy: "_d", sortDesc: true, emptyText: "无数据" });
    };
    drawTable();
    document.getElementById("cmp-ent-li").onclick = () => { state.ent = "li"; drawTable(); };
    document.getElementById("cmp-ent-st").onclick = () => { state.ent = "st"; drawTable(); };
    document.getElementById("cmp-csv").onclick = () => {
      if (tbl) core.download(`对比明细_${(metaA ? metaA.label : "a")}_vs_${(metaB ? metaB.label : "b")}.csv`, tbl.getCSV(), "text/csv;charset=utf-8");
    };

    function fmtDeltaHtml(av, bv, u) {
      if (av == null || bv == null) return "";
      const d = bv - av;
      const p = av ? (d / Math.abs(av)) * 100 : null;
      if (d === 0) return '<span class="rt">±0</span>';
      return `<span class="rt ${d >= 0 ? "pos" : "neg"}">${d >= 0 ? "+" : ""}${fmtAny(d, u)}${p != null ? ` (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)` : ""}</span>`;
    }
  }

  NS.compare = Cmp;
})(window.NFB);
