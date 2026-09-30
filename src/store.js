/* NIMBY Finance · persistence: IndexedDB workspace + import/export bundles */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const S = {};
  const DB_NAME = "nimby_finance_ws";
  const DB_VER = 1;

  let db = null;
  let memoryFallback = false;
  let WS = { key: "ws", imports: [], comparisons: [], settings: {} };

  function idb() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("imports")) d.createObjectStore("imports", { keyPath: "id" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      const r = fn(os);
      t.oncomplete = () => res(r && r.result !== undefined ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  function getStore(store, key) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, "readonly");
      const rq = t.objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  function putStore(store, val) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, "readwrite");
      t.objectStore(store).put(val);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }
  function delStore(store, key) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, "readwrite");
      t.objectStore(store).delete(key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  }

  S.storageAvailable = () => !memoryFallback;
  S.storageMode = () => (memoryFallback ? "内存(仅本次会话)" : "IndexedDB(本地持久)");

  S.init = async function () {
    try {
      if (!("indexedDB" in window)) throw new Error("no idb");
      db = await idb();
    } catch (e) {
      memoryFallback = true;
      console.warn("IndexedDB 不可用，使用内存存储", e);
    }
    const doc = memoryFallback ? null : await getStore("meta", "ws");
    if (doc) WS = doc;
    else {
      WS = { key: "ws", imports: [], comparisons: [], settings: {} };
      if (!memoryFallback) await putStore("meta", WS);
    }
    return S;
  };

  S.ws = () => WS;
  S.getImport = async function (id) {
    if (memoryFallback) return S._memImports ? S._memImports.get(id) : undefined;
    return getStore("imports", id);
  };
  S.listImportsMeta = function () { return WS.imports.slice(); };

  /* clean an import object into serializable form (drops runtime maps/caches) */
  S.serializeImp = function (imp) {
    return {
      schemaVer: 1,
      id: imp.id, label: imp.label, companyName: imp.companyName,
      files: imp.files || [], importedAt: imp.importedAt, exportClock: imp.exportClock,
      modelVersion: imp.modelVersion, jsonOk: !!imp.jsonOk, tsvOk: !!imp.tsvOk,
      geoOk: !!imp.geoOk, finOk: !!imp.finOk,
      stations: imp.stations, lines: imp.lines,
      accLi: imp.accLi, accSt: imp.accSt, accCo: imp.accCo,
      companyLife: imp.companyLife, stFb: imp.stFb, buckets: imp.buckets,
    };
  };
  /* rebuild runtime structures on a loaded object */
  S.rehydrate = function (imp) {
    if (!imp.stations) imp.stations = [];
    if (!imp.lines) imp.lines = [];
    imp.stById = new Map(imp.stations.map((s) => [s.id, s]));
    imp._prepared = false;
    imp._idx = null; imp._aggCache = null;
    imp._lineDescriptions = null; imp._stationDescriptions = null;
    imp.buckets = imp.buckets || {};
    imp.stFb = imp.stFb || {};
    imp.accLi = imp.accLi || []; imp.accSt = imp.accSt || []; imp.accCo = imp.accCo || [];
    return imp;
  };

  async function persistWs() {
    if (memoryFallback) return;
    await putStore("meta", WS);
  }
  async function persistImport(clean) {
    if (memoryFallback) {
      (S._memImports = S._memImports || new Map()).set(clean.id, clean);
      return;
    }
    await putStore("imports", clean);
  }

  S.addImport = async function (imp) {
    const clean = S.serializeImp(imp);
    await persistImport(clean);
    WS.imports.push(S.metaOf(clean));
    await persistWs();
    return clean.id;
  };
  S.metaOf = function (imp) {
    return {
      id: imp.id, label: imp.label, company: imp.companyName,
      files: imp.files || [], importedAt: imp.importedAt, exportClock: imp.exportClock,
      modelVersion: imp.modelVersion, geoOk: !!imp.geoOk, finOk: !!imp.finOk,
      nLines: (imp.lines || []).length, nStations: (imp.stations || []).length,
      accLineRows: (imp.accLi || []).length, accStationRows: (imp.accSt || []).length,
    };
  };
  S.removeImport = async function (id) {
    if (!memoryFallback) await delStore("imports", id);
    else if (S._memImports) S._memImports.delete(id);
    WS.imports = WS.imports.filter((x) => x.id !== id);
    WS.comparisons = WS.comparisons.filter((c) => c.baseId !== id && c.targetId !== id);
    await persistWs();
  };
  S.updateImportMeta = async function (id, patch) {
    const meta = WS.imports.find((x) => x.id === id);
    if (!meta) return;
    if (patch.label !== undefined) {
      const saved = await S.getImport(id);
      if (saved) {
        saved.label = patch.label;
        await persistImport(saved);
      }
    }
    Object.assign(meta, patch);
    await persistWs();
  };
  S.addComparison = async function (cmp) {
    cmp.id = cmp.id || "cmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    cmp.createdAt = Math.floor(Date.now() / 1000);
    WS.comparisons.unshift(cmp);
    await persistWs();
    return cmp.id;
  };
  S.removeComparison = async function (id) {
    WS.comparisons = WS.comparisons.filter((c) => c.id !== id);
    await persistWs();
  };
  S.setSettings = async function (patch) {
    Object.assign(WS.settings, patch);
    await persistWs();
  };
  S.reset = async function () {
    WS.imports = []; WS.comparisons = []; WS.settings = {};
    await persistWs();
    if (!memoryFallback) {
      await tx("imports", "readwrite", (os) => os.clear());
    }
  };

  /* ---------------- bundle serialization ---------------- */
  S.bundleType = { IMPORT: "nb-import", BUNDLE: "nb-bundle", WORKSPACE: "nb-workspace", COMPARISON: "nb-comparison" };
  S.packImports = function (imps) {
    return imps.map((i) => S.serializeImp(i));
  };
  S.packComparisons = function (cmps) {
    return cmps.map((c) => JSON.parse(JSON.stringify(c)));
  };
  S.makeSingleFile = function (kind, { imports = [], comparisons = [], label } = {}) {
    const obj = { type: kind, app: "nimby-finance", ver: 1, exportedAt: Date.now(), label: label || "" };
    if (kind === S.bundleType.IMPORT && imports.length === 1) {
      obj.import = S.serializeImp(imports[0]);
    } else if (kind === S.bundleType.BUNDLE) {
      obj.imports = S.packImports(imports);
      obj.comparisons = S.packComparisons(comparisons);
    } else if (kind === S.bundleType.WORKSPACE) {
      obj.settings = WS.settings;
      obj.imports = S.packImports(imports);
      obj.comparisons = S.packComparisons(comparisons);
    } else if (kind === S.bundleType.COMPARISON) {
      obj.comparison = comparisons[0];
      const ids = [obj.comparison.baseId, obj.comparison.targetId];
      obj.imports = S.packImports(imports.filter((i) => ids.includes(i.id)));
    }
    return obj;
  };
  /* returns {imports:[clean...], comparisons:[...], meta} after parsing bundle text */
  S.parseBundle = function (text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error("文件不是有效的 JSON 包"); }
    if (!o || typeof o !== "object") throw new Error("数据包格式错误");
    const imports = [];
    const comparisons = [];
    if (o.type === "nb-import" && o.import) imports.push(o.import);
    else if (o.type === "nb-bundle" || o.type === "nb-workspace") {
      (o.imports || []).forEach((x) => imports.push(x));
      (o.comparisons || []).forEach((x) => comparisons.push(x));
    } else if (o.type === "nb-comparison") {
      comparisons.push(o.comparison);
      (o.imports || []).forEach((x) => imports.push(x));
    } else throw new Error("未知数据包类型: " + (o.type || "?"));
    return { imports, comparisons };
  };
  S.importToWorkspace = async function (clean) {
    S.rehydrate(clean);
    await S.addImport(clean);
    return clean;
  };
  /* restore comparisons (imports must exist); returns count restored */
  S.restoreComparisons = async function (cmps) {
    const ids = new Set(WS.imports.map((m) => m.id));
    let n = 0;
    for (const c of cmps) {
      if (c && ids.has(c.baseId) && ids.has(c.targetId)) {
        await S.addComparison(c);
        n++;
      }
    }
    return n;
  };

  NS.store = S;
})(window.NFB);
