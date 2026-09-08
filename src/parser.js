/* NIMBY Finance · parser: game JSON timetable + TSV accounting -> normalized import model */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const P = {};
  const core = NS.core;

  /* TSV header name -> canonical id (sum = include in aggregation) */
  const CANON = [
    ["financing_credit", "credit", 1], ["financing_interest", "interest", 1],
    ["construction_tracks", "cTrack", 1], ["construction_buildings", "cBuild", 1],
    ["construction_stations", "cStation", 1], ["construction_depots", "cDepot", 1],
    ["construction_total", "cTotal", 1],
    ["trains_purchases", "buy", 1], ["trains_sales", "sell", 1],
    ["trains_running", "running", 1], ["trains_maintenance", "maintenance", 1],
    ["trains_intervention", "intervention", 1],
    ["trains_running_distance", "dist", 1], ["trains_running_time", "runTime", 1],
    ["trains_stop_time", "stopTime", 1], ["trains_extra_stop_time", "extraStop", 1],
    ["trains_late_arrival_time", "late", 1], ["trains_signal_stop_time", "signalStop", 1],
    ["trains_collisions", "collisions", 1], ["trains_departures", "departures", 1],
    ["train_arrived_full", "arrivedFull", 1], ["train_departed_full", "departedFull", 1],
    ["ticketing_fares", "fares", 1], ["ticketing_refunds", "refunds", 1],
    ["ticketing_compensations", "compensations", 1], ["cash_total", "cash", 1],
    ["pax_new", "paxNew", 1], ["pax_never_serviced", "paxNever", 1],
    ["pax_spawned", "paxSpawn", 1], ["pax_boarded", "paxBoard", 1],
    ["pax_walked_in", "walkIn", 1], ["pax_walked_out", "walkOut", 1],
    ["pax_reached_transfer", "transfer", 1], ["pax_reached_destination", "dest", 1],
    ["pax_found_station_too_full", "tooFull", 1], ["pax_waited_too_long", "wait", 1],
    ["pax_lost", "lost", 1], ["pax_intervention", "intervPax", 1],
    ["pax_compensated", "compPax", 1], ["pax_refused_fare", "refuse", 1],
    ["pax_reached_depot", "depot", 1], ["pax_refunded", "refunded", 1],
    ["longitude", "lon", 0], ["latitude", "lat", 0],
  ];
  P.CANON = CANON;

  function fieldIndexes(header) {
    const map = {};
    CANON.forEach(([h, c]) => { map[h] = c; });
    const meta = ["id", "kind", "name", "code", "period", "timestamp", "line_id"];
    meta.forEach((h) => { map[h] = h; });
    const idx = {}; // canon/meta -> header col
    header.forEach((h, i) => { const c = map[h]; if (c && idx[c] == null) idx[c] = i; });
    return idx;
  }
  const SKIP = { id: 1, kind: 1, name: 1, code: 1, period: 1, timestamp: 1, line_id: 1 };

  /* ---------------- TSV accounting ---------------- */
  function parseAccounting(text, fileName) {
    const lines = text.split(/\r?\n/);
    const out = { company: null, accLi: [], accSt: [], accCo: [], stFb: {}, buckets: {} };
    let n = 0, skipBad = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (!line.trim()) continue;
      const cells = line.split("\t");
      if (n === 0) {
        if (cells[0] === "id" || cells[1] === "kind") {
          out.idx = fieldIndexes(cells);
          n = 1;
          continue;
        }
        // tolerate missing header: assume standard layout
        out.idx = fieldIndexes(["id", "kind", "name", "code", "period", "timestamp", "line_id", "longitude", "latitude", "financing_credit", "financing_interest", "construction_tracks", "construction_buildings", "construction_stations", "construction_depots", "construction_total", "trains_purchases", "trains_sales", "trains_running", "trains_maintenance", "trains_intervention", "trains_running_distance", "trains_running_time", "trains_stop_time", "trains_extra_stop_time", "trains_late_arrival_time", "trains_signal_stop_time", "trains_collisions", "trains_departures", "train_arrived_full", "train_departed_full", "ticketing_fares", "ticketing_refunds", "ticketing_compensations", "cash_total", "pax_new", "pax_never_serviced", "pax_spawned", "pax_boarded", "pax_walked_in", "pax_walked_out", "pax_reached_transfer", "pax_reached_destination", "pax_found_station_too_full", "pax_waited_too_long", "pax_lost", "pax_intervention", "pax_compensated", "pax_refused_fare", "pax_reached_depot", "pax_refunded"]);
        n = 1;
      }
      const ix = out.idx;
      const kind = (cells[ix.kind] || "").trim();
      const per = (cells[ix.period] || "").trim();
      const ts = (cells[ix.timestamp] || "").trim();
      if (kind === "kind" || !per) continue;
      const v = {};
      for (const c in ix) {
        if (SKIP[c]) continue;
        const raw = cells[ix[c]];
        if (raw == null || raw === "") continue;
        const num = Number(raw);
        if (isFinite(num)) v[c] = num;
      }
      if (kind === "company") {
        if (per === "lifetime" && !out.company) {
          out.company = { id: cells[ix.id] ? Number(cells[ix.id]) : 0, name: cells[ix.name] || "", v };
        }
        out.accCo.push({ id: cells[ix.id] ? Number(cells[ix.id]) : 0, name: cells[ix.name] || "", per, ts, v });
        continue;
      }
      const idRaw = cells[ix.id];
      const id = idRaw && idRaw !== "" ? Number(idRaw) : null;
      const name = cells[ix.name] != null ? cells[ix.name].trim() : "";
      const code = cells[ix.code] != null ? cells[ix.code].trim() : "";
      const rec = { id, name, code, per, ts, v };
      if (kind === "line") {
        out.accLi.push(rec);
        if (!out.buckets[per]) out.buckets[per] = new Set();
        out.buckets[per].add(ts);
      } else if (kind === "station") {
        out.accSt.push(rec);
        if (!out.buckets[per]) out.buckets[per] = new Set();
        out.buckets[per].add(ts);
        if (id != null && v.lon != null && v.lat != null && !out.stFb[id]) out.stFb[id] = [v.lon, v.lat];
      }
      // train rows intentionally skipped (fleet detail, not required)
    }
    if (!n) throw new Error("TSV 会计文件无法识别（缺少表头）");
    return out;
  }

  /* ---------------- JSON timetable ---------------- */
  function parseTimetable(text) {
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new Error("JSON 文件解析失败: " + e.message); }
    if (!Array.isArray(arr)) throw new Error("JSON 结构异常：应为对象数组");
    const out = { companyName: null, exportClock: null, modelVersion: null, stations: [], lines: [], byId: new Map() };
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i];
      if (!o || typeof o !== "object") continue;
      const cls = o.class;
      if (cls === "ExportMeta") {
        out.companyName = o.company_name || null;
        out.exportClock = o.clock_epoch_s || null;
        out.modelVersion = o.model_version || null;
      } else if (cls === "Station") {
        const [lon, lat] = Array.isArray(o.lonlat) ? o.lonlat : [null, null];
        const id = numId(o.id);
        const st = { id, name: String(o.name || ""), lon, lat };
        out.stations.push(st);
        out.byId.set(id, st);
      } else if (cls === "Line") {
        const stops = Array.isArray(o.stops) ? o.stops : [];
        const staIds = [];
        let lenM = 0;
        for (const s of stops) {
          if (s && s.station_id != null) staIds.push(numId(s.station_id));
          if (s && isFinite(s.leg_distance)) lenM += s.leg_distance;
        }
        out.lines.push({
          id: numId(o.id),
          name: String(o.name || ""),
          code: String(o.code || ""),
          color: String(o.color || "0xff8080ff"),
          tags: Array.isArray(o.tags) ? o.tags : [],
          staIds,
          lenM,
          nStops: staIds.length,
        });
      }
    }
    return out;
  }
  function numId(id) {
    if (typeof id === "number") return id;
    const n = Number(String(id));
    return isFinite(n) ? n : null;
  }

  /* ---------------- merge into import ---------------- */
  P.buildImport = function ({ json, tsv, files, label }) {
    const imp = {
      schemaVer: 1,
      id: core.uid("imp"),
      label: label || "",
      files: files || [],
      importedAt: Math.floor(Date.now() / 1000),
      companyName: null, exportClock: null, modelVersion: null,
      jsonOk: !!json, tsvOk: !!tsv,
      stations: [], lines: [], stById: new Map(),
      accLi: [], accSt: [], accCo: [], companyLife: null,
      stFb: {}, buckets: {},
      geoOk: false, finOk: false,
    };
    if (json) {
      const t = parseTimetable(json.text);
      imp.companyName = t.companyName || imp.companyName;
      imp.exportClock = t.exportClock;
      imp.modelVersion = t.modelVersion;
      imp.stations = t.stations;
      imp.stById = t.byId;
      imp.lines = t.lines;
      imp.geoOk = t.stations.length > 0;
    }
    if (tsv) {
      const a = parseAccounting(tsv.text, tsv.name);
      imp.companyName = (a.company && a.company.name) || imp.companyName;
      imp.companyLife = a.company ? a.company.v : null;
      imp.accLi = a.accLi; imp.accSt = a.accSt; imp.accCo = a.accCo;
      imp.stFb = a.stFb;
      imp.buckets = {};
      for (const per in a.buckets) imp.buckets[per] = core.tsSort(per, Array.from(a.buckets[per]));
      imp.finOk = a.accLi.length > 0 || a.accCo.length > 0;
      // station fallback coords for stations unknown to JSON
      if (!imp.geoOk && Object.keys(a.stFb).length) {
        for (const id in a.stFb) {
          if (!imp.stById.has(+id)) {
            const st = { id: +id, name: "", lon: a.stFb[id][0], lat: a.stFb[id][1] };
            imp.stations.push(st); imp.stById.set(st.id, st);
          }
        }
      }
    }
    if (!imp.label) {
      const d = imp.exportClock ? core.shortEpoch(imp.exportClock) : new Date().toISOString().slice(0, 10);
      imp.label = (imp.companyName || "公司") + " · " + d;
    }
    return imp;
  };

  /* descriptive summary */
  P.summarize = function (imp) {
    const bucketCount = {};
    for (const per in imp.buckets) bucketCount[per] = imp.buckets[per].length;
    return {
      company: imp.companyName || "—",
      epoch: imp.exportClock,
      stations: imp.stations.length,
      lines: imp.lines.length,
      accLineRows: imp.accLi.length,
      accStationRows: imp.accSt.length,
      buckets: bucketCount,
      geoOk: imp.geoOk, finOk: imp.finOk,
    };
  };

  NS.parser = P;
})(window.NFB);
