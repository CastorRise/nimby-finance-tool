/* NIMBY Finance · export center + generic modal/import flows */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const X = {};
  const core = NS.core, store = NS.store, engine = NS.engine;

  /* ---------- generic modal ---------- */
  X.showModal = function ({ title, body, footer, wide, narrow }) {
    const root = document.getElementById("modal-root");
    const overlay = core.el("div", "overlay");
    const modal = core.el("div", "modal" + (wide ? " wide" : narrow ? " narrow" : ""));
    const head = core.el("div", "m-head");
    head.innerHTML = `<span>${core.esc(title)}</span><button class="x" aria-label="关闭">✕</button>`;
    const bodyEl = core.el("div", "m-body");
    bodyEl.append(body);
    modal.appendChild(head);
    modal.appendChild(bodyEl);
    if (footer) {
      const f = core.el("div", "m-foot");
      footer.forEach((b) => f.appendChild(b));
      modal.appendChild(f);
    }
    overlay.appendChild(modal);
    root.appendChild(overlay);
    const close = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    head.querySelector(".x").onclick = close;
    return { close, modal, bodyEl };
  };
  X.confirm = function (msg, okText) {
    return new Promise((res) => {
      const btnOk = core.el("button", "btn danger", core.esc(okText || "确认"));
      const btnNo = core.el("button", "btn", "取消");
      const m = X.showModal({
        title: "请确认", body: core.el("div", "step-hint", msg),
        footer: [btnNo, btnOk],
      });
      btnNo.onclick = () => { m.close(); res(false); };
      btnOk.onclick = () => { m.close(); res(true); };
    });
  };

  /* ---------- file naming / download ---------- */
  function toJsonFile(prefix, obj) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const name = `${prefix}_${date}.nb.json`;
    core.download(name, JSON.stringify(obj), "application/json");
    return name;
  }
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);

  /* ---------- individual exports ---------- */
  X.exportSingleImport = async function (meta) {
    const imp = await store.getImport(meta.id);
    if (!imp) { NS.app.toast("档案不存在", "err"); return; }
    const obj = { type: "nb-import", app: "nimby-finance", ver: 1, exportedAt: Date.now(), import: store.serializeImp(imp) };
    const nm = toJsonFile((meta.company || "公司") + "_快照_" + safe(meta.label), obj);
    NS.app.toast("已导出: " + nm, "ok");
  };
  X.exportSingleComparison = async function (cmp) {
    const refs = [];
    for (const id of [cmp.baseId, cmp.targetId]) {
      const imp = await store.getImport(id);
      if (imp) refs.push(store.serializeImp(imp));
    }
    const obj = { type: "nb-comparison", app: "nimby-finance", ver: 1, exportedAt: Date.now(), comparison: JSON.parse(JSON.stringify(cmp)), imports: refs };
    const nm = toJsonFile("对比_" + safe(cmp.name), obj);
    NS.app.toast("已导出: " + nm, "ok");
  };
  X.exportBundle = async function ({ imports, comparisons, label }) {
    const list = [];
    for (const m of imports) {
      const imp = await store.getImport(m.id);
      if (imp) list.push(store.serializeImp(imp));
    }
    const obj = {
      type: "nb-bundle", app: "nimby-finance", ver: 1, exportedAt: Date.now(),
      imports: list, comparisons: comparisons.map((c) => JSON.parse(JSON.stringify(c))),
    };
    const nm = toJsonFile("打包_" + safe(label || `选${imports.length}档`), obj);
    NS.app.toast(`已打包导出 ${list.length} 档 · ${comparisons.length} 对比: ${nm}`, "ok");
  };
  X.exportBackup = async function () {
    const metas = store.listImportsMeta();
    const list = [];
    for (const m of metas) {
      const imp = await store.getImport(m.id);
      if (imp) list.push(store.serializeImp(imp));
    }
    const obj = {
      type: "nb-workspace", app: "nimby-finance", ver: 1, exportedAt: Date.now(),
      settings: store.ws().settings, imports: list, comparisons: store.ws().comparisons.slice(),
    };
    const nm = toJsonFile("NIMBY财务_整库备份", obj);
    NS.app.toast(`整库备份已导出(${list.length} 档): ${nm}`, "ok");
  };

  /* ---------- export center modal ---------- */
  X.open = function () {
    const metas = store.listImportsMeta();
    const cmps = store.ws().comparisons;
    const sel = new Set();
    const items = new Map(); // key -> {chk, lbl}
    const body = core.el("div", "exp-groups");
    const addCheck = (key, labelTxt, sub) => {
      const lbl = core.el("label", "", "");
      const chk = document.createElement("input");
      chk.type = "checkbox"; chk.checked = true; sel.add(key);
      chk.onchange = () => { if (chk.checked) sel.add(key); else sel.delete(key); };
      const span = core.el("span", "", core.esc(labelTxt));
      const sz = core.el("span", "sz", core.esc(sub || ""));
      lbl.append(chk, span, sz);
      items.set(key, { chk, lbl });
      return lbl;
    };
    const group = (t, hint) => {
      const w = core.el("div", "exp-group");
      w.appendChild(core.el("div", "eg-t", core.esc(t)));
      if (hint) w.appendChild(core.el("div", "eg-hint", core.esc(hint)));
      return w;
    };
    const ga = group("① 档案数据包 (含几何+账目, 供其它设备使用)", "勾选档案：可“逐个导出”为独立文件，或“打包”成一个文件。");
    const la = core.el("div", "check-list");
    metas.forEach((m) => la.appendChild(addCheck("imp:" + m.id, m.label, `${m.nLines || 0} 线 · ${m.nStations || 0} 站 · ${m.accLineRows || 0} 行`)));
    if (!metas.length) la.innerHTML = '<div class="empty-hint">还没有导入档案</div>';
    ga.appendChild(la); body.appendChild(ga);

    const gc = group("② 保存过的对比 (自动附带引用档案)", "勾选后打包/导出，可在其它设备重建对比。");
    const lc = core.el("div", "check-list");
    cmps.forEach((c) => lc.appendChild(addCheck("cmp:" + c.id, c.name, "对比")));
    if (!cmps.length) lc.innerHTML = '<div class="empty-hint">暂无保存的对比(在「历史对比」页可保存)</div>';
    gc.appendChild(lc); body.appendChild(gc);

    const gb = group("③ 操作", "");
    const row = core.el("div", "exp-btns");
    const bAll = core.el("button", "btn xs", "全选");
    const bNone = core.el("button", "btn xs", "清空");
    const bEach = core.el("button", "btn xs", "逐个导出选中");
    const bPack = core.el("button", "btn primary sm", "⤓ 打包为一个文件");
    row.append(bAll, bNone, bEach, bPack);
    gb.appendChild(row);
    gb.appendChild(core.el("div", "eg-hint", "“.nb.json”文件可直接导入本工具(含其它设备/浏览器)，数据完整可复算。"));
    body.appendChild(gb);

    const g2 = group("④ 整库备份 / 恢复", "备份=当前工作区全部(档案+对比+设置)；恢复自动合并，重复档案跳过。");
    const row2 = core.el("div", "exp-btns");
    const bBak = core.el("button", "btn sm", "备份整个工作区");
    const bRes = core.el("button", "btn sm", "从备份/数据包恢复…");
    const bClr = core.el("button", "btn sm danger", "清空工作区");
    row2.append(bBak, bRes, bClr);
    g2.appendChild(row2); body.appendChild(g2);

    const g3 = group("⑤ 应用状态与口径", "");
    const kv = core.el("div", "kv");
    kv.innerHTML = `<span class="k">存储方式</span><span class="v">${core.esc(store.storageMode())}</span>
      <span class="k">档案数量</span><span class="v">${metas.length}</span>
      <span class="k">数据口径</span><span class="v">票款净额=票款+退票+补偿; 运营成本=运行+维护+干预(负数); 运营利润=两者之和; 公司现金流含建设/购车/融资</span>`;
    g3.appendChild(kv); body.appendChild(g3);

    const g6 = group("⑥ 自动备份设置", "开启后：每次从游戏文件导入档案，都会自动在浏览器的“下载”文件夹生成一份该档案的 .nb.json（无需手动导出）。本地 IndexedDB 保存不受影响。");
    const l6 = core.el("label", "chk", "");
    const c6 = document.createElement("input");
    c6.type = "checkbox";
    c6.checked = (store.ws().settings || {}).autoBackup !== false;
    c6.onchange = () => store.setSettings({ autoBackup: c6.checked });
    const sp6 = core.el("span", "", "导入后自动生成备份文件");
    l6.append(c6, sp6);
    g6.appendChild(l6);
    body.appendChild(g6);

    const m = X.showModal({ title: "导出中心 · 打包 / 备份 / 恢复", body, wide: true });
    bAll.onclick = () => items.forEach((it, k) => { it.chk.checked = true; sel.add(k); });
    bNone.onclick = () => items.forEach((it, k) => { it.chk.checked = false; sel.delete(k); });
    bEach.onclick = async () => {
      const selImps = metas.filter((x) => sel.has("imp:" + x.id));
      const selCmps = cmps.filter((x) => sel.has("cmp:" + x.id));
      if (!selImps.length && !selCmps.length) return NS.app.toast("未选择任何项目", "err");
      for (const x of selImps) await X.exportSingleImport(x);
      for (const c of selCmps) await X.exportSingleComparison(c);
    };
    bPack.onclick = async () => {
      const selImps = metas.filter((x) => sel.has("imp:" + x.id));
      const selCmps = cmps.filter((x) => sel.has("cmp:" + x.id));
      if (!selImps.length && !selCmps.length) return NS.app.toast("未选择任何项目", "err");
      await X.exportBundle({ imports: selImps, comparisons: selCmps });
    };
    bBak.onclick = async () => { await X.exportBackup(); };
    bClr.onclick = async () => {
      const yes = await X.confirm("将删除工作区内全部档案与对比(不影响磁盘上的原始游戏导出文件)。确定继续？");
      if (!yes) return;
      await store.reset();
      m.close();
      NS.app.reloadAll && NS.app.reloadAll();
      NS.app.toast("工作区已清空", "ok");
    };
    bRes.onclick = () => { m.close(); X.openImportDialog(); };
    return m;
  };

  /* ---------- file classification ---------- */
  X.classify = function (text) {
    const t = text.trim();
    if (!t) return "empty";
    if (t.startsWith("[")) return "timetable-json";
    if (t.startsWith("{")) return "bundle-json";
    if (t.includes("\t") && /financing_credit|ticketing_fares|trains_running/.test(t.slice(0, 4000))) return "accounting-tsv";
    return "unknown";
  };

  /* ---------- import dialog (raw exports or .nb bundles) ---------- */
  X.openImportDialog = function () {
    const body = core.el("div", "", "");
    const hint = core.el("div", "step-hint",
      `从 <b>NIMBY Rails</b> 游戏导出：可同时放入 <b>会计账目(*.tsv)</b> 与 <b>时刻表(*.json)</b>（也可只放一种）。
      <br>也可以选择本工具导出的 <b>.nb.json 数据包</b>，会直接并入工作区（跨设备同步用）。`);
    const dz = core.el("div", "dropzone");
    dz.innerHTML = `<div class="dz-t">点击选择 或 拖放文件到这里</div>
      <div style="font-size:11.6px">支持多选: Accounting *.tsv + Timetable *.json + *.nb.json</div>`;
    const fileList = core.el("div", "file-list");
    const progWrap = core.el("div", "", "");
    body.append(hint, dz, fileList, progWrap);
    const btnImport = core.el("button", "btn primary", "导入");
    btnImport.disabled = true;
    const btnCancel = core.el("button", "btn", "取消");
    const m = X.showModal({ title: "导入数据", body, footer: [btnCancel, btnImport], wide: true });
    let selected = [];
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.tsv,.nb,.txt,application/json,text/plain";
    input.style.display = "none";
    dz.appendChild(input);
    input.onchange = () => { accept(input.files); input.value = ""; };
    dz.onclick = () => input.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
    dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = (e) => {
      e.preventDefault(); dz.classList.remove("over");
      if (e.dataTransfer && e.dataTransfer.files.length) accept(e.dataTransfer.files);
    };
    function accept(files) {
      fileList.innerHTML = ""; selected = Array.from(files);
      selected.forEach((f) => {
        fileList.appendChild(core.el("div", "file-item",
          `<span class="fi-t"><span class="fn">${core.esc(f.name)}</span></span><span class="fs">${core.fmtSize(f.size)}</span>`));
      });
      btnImport.disabled = !selected.length;
    }
    btnImport.onclick = async () => {
      if (!selected.length) return;
      btnImport.disabled = true;
      const prog = core.el("div", "", "");
      progWrap.innerHTML = ""; progWrap.appendChild(prog);
      const setProg = (p, txt) => { prog.innerHTML = `<div class="progress"><i style="width:${p}%"></i></div><div class="progress-txt">${core.esc(txt)}</div>`; };
      try {
        setProg(3, "读取文件…");
        const contents = await Promise.all(selected.map((f) => new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res({ name: f.name, text: fr.result });
          fr.onerror = rej;
          fr.readAsText(f);
        })));
        setProg(15, "识别文件…");
        let json = null, tsv = null, bundles = [];
        contents.forEach((c) => {
          const cls = X.classify(c.text);
          if (cls === "timetable-json" && !json) json = c;
          else if (cls === "accounting-tsv" && !tsv) tsv = c;
          else if (cls === "bundle-json") bundles.push(c);
          else if (cls !== "empty") NS.app.toast("无法识别的文件: " + c.name, "err");
        });
        if (!json && !tsv && !bundles.length) {
          NS.app.toast("没有可导入的文件内容", "err");
          btnImport.disabled = false;
          return;
        }
        if (bundles.length) {
          setProg(55, "并入数据包…");
          for (const b of bundles) {
            try {
              const { imports, comparisons } = store.parseBundle(b.text);
              const existing = new Set(store.listImportsMeta().map((x) => x.id));
              let n = 0;
              for (const clean of imports) {
                if (!existing.has(clean.id)) { await store.importToWorkspace(clean); n++; }
                else NS.app.toast(`跳过重复档案: ${clean.label || clean.id}`, "ok");
              }
              const restored = await store.restoreComparisons(comparisons);
              if (n || restored) NS.app.toast(`数据包 ${b.name}: 并入 ${n} 档 / 恢复对比 ${restored} 个`, "ok");
            } catch (e) { NS.app.toast(`数据包 ${b.name} 失败: ${e.message}`, "err"); }
          }
        }
        if (json || tsv) {
          setProg(45, "解析账目与线路(大文件需数秒)…");
          await new Promise((r) => setTimeout(r, 30));
          const imp = NS.parser.buildImport({
            json: json ? { text: json.text, name: json.name } : null,
            tsv: tsv ? { text: tsv.text, name: tsv.name } : null,
            files: selected.map((f) => f.name),
          });
          const s = NS.parser.summarize(imp);
          setProg(88, "构建分析索引…");
          await new Promise((r) => setTimeout(r, 30));
          engine.prepare(imp);
          setProg(100, "完成");
          await new Promise((r) => setTimeout(r, 120));
          const p2 = core.el("div", "", "");
          p2.innerHTML = `
            <div class="kv">
              <span class="k">公司</span><span class="v">${core.esc(s.company)}</span>
              <span class="k">导出时刻</span><span class="v">${imp.exportClock ? core.epochLabel(imp.exportClock) : "未知"}</span>
              <span class="k">线路数</span><span class="v">${s.lines}</span>
              <span class="k">站点数</span><span class="v">${s.stations}</span>
              <span class="k">线路账行</span><span class="v">${s.accLineRows} (其中日账期 ${(s.buckets.daily || 0)} 天)</span>
              <span class="k">站点账行</span><span class="v">${s.accStationRows}</span>
              <span class="k">账期粒度</span><span class="v">${Object.keys(s.buckets).map((p) => `${core.periodLabel(p)}×${s.buckets[p]}`).join(" · ") || "—"}</span>
            </div>
            <div class="note-box" style="margin-top:10px">${!s.geoOk ? "⚠ 未识别到线路几何(JSON)，地图将按账目坐标示意。" : ""}${!s.finOk ? "⚠ 未识别到会计账目(TSV)。" : ""}</div>`;
          const auto = (store.ws().settings || {}).autoBackup !== false;
          const abBox = core.el("div", "chk-row", "");
          abBox.style.margin = "10px 0 2px";
          abBox.innerHTML = `<label class="chk" style="font-size:12.2px"><input type="checkbox" id="imp-auto-bk" ${auto ? "checked" : ""}><span>导入后自动在“下载”文件夹生成该档案的 .nb.json 备份（防止浏览器数据被清理后丢失）</span></label>`;
          p2.appendChild(abBox);
          const lblInp = core.el("div", "field-label", "档案名称(可修改)");
          const nameInp = document.createElement("input");
          nameInp.type = "text";
          nameInp.style.cssText = "border:1px solid #d4dbe7;border-radius:8px;padding:6px 8px";
          nameInp.value = imp.label;
          lblInp.appendChild(nameInp);
          p2.appendChild(lblInp);
          const m2 = X.showModal({
            title: "确认导入", body: p2,
            footer: [
              core.el("button", "btn", "取消"),
              (() => { const b = core.el("button", "btn primary", "导入到工作区"); return b; })(),
            ],
          });
          m2.modal.querySelector(".m-foot .btn.primary").onclick = async () => {
            imp.label = nameInp.value.trim() || imp.label;
            const ab = p2.querySelector("#imp-auto-bk");
            await store.setSettings({ autoBackup: ab ? ab.checked : true });
            const id = await store.addImport(imp);
            m.close(); m2.close();
            NS.app.reloadAll && NS.app.reloadAll(id);
            if (ab && ab.checked) NS.app.autoBackup(imp);
            NS.app.toast(`已导入「${imp.label}」`, "ok");
          };
          return;
        }
        m.close();
        NS.app.reloadAll && NS.app.reloadAll();
      } catch (e) {
        console.error(e);
        NS.app.toast("导入失败: " + e.message, "err");
        btnImport.disabled = false;
      }
    };
    btnCancel.onclick = m.close;
  };

  NS.exportcenter = X;
})(window.NFB);
