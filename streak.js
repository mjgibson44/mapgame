/* MapGame — Streak Mode */
(function () {
  "use strict";

  const BEST_KEY = "mapgame-streak-best";  // all areas; other picks get their own best
  const AREAS_KEY = "mapgame-streak-areas";
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
    areas: $("areas"),
    end: $("endscreen"), endTitle: $("endTitle"), finalScore: $("finalScore"), finalBest: $("finalBest"),
    resultChips: $("resultChips"), playagain: $("playagain"), changeAreas: $("changeAreas"),
    map: $("map"), inset: $("inset"),
  };

  // ---------- State ----------

  // Which map areas (REGIONS ids) the pins drop in; all of them by default.
  let areas = REGIONS.map((r) => r.id);
  try {
    const saved = JSON.parse(localStorage.getItem(AREAS_KEY) || "null");
    if (Array.isArray(saved)) {
      const valid = areas.filter((id) => saved.includes(id));
      if (valid.length) areas = valid;
    }
  } catch (e) {}
  const allAreas = () => areas.length === REGIONS.length;
  const areaNames = () => REGIONS.filter((r) => areas.includes(r.id)).map((r) => r.name).join(" + ");

  // A best score per choice of areas, so a run on one continent doesn't
  // compete with runs on the whole world. All areas keeps the original key.
  const bestKey = () => (allAreas() ? BEST_KEY : `${BEST_KEY}:${areas.join("+")}`);
  let best = 0;
  function loadBest() {
    best = 0;
    try { best = Number(localStorage.getItem(bestKey())) || 0; } catch (e) {}
  }
  loadBest();

  const regionOf = new Map(REGIONS.flatMap((r) => r.codes.map((code) => [code, r.id])));
  let pool = [];
  function updatePool() {
    pool = COUNTRIES.filter((c) => areas.includes(regionOf.get(c.code)));
  }
  updatePool();

  let run = null; // { deck, target, pin, streak, remainingMs, correct: [], missed: [] }
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

  // The Pacific straddles the map's left and right edges, so draw the land
  // near each edge again just past the other one: a view centred on Samoa
  // then shows Fiji and Australia to its west, as on a globe. Reveal colours
  // go on every copy of a country.
  const copies = new Map(); // code -> [node and its copies]
  const firstDot = el.map.querySelector(".dot"); // copies go beneath the dots
  for (const [code, node] of mapNodes) {
    const list = [node];
    if (node.tagName === "path") {
      const { minX, maxX } = bboxOf(ringsOf(MAP_DATA.shapes[code].d).flat());
      for (const dx of [WORLD_W, -WORLD_W]) {
        if ((dx > 0 && minX < 400) || (dx < 0 && maxX > WORLD_W - 400)) {
          const copy = node.cloneNode();
          copy.setAttribute("transform", `translate(${dx} 0)`);
          el.map.insertBefore(copy, firstDot);
          list.push(copy);
        }
      }
    }
    copies.set(code, list);
  }

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

  function bboxOf(points) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  // Where to drop the pin: the visual centre of the country — the point
  // deepest inside its largest landmass (a plain centroid can land in the sea
  // for crescent-shaped countries), found by a coarse-to-fine grid search.
  // Also returns the bounding box of the country's major landmasses (so
  // Indonesia spans Sumatra to Papua, but France leaves out French Guiana),
  // which sets how far to zoom in, and how deep inside the centre is.
  const pinCache = new Map();
  function pinFor(code) {
    if (pinCache.has(code)) return pinCache.get(code);
    let pin;
    const dot = MAP_DATA.dots[code];
    const close = MAP_DETAIL[code];
    if (close) {
      // small islands: the pin and zoom come from the close-up's outline
      const [bx, by, bw] = close.box;
      pin = { x: close.pin[0], y: close.pin[1], depth: 0, box: { minX: bx, maxX: bx + bw, minY: by, maxY: by + bw } };
    } else if (dot) {
      pin = { x: dot[0], y: dot[1], depth: 0, box: { minX: dot[0], maxX: dot[0], minY: dot[1], maxY: dot[1] } };
    } else {
      const rings = ringsOf(MAP_DATA.shapes[code].d);
      const ring = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a));
      const major = rings.filter((r) => ringArea(r) >= 0.35 * ringArea(ring));
      const { minX, maxX, minY, maxY } = bboxOf(ring);
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
      pin = { x: cx, y: cy, depth: bestD, box: bboxOf(major.flat()), rings, ringBox: bboxOf(ring) };
    }
    pinCache.set(code, pin);
    return pin;
  }

  // Each time a larger country comes up, the pin goes somewhere random in
  // its largest landmass rather than always dead centre, so it's the whole
  // shape you learn, not one spot. It stays at least ~half as deep as the
  // centre, well clear of coasts and borders, so it's never in doubt which
  // side of a border it's on. Countries too small for that to make a
  // difference (~100 of them) keep the centre.
  const SPREAD_DEPTH = 5; // map units the centre must be from the edge
  function pinSpot(code) {
    const pin = pinFor(code);
    if (pin.depth < SPREAD_DEPTH) return pin;
    const minD = 0.45 * pin.depth;
    const { minX, maxX, minY, maxY } = pin.ringBox;
    for (let tries = 0; tries < 400; tries++) {
      const x = minX + Math.random() * (maxX - minX), y = minY + Math.random() * (maxY - minY);
      // odd = on land; even = sea, or a hole such as Lesotho inside South Africa
      if (pin.rings.filter((r) => inside(x, y, r)).length % 2 === 0) continue;
      if (pin.rings.some((r) => edgeDist(x, y, r) < minD)) continue;
      return { x, y };
    }
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

  // Island countries too small to see at this zoom (see map-detail.js) get
  // a close-up inset in the map's bottom-right corner, where the country is
  // shaded darker than its neighbours. On the main map, instead of the pin,
  // their detailed outline is drawn with a thick stroke so it's always a few
  // pixels across, and circled, with a line to the inset.
  function svgEl(tag, cls, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    n.setAttribute("class", cls);
    parent.appendChild(n);
    return n;
  }
  const markG = svgEl("g", "close-mark", el.map);
  const markShape = svgEl("path", "close-shape", markG);
  const markLeader = svgEl("line", "close-leader", markG);
  const markRing = svgEl("circle", "close-ring", markG);
  const markPulse = svgEl("circle", "pin-pulse", markG);
  markG.style.display = "none";
  const insetLand = svgEl("path", "close-land", el.inset);
  const insetShape = svgEl("path", "close-shape", el.inset);
  el.map.appendChild(pinG);
  let closeUp = null; // MAP_DETAIL entry of the country in the inset

  function showCloseUp(code) {
    closeUp = (code && MAP_DETAIL[code]) || null;
    el.inset.toggleAttribute("hidden", !closeUp); // (no .hidden on SVG elements)
    markG.style.display = closeUp ? "" : "none";
    if (!closeUp) return;
    const [x, y, w] = closeUp.box;
    el.inset.setAttribute("viewBox", `${x} ${y} ${w} ${w}`);
    insetLand.setAttribute("d", closeUp.ctx);
    insetShape.setAttribute("d", closeUp.d);
    markShape.setAttribute("d", closeUp.d);
    el.inset.classList.remove("show");
    void el.inset.getBoundingClientRect(); // restart the fade-in
    el.inset.classList.add("show");
  }

  // In the app the map grows to fill the screen down to the keyboard (see
  // fitMap), so views are framed to the map's actual shape, not the world's.
  const WORLD_ASPECT = WORLD_H / WORLD_W;
  let mapAspect = WORLD_ASPECT;

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
    if (closeUp) { placeCloseUp(k); return; }
    pinG.setAttribute("transform", `translate(${pinAt.x} ${pinAt.y}) scale(${k})`);
    pinG.style.display = "";
  }

  // k: map units per pin unit on the main map. The ring stays 18px across
  // and its line runs to the inset's left edge (or nearest corner).
  function placeCloseUp(k) {
    pinG.style.display = "none";
    const r = 9 * k;
    for (const c of [markRing, markPulse]) {
      c.setAttribute("cx", pinAt.x); c.setAttribute("cy", pinAt.y); c.setAttribute("r", r);
    }
    const mr = el.map.getBoundingClientRect(), ir = el.inset.getBoundingClientRect();
    const u = view.w / (mr.width || 1);
    const ix = view.x + (ir.left - mr.left) * u, top = view.y + (ir.top - mr.top) * u;
    const iy = Math.max(top, Math.min(top + ir.height * u, pinAt.y));
    const len = Math.hypot(ix - pinAt.x, iy - pinAt.y) || 1;
    markLeader.setAttribute("x1", pinAt.x + ((ix - pinAt.x) * r) / len);
    markLeader.setAttribute("y1", pinAt.y + ((iy - pinAt.y) * r) / len);
    markLeader.setAttribute("x2", ix); markLeader.setAttribute("y2", iy);
  }

  // What makes a view recognisable is coastline: Rwanda up close is a
  // featureless blob of land, Samoa up close is empty sea. So sample view v
  // on a grid (x wraps like the map) and report the land fraction and how
  // many neighbouring samples flip between land and sea — a coastline count.
  let landRings = null;
  function scenery(v) {
    if (!landRings) {
      landRings = Object.values(MAP_DATA.shapes)
        .flatMap((s) => ringsOf(s.d))
        .map((r) => ({ r, ...bboxOf(r) }));
    }
    const NX = 48, NY = 24;
    const grid = [];
    let land = 0, coast = 0;
    for (let j = 0; j < NY; j++) {
      const y = v.y + ((j + 0.5) * v.h) / NY;
      grid.push([]);
      for (let i = 0; i < NX; i++) {
        const x = (((v.x + ((i + 0.5) * v.w) / NX) % WORLD_W) + WORLD_W) % WORLD_W;
        const isLand = landRings.some((L) =>
          x >= L.minX && x <= L.maxX && y >= L.minY && y <= L.maxY && inside(x, y, L.r));
        grid[j].push(isLand);
        if (isLand) land++;
        if (i > 0 && grid[j][i - 1] !== isLand) coast++;
        if (j > 0 && grid[j - 1][i] !== isLand) coast++;
      }
    }
    return { land: land / (NX * NY), coast };
  }

  // The view (in map units) for a country. It starts with the whole country
  // filling ~40% of the width — close enough to see exactly where the pin is
  // — then zooms out step by step while it's a blob of land with too little
  // coastline to tell which continent you're on, or nearly all open ocean
  // (islands like New Zealand naturally have little coastline, so a sea
  // view with some land in it is fine). The width
  // stays between MIN_W (about Western Europe) and MAX_W (about two
  // continents side by side). Those widths are for a world-shaped (2:1) map;
  // a taller map gets a narrower view covering the same area, so it zooms
  // in a little as well as showing more to the north and south.
  const MIN_W = 230, MAX_W = 560;
  const MIN_COAST = 120, BLOB_LAND = 0.2, MIN_LAND = 0.06;
  // The zoom is worked out once per country (around its centre); the view
  // is then framed around wherever the pin is this time.
  const widthCache = new Map();
  function viewFor(code, at) {
    const pin = pinFor(code), b = pin.box;
    const aspect = WORLD_ASPECT;
    const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY) / aspect);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function frame(worldW, pin) {
      const w = worldW * Math.sqrt(aspect / mapAspect); // same area as a 2:1 view
      const h = w * mapAspect;
      // centre on the country, keeping the pin clear of the sides and with
      // headroom above it for the pin graphic — or, for an island with a
      // close-up, a third of the way across, clear of the inset
      let x = MAP_DETAIL[code] ? pin.x - 0.3 * w : clamp(cx - w / 2, pin.x - 0.82 * w, pin.x - 0.18 * w);
      let y = clamp(cy - h / 2, pin.y - 0.88 * h, pin.y - 0.3 * h);
      // don't show empty space past the top/bottom of the map unless the pin needs it
      y = clamp(y, Math.min(0, pin.y - 0.3 * h), Math.max(WORLD_H - h, pin.y - 0.88 * h));
      return { x, y, w, h };
    }

    const key = `${code}@${mapAspect.toFixed(3)}`;
    let w = widthCache.get(key);
    if (w === undefined) {
      w = clamp(size * 2.5, MIN_W, MAX_W);
      for (let s = scenery(frame(w, pin)); ((s.coast < MIN_COAST && s.land > BLOB_LAND) || s.land < MIN_LAND) && w < MAX_W; s = scenery(frame(w, pin))) {
        w = Math.min(MAX_W, w * 1.15);
      }
      widthCache.set(key, w);
    }
    return frame(w, at || pin);
  }

  // In the app (where the page reserves room for its own keyboard), stretch
  // the map during a run so the answer box sits just above the keyboard.
  // Only on the stacked phone layout, where the map is above the box.
  const stacked = window.matchMedia("(max-width: 950px)");
  function fitMap() {
    let h = "";
    if (document.body.classList.contains("kb-open") && !el.panel.hidden && stacked.matches) {
      const kbH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kb-h")) || 0;
      const room = window.innerHeight - kbH - 12 - (el.panel.getBoundingClientRect().bottom + window.scrollY);
      const w = el.map.clientWidth;
      h = `${Math.round(Math.max(w * WORLD_ASPECT, Math.min(w * 1.6, el.map.clientHeight + room)))}px`;
    }
    if (el.map.style.height === h) return;
    el.map.style.height = h;
    mapAspect = h ? el.map.clientHeight / el.map.clientWidth : WORLD_ASPECT;
    if (run && run.target) zoomTo(viewFor(run.target.code, run.pin));
    else placePin();
  }
  window.addEventListener("resize", () => requestAnimationFrame(fitMap));

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
  const nodesOf = (code) => copies.get(code) || [];
  function clearReveals() {
    for (const list of copies.values()) for (const node of list) node.classList.remove("target", ...REVEALS);
    for (const node of [markShape, insetShape]) node.classList.remove(...REVEALS);
  }

  // On the start screen, the whole world with the chosen areas shaded in
  // (island microstates shown as dots) and the rest faded out. Cleared for
  // a run, where the fade would give away borders.
  function previewAreas(on) {
    el.map.classList.toggle("preview", on);
    for (const [code, list] of copies) {
      const off = on && !areas.includes(regionOf.get(code));
      for (const node of list) node.classList.toggle("area-off", off);
    }
  }
  function reveal(code, kind) {
    for (const node of nodesOf(code)) node.classList.add(`reveal-${kind}`);
    if (closeUp === MAP_DETAIL[code]) for (const node of [markShape, insetShape]) node.classList.add(`reveal-${kind}`);
  }
  const wrongTimers = new Map();
  function flashWrong(code) {
    clearTimeout(wrongTimers.get(code));
    for (const node of nodesOf(code)) node.classList.add("reveal-wrong");
    wrongTimers.set(code, setTimeout(() => {
      for (const node of nodesOf(code)) node.classList.remove("reveal-wrong");
    }, 1100));
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
    if (which === "start") {
      clearReveals();
      pinAt = null;
      showCloseUp(null);
      zoomTo({ x: 0, y: 0, w: WORLD_W, h: WORLD_H });
    }
    previewAreas(which === "start");
    el.start.hidden = which !== "start";
    el.panel.hidden = which !== "game";
    el.end.hidden = which !== "end";
    el.mic.classList.toggle("idle", which !== "game"); // voice only counts during a run
    requestAnimationFrame(fitMap); // after the keyboard shows or hides
  }

  function startRun() {
    clearTimeout(nextTimer);
    if (!pool.length) return;
    run = { deck: shuffled(pool), target: null, streak: 0, remainingMs: START_MS, correct: [], missed: [] };
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
    run.target = run.deck.pop();
    run.pin = pinSpot(run.target.code);
    // (an island with a close-up has its detailed outline instead of a dot)
    if (!MAP_DETAIL[run.target.code]) for (const node of nodesOf(run.target.code)) node.classList.add("target");
    showCloseUp(run.target.code);
    pinAt = run.pin;
    zoomTo(viewFor(run.target.code, run.pin));
    busy = false;
    el.guess.disabled = false;
    el.skip.disabled = false;
    el.guess.value = "";
    closeSuggestions();
    if (!voice.isListening()) el.guess.focus();
    resume();
  }

  // Pause on the answer for a moment, then move to the next country — or,
  // once every country has been named, finish the run.
  function between(ms) {
    busy = true;
    pause();
    el.skip.disabled = true;
    nextTimer = setTimeout(() => {
      setFeedback("", "info");
      if (run.deck.length) nextCountry();
      else endRun(true);
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

  // A skipped country goes to the back of the deck: the run is only
  // complete once every country has been named.
  function skip() {
    if (!running || busy) return;
    const t = run.target;
    if (!run.missed.includes(t)) run.missed.push(t);
    run.deck.unshift(t);
    sound("wrong");
    reveal(t.code, "bad");
    setFeedback(`That was ${t.name}.`, "err");
    if (adjustTime(-SKIP_MS)) between(1400);
  }

  // complete: every country named (the clock keeps what was left);
  // otherwise time ran out.
  function endRun(complete = false) {
    pause();
    clearTimeout(nextTimer);
    busy = true;
    if (!complete) run.remainingMs = 0;
    renderClock();
    voice.stop();
    closeSuggestions();
    el.guess.disabled = true;
    el.guess.blur();
    // show where the last one was
    const t = run.target;
    if (t && !run.correct.includes(t)) {
      if (!run.missed.includes(t)) run.missed.push(t);
      reveal(t.code, "bad");
    }
    sound(complete ? "complete" : "gameover");

    const newBest = run.streak > best;
    if (newBest) {
      best = run.streak;
      try { localStorage.setItem(bestKey(), String(best)); } catch (e) {}
    }
    renderScore();
    showPanel("end");
    el.endTitle.textContent = complete ? "Complete! 🎉" : "Time's up! ⏱";
    el.finalScore.textContent = `${run.streak} ${run.streak === 1 ? "country" : "countries"}`;
    const where = allAreas() ? "" : ` (${areaNames()})`;
    const bestLine = newBest ? `🏆 New personal best${where}!` : `Your best${where}: ${best}`;
    el.finalBest.textContent = complete
      ? `You named every country${where}, with ${fmt(run.remainingMs)} to spare.${newBest ? " 🏆" : ""}`
      : bestLine;
    el.resultChips.innerHTML = "";
    for (const c of run.correct) {
      const s = document.createElement("span");
      s.textContent = c.name;
      el.resultChips.appendChild(s);
    }
    // skipped ones named later count as named
    for (const c of run.missed.filter((c) => !run.correct.includes(c))) {
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
    sug = MapGame.suggest(el.guess.value, pool);
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
  el.changeAreas.addEventListener("click", () => {
    clearTimeout(nextTimer);
    run = null;
    renderAreas();
    renderScore();
    renderClock();
    showPanel("start");
  });
  MapGame.setupMenu({ onReset: startRun });
  MapGame.setupKeyboard(el.guess);

  // ---------- Map areas ----------

  const areaBtns = REGIONS.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = r.id;
    b.innerHTML = `${r.name}<small>${r.codes.length}</small>`;
    b.addEventListener("click", () => {
      areas = areas.includes(r.id)
        ? areas.filter((id) => id !== r.id)
        : REGIONS.map((x) => x.id).filter((id) => id === r.id || areas.includes(id));
      try { localStorage.setItem(AREAS_KEY, JSON.stringify(areas)); } catch (e) {}
      updatePool();
      loadBest();
      renderAreas();
      renderScore();
      previewAreas(true);
    });
    el.areas.appendChild(b);
    return b;
  });

  function renderAreas() {
    for (const b of areaBtns) b.setAttribute("aria-pressed", String(areas.includes(b.dataset.id)));
    el.startBtn.disabled = !pool.length;
    if (!pool.length) el.startBest.textContent = "Pick at least one area to play.";
    else {
      const count = `${pool.length} ${pool.length === 1 ? "country" : "countries"}`;
      el.startBest.textContent = best ? `${count} · your best: ${best}` : count;
    }
  }

  // ---------- Init ----------

  renderAreas();
  renderScore();
  renderClock();
  showPanel("start");
})();
