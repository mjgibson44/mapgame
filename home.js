/* MapGame — home page: pick a mode, with your progress in each */
(function () {
  "use strict";

  // Same keys the modes save under (app.js STORAGE_KEY, streak.js BEST_KEY, draw.js RUN_KEY).
  let found = 0, best = 0, drawStat = "";
  try {
    const saved = JSON.parse(localStorage.getItem("mapgame-alphabet-v2") || "null");
    found = (saved && saved.found && saved.found.length) || 0;
    best = Number(localStorage.getItem("mapgame-streak-best")) || 0;
    const run = JSON.parse(localStorage.getItem("mapgame-draw-run") || "null");
    if (run && run.results.length < run.order.length) {
      drawStat = `${REGIONS.find((r) => r.id === run.cont).name}: ${run.results.length} of ${run.order.length} drawn`;
    }
  } catch (e) { /* storage unavailable — show no stats */ }

  if (found) document.getElementById("alphabetStat").textContent = `${found} of ${COUNTRIES.length} found`;
  if (best) document.getElementById("streakStat").textContent = `Your best: ${best}`;
  if (drawStat) document.getElementById("drawStat").textContent = drawStat;
})();
