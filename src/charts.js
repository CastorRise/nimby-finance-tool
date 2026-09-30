/* NIMBY Finance · ECharts helpers */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const H = {};
  const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC",sans-serif';
  let INK, MUT, PALETTE, AXIS, ACCENT, RED, TRACK, SURFACE, SOFT;
  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(name).trim();
    INK = token("--ink"); MUT = token("--muted");
    ACCENT = token("--accent"); RED = token("--red");
    TRACK = token("--track"); SURFACE = token("--surface"); SOFT = token("--surface-soft");
    const dark = document.documentElement.dataset.theme === "dark";
    PALETTE = [ACCENT, token("--green"), token("--amber"), RED,
      dark ? "#b49aff" : "#7357bd", dark ? "#7ac8dc" : "#24889e",
      MUT, token("--orange")];
    AXIS = {
      axisLine: { lineStyle: { color: token("--line2") } },
      axisTick: { show: false },
      axisLabel: { color: MUT, fontFamily: FONT, fontSize: 10.5 },
    };
  }
  H.color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  H.mk = function (el) {
    readTheme();
    const c = echarts.init(el, null, { renderer: "canvas" });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    c._ro = ro;
    return c;
  };
  H.dispose = function (c) { if (c) { try { c._ro && c._ro.disconnect(); } catch (e) {} c.dispose(); } };

  function tooltipFmt(unitFmt) {
    return {
      trigger: "axis",
      backgroundColor: "rgba(28,35,51,.92)", borderWidth: 0, textStyle: { color: "#fff", fontSize: 11, fontFamily: FONT },
      valueFormatter: unitFmt || null,
    };
  }
  function valFmt(unit) {
    if (unit === "money") return (v) => NS.core.fmtMoney(v);
    if (unit === "pax") return (v) => NS.core.fmtNum(v);
    if (unit === "pct") return (v) => (v == null ? "" : (v * 100).toFixed(1) + "%");
    return null;
  }
  H.barH = function (c, items, opts) {
    opts = opts || {};
    const names = items.map((x) => x.name), vals = items.map((x) => x.value);
    const color = (p) => {
      if (opts.colorBy) {
        const rgb = opts.colorBy(names[p.dataIndex]);
        return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.9)`;
      }
      return (p.value >= 0 ? ACCENT : RED);
    };
    c.setOption({
      grid: { left: 8, right: 30, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipFmt(opts.unit ? valFmt(opts.unit) : null) },
      xAxis: { type: "value", ...AXIS, splitLine: { lineStyle: { color: TRACK } } },
      yAxis: { type: "category", data: names, ...AXIS, axisLabel: { color: INK, fontFamily: FONT, fontSize: 11, formatter: (v) => (v.length > 12 ? v.slice(0, 11) + "…" : v) } },
      series: [{ type: "bar", data: vals, barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0], color }, label: { show: opts.showLabel !== false && items.length <= 12, position: "right", color: MUT, fontSize: 10, fontFamily: FONT, formatter: (p) => (opts.unit === "money" ? NS.core.fmtMoney(p.value) : NS.core.fmtNum(p.value)) } }],
    });
  };
  H.barV = function (c, xs, series, opts) {
    opts = opts || {};
    const data = series.map((s, i) => ({
      name: s.name, type: "bar", data: s.data, barMaxWidth: 26,
      itemStyle: { color: s.color || PALETTE[i % PALETTE.length], borderRadius: opts.stack ? [0, 0, 0, 0] : [3, 3, 0, 0] },
      stack: opts.stack ? "s" : undefined,
      emphasis: { focus: "series" },
    }));
    c.setOption({
      color: PALETTE,
      grid: { left: 8, right: 12, top: opts.stack ? 10 : 34, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...tooltipFmt(opts.unit ? valFmt(opts.unit) : null) },
      legend: opts.stack ? { top: 0, textStyle: { color: MUT, fontSize: 10.5 }, type: "scroll" } : undefined,
      xAxis: { type: "category", data: xs, ...AXIS, axisLabel: { color: INK, fontSize: 10.5, fontFamily: FONT, rotate: xs.length > 10 ? 34 : 0 } },
      yAxis: { type: "value", ...AXIS, splitLine: { lineStyle: { color: TRACK } } },
      series: data,
    });
  };
  H.lineTrend = function (c, xs, series, opts) {
    opts = opts || {};
    const data = series.map((s, i) => ({
      name: s.name, type: "line", data: s.data, smooth: 0.28, symbolSize: 4,
      lineStyle: { width: 2, color: s.color || PALETTE[i % PALETTE.length] },
      itemStyle: { color: s.color || PALETTE[i % PALETTE.length] },
      areaStyle: opts.area && i === 0 ? { opacity: 0.1 } : undefined,
    }));
    c.setOption({
      color: PALETTE,
      grid: { left: 8, right: 16, top: opts.legend === false ? 10 : 34, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", ...tooltipFmt(opts.unit ? valFmt(opts.unit) : null) },
      legend: opts.legend === false ? undefined : { top: 0, textStyle: { color: MUT, fontSize: 10.5 }, type: "scroll" },
      xAxis: { type: "category", data: xs, boundaryGap: false, ...AXIS, axisLabel: { color: INK, fontSize: 10.5, fontFamily: FONT, rotate: xs.length > 10 ? 34 : 0 } },
      yAxis: { type: "value", ...AXIS, splitLine: { lineStyle: { color: TRACK } }, axisLabel: { color: MUT, fontSize: 10.5, formatter: (v) => NS.core.fmtMoney(v) } },
      series: data,
    });
  };
  H.donut = function (c, items, opts) {
    opts = opts || {};
    const data = items.map((x) => ({ name: x.name, value: x.value }));
    c.setOption({
      color: opts.colors || PALETTE,
      tooltip: { trigger: "item", ...tooltipFmt(opts.unit ? valFmt(opts.unit) : null) },
      legend: { orient: "vertical", right: 4, top: "middle", textStyle: { color: MUT, fontSize: 10.5, fontFamily: FONT }, type: "scroll", icon: "circle" },
      series: [{
        type: "pie", radius: ["46%", "72%"], center: ["36%", "50%"],
        itemStyle: { borderRadius: 5, borderColor: SURFACE, borderWidth: 2 },
        label: { show: false },
        data,
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 600, formatter: "{b}\n{d}%" } },
      }],
    });
  };
  H.radar = function (c, indicators, values, opts) {
    opts = opts || {};
    c.setOption({
      radar: {
        indicator: indicators,
        radius: opts.radius || "66%",
        center: ["50%", "54%"],
        splitNumber: 4,
        axisName: { color: INK, fontSize: 11.5, fontFamily: FONT },
        axisLine: { lineStyle: { color: TRACK } },
        splitLine: { lineStyle: { color: TRACK } },
        splitArea: { areaStyle: { color: [SURFACE, SOFT] } },
      },
      tooltip: { backgroundColor: "rgba(28,35,51,.92)", borderWidth: 0, textStyle: { color: "#fff", fontSize: 11, fontFamily: FONT } },
      series: [{
        type: "radar",
        symbolSize: 5,
        data: [{
          value: values,
          name: opts.name || "综合评分",
          lineStyle: { color: opts.color || ACCENT, width: 2.2 },
          itemStyle: { color: opts.color || ACCENT },
          areaStyle: { color: ACCENT, opacity: 0.12 },
        }],
      }],
    });
  };
  H.snapshot = function (c) {
    return c.getDataURL({ pixelRatio: 2, backgroundColor: SURFACE });
  };
  NS.charts = H;
})(window.NFB);
