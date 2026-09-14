/* NIMBY Finance · advisor: automatic operating analysis, scoring & suggestions */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const A = {};
  const core = NS.core, engine = NS.engine;

  /* ---------- small stats helpers ---------- */
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function quant(arr, q) {
    const a = arr.filter((x) => x != null && isFinite(x)).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  /* linear map: x <= lo -> 0 ; x >= hi -> 100 (hi may be lower than lo for "smaller is better") */
  function norm(x, lo, hi) {
    if (x == null || !isFinite(x)) return null;
    const t = (x - lo) / (hi - lo);
    return cl(t * 100, 0, 100);
  }
  const sum = (arr, f) => arr.reduce((s, x) => { const v = f(x); return v == null ? s : s + v; }, 0);
  const fmtMoney = (v) => (v == null ? "—" : core.fmtMoney(v));
  const fmtPax = (v) => (v == null ? "—" : core.fmtNum(v));
  const fmtPct1 = (v) => (v == null ? "—" : (v * 100).toFixed(1) + "%");

  /* ---------- scoring ---------- */
  const DIMS = [
    { id: "profit", label: "盈利能力", weight: 0.4, desc: "运营利润率：(票款净额 − 运营成本) ÷ 票款净额，−25%~+25% 映射为 0~100 分" },
    { id: "cost", label: "成本效率", weight: 0.2, desc: "收入成本比：票款净额 ÷ 运营成本，0.7~1.8 映射为 0~100 分" },
    { id: "reliability", label: "服务可靠", weight: 0.2, desc: "以等待超时、流失、退票、晚点、拒付等占比扣分（占比越高扣得越多）" },
    { id: "growth", label: "需求增长", weight: 0.1, desc: "客流量相对上一账期的变化率，−15%~+15% 映射为 0~100 分（无上期则不参与计分）" },
    { id: "structure", label: "成本结构", weight: 0.1, desc: "(维护+干预) ÷ 票款净额，占比 10%~60% 反向映射为 100~0 分" },
  ];
  function grade(total) {
    if (total == null) return { label: "数据不足", cls: "na" };
    if (total >= 80) return { label: "优秀", cls: "a" };
    if (total >= 65) return { label: "良好", cls: "b" };
    if (total >= 50) return { label: "一般", cls: "c" };
    if (total >= 35) return { label: "偏弱", cls: "d" };
    return { label: "困难", cls: "e" };
  }

  function computeScores(net, co, prevBoard) {
    const s = {};
    const margin = net.revenue ? net.opProfit / net.revenue : null;
    s.profit = margin == null ? null : norm(margin, -0.3, 0.35);
    const ratio = net.opex ? net.revenue / net.opex : null;
    s.cost = ratio == null ? null : norm(ratio, 0.7, 1.8);
    // reliability: penalties
    let rel = 100, relAny = false;
    const pen = (v, max, k) => { if (v == null) return; relAny = true; rel -= Math.min(max, v * k); };
    if (net.paxSpawn) {
      pen(net.wait / net.paxSpawn, 30, 600);
      pen(net.lost / net.paxSpawn, 20, 2500);
    }
    if (net.paxBoard) {
      pen(net.refunded / net.paxBoard, 10, 500);
      pen(net.refuse / net.paxBoard, 15, 1200);
    }
    if (net.late != null && net.departures) pen((net.late / net.departures) / 60, 25, 1.5); // 平均每趟晚点分钟数
    if (net.departures && net.collisions) pen(net.collisions / net.departures, 15, 20000);
    s.reliability = relAny ? cl(rel, 0, 100) : null;
    const growth = prevBoard && prevBoard > 0 && net.paxBoard != null ? (net.paxBoard - prevBoard) / prevBoard : null;
    s.growthRate = growth;
    s.growth = growth == null ? null : norm(growth, -0.15, 0.15);
    const struct = net.revenue ? ((net.maintenance || 0) + (net.intervention || 0)) / net.revenue : null;
    s.structure = struct == null ? null : norm(struct, 0.6, 0.1);
    let wsum = 0, acc = 0;
    DIMS.forEach((d) => { const v = s[d.id]; if (v != null) { acc += v * d.weight; wsum += d.weight; } });
    const total = wsum ? acc / wsum : null;
    return { parts: s, total, margin, ratio, struct, growth, growthRate: s.growthRate };
  }

  /* ---------- main analysis ---------- */
  A.analyze = function (imp, per, ts) {
    const eng = engine;
    if (!imp || !imp.finOk || !ts) {
      return { ok: false, reason: !imp ? "无档案" : !imp.finOk ? "该档案没有会计账目数据" : "当前账期无数据" };
    }
    eng.prepare(imp);
    const co = eng.companyAgg(imp, per, ts);
    const liMap = eng.aggBucket(imp, "li", per, ts);
    const stMap = eng.aggBucket(imp, "st", per, ts);
    const desc = eng.describeLines(imp);
    const stDesc = eng.describeStations(imp);
    if (!liMap.size && !co) return { ok: false, reason: "当前粒度/账期没有可分析的账目（可切换为日/累计）" };

    const M = (agg, id) => eng.metricOn(id, agg);
    const lines = [];
    for (const [name, agg] of liMap) {
      const d = desc.get(name) || {};
      lines.push({
        name, region: d.region || "", lenKm: d.lenKm, color: d.color,
        revenue: M(agg, "revenue"), fares: M(agg, "fares"), opex: M(agg, "opex"),
        profit: M(agg, "opProfit"), margin: M(agg, "marginRatio"),
        board: M(agg, "paxBoard"), dep: M(agg, "departures"), distKm: M(agg, "distKm"),
        fareAvg: M(agg, "fareAvg"), costPerKm: M(agg, "costPerKm"), revenuePerKm: M(agg, "revenuePerKm"),
        boardPerDep: M(agg, "boardPerDep"), loadFull: M(agg, "loadFullRate"),
        transRate: M(agg, "transRate"), destRate: M(agg, "destRate"),
        wait: M(agg, "wait"), lost: M(agg, "lost"), tooFull: M(agg, "tooFull"),
      });
    }
    /* network totals: prefer company row, else sum of lines */
    const netFromLines = (f) => sum(lines, f);
    const net = {
      revenue: co ? M(co, "revenue") : netFromLines((l) => l.revenue),
      fares: co ? M(co, "fares") : netFromLines((l) => l.fares),
      opex: co ? M(co, "opex") : netFromLines((l) => l.opex),
      opProfit: co ? M(co, "opProfit") : netFromLines((l) => l.profit),
      refunds: co ? M(co, "refunds") : null,
      compensations: co ? M(co, "compensations") : null,
      paxBoard: co ? M(co, "paxBoard") : netFromLines((l) => l.board),
      paxSpawn: co ? M(co, "paxSpawn") : null,
      departures: co ? M(co, "departures") : netFromLines((l) => l.dep),
      distKm: co ? M(co, "distKm") : netFromLines((l) => l.distKm),
      runTime: co ? M(co, "runTime") : null,
      late: co ? M(co, "late") : null,
      maintenance: co ? M(co, "maintenance") : null,
      intervention: co ? M(co, "intervention") : null,
      wait: co ? M(co, "wait") : netFromLines((l) => l.wait),
      lost: co ? M(co, "lost") : netFromLines((l) => l.lost),
      tooFull: co ? M(co, "tooFull") : null,
      refuse: co ? M(co, "refuse") : null,
      refunded: co ? M(co, "refunded") : null,
      collisions: co ? M(co, "collisions") : null,
      cash: co ? M(co, "cash") : null,
      cTotal: co ? M(co, "cTotal") : null,
      buy: co ? M(co, "buy") : null,
      interest: co ? M(co, "interest") : null,
    };
    /* previous bucket for growth */
    const buckets = eng.buckets(imp, per, "co").length ? eng.buckets(imp, per, "co") : eng.buckets(imp, per, "li");
    const i = buckets.indexOf(ts);
    const prevTs = i > 0 ? buckets[i - 1] : null;
    const coPrev = prevTs ? eng.companyAgg(imp, per, prevTs) : null;
    const prevBoard = coPrev ? M(coPrev, "paxBoard") : null;
    const prevProfit = coPrev ? M(coPrev, "opProfit") : null;

    const scores = computeScores(net, co, prevBoard);

    /* ---------- line-level benchmark ---------- */
    const boards = lines.map((l) => l.board).filter((v) => v != null);
    const profits = lines.map((l) => l.profit).filter((v) => v != null);
    const medBoard = quant(boards, 0.5), p25Board = quant(boards, 0.25);
    const medProfit = quant(profits, 0.5);
    const fareAvgs = lines.map((l) => l.fareAvg).filter((v) => v != null);
    const medFare = quant(fareAvgs, 0.5);
    const cpk = lines.map((l) => l.costPerKm).filter((v) => v != null);
    const p75Cpk = quant(cpk, 0.75), medCpk = quant(cpk, 0.5);
    const bpds = lines.map((l) => l.boardPerDep).filter((v) => v != null);
    const p25Bpd = quant(bpds, 0.25), medBpd = quant(bpds, 0.5);
    const deps = lines.map((l) => l.dep).filter((v) => v != null);
    const medDep = quant(deps, 0.5), p75Dep = quant(deps, 0.75);
    const trans = lines.map((l) => l.transRate).filter((v) => v != null);
    const medTrans = quant(trans, 0.5);
    const nLineTotal = lines.length;
    const losing = lines.filter((l) => l.profit != null && l.profit < 0).sort((a, b) => a.profit - b.profit);
    const winning = lines.filter((l) => l.profit != null && l.profit > 0).sort((a, b) => b.profit - a.profit);
    const totalProfit = netFromLines((l) => l.profit);

    const insights = [];
    const add = (o) => { insights.push(Object.assign({ level: "info", category: "运营", impact: 0, evidence: [] }, o)); };

    /* ---------- summary bullets ---------- */
    const summary = [];
    if (net.revenue != null && net.opProfit != null) {
      const margin = net.revenue ? net.opProfit / net.revenue : null;
      summary.push(`本期全网络票款净额 ${fmtMoney(net.revenue)}、运营成本 ${fmtMoney(net.opex)}、运营利润 <b class="${core.moneyClass(net.opProfit)}">${fmtMoney(net.opProfit)}</b>${margin != null ? `（利润率 ${fmtPct1(margin)}）` : ""}。`);
    }
    if (winning.length && losing.length) {
      summary.push(`线路层面：<b>${winning.length}</b> 条盈利 / <b>${losing.length}</b> 条亏损；最盈利「${core.esc(winning[0].name)}」${fmtMoney(winning[0].profit)}，最亏损「${core.esc(losing[0].name)}」${fmtMoney(losing[0].profit)}。`);
    } else if (winning.length || losing.length) {
      summary.push(`线路层面：盈利 ${winning.length} 条、亏损 ${losing.length} 条。`);
    }
    if (scores.growth != null) {
      const g = scores.growthRate;
      summary.push(`环比上一账期（${core.fmtBucket(per, prevTs)}）：客流 ${g >= 0 ? "增长" : "下降"} <b class="${g >= 0 ? "pos" : "neg"}">${fmtPct1(Math.abs(g))}</b>${prevProfit != null && net.opProfit != null ? `，利润由 ${fmtMoney(prevProfit)} 变为 <b class="${core.moneyClass(net.opProfit)}">${fmtMoney(net.opProfit)}</b>` : ""}。`);
    }
    if (stMap.size) {
      const stArr = [];
      for (const [id, agg] of stMap) stArr.push({ id, board: M(agg, "paxBoard") || 0, name: (stDesc.get(id) || {}).name || String(id) });
      stArr.sort((a, b) => b.board - a.board);
      const totalBoard = sum(stArr, (s) => s.board);
      const top10 = stArr.slice(0, Math.max(1, Math.ceil(stArr.length * 0.1)));
      const share = totalBoard ? sum(top10, (s) => s.board) / totalBoard : null;
      if (share != null) summary.push(`站点层面：共 ${stArr.length} 个站点有账，客流前 10% 的站点承担了 <b>${fmtPct1(share)}</b> 的登乘客流。`);
    }

    /* ---------- insights: losses ---------- */
    if (losing.length) {
      add({
        id: "loss-sum", level: "danger", category: "盈利",
        title: `${losing.length} 条线路运营亏损，合计 ${fmtMoney(sum(losing, (l) => l.profit))}`,
        summary: `亏损合计占全网票款净额的 ${net.revenue ? fmtPct1(Math.abs(sum(losing, (l) => l.profit)) / Math.abs(net.revenue)) : "—"}，是拉低整体盈利的主要来源。`,
        evidence: [
          { label: "亏损线路", value: `${losing.length}/${nLineTotal} 条` },
          { label: "合计亏损", value: fmtMoney(sum(losing, (l) => l.profit)) },
          { label: "最大亏损", value: `${losing[0].name} ${fmtMoney(losing[0].profit)}` },
        ],
        suggestion: "优先处理亏损额最大的 2~3 条：压缩低峰班次、优化换乘衔接，并复核其单位成本；必要时调整票价或向公司申请专项补贴。",
        impact: Math.abs(sum(losing, (l) => l.profit)),
      });
      losing.slice(0, 4).forEach((l) => {
        const causes = [];
        if (l.board != null && p25Board != null && l.board < p25Board) causes.push("客流处于全网低位");
        if (l.costPerKm != null && p75Cpk != null && l.costPerKm > p75Cpk) causes.push("单位里程成本偏高");
        if (l.fareAvg != null && medFare != null && l.fareAvg < medFare * 0.7) causes.push("平均票价偏低（短途化）");
        if (l.boardPerDep != null && p25Bpd != null && l.dep != null && p75Dep != null && l.boardPerDep < p25Bpd && l.dep > p75Dep) causes.push("班次偏密但上座不足");
        if (!causes.length) causes.push("收入与成本结构均无突出异常，可能受里程/票价结构影响");
        const tips = [];
        if (causes.some((c) => c.includes("客流"))) tips.push("针对客源做接驳与班次时机优化（高峰加密、平峰减班）");
        if (causes.some((c) => c.includes("成本"))) tips.push("核查能耗/维护支出与车辆调配，降低每公里成本");
        if (causes.some((c) => c.includes("票价"))) tips.push("评估票价或长短途票制，引导长距离客流");
        if (!tips.length) tips.push("复核线路定位与投资回收计划");
        add({
          id: "loss-" + l.name, level: "warn", category: "盈利",
          title: `亏损线路：${l.name}（${fmtMoney(l.profit)}）`,
          summary: `原因判断：${causes.join("；")}。`,
          evidence: [
            { label: "利润率", value: fmtPct1(l.margin) },
            { label: "客流", value: fmtPax(l.board) },
            { label: "每公里成本", value: fmtMoney(l.costPerKm) },
            { label: "平均票价", value: fmtMoney(l.fareAvg) },
          ],
          suggestion: "建议：" + tips.join("；") + "。",
          link: { type: "line", name: l.name },
          impact: Math.abs(l.profit),
        });
      });
    }

    /* ---------- insights: capacity / load ---------- */
    const emptyRuns = lines.filter((l) => l.boardPerDep != null && p25Bpd != null && l.boardPerDep < p25Bpd && l.dep != null && medDep != null && l.dep >= medDep)
      .sort((a, b) => (a.boardPerDep - b.boardPerDep));
    if (emptyRuns.length) {
      const worst = emptyRuns.slice(0, 3);
      add({
        id: "empty", level: "warn", category: "运力",
        title: `运力投放偏松：${worst.map((l) => l.name).join("、")}`,
        summary: `这些线路每趟登乘人数低于全网 25% 分位（${fmtPax(p25Bpd)} 人/趟），但发车趟次不低于中位水平，存在空跑浪费。`,
        evidence: worst.map((l) => ({ label: l.name, value: `${fmtPax(l.boardPerDep)} 人/趟` })).concat([{ label: "全网中位", value: `${fmtPax(medBpd)} 人/趟` }]),
        suggestion: "建议压缩平峰班次或改用小编组，把节省的运力投放到满载率高的线路。",
        link: { type: "line", name: worst[0].name },
        impact: worst.length,
      });
    }
    const p90Load = quant(lines.map((x) => x.loadFull), 0.9);
    const tight = lines.filter((l) => {
      const pressure = l.wait != null && l.board != null && l.board > 0 ? l.wait / l.board : null;
      return (pressure != null && pressure > 0.03) || (l.loadFull != null && p90Load != null && l.loadFull > p90Load);
    }).sort((a, b) => (b.wait || 0) - (a.wait || 0));
    if (tight.length) {
      const t = tight.slice(0, 3);
      add({
        id: "tight", level: "warn", category: "运力",
        title: `运力偏紧：${t.map((l) => l.name).join("、")}`,
        summary: "等待超时或满员发车比例高于全网水平，说明需求未被完全满足。",
        evidence: t.map((l) => ({ label: l.name, value: `等待超时 ${fmtPax(l.wait)}` })),
        suggestion: "建议在高峰时段加密班次、扩编或改造站台；优先保障换乘枢纽方向。",
        link: { type: "line", name: t[0].name },
        impact: t.length,
      });
    }

    /* ---------- insights: good performers ---------- */
    if (winning.length) {
      const best = winning.slice(0, 3);
      add({
        id: "best", level: "good", category: "盈利",
        title: `盈利标杆：${best.map((l) => l.name).join("、")}`,
        summary: `合计贡献运营利润 ${fmtMoney(sum(best, (l) => l.profit))}${totalProfit ? `，占全网线路利润的 ${fmtPct1(sum(best, (l) => l.profit) / totalProfit)}` : ""}。`,
        evidence: best.map((l) => ({ label: l.name, value: `${fmtMoney(l.profit)} / 利润率 ${fmtPct1(l.margin)}` })),
        suggestion: "可将这些线路的班次结构、停站方案与成本控制作为全网模板；新增运力优先向同类走廊投放。",
        link: { type: "line", name: best[0].name },
        impact: best.length + 1,
      });
    }
    const hubs = lines.filter((l) => l.transRate != null && medTrans != null && l.transRate > medTrans * 1.4 && l.board != null && medBoard != null && l.board > medBoard)
      .sort((a, b) => b.transRate - a.transRate).slice(0, 3);
    if (hubs.length) {
      add({
        id: "hubs", level: "good", category: "客流",
        title: `换乘枢纽线路：${hubs.map((l) => l.name).join("、")}`,
        summary: "换乘率与客流均明显高于全网中位，承担网络接驳中枢作用。",
        evidence: hubs.map((l) => ({ label: l.name, value: `换乘率 ${fmtPct1(l.transRate)}` })),
        suggestion: "建议优先保障其准点与运力，并围绕枢纽站点做商业与导向优化。",
        link: { type: "line", name: hubs[0].name },
        impact: hubs.length,
      });
    }

    /* ---------- insights: service quality ---------- */
    const refundRate = net.fares ? (Math.abs(net.refunds || 0) + Math.abs(net.compensations || 0)) / Math.abs(net.fares) : null;
    if (refundRate != null && refundRate > 0.02) {
      add({
        id: "refund", level: "warn", category: "服务",
        title: `退票与赔偿占比 ${fmtPct1(refundRate)}，高于 2% 的健康线`,
        summary: `本期退票 ${fmtMoney(net.refunds)}、赔偿 ${fmtMoney(net.compensations)}，直接侵蚀票款收入。`,
        evidence: [
          { label: "退票", value: fmtMoney(net.refunds) },
          { label: "赔偿", value: fmtMoney(net.compensations) },
          { label: "占票款", value: fmtPct1(refundRate) },
        ],
        suggestion: "建议排查晚点与拥挤导致的退款/补偿高峰时段，优先改善准点率与热门区间运力。",
        impact: refundRate * 100,
      });
    }
    if (net.late != null && net.departures) {
      const latePerDep = net.late / net.departures; // seconds per departure
      const lateMin = latePerDep / 60;
      add({
        id: "late", level: lateMin > 8 ? "warn" : "info", category: "服务",
        title: `平均每趟晚点约 ${lateMin.toFixed(1)} 分钟`,
        summary: `本期总晚点 ${core.fmtDur(net.late)}，分摊到 ${fmtPax(net.departures)} 趟发车。延误不仅影响体验，也会推高退票与赔偿。`,
        evidence: [
          { label: "平均每趟晚点", value: lateMin.toFixed(1) + " 分钟" },
          { label: "总晚点", value: core.fmtDur(net.late) },
          { label: "发车趟次", value: fmtPax(net.departures) },
        ],
        suggestion: lateMin > 8 ? "建议梳理瓶颈区间与信号/会让冲突，压缩折返与停站时间，优先改善晚点最严重的线路。" : "整体准点情况可控，保持监测即可。",
        impact: lateMin,
      });
    }

    /* ---------- insights: stations ---------- */
    if (stMap.size > 3) {
      const stArr = [];
      for (const [id, agg] of stMap) {
        const d = stDesc.get(id) || {};
        stArr.push({ id, name: d.name || String(id), region: d.region || "", board: M(agg, "paxBoard"), dest: M(agg, "dest"), fares: M(agg, "fares"), dep: M(agg, "departures"), lines: d.lines || [] });
      }
      const withBoard = stArr.filter((s) => s.board != null);
      const totalBoard = sum(withBoard, (s) => s.board);
      const top10 = withBoard.slice().sort((a, b) => b.board - a.board).slice(0, Math.max(1, Math.ceil(withBoard.length * 0.1)));
      const share = totalBoard ? sum(top10, (s) => s.board) / totalBoard : null;
      if (share != null && share > 0.45) {
        add({
          id: "station-pareto", level: "info", category: "结构",
          title: `客流集中度较高：前 10% 站点承担 ${fmtPct1(share)} 客流`,
          summary: `Top 站点依次为 ${top10.slice(0, 5).map((s) => core.esc(s.name)).join("、")}。`,
          evidence: top10.slice(0, 5).map((s) => ({ label: s.name, value: fmtPax(s.board) })),
          suggestion: "建议把运力与商业资源向核心站点倾斜，同时评估长尾站点的投入产出。",
          link: { type: "station", id: top10[0].id },
          impact: share * 100,
        });
      }
      const p10 = quant(withBoard.map((s) => s.board), 0.1);
      if (p10 != null) {
        const quiet = withBoard.filter((s) => s.board <= p10 && (s.dep == null || s.dep > 0)).sort((a, b) => a.board - b.board);
        if (quiet.length) {
          add({
            id: "station-quiet", level: "info", category: "站点",
            title: `低流量站点 ${quiet.length} 个（最低：${quiet.slice(0, 3).map((s) => s.name).join("、")}）`,
            summary: "这些站点客流处于全网后 10%，但仍占用停车时间与站务成本。",
            evidence: quiet.slice(0, 4).map((s) => ({ label: s.name, value: fmtPax(s.board) })),
            suggestion: "建议评估跨站停车/低峰跳停、减少停站时间，或与地方协商接驳；极低效站点可考虑整合。",
            link: { type: "station", id: quiet[0].id },
            impact: quiet.length * 0.5,
          });
        }
      }
    }

    /* ---------- insights: trend ---------- */
    if (prevTs && coPrev) {
      const deltas = lines.map((l) => {
        const prev = eng.lineAggAt(imp, per, prevTs, l.name);
        const pv = prev ? M(prev, "opProfit") : null;
        return { name: l.name, now: l.profit, prev: pv, d: pv != null && l.profit != null ? l.profit - pv : null };
      }).filter((x) => x.d != null);
      const down = deltas.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
      const up = deltas.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3);
      if (down.length) {
        add({
          id: "trend-down", level: "warn", category: "趋势",
          title: `利润环比下滑最多：${down.map((x) => x.name).join("、")}`,
          summary: `对比上一账期（${core.fmtBucket(per, prevTs)}），这些线路利润跌幅最大。`,
          evidence: down.map((x) => ({ label: x.name, value: `${fmtMoney(x.d)}` })),
          suggestion: "建议核查是否因新线分流、施工限速或班次调整导致，及时在新账期内做运力回流。",
          link: { type: "line", name: down[0].name },
          impact: Math.abs(down[0].d),
        });
      }
      if (up.length) {
        add({
          id: "trend-up", level: "good", category: "趋势",
          title: `利润环比提升：${up.map((x) => x.name).join("、")}`,
          summary: "环比改善明显，可作为近期调整有效的证据。",
          evidence: up.map((x) => ({ label: x.name, value: `+${fmtMoney(x.d)}` })),
          suggestion: "建议复盘这些线路本期的具体改动，并复制到同类线路。",
          link: { type: "line", name: up[0].name },
          impact: up[0].d,
        });
      }
    }

    /* ---------- insights: company / assets ---------- */
    if (co) {
      if (net.cash != null && net.cash < 0) {
        add({
          id: "cash", level: net.opProfit != null && net.opProfit > 0 ? "info" : "warn", category: "资产",
          title: `本期公司现金流为 ${fmtMoney(net.cash)}`,
          summary: "公司级现金流包含建设、购车与融资，负值通常代表处于扩张投入期。",
          evidence: [
            { label: "建设支出", value: fmtMoney(net.cTotal) },
            { label: "购车支出", value: fmtMoney(net.buy) },
            { label: "融资利息", value: fmtMoney(net.interest) },
          ],
          suggestion: "建议结合运营利润判断：若运营已盈利，则控制资本开支节奏与融资成本；若运营亦亏，应先修复运营面。",
          impact: 1.5,
        });
      }
      if (per === "lifetime" || per === "yearly") {
        add({
          id: "longrun", level: net.opProfit != null && net.opProfit < 0 ? "warn" : "good", category: "资产",
          title: net.opProfit != null && net.opProfit < 0 ? `长期累计运营仍亏损 ${fmtMoney(net.opProfit)}` : `长期累计运营盈利 ${fmtMoney(net.opProfit)}`,
          summary: "累计口径反映自开线以来的整体经营结果，不含折旧但包含全部运营收支。",
          evidence: [
            { label: "累计票款净额", value: fmtMoney(net.revenue) },
            { label: "累计运营成本", value: fmtMoney(net.opex) },
          ],
          suggestion: net.opProfit != null && net.opProfit < 0 ? "建议制定分线路扭亏计划：先止血（减班次/控成本），再培育客流（接驳/票价结构）。" : "整体经营健康，建议把利润继续投入瓶颈区段的扩能与准点改善。",
          impact: 2,
        });
      }
    }

    /* order: severity then impact */
    const sev = { danger: 0, warn: 1, good: 2, info: 3 };
    insights.sort((a, b) => (sev[a.level] - sev[b.level]) || (b.impact - a.impact));

    const report = {
      ok: true,
      per, ts,
      scopeLabel: core.fmtBucket(per, ts),
      prevTs,
      scores,
      grade: grade(scores.total),
      summary,
      insights,
      net,
      lineStats: { total: nLineTotal, winning: winning.length, losing: losing.length, medBoard, medProfit, medFare, medCpk, medBpd, medTrans },
      generatedAt: new Date(),
      days: (eng.derivedInfo && eng.derivedInfo(imp, "st", per, ts)) || null,
    };
    report.markdown = () => A.toMarkdown(imp, report);
    return report;
  };

  /* ---------- markdown report ---------- */
  A.toMarkdown = function (imp, r) {
    if (!r.ok) return "# 运营分析\n\n无可用数据：" + r.reason + "\n";
    const lines = [];
    lines.push(`# NIMBY 运营分析报告`);
    lines.push("");
    lines.push(`- 公司：${imp.companyName || "—"}`);
    lines.push(`- 分析账期：${r.scopeLabel}（${core.periodLabel(r.per)}粒度）`);
    lines.push(`- 生成时间：${r.generatedAt.toLocaleString("zh-CN")}`);
    lines.push(`- 综合评分：**${r.scores.total == null ? "—" : r.scores.total.toFixed(0)} / 100（${r.grade.label}）**`);
    lines.push("");
    lines.push(`| 维度 | 得分 | 说明 |`);
    lines.push(`| --- | --- | --- |`);
    DIMS.forEach((d) => { const v = r.scores.parts[d.id]; lines.push(`| ${d.label} | ${v == null ? "—" : v.toFixed(0)} | ${d.desc} |`); });
    lines.push("");
    lines.push(`## 核心结论`);
    r.summary.forEach((s) => lines.push(`- ${s.replace(/<[^>]+>/g, "")}`));
    lines.push("");
    const LV = { danger: "🔴 需关注", warn: "🟠 建议关注", good: "🟢 表现良好", info: "🔵 提示" };
    ["danger", "warn", "good", "info"].forEach((lv) => {
      const arr = r.insights.filter((x) => x.level === lv);
      if (!arr.length) return;
      lines.push(`## ${LV[lv]}`);
      arr.forEach((x) => {
        lines.push(`### ${x.title}`);
        lines.push(`- 分类：${x.category}`);
        lines.push(`- 说明：${x.summary}`);
        if (x.evidence && x.evidence.length) lines.push(`- 数据：${x.evidence.map((e) => `${e.label} ${e.value}`).join("；")}`);
        lines.push(`- 建议：${x.suggestion}`);
        if (x.link) lines.push(`- 关联：${x.link.type === "line" ? "线路 " + x.link.name : "站点 " + x.link.id}`);
        lines.push("");
      });
    });
    lines.push("");
    lines.push(`---`);
    lines.push(`> 数据口径：票款净额=票款+退票+补偿；运营成本=运行+维护+干预；运营利润=票款净额−运营成本。`);
    if (r.days) lines.push(`> 站点数据在「${core.periodLabel(r.per)}」粒度下由日账汇总，覆盖 ${r.days.days} 天（${r.days.from} ~ ${r.days.to}）。`);
    return lines.join("\n");
  };

  /* ---------- in-page (HTML) report view ---------- */
  const LV_HTML = {
    danger: ["需要重点关注", "danger", "🔴"],
    warn: ["建议关注 / 可优化", "warn", "🟠"],
    good: ["表现良好", "good", "🟢"],
    info: ["提示与机会", "info", "🔵"],
  };
  A.reportHTML = function (imp, r) {
    if (!r.ok) return `<div class="rpt"><h1>运营分析报告</h1><p class="rpt-empty">无可用数据：${core.esc(r.reason)}</p></div>`;
    const total = r.scores.total;
    const pct = (v) => (v == null ? 0 : Math.max(3, v));
    const h = [];
    h.push('<div class="rpt">');
    h.push(`<div class="rpt-hd">
      <h1>NIMBY · 运营分析报告</h1>
      <div class="rpt-meta">
        <span>公司：<b>${core.esc(imp.companyName || "—")}</b></span>
        <span>账期：<b>${core.esc(r.scopeLabel)}</b>（${core.periodLabel(r.per)}粒度）</span>
        ${r.prevTs ? `<span>环比：${core.esc(core.fmtBucket(r.per, r.prevTs))}</span>` : ""}
        <span>生成：${r.generatedAt.toLocaleString("zh-CN")}</span>
      </div>
    </div>`);
    h.push(`<div class="rpt-score">
      <div class="rpt-score-num ${r.grade.cls}">${total == null ? "—" : total.toFixed(0)}<span>/100</span></div>
      <div class="rpt-score-right">
        <span class="adv-grade ${r.grade.cls}">${core.esc(r.grade.label)}</span>
        <div class="rpt-bars">${DIMS.map((d) => {
          const v = r.scores.parts[d.id];
          return `<div class="rpt-bar"><span class="l">${d.label}</span><span class="t"><i class="${v == null ? "na" : v >= 80 ? "a" : v >= 65 ? "b" : v >= 50 ? "c" : v >= 35 ? "d" : "e"}" style="width:${pct(v)}%"></i></span><span class="v">${v == null ? "—" : v.toFixed(0)}</span></div>`;
        }).join("")}</div>
      </div>
    </div>`);
    h.push(`<h2>一、核心结论</h2><ul class="rpt-ul">${r.summary.map((x) => `<li>${x}</li>`).join("")}</ul>`);
    h.push(`<h2>二、主要发现与建议</h2>`);
    ["danger", "warn", "good", "info"].forEach((lv) => {
      const arr = r.insights.filter((x) => x.level === lv);
      if (!arr.length) return;
      h.push(`<h3 class="rpt-h3 lv-${lv}">${LV_HTML[lv][2]} ${LV_HTML[lv][0]}<span class="n">${arr.length}</span></h3>`);
      arr.forEach((x) => {
        h.push(`<div class="rpt-card lv-${lv}">
          <div class="rpt-card-t"><b>${core.esc(x.title)}</b><span class="cat">${core.esc(x.category)}</span></div>
          <div class="rpt-card-s">${x.summary}</div>
          ${x.evidence && x.evidence.length ? `<div class="rpt-pills">${x.evidence.slice(0, 6).map((e) => `<span class="adv-pill"><b>${core.esc(e.label)}</b> ${core.esc(String(e.value))}</span>`).join("")}</div>` : ""}
          <div class="rpt-card-g">💡 ${core.esc(x.suggestion)}</div>
        </div>`);
      });
    });
    h.push(`<h2>三、评分口径与数据说明</h2>`);
    h.push(`<table class="rpt-table"><thead><tr><th>维度</th><th>权重</th><th>算法</th></tr></thead><tbody>
      ${DIMS.map((d) => `<tr><td>${d.label}</td><td>${Math.round(d.weight * 100)}%</td><td>${core.esc(d.desc)}</td></tr>`).join("")}
    </tbody></table>`);
    h.push(`<div class="rpt-note">
      <div>总分 = 各维度按权重加权平均；“需求增长”无上一账期时不参与计分并重新分配权重。</div>
      <div>分析范围：当前档案所选账期内的全部线路与站点（不受地图区域筛选影响）。</div>
      <div>数据口径：票款净额 = 票款 + 退票 + 补偿；运营成本 = 运行 + 维护 + 干预；运营利润 = 票款净额 − 运营成本；公司现金流含建设与购车等资本支出。</div>
      ${r.days ? `<div>站点账目在「${core.periodLabel(r.per)}」粒度下由日账自动汇总，覆盖 ${r.days.days} 天（${r.days.from} ~ ${r.days.to}）。</div>` : ""}
      <div>本报告由规则引擎自动生成，用于快速定位运营问题，具体决策请结合游戏内实际情况。</div>
    </div>`);
    h.push("</div>");
    return h.join("");
  };

  A.DIMS = DIMS;
  NS.advisor = A;
})(window.NFB);
