/* NIMBY Finance · appearance preference, independent of imported data */
"use strict";
window.NFB = window.NFB || {};
(function (NS) {
  const KEY = "nimby-finance-theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const modes = ["system", "light", "dark"];
  const labels = { system: "跟随系统", light: "浅色模式", dark: "深色模式" };
  const symbols = { system: "◐", light: "☀", dark: "☾" };
  let mode = "system";
  try {
    const saved = localStorage.getItem(KEY);
    if (modes.includes(saved)) mode = saved;
  } catch (_) { /* private browsing may block storage */ }

  function apply() {
    const appearance = mode === "system" ? (media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.theme = appearance;
    const button = document.getElementById("btn-theme");
    if (button) {
      button.textContent = symbols[mode];
      button.title = `外观：${labels[mode]}。点击切换`;
      button.setAttribute("aria-label", button.title);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = appearance === "dark" ? "#26272b" : "#ffffff";
    return appearance;
  }
  function set(next) {
    if (!modes.includes(next)) return;
    mode = next;
    try { localStorage.setItem(KEY, mode); } catch (_) { /* theme still works this session */ }
    apply();
    document.dispatchEvent(new CustomEvent("nfb-theme-change"));
  }
  media.addEventListener?.("change", () => {
    if (mode === "system") {
      apply();
      document.dispatchEvent(new CustomEvent("nfb-theme-change"));
    }
  });
  NS.theme = { apply, set, cycle: () => set(modes[(modes.indexOf(mode) + 1) % modes.length]), mode: () => mode };
  apply();
})(window.NFB);
