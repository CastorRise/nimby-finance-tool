/* NIMBY Finance · analysis engine: aggregation, metrics, regions, series */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const E = {};
  const core = NS.core;
  const KINDS = { li: "accLi", st: "accSt", co: "accCo" };

  /* ---------------- metric definitions ---------------- */
  const M = (id, label, unit, ent, f, desc) => ({ id, label, unit, ent, f, desc });
  const ENT_ALL = ["li", "st", "co"];
  E.METRICS = [
    M("revenue", "营业收入(净票款)", "money", ENT_ALL, (a) => sum(a, "fares", "refunds", "compensations"), "票款收入+退票+补偿"),
    M("fares", "票款收入", "money", ENT_ALL, (a) => a.fares ?? null, "已收车费总额(不含退票补偿)"),
    M("refunds", "退票", "money", ENT_ALL, (a) => a.refunds ?? null),
    M("compensations", "延误赔偿", "money", ENT_ALL, (a) => a.compensations ?? null),
    M("opex", "运营成本", "money", ENT_ALL, (a) => neg(sum(a, "running", "maintenance", "intervention")), "运行+维护+干预(正数显示)"),
    M("opProfit", "运营利润", "money", ENT_ALL, (a) => sum(a, "fares", "refunds", "compensations", "running", "maintenance", "intervention"), "毛利=票款净额−运营成本"),
    M("cash", "本期现金流", "money", ["li", "co"], (a) => a.cash ?? null),
    M("cTotal", "建设支出", "money", ["co"], (a) => neg(a.cTotal)),
    M("buy", "购车支出", "money", ["co"], (a) => neg(a.buy)),
    M("sell", "售车收入", "money", ["co"], (a) => a.sell ?? null),
    M("credit", "融资进账", "money", ["co"], (a) => a.credit ?? null),
    M("interest", "融资利息", "money", ["co"], (a) => neg(a.interest)),
    M("paxBoard", "登乘客流", "pax", ENT_ALL, (a) => a.paxBoard ?? null),
    M("paxSpawn", "开始行程人次", "pax", ENT_ALL, (a) => a.paxSpawn ?? null),
    M("paxNew", "新增乘客", "pax", ENT_ALL, (a) => a.paxNew ?? null),
    M("dest", "到达目的地", "pax", ENT_ALL, (a) => a.dest ?? null),
    M("transfer", "换乘人次", "pax", ENT_ALL, (a) => a.transfer ?? null),
    M("walkOut", "步行进/离站", "pax", ENT_ALL, (a) => numOr(a.walkOut, a.walkIn)),
    M("wait", "等待超时", "pax", ENT_ALL, (a) => a.wait ?? null),
    M("lost", "流失乘客", "pax", ENT_ALL, (a) => a.lost ?? null),
    M("tooFull", "满员无法上车", "pax", ENT_ALL, (a) => a.tooFull ?? null),
    M("refuse", "拒付票款", "pax", ENT_ALL, (a) => a.refuse ?? null),
    M("refunded", "退票人次", "pax", ENT_ALL, (a) => a.refunded ?? null),
    M("paxCompensated", "获赔乘客", "pax", ENT_ALL, (a) => a.compPax ?? null),
    M("departures", "发车趟次", "num", ENT_ALL, (a) => a.departures ?? null),
    M("arrivedFull", "满员到站趟次", "num", ENT_ALL, (a) => a.arrivedFull ?? null),
    M("departedFull", "满员发车趟次", "num", ENT_ALL, (a) => a.departedFull ?? null),
    M("distKm", "列车总里程", "km", ["li", "co"], (a) => km(a.dist)),
    M("stopTime", "停站总时长", "dur", ["li", "st", "co"], (a) => a.stopTime ?? null),
    M("late", "总晚点时长", "dur", ["li", "co"], (a) => a.late ?? null),
    M("collisions", "碰撞次数", "num", ["li", "co"], (a) => a.collisions ?? null),
    /* efficiency */
    M("marginRatio", "运营利润率", "pct", ["li", "co"], (a) => {
      const r = sum(a, "fares", "refunds", "compensations"), c = neg(sum(a, "running", "maintenance", "intervention"));
      return r ? (r - c) / r : null;
    }),
    M("fareAvg", "平均票价", "money", ["li", "st"], (a) => {
      const r = sum(a, "fares", "refunds", "compensations");
      return a.paxBoard ? r / a.paxBoard : null;
    }),
    M("opexPerPax", "人均运营成本", "money", ["li", "st"], (a) => {
      const c = neg(sum(a, "running", "maintenance", "intervention"));
      return a.paxBoard ? c / a.paxBoard : null;
    }),
    M("boardPerDep", "每趟登乘人数", "num", ["li", "st"], (a) => (a.departures ? a.paxBoard / a.departures : null)),
    M("destRate", "目的地到达率", "pct", ["li", "st"], (a) => (a.paxBoard ? a.dest / a.paxBoard : null)),
    M("transRate", "换乘率", "pct", ["li", "st"], (a) => (a.paxBoard ? a.transfer / a.paxBoard : null)),
    M("loadFullRate", "满载率(发车)", "pct", ["li"], (a) => (a.departures ? a.departedFull / a.departures : null)),
    M("revenuePerKm", "每公里票款收入", "money", ["li"], (a) => (a.dist ? sum(a, "fares", "refunds", "compensations") / (a.dist / 1000) : null)),
    M("costPerKm", "每公里运营成本", "money", ["li"], (a) => (a.dist ? neg(sum(a, "running", "maintenance", "intervention")) / (a.dist / 1000) : null)),
    M("profitPerKm", "每公里运营利润", "money", ["li"], (a) => (a.dist ? sum(a, "fares", "refunds", "compensations", "running", "maintenance", "intervention") / (a.dist / 1000) : null)),
    M("avgSpeed", "平均旅速", "kmh", ["li", "co"], (a) => (a.runTime && a.dist ? (a.dist / 1000) / (a.runTime / 3600) : null)),
    M("lateRate", "晚点率", "pct", ["li"], (a) => (a.runTime ? a.late / a.runTime : null)),
    M("distPerDep", "平均趟距", "km", ["li"], (a) => (a.departures && a.dist ? a.dist / 1000 / a.departures : null)),
    M("runTime", "运行总时长", "dur", ["li", "co"], (a) => a.runTime ?? null),
  ];
  E.METRIC_BY_ID = {};
  E.METRICS.forEach((m) => { E.METRIC_BY_ID[m.id] = m; });
  function sum(a) {
    let s = 0, any = false;
    for (let i = 1; i < arguments.length; i++) {
      const k = arguments[i];
      if (a[k] != null) { s += a[k]; any = true; }
    }
    return any ? s : null;
  }
  function neg(v) { return v == null ? null : -v; }
  function numOr(a, b) { return a ?? b ?? null; }
  function km(m) { return m == null ? null : m / 1000; }

  /* ---------------- region detection ---------------- */
  E.assignRegions = function (imp) {
    const regionOf = new Map(); // stationId -> region key
    const regions = new Map(); // key -> {key,name,cx,cy,n}
    const addSt = (id, lon, lat, name) => {
      if (lon == null || lat == null) return;
      let best = null, bd = Infinity;
      for (const rg of regions.values()) {
        const d = core.haversineKm(lon, lat, rg.cx, rg.cy);
        if (d < bd) { bd = d; best = rg; }
      }
      if (best && bd <= 55) {
        regionOf.set(id, best.key);
        best.n++; best.cx = (best.cx * (best.n - 1) + lon) / best.n;
        best.cy = (best.cy * (best.n - 1) + lat) / best.n;
      } else {
        const cn = core.cityName(lon, lat);
        const key = cn || "其他区域";
        let rg = regions.get(key);
        if (!rg) { rg = { key, name: cn || "其他区域", cx: lon, cy: lat, n: 0 }; regions.set(key, rg); }
        regionOf.set(id, key);
        rg.n++; rg.cx = (rg.cx * (rg.n - 1) + lon) / rg.n;
        rg.cy = (rg.cy * (rg.n - 1) + lat) / rg.n;
      }
    };
    for (const s of imp.stations) addSt(s.id, s.lon, s.lat, s.name);
    // fallback coordinates from accounting
    for (const idStr in imp.stFb) {
      const id = +idStr;
      if (!regionOf.has(id)) {
        const [lon, lat] = imp.stFb[idStr];
        const st = imp.stById.get(id);
        addSt(id, lon, lat, st ? st.name : "");
      }
    }
    const list = Array.from(regions.values()).sort((a, b) => b.n - a.n);
    // stations in a region that we could not resolve get bucket "其他区域" already
    imp.regionOf = regionOf;
    imp.regions = list;
    imp.regionKeyOfStation = (id) => regionOf.get(id) || "其他区域";
    return list;
  };

  /* ---------------- index building ---------------- */
  E.prepare = function (imp) {
    if (!imp._prepared) {
      imp._prepared = true;
      imp._idx = { li: {}, st: {}, co: {} };
      const push = (k, per, ts, row) => {
        const byPer = (imp._idx[k][per] = imp._idx[k][per] || {});
        (byPer[ts] = byPer[ts] || []).push(row);
      };
      for (const k of ["li", "st", "co"]) {
        for (const r of imp[KINDS[k]]) push(k, r.per, r.ts, r);
      }
      imp._aggCache = new Map();
      imp._lineDescriptions = null;
      imp._stationDescriptions = null;
      E.assignRegions(imp);
      // station id -> lines & index
      const stLines = new Map();
      const stIds = new Set(imp.stations.map((s) => s.id));
      imp.lines.forEach((ln, i) => {
        const seen = new Set();
        for (const sid of ln.staIds) {
          if (seen.has(sid)) continue;
          seen.add(sid);
          if (!stLines.has(sid)) stLines.set(sid, []);
          stLines.get(sid).push(i);
        }
      });
      imp.stLines = stLines;
      imp.stIds = stIds;
      E.alignVariants(imp);
    }
  };

  /* Variant lines (xxx特急/希望号/隼号…) skip stations but run on the main corridor.
     Detect children whose every stop lies (in station-id terms) on a longer line,
     then let drawing follow the parent line's geometry between its endpoints. */
  E.alignVariants = function (imp) {
    imp.aligned = new Map(); // child line index -> { parentIdx, ids:[stationIds along parent path] }
    const L = imp.lines;
    const sets = L.map((ln) => new Set(ln.staIds));
    for (let c = 0; c < L.length; c++) {
      const child = L[c];
      if (child.staIds.length < 2) continue;
      let best = null;
      for (let p = 0; p < L.length; p++) {
        if (p === c) continue;
        const par = L[p];
        if (par.staIds.length <= child.staIds.length) continue; // peers/longer only
        const ps = sets[p];
        // parent lines are stored as out-and-back trips: note first+last occurrence per station
        const rangeOf = new Map();
        for (let k = 0; k < par.staIds.length; k++) {
          const id = par.staIds[k];
          const r = rangeOf.get(id);
          if (!r) rangeOf.set(id, [k, k]);
          else r[1] = k;
        }
        let all = true, mn = Infinity, mx = -1;
        for (const id of child.staIds) {
          const r = rangeOf.get(id);
          if (!r) { all = false; break; }
          if (r[0] < mn) mn = r[0];
          if (r[1] > mx) mx = r[1];
        }
        if (!all || mx <= mn) continue;
        const span = mx - mn;
        if (!best || span < best.span) best = { parentIdx: p, i0: mn, i1: mx, span };
      }
      if (best) {
        const ids = L[best.parentIdx].staIds.slice(best.i0, best.i1 + 1);
        imp.aligned.set(c, { parentIdx: best.parentIdx, parentName: L[best.parentIdx].name, ids });
      }
    }
  };
  /* full expanded drawing path for a variant: for each neighbouring stop pair walk the
     parent corridor along the shortest arc (round-trip parent lists have duplicates) */
  E.routeWalk = function (imp, lineIdx) {
    E.prepare(imp);
    const a = imp.aligned && imp.aligned.get(lineIdx);
    if (!a) return null;
    const par = imp.lines[a.parentIdx];
    const posOf = new Map();
    for (let k = 0; k < par.staIds.length; k++) {
      const id = par.staIds[k];
      if (!posOf.has(id)) posOf.set(id, []);
      posOf.get(id).push(k);
    }
    const P = [];
    for (const id of par.staIds) {
      const s = imp.stById.get(id);
      const pt = s && s.lon != null ? [s.lat, s.lon] : (imp.stFb[id] ? [imp.stFb[id][1], imp.stFb[id][0]] : null);
      P.push(pt); // null when unknown
    }
    const child = imp.lines[lineIdx];
    const pts = [];
    const ids = [];
    const pushPt = (pt, id) => {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) { pts.push(pt); ids.push(id); }
    };
    const firstId = child.staIds[0];
    const fpos = posOf.get(firstId);
    let curPt = P[fpos ? fpos[0] : -1];
    let curId = firstId;
    if (curPt) { pts.push(curPt); ids.push(firstId); }
    for (let k = 1; k < child.staIds.length; k++) {
      const id = child.staIds[k];
      if (id === curId) continue; // pivot repeat
      const A = posOf.get(curId) || [], B = posOf.get(id) || [];
      if (!A.length || !B.length) {
        const s = imp.stById.get(id);
        const pt = s && s.lon != null ? [s.lat, s.lon] : (imp.stFb[id] ? [imp.stFb[id][1], imp.stFb[id][0]] : null);
        if (pt) pushPt(pt, id);
        curId = id; continue;
      }
      let bi = B[0], ai = A[0], best = Math.abs(B[0] - A[0]);
      for (const x of A) for (const y of B) { const d = Math.abs(y - x); if (d < best) { best = d; ai = x; bi = y; } }
      const step = bi >= ai ? 1 : -1;
      for (let q = ai + step; q !== bi + step; q += step) {
        if (P[q]) pushPt(P[q], par.staIds[q]);
      }
      if (!pts.length) { const pt = P[bi]; if (pt) { pts.push(pt); ids.push(id); } }
      curPt = P[bi];
      curId = id;
    }
    if (pts.length < 2) return null;
    return { pts, ids };
  };
  /* station-id list to follow for drawing; null = draw the line's own stops */
  E.routeStops = function (imp, lineIdx) {
    E.prepare(imp);
    const a = imp.aligned && imp.aligned.get(lineIdx);
    return a ? a.ids : null;
  };
  E.isVariant = function (imp, lineIdx) {
    E.prepare(imp);
    return !!(imp.aligned && imp.aligned.has(lineIdx));
  };
  E.variantParentOf = function (imp, lineName) {
    E.prepare(imp);
    for (let i = 0; i < imp.lines.length; i++) {
      if (imp.lines[i].name === lineName) {
        const a = imp.aligned && imp.aligned.get(i);
        return a ? a.parentName : null;
      }
    }
    return null;
  };
  E.variantParent = function (imp, lineIdx) {
    E.prepare(imp);
    const a = imp.aligned && imp.aligned.get(lineIdx);
    return a ? a.parentName : null;
  };

  /* ---------------- rolling daily up to coarser periods ---------------- */
  const QCHAR = ["一", "二", "三", "四"];
  function parseDate(ts) {
    const p = String(ts).split("-").map(Number);
    return p.length >= 3 && p.every((x) => isFinite(x)) ? { y: p[0], m: p[1], d: p[2] } : null;
  }
  function periodKeyOfDate(per, dateStr) {
    const dt = parseDate(dateStr);
    if (!dt) return null;
    if (per === "weekly") {
      const d = new Date(Date.UTC(dt.y, dt.m - 1, dt.d));
      const wd = d.getUTCDay() || 7; // Mon=1
      d.setUTCDate(d.getUTCDate() - (wd - 1));
      return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    }
    if (per === "monthly") return `${dt.y}-${dt.m}`;
    if (per === "quarterly") return `${dt.y}-第${QCHAR[Math.floor((dt.m - 1) / 3)]}季度`;
    if (per === "yearly") return `${dt.y}`;
    return dateStr; // daily
  }
  function hasNative(imp, kind, per) { return !!imp._idx[kind][per]; }

  /* derived (rolled-up) daily-based buckets for a kind+period, e.g. station weekly/monthly */
  function derivedBucketList(imp, kind, per) {
    const dailyIdx = imp._idx[kind].daily;
    if (!dailyIdx || per === "daily" || per === "lifetime") return [];
    const set = new Set();
    for (const ts in dailyIdx) {
      const k = periodKeyOfDate(per, ts);
      if (k) set.add(k);
    }
    return core.tsSort(per, Array.from(set));
  }

  /* ---------------- bucket lists ---------------- */
  E.buckets = function (imp, per, kind) {
    E.prepare(imp);
    const o = imp._idx[kind][per] || {};
    const native = Object.keys(o);
    if (native.length) return core.tsSort(per, native);
    return derivedBucketList(imp, kind, per);
  };
  E.latestBucket = function (imp, per, kind) {
    const b = E.buckets(imp, per, kind);
    return b.length ? b[b.length - 1] : null;
  };
  E.hasBucketKind = function (imp, per, kind) { return E.buckets(imp, per, kind).length > 0; };

  /* ---------------- aggregation ---------------- */
  function emptyAgg() { return {}; }
  E.aggBucket = function (imp, kind, per, ts) {
    E.prepare(imp);
    const cacheKey = "AGG|" + kind + "|" + per + "|" + ts;
    if (imp._aggCache.has(cacheKey)) return imp._aggCache.get(cacheKey);
    const byPer = imp._idx[kind][per] || {};
    let rows = byPer[ts];
    if (!rows) {
      // station-like accounts are only exported per day / lifetime: roll up daily
      const dailyIdx = imp._idx[kind].daily;
      if (dailyIdx && per !== "daily" && per !== "lifetime") {
        const list = [];
        for (const dts in dailyIdx) if (periodKeyOfDate(per, dts) === ts) list.push(...dailyIdx[dts]);
        rows = list.length ? list : null;
      }
    }
    rows = rows || [];
    const map = new Map();
    for (const r of rows) {
      const key = kind === "li" ? r.name : kind === "st" ? r.id : (r.name || "公司");
      let agg = map.get(key);
      if (!agg) { agg = emptyAgg(); map.set(key, agg); }
      const v = r.v;
      for (const c in v) {
        if (c === "lon" || c === "lat") continue;
        agg[c] = (agg[c] || 0) + v[c];
      }
    }
    if (imp._aggCache.size > 1400) imp._aggCache.clear();
    imp._aggCache.set(cacheKey, map);
    return map;
  };
  E.hasNativeRows = function (imp, kind, per) { E.prepare(imp); return !!imp._idx[kind][per]; };
  /* coverage info when a bucket is produced by rolling up daily rows */
  E.derivedInfo = function (imp, kind, per, ts) {
    E.prepare(imp);
    if (hasNative(imp, kind, per)) return null; // native rows exist for this period
    const dailyIdx = imp._idx[kind].daily;
    if (!dailyIdx || per === "daily" || per === "lifetime") return null;
    const days = [];
    for (const dts in dailyIdx) if (periodKeyOfDate(per, dts) === ts) days.push(dts);
    if (!days.length) return null;
    const sorted = core.tsSort("daily", days);
    return { days: sorted.length, from: sorted[0], to: sorted[sorted.length - 1] };
  };
  E.companyAgg = function (imp, per, ts) {
    const map = E.aggBucket(imp, "co", per, ts);
    if (!map.size) return null;
    return map.values().next().value;
  };
  E.sumAgg = function (imp, kind, per) {
    // total across all buckets (kind & period), ignoring ts keys
    E.prepare(imp);
    const cacheKey = "SUM|" + kind + "|" + per;
    if (imp._aggCache.has(cacheKey)) return imp._aggCache.get(cacheKey);
    const out = {};
    for (const r of imp[KINDS[kind]]) {
      if (r.per !== per) continue;
      const v = r.v;
      for (const c in v) {
        if (c === "lon" || c === "lat") continue;
        out[c] = (out[c] || 0) + v[c];
      }
    }
    imp._aggCache.set(cacheKey, out);
    return out;
  };

  /* metric value on an agg (or null) */
  E.metricOn = function (metricId, agg) {
    if (!agg) return null;
    const def = E.METRIC_BY_ID[metricId];
    if (!def) return null;
    try { return def.f(agg); } catch (e) { return null; }
  };

  /* line metric value resolved over lines operating in bucket (name key) */
  E.lineAggAt = function (imp, per, ts, name) {
    const m = E.aggBucket(imp, "li", per, ts);
    return m.get(name) || null;
  };
  E.stationAggAt = function (imp, per, ts, stationId) {
    const m = E.aggBucket(imp, "st", per, ts);
    return m.get(stationId) || null;
  };

  /* geometry enrich (pts, lenKm, stations count, region) */
  E.lineGeometry = function (imp, line) {
    E.prepare(imp);
    const pts = [];
    for (const sid of line.staIds) {
      const s = imp.stById.get(sid);
      if (s && s.lon != null && s.lat != null) pts.push([s.lon, s.lat]);
      else {
        const fb = imp.stFb[sid];
        if (fb) pts.push(fb);
      }
    }
    let lenKm = line.lenM ? line.lenM / 1000 : null;
    if (!lenKm && pts.length > 1) {
      let d = 0;
      for (let i = 1; i < pts.length; i++) d += core.haversineKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      lenKm = d;
    }
    return { pts, lenKm, present: pts.length >= 2 };
  };

  /* line rows for tables (union: geometry lines + accounting names) */
  E.describeLines = function (imp) {
    E.prepare(imp);
    if (imp._lineDescriptions) return imp._lineDescriptions;
    const out = new Map();
    imp.lines.forEach((ln, i) => {
      const g = E.lineGeometry(imp, ln);
      out.set(ln.name, {
        kind: "line", name: ln.name, code: ln.code, color: core.colorFromGame(ln.color),
        lineIdx: i, lenKm: g.lenKm, stopsN: ln.nStops,
        region: imp.regionKeyOfStation(ln.staIds[0]),
        accName: ln.name,
      });
    });
    // accounting-only lines (no geometry)
    const seen = new Set(out.keys());
    const byPer = imp._idx.li.daily || {};
    for (const ts in byPer) for (const r of byPer[ts]) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        out.set(r.name, { kind: "line", name: r.name, code: r.code || "", color: [120, 130, 150], lineIdx: -1, lenKm: null, stopsN: null, region: "其他区域", accName: r.name, noGeo: true });
      }
    }
    imp._lineDescriptions = out;
    return out;
  };

  /* station descriptions (union geometry + accounting) */
  E.describeStations = function (imp) {
    E.prepare(imp);
    if (imp._stationDescriptions) return imp._stationDescriptions;
    const out = new Map();
    imp.stations.forEach((s, i) => {
      out.set(s.id, {
        kind: "station", id: s.id, name: s.name, lon: s.lon, lat: s.lat,
        region: imp.regionKeyOfStation(s.id),
        lines: (imp.stLines.get(s.id) || []).map((li) => imp.lines[li].name),
      });
    });
    const seen = new Set(out.keys());
    const byPer = imp._idx.st.daily || {};
    for (const ts in byPer) for (const r of byPer[ts]) {
      if (r.id != null && !seen.has(r.id)) {
        seen.add(r.id);
        const fb = imp.stFb[r.id];
        out.set(r.id, {
          kind: "station", id: r.id, name: r.name, lon: fb ? fb[0] : null, lat: fb ? fb[1] : null,
          region: fb ? (imp.regionKeyOfStation(r.id) || "其他区域") : "其他区域",
          lines: [], noGeo: !fb,
        });
      }
    }
    imp._stationDescriptions = out;
    return out;
  };

  /* region stats: per region -> station count + operating lines count in current bucket */
  E.regionStats = function (imp, bucketLines /* Set of station ids w/ acc rows in bucket */) {
    E.prepare(imp);
    const out = [];
    for (const rg of imp.regions) {
      out.push({ key: rg.name, name: rg.name, stations: rg.n });
    }
    return out;
  };

  /* trend series over buckets of a period for company & aggregated network */
  E.trend = function (imp, per) {
    E.prepare(imp);
    const tsList = E.buckets(imp, per, "li");
    if (!tsList.length) return [];
    const series = tsList.map((ts) => {
      const co = E.companyAgg(imp, per, ts);
      const liMap = E.aggBucket(imp, "li", per, ts);
      let liAgg = null;
      if (liMap.size) {
        liAgg = {};
        for (const a of liMap.values()) for (const c in a) liAgg[c] = (liAgg[c] || 0) + a[c];
      }
      const pick = (agg) => ({
        revenue: E.metricOn("revenue", agg), opex: E.metricOn("opex", agg), opProfit: E.metricOn("opProfit", agg),
        paxBoard: E.metricOn("paxBoard", agg), departures: E.metricOn("departures", agg), fares: E.metricOn("fares", agg),
        cash: E.metricOn("cash", agg), distKm: E.metricOn("distKm", agg),
      });
      return { ts, co: pick(co), net: pick(liAgg), nLines: liMap.size };
    });
    return series;
  };

  E.seriesLine = function (imp, per, name, metricId) {
    const tsList = E.buckets(imp, per, "li");
    const out = [];
    for (const ts of tsList) {
      const agg = E.lineAggAt(imp, per, ts, name);
      out.push({ ts, v: agg ? E.metricOn(metricId, agg) : null });
    }
    return out;
  };
  E.seriesCompany = function (imp, per, metricId) {
    const tsList = E.buckets(imp, per, "co");
    const out = [];
    for (const ts of tsList) {
      out.push({ ts, v: E.metricOn(metricId, E.companyAgg(imp, per, ts)) });
    }
    return out;
  };

  /* financial scope summary text */
  E.scopeNote = function (imp) {
    const rows = [
      imp.geoOk ? `已载入 ${imp.lines.length} 条线路 / ${imp.stations.length} 个站点几何` : "未载入线路几何(仅财务)",
    ];
    if (imp.finOk) {
      const liDaily = E.buckets(imp, "daily", "li").length;
      rows.push(`线路账目 ${imp.accLi.length} 条(含最近 ${liDaily} 个日账期)`);
    } else rows.push("无会计账目数据");
    return rows;
  };

  NS.engine = E;
})(window.NFB);
