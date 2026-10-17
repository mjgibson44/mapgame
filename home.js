/* MapGame — home page: pick a mode, with your progress in each */
(function () {
  "use strict";

  // Same keys the modes save under (app.js STORAGE_KEY, streak.js BEST_KEY).
  let found = 0, best = 0;
  try {
    const saved = JSON.parse(localStorage.getItem("mapgame-alphabet-v2") || "null");
    found = (saved && saved.found && saved.found.length) || 0;
    best = Number(localStorage.getItem("mapgame-streak-best")) || 0;
  } catch (e) { /* storage unavailable — show no stats */ }

  if (found) document.getElementById("alphabetStat").textContent = `${found} of ${COUNTRIES.length} found`;
  if (best) document.getElementById("streakStat").textContent = `Your best: ${best}`;
})();
