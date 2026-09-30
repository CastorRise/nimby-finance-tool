/* NIMBY Finance · sortable data table + csv */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const T = {};
  const core = NS.core;

  /* cfg: { cols:[{k,label,num,align,fmt(v,row),raw(v,row),title}], rows, sortBy, sortDesc, onSelect(row), selectedKey, emptyText } */
  T.mkTable = function (container, cfg) {
    let rows = cfg.rows || [];
    let sortBy = cfg.sortBy || (cfg.cols[0] && cfg.cols[0].k);
    let sortDesc = cfg.sortDesc != null ? cfg.sortDesc : true;

    function cellText(col, row, v) {
      if (col.fmt) return col.fmt(v, row);
      if (v == null) return "—";
      if (typeof v === "number") return core.fmtNum(v);
      return String(v);
    }
    function sortVal(col, row) {
      const raw = row[col.k];
      return col.num && typeof raw === "number" ? raw : String(raw == null ? "" : raw);
    }

    function draw() {
      container.innerHTML = "";
      // host must behave as a flex column so the inner .tbl-wrap can shrink & scroll
      container.style.cssText = (container.style.cssText || "") + ";display:flex;flex-direction:column;min-height:0;flex:1 1 0%;overflow:hidden";
      const wrap = core.el("div", "tbl-wrap scroll-thin");
      const table = core.el("table", "grid");
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      cfg.cols.forEach((col) => {
        const th = document.createElement("th");
        th.className = col.num ? "num" : "";
        th.innerHTML = col.label + (sortBy === col.k ? (sortDesc ? " ▼" : " ▲") : "");
        th.style.cursor = "pointer";
        th.tabIndex = 0;
        th.setAttribute("aria-sort", sortBy === col.k ? (sortDesc ? "descending" : "ascending") : "none");
        th.onclick = () => {
          if (sortBy === col.k) sortDesc = !sortDesc;
          else { sortBy = col.k; sortDesc = !!col.num; }
          draw();
        };
        th.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); th.click(); }
        };
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);
      const sorted = rows.slice().sort((a, b) => {
        const va = cfg.cols.find((c) => c.k === sortBy);
        if (!va) return 0;
        const x = sortVal(va, a), y = sortVal(va, b);
        if (typeof x === "number" && typeof y === "number") return sortDesc ? y - x : x - y;
        return sortDesc ? String(y).localeCompare(String(x), "zh-CN") : String(x).localeCompare(String(y), "zh-CN");
      });
      const tbody = document.createElement("tbody");
      sorted.forEach((row) => {
        const tr = document.createElement("tr");
        if (cfg.selectedKey != null && row.__key === cfg.selectedKey) tr.className = "sel";
        cfg.cols.forEach((col) => {
          const td = document.createElement("td");
          const v = row[col.k];
          if (col.num) td.className = "num";
          if (col.cls) td.className = (td.className ? td.className + " " : "") + col.cls;
          td.innerHTML = cellText(col, row, v);
          if (col.title) td.title = col.title;
          tr.appendChild(td);
        });
        if (cfg.onSelect) {
          tr.style.cursor = "pointer";
          tr.onclick = () => cfg.onSelect(row);
          tr.tabIndex = 0;
          tr.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cfg.onSelect(row); }
          };
        }
        tbody.appendChild(tr);
      });
      if (!sorted.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = cfg.cols.length;
        td.className = "grid-empty";
        td.textContent = cfg.emptyText || "无数据";
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      container._wrap = wrap;
      container._table = table;
    }

    draw();

    return {
      setRows(r) { rows = r; draw(); },
      sortByKey(k, desc) { sortBy = k; sortDesc = desc; draw(); },
      getCSV() {
        const head = cfg.cols.map((c) => c.label);
        const out = rows.map((row) => cfg.cols.map((c) => {
          const raw = row[c.k];
          if (c.csv != null) return c.csv(raw, row);
          if (raw == null) return "";
          return raw;
        }));
        return core.toCSV(head, out);
      },
      rowCount: () => rows.length,
      sortState: () => ({ sortBy, sortDesc }),
    };
  };

  NS.tables = T;
})(window.NFB);
