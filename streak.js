/* MapGame — Streak Mode */
(function () {
  "use strict";

  const BEST_KEY = "mapgame-streak-best";
  const START_MS = 60000;  // clock at the start of a run
  const RIGHT_MS = 5000;   // added for a right answer
  const WRONG_MS = 5000;   // taken off for a wrong answer
  const SKIP_MS = 5000;    // taken off for a skip

  const { lookup, sound } = MapGame;

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    score: $("streakScore"), clockBox: $("clockBox"), clock: $("clock"), delta: $("delta"),
    start: $("startPanel"), startBest: $("startBest"), startBtn: $("startBtn"),
    panel: $("gamePanel"), guess: $("guess"), mic: $("micBtn"), sug: $("suggestions"),
    feedback: $("feedback"), skip: $("skipBtn"),
    end: $("endscreen"), finalScore: $("finalScore"), finalBest: $("finalBest"),
    resultChips: $("resultChips"), playagain: $("playagain"),
    map: $("map"),
  };

  // ---------- State ----------

  let best = 0;
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) {}

  let run = null; // { deck, target, streak, remainingMs, correct: [], missed: [] }
  let running = false;  // clock ticking
  let busy = false;     // showing an answer between countries; input ignored
  let lastTick = 0;
  let nextTimer = null;

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Map & pin ----------

  const mapNodes = MapGame.buildMap(el.map); // code -> svg node
  const [, , WORLD_W, WORLD_H] = MAP_DATA.viewBox.split(" ").map(Number);
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Map paths are "M x y" followed by relative "l dx dy" segments, closed by
  // "Z" — one ring per island/landmass.
  function ringsOf(d) {
    const rings = [];
    let ring = null, x = 0, y = 0;
    const re = /([MlZ])([^MlZ]*)/g;
    let m;
    while ((m = re.exec(d))) {
      const nums = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
      if (m[1] === "M") {
        [x, y] = nums;
        ring = [[x, y]];
        rings.push(ring);
      } else if (m[1] === "l") {
        x += nums[0]; y += nums[1];
        ring.push([x, y]);
      }
    }
    return rings;
  }

  function ringArea(r) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return Math.abs(a / 2);
  }

  function inside(px, py, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  function edgeDist(px, py, r) {
    let best = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      best = Math.min(best, ex * ex + ey * ey);
    }
    return Math.sqrt(best);
  }

  // Where to drop the pin: the point deepest inside the country's largest
  // landmass (a centroid can land in the sea for crescent-shaped countries),
  // found by a coarse-to-fine grid search. Also returns that landmass's
  // bounding box, which sets how far to zoom in.
  const pinCache = new Map();
  function pinFor(code) {
    if (pinCache.has(code)) return pinCache.get(code);
    let pin;
    const dot = MAP_DATA.dots[code];
    if (dot) {
      pin = { x: dot[0], y: dot[1], w: 0, h: 0 };
    } else {
      const ring = ringsOf(MAP_DATA.shapes[code].d).reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      let spanX = maxX - minX, spanY = maxY - minY, bestD = -1;
      const N = 16;
      for (let pass = 0; pass < 4; pass++) {
        const x0 = cx - spanX / 2, y0 = cy - spanY / 2;
        let bx = cx, by = cy;
        for (let i = 0; i <= N; i++) {
          for (let j = 0; j <= N; j++) {
            const px = x0 + (spanX * i) / N, py = y0 + (spanY * j) / N;
            if (!inside(px, py, ring)) continue;
            const d = edgeDist(px, py, ring);
            if (d > bestD) { bestD = d; bx = px; by = py; }
          }
        }
        cx = bx; cy = by; spanX /= 4; spanY /= 4;
      }
      pin = { x: cx, y: cy, w: maxX - minX, h: maxY - minY };
    }
    pinCache.set(code, pin);
    return pin;
  }

  // Pin graphic: a teardrop whose tip sits on (0,0), plus a pulsing ring.
  const pinG = document.createElementNS(SVG_NS, "g");
  pinG.setAttribute("class", "pin");
  pinG.innerHTML =
    '<circle class="pin-pulse" r="5"></circle>' +
    '<path class="pin-head" d="M0 0C-1.6 -4.2 -7 -8.4 -7 -13.5A7 7 0 1 1 7 -13.5C7 -8.4 1.6 -4.2 0 0Z"></path>' +
    '<circle class="pin-hole" cy="-13.5" r="2.6"></circle>';
  pinG.style.display = "none";
  el.map.appendChild(pinG);

  let view = { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
  let viewAnim = null;
  let pinAt = null;

  function setView(v) {
    view = v;
    el.map.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    placePin();
  }

  // Keep the pin about 28px tall on screen whatever the zoom and map size.
  function placePin() {
    if (!pinAt) { pinG.style.display = "none"; return; }
    const px = el.map.clientWidth || 800;
    const k = (view.w / px) * (28 / 20);
    pinG.setAttribute("transform", `translate(${pinAt.x} ${pinAt.y}) scale(${k})`);
    pinG.style.display = "";
  }

  // Zoom so the country's main landmass fills about a third of the map —
  // close enough to place small countries, wide enough to show neighbours.
  function viewFor(pin) {
    const size = Math.max(pin.w, pin.h * (WORLD_W / WORLD_H));
    const w = Math.min(WORLD_W, Math.max(170, size * 3));
    const h = w * (WORLD_H / WORLD_W);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    // stay on the map, but never cut off a pin near the edge (Tuvalu sits at x≈1002)
    const x = clamp(pin.x - w / 2, Math.min(0, pin.x - w * 0.1), Math.max(WORLD_W, pin.x + w * 0.1) - w);
    const y = clamp(pin.y - h / 2, Math.min(0, pin.y - h * 0.1), Math.max(WORLD_H, pin.y + h * 0.1) - h);
    return { x, y, w, h };
  }

  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function zoomTo(target) {
    if (viewAnim) cancelAnimationFrame(viewAnim);
    if (reduceMotion) { setView(target); return; }
    const from = view, t0 = performance.now(), dur = 550;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
      setView({
        x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e,
      });
      viewAnim = t < 1 ? requestAnimationFrame(step) : null;
    };
    viewAnim = requestAnimationFrame(step);
  }

  window.addEventListener("resize", placePin);

  // Reveal colours on the map: "good" (got it), "bad" (skipped / timed out),
  // "wrong" (a wrong guess, flashed briefly so you learn where it is).
  const REVEALS = ["reveal-good", "reveal-bad", "reveal-wrong"];
  function clearReveals() {
    for (const node of mapNodes.values()) node.classList.remove("target", ...REVEALS);
  }
  function reveal(code, kind) {
    const node = mapNodes.get(code);
    if (node) node.classList.add(`reveal-${kind}`);
  }
  const wrongTimers = new Map();
  function flashWrong(code) {
    const node = mapNodes.get(code);
    if (!node) return;
    clearTimeout(wrongTimers.get(code));
    node.classList.add("reveal-wrong");
    wrongTimers.set(code, setTimeout(() => node.classList.remove("reveal-wrong"), 1100));
  }

  // ---------- Clock ----------

  function fmt(ms) {
    if (ms < 10000) return (Math.ceil(ms / 100) / 10).toFixed(1);
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderClock() {
    const ms = run ? run.remainingMs : START_MS;
    el.clock.textContent = fmt(ms);
    el.clockBox.classList.toggle("low", !!run && ms < 10000);
  }

  function renderScore() {
    el.score.innerHTML = `<b>${run ? run.streak : 0}</b><small>streak · best ${best}</small>`;
  }

  function tick(now) {
    if (!running) return;
    run.remainingMs -= now - lastTick;
    lastTick = now;
    if (run.remainingMs <= 0) { endRun(); return; }
    renderClock();
    requestAnimationFrame(tick);
  }

  function resume() {
    if (running || !run || el.panel.hidden || document.hidden) return;
    running = true;
    lastTick = performance.now();
    requestAnimationFrame(tick);
  }
  function pause() { running = false; }

  // Backgrounded tabs (and the iOS app going to the background) pause the clock.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (!busy) resume();
  });

  function adjustTime(ms) {
    run.remainingMs = Math.max(0, run.remainingMs + ms);
    renderClock();
    el.delta.textContent = `${ms > 0 ? "+" : "−"}${Math.abs(ms) / 1000}s`;
    el.delta.className = `delta show ${ms > 0 ? "up" : "down"}`;
    void el.delta.offsetWidth; // restart animation
    el.delta.classList.add("go");
    if (run.remainingMs <= 0) { endRun(); return false; }
    return true;
  }

  // ---------- Flow ----------

  function setFeedback(msg, kind) {
    el.feedback.textContent = msg;
    el.feedback.className = kind || "info";
  }

  function showPanel(which) {
    el.start.hidden = which !== "start";
    el.panel.hidden = which !== "game";
    el.end.hidden = which !== "end";
  }

  function startRun() {
    clearTimeout(nextTimer);
    run = { deck: shuffled(COUNTRIES), target: null, streak: 0, remainingMs: START_MS, correct: [], missed: [] };
    busy = false;
    showPanel("game");
    setFeedback("", "info");
    renderScore();
    renderClock();
    nextCountry();
    resume();
  }

  function nextCountry() {
    clearReveals();
    if (!run.deck.length) run.deck = shuffled(COUNTRIES); // went through all 197!
    run.target = run.deck.pop();
    const node = mapNodes.get(run.target.code);
    if (node) node.classList.add("target");
    pinAt = pinFor(run.target.code);
    zoomTo(viewFor(pinAt));
    busy = false;
    el.guess.disabled = false;
    el.skip.disabled = false;
    el.guess.value = "";
    closeSuggestions();
    if (!voice.isListening()) el.guess.focus();
    resume();
  }

  // Pause on the answer for a moment, then move to the next country.
  function between(ms) {
    busy = true;
    pause();
    el.skip.disabled = true;
    nextTimer = setTimeout(() => {
      setFeedback("", "info");
      nextCountry();
    }, ms);
  }

  function judge(c, viaVoice) {
    if (!running || busy) return;
    const t = run.target;
    el.guess.value = "";
    closeSuggestions();
    if (c.code === t.code) {
      run.streak++;
      run.correct.push(t);
      sound("correct");
      reveal(t.code, "good");
      adjustTime(RIGHT_MS);
      renderScore();
      setFeedback(`✓ ${t.name}${viaVoice ? " (heard you!)" : ""}`, "ok");
      between(750);
    } else {
      sound("wrong");
      flashWrong(c.code);
      wiggle();
      setFeedback(`✗ Not ${c.name}${viaVoice ? " (heard you)" : ""}`, "err");
      adjustTime(-WRONG_MS);
    }
  }

  function skip() {
    if (!running || busy) return;
    const t = run.target;
    run.missed.push(t);
    sound("wrong");
    reveal(t.code, "bad");
    setFeedback(`That was ${t.name}.`, "err");
    if (adjustTime(-SKIP_MS)) between(1400);
  }

  function endRun() {
    pause();
    clearTimeout(nextTimer);
    busy = true;
    run.remainingMs = 0;
    renderClock();
    voice.stop();
    closeSuggestions();
    el.guess.disabled = true;
    el.guess.blur();
    // show where the last one was
    const t = run.target;
    if (t && !run.correct.includes(t) && !run.missed.includes(t)) {
      run.missed.push(t);
      reveal(t.code, "bad");
    }
    sound("gameover");

    const newBest = run.streak > best;
    if (newBest) {
      best = run.streak;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    renderScore();
    showPanel("end");
    el.finalScore.textContent = `${run.streak} ${run.streak === 1 ? "country" : "countries"}`;
    el.finalBest.textContent = newBest ? "🏆 New personal best!" : `Your best: ${best}`;
    el.resultChips.innerHTML = "";
    for (const c of run.correct) {
      const s = document.createElement("span");
      s.textContent = c.name;
      el.resultChips.appendChild(s);
    }
    for (const c of run.missed) {
      const s = document.createElement("span");
      s.className = "missed";
      s.textContent = c.name;
      el.resultChips.appendChild(s);
    }
    el.playagain.focus();
  }

  function wiggle() {
    el.guess.classList.remove("shake");
    void el.guess.offsetWidth; // restart animation
    el.guess.classList.add("shake");
  }

  // ---------- Autocomplete & input ----------

  let sug = null;

  function renderSuggestions() {
    el.sug.innerHTML = "";
    if (!sug) { el.sug.classList.remove("open"); return; }
    const d = document.createElement("div");
    d.className = "active";
    d.textContent = sug.c.name;
    if (sug.via) {
      const sm = document.createElement("small");
      sm.textContent = `(${sug.via})`;
      d.appendChild(sm);
    }
    const chosen = sug.c;
    d.addEventListener("mousedown", (e) => { e.preventDefault(); judge(chosen, false); });
    el.sug.appendChild(d);
    el.sug.classList.add("open");
  }

  function closeSuggestions() {
    sug = null;
    el.sug.classList.remove("open");
    el.sug.innerHTML = "";
  }

  function submitText(text) {
    const c = lookup.get(MapGame.normalize(text));
    if (c) { judge(c, false); return; }
    if (!text.trim()) return;
    // not a country at all — likely a typo, so no time penalty
    sound("nomatch");
    setFeedback(`“${text.trim()}” isn't a country we recognize.`, "info");
    wiggle();
  }

  el.guess.addEventListener("input", () => {
    sug = MapGame.suggest(el.guess.value, COUNTRIES);
    renderSuggestions();
  });
  el.guess.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (sug) judge(sug.c, false);
      else submitText(el.guess.value);
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });
  el.guess.addEventListener("blur", () => setTimeout(closeSuggestions, 150));

  const voice = MapGame.setupVoice(el.mic, {
    onFinal(transcript, hits) {
      if (!running || busy) return;
      if (!hits.length) {
        sound("nomatch");
        setFeedback(`Heard “${transcript.trim()}” — no country match.`, "info");
        return;
      }
      // one utterance is one guess: a right answer anywhere in it counts
      judge(hits.find((c) => c.code === run.target.code) || hits[0], true);
    },
    onInterim: (text) => { if (running && !busy) setFeedback(`Listening… “${text}”`, "info"); },
    onStatus: setFeedback,
  });

  el.skip.addEventListener("click", skip);
  el.startBtn.addEventListener("click", startRun);
  el.playagain.addEventListener("click", startRun);
  MapGame.setupMenu({ onReset: startRun });

  // ---------- Init ----------

  el.startBest.textContent = best ? `Your best: ${best}` : "";
  renderScore();
  renderClock();
  showPanel("start");
})();
