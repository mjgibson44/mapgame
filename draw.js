/* MapGame — Border Draw */
(function () {
  "use strict";

  const RUN_KEY = "mapgame-draw-run";    // the map in progress, so a refresh resumes it
  const CONT_KEY = "mapgame-draw-continent";
  const BEST_KEY = "mapgame-draw-best";  // + ":" + continent id
  const PEN_KEY = "mapgame-draw-pen";    // "1" once a stylus has been used here
  const MAX_ZOOM = 12;                   // how far in you can zoom, relative to the whole continent
  const RASTER_PX = 2.2e6;               // scoring grid size, in cells

  const { sound } = MapGame;

  // The four continents, from the Streak Mode map areas (Asia includes
  // Australia), each with the part of the map to show: Russia is cut off east
  // of the Urals, and France's overseas territories fall outside Europe.
  // The island microstates (Streak's Global Islands) have no land borders,
  // so they're shown faded, like the other continents.
  const VIEWS = {
    americas: { x: 55, y: 0, w: 355, h: 440 },
    europe:   { x: 438, y: 2, w: 226, h: 144 },
    asia:     { x: 560, y: 70, w: 440, h: 342 },
    africa:   { x: 440, y: 128, w: 215, h: 248 },
  };
  const CONTINENTS = REGIONS.filter((r) => VIEWS[r.id]).map((r) => ({ ...r, box: VIEWS[r.id] }));
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
  // Map shapes that are part of a country: the map draws Somaliland apart from Somalia.
  const PART_OF = { SOL: "SO" };
  const regionOf = new Map(REGIONS.flatMap((r) => r.codes.map((code) => [code, r.id])));
  const contOf = (code) => regionOf.get(PART_OF[code] || code);

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("drawTitle"), score: $("drawScore"),
    start: $("startPanel"), conts: $("continents"), startBest: $("startBest"), startBtn: $("startBtn"),
    toolbar: $("toolbar"), pen: $("penBtn"), erase: $("eraseBtn"), undo: $("undoBtn"), clear: $("clearBtn"),
    done: $("doneBtn"), hint: $("drawHint"),
    end: $("endscreen"), finalScore: $("finalScore"), finalPct: $("finalPct"), showLines: $("showLines"),
    feedback: $("feedback"), results: $("results"), unscored: $("unscored"),
    playagain: $("playagain"), changeCont: $("changeCont"),
    map: $("map"), zoomIn: $("zoomIn"), zoomOut: $("zoomOut"), zoomFit: $("zoomFit"),
  };

  // ---------- State ----------

  let contId = CONTINENTS[0].id;
  try {
    const saved = localStorage.getItem(CONT_KEY);
    if (CONTINENTS.some((c) => c.id === saved)) contId = saved;
  } catch (e) {}
  const cont = () => CONTINENTS.find((c) => c.id === contId);

  function bestFor(id) {
    try { return Number(localStorage.getItem(`${BEST_KEY}:${id}`)) || 0; } catch (e) { return 0; }
  }

  // run = { cont, strokes: [[[x, y], …], …], result: null | { total, max, scores } }
  // Strokes are open lines, in map units.
  let run = null;
  let state = "start"; // "start" | "draw" | "result"
  let tool = "pen";    // "pen" | "erase"
  let undoStack = [];  // earlier versions of run.strokes
  let penMode = false; // a stylus has been used: it draws, and fingers only move the map
  try { penMode = localStorage.getItem(PEN_KEY) === "1"; } catch (e) {}

  function save() {
    try {
      if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
      else localStorage.removeItem(RUN_KEY);
    } catch (e) {}
  }

  // ---------- Map ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  const mapNodes = MapGame.buildMap(el.map);
  const ink = document.createElementNS(SVG_NS, "g"); // your lines, above the land
  ink.setAttribute("class", "ink");
  el.map.appendChild(ink);

  // The visible part of the map, in map units. The view is always the
  // element's own shape, so a map unit is square.
  let view = null, fitView = null;

  function setView(v) {
    view = v;
    el.map.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    // microstate dots stay the same size on screen at any zoom
    const r = String((4 * v.w) / el.map.clientWidth);
    for (const dot of el.map.querySelectorAll(".dot")) dot.setAttribute("r", r);
  }

  // While drawing, the map fills the screen below the toolbar; otherwise it
  // follows the continent's shape, within what fits on screen.
  const stacked = window.matchMedia("(max-width: 950px)");
  function layoutMap() {
    const b = cont().box;
    const w = el.map.clientWidth;
    if (!w) return;
    let h;
    if (state === "draw") {
      const top = el.map.getBoundingClientRect().top + window.scrollY;
      h = Math.max(300, window.innerHeight - top - 56);
    } else {
      const maxH = window.innerHeight * (stacked.matches ? 0.6 : 0.8);
      h = Math.max(w * 0.55, Math.min(maxH, (w * b.h) / b.w));
    }
    h = Math.round(h);
    el.map.style.height = `${h}px`;
    const aspect = h / w;
    const zoomed = view && fitView && view.w < fitView.w * 0.999;
    fitView = b.h / b.w > aspect
      ? { x: b.x + b.w / 2 - b.h / aspect / 2, y: b.y, w: b.h / aspect, h: b.h }
      : { x: b.x, y: b.y + b.h / 2 - (b.w * aspect) / 2, w: b.w, h: b.w * aspect };
    // keep your zoom when you've zoomed in; otherwise refit
    setView(zoomed ? clampView(view) : fitView);
  }
  window.addEventListener("resize", () => requestAnimationFrame(layoutMap));

  // Zoom in no further than MAX_ZOOM, out no further than the whole
  // continent, and keep the view over it.
  function clampView(v) {
    const w = Math.min(fitView.w, Math.max(fitView.w / MAX_ZOOM, v.w));
    const h = (w * fitView.h) / fitView.w;
    const x = Math.min(fitView.x + fitView.w - w, Math.max(fitView.x, v.x));
    const y = Math.min(fitView.y + fitView.h - h, Math.max(fitView.y, v.y));
    return { x, y, w, h };
  }

  // Zoom by factor k (>1 = in), keeping map point [px, py] where it is.
  function zoomAt(k, px, py) {
    const w = view.w / k, h = view.h / k;
    setView(clampView({ x: px - ((px - view.x) * w) / view.w, y: py - ((py - view.y) * h) / view.h, w, h }));
  }

  function toMap(clientX, clientY) {
    const r = el.map.getBoundingClientRect();
    return [view.x + ((clientX - r.left) / r.width) * view.w, view.y + ((clientY - r.top) / r.height) * view.h];
  }
  const unitsPerPx = () => view.w / el.map.clientWidth;

  // While you draw, the continent is one plain landmass and everything else
  // (other continents, Western Sahara, the island microstates) is faded. On
  // the result, the continent's countries get their real borders, shaded by
  // score.
  function paintMap() {
    for (const [code, node] of mapNodes) {
      node.setAttribute("class", node.tagName === "circle" ? "dot" : "land");
      if (contOf(code) !== contId) { node.classList.add("area-off"); continue; }
      if (state !== "result") continue;
      const s = run.result.scores[PART_OF[code] || code];
      node.classList.add(!s ? "unscored" : s.pts >= 75 ? "pts-hi" : s.pts >= 40 ? "pts-mid" : "pts-lo");
    }
  }

  // ---------- Your lines ----------

  const pointsAttr = (s) => s.map((p) => p.join(",")).join(" ");
  function lineEl(s) {
    const p = document.createElementNS(SVG_NS, "polyline");
    p.setAttribute("class", "line");
    p.setAttribute("points", pointsAttr(s));
    return p;
  }
  function renderInk() {
    ink.textContent = "";
    if (run) for (const s of run.strokes) ink.appendChild(lineEl(s));
    updateButtons();
  }

  function updateButtons() {
    const empty = !run || !run.strokes.length;
    el.undo.disabled = !undoStack.length;
    el.clear.disabled = empty;
    el.done.disabled = empty;
    el.pen.setAttribute("aria-checked", String(tool === "pen"));
    el.erase.setAttribute("aria-checked", String(tool === "erase"));
    el.map.classList.toggle("erasing", tool === "erase");
  }

  function remember(strokes) {
    undoStack.push(strokes);
    if (undoStack.length > 300) undoStack.shift();
    disarmDone();
  }

  // Removes every line passing within r map units of [x, y].
  function eraseAt([x, y], r) {
    const before = run.strokes.length;
    run.strokes = run.strokes.filter((s) => {
      for (let i = 0; i < s.length; i++) {
        const [ax, ay] = s[i], [bx, by] = s[Math.min(i + 1, s.length - 1)];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= r) return false;
      }
      return true;
    });
    return run.strokes.length !== before;
  }

  // ---------- Pointer input ----------
  //
  // Mouse: drag draws (or erases); Shift-drag or a right/middle-button drag
  // moves the map, and the wheel zooms. Touch: one finger draws, two move and
  // zoom. Once a stylus (Apple Pencil) is used, the stylus draws and fingers
  // only move and zoom the map — so a palm resting on the screen never draws.

  const pointers = new Map(); // pointerId -> { x, y, type }
  let gesture = null;

  const round = (v) => Math.round(v * 1000) / 1000;
  const fingers = () => [...pointers.values()].filter((p) => p.type !== "pen").slice(0, 2);

  el.map.addEventListener("contextmenu", (e) => e.preventDefault());
  // iOS: no magnifier, callout or double-tap zoom on the map
  el.map.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

  el.map.addEventListener("pointerdown", (e) => {
    if (state === "start") return;
    e.preventDefault();
    if (e.pointerType === "pen" && !penMode) {
      penMode = true;
      try { localStorage.setItem(PEN_KEY, "1"); } catch (err) {}
      updateHint();
    }
    // a palm or finger landing while the stylus draws is ignored
    if (gesture && gesture.pen && e.pointerType === "touch") return;
    try { el.map.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (e.pointerType === "touch" && fingers().length === 2 && !(gesture && gesture.pen)) {
      if (gesture && gesture.kind === "draw") gesture.node.remove(); // a second finger: it's a pinch
      const [a, b] = fingers();
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: toMap((a.x + b.x) / 2, (a.y + b.y) / 2) };
      return;
    }
    if (gesture) return;
    const fingerOnly = penMode && e.pointerType === "touch";
    const moveMap = e.shiftKey || e.button === 1 || e.button === 2 || fingerOnly || state !== "draw";
    const at = toMap(e.clientX, e.clientY);
    if (moveMap) {
      gesture = { kind: "pan", id: e.pointerId, from: at, start: [e.clientX, e.clientY], tap: true };
    } else if (tool === "erase") {
      gesture = { kind: "erase", id: e.pointerId, pen: e.pointerType === "pen", before: run.strokes, last: at };
      eraseAt(at, 10 * unitsPerPx()) && renderInk();
    } else {
      const stroke = [at.map(round)];
      gesture = { kind: "draw", id: e.pointerId, pen: e.pointerType === "pen", stroke, node: lineEl(stroke),
                  last: [e.clientX, e.clientY], moved: 0 };
      ink.appendChild(gesture.node);
    }
  });

  el.map.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const f = fingers();
      if (f.length < 2) return;
      const [a, b] = f;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // scale about the original midpoint, then move it under the fingers
      zoomAt(dist / gesture.dist, ...gesture.mid);
      gesture.dist = dist;
      const [mx, my] = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView(clampView({ ...view, x: view.x + gesture.mid[0] - mx, y: view.y + gesture.mid[1] - my }));
      return;
    }
    if (e.pointerId !== gesture.id) return;
    if (gesture.kind === "pan") {
      if (Math.hypot(e.clientX - gesture.start[0], e.clientY - gesture.start[1]) >= 6) gesture.tap = false;
      const [x, y] = toMap(e.clientX, e.clientY);
      setView(clampView({ ...view, x: view.x + gesture.from[0] - x, y: view.y + gesture.from[1] - y }));
      return;
    }
    // a stylus reports several points per frame; use them all for a smooth line
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      if (gesture.kind === "erase") {
        // check every few pixels along the way, so a quick swipe misses nothing
        const r = 10 * unitsPerPx(), [x0, y0] = gesture.last, [x1, y1] = toMap(ev.clientX, ev.clientY);
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r / 2)));
        let hit = false;
        for (let k = 1; k <= steps; k++) hit = eraseAt([x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps], r) || hit;
        gesture.last = [x1, y1];
        if (hit) renderInk();
        continue;
      }
      const d = Math.hypot(ev.clientX - gesture.last[0], ev.clientY - gesture.last[1]);
      if (d < 1.5) continue;
      gesture.moved += d;
      gesture.last = [ev.clientX, ev.clientY];
      gesture.stroke.push(toMap(ev.clientX, ev.clientY).map(round));
    }
    if (gesture.kind === "draw") gesture.node.setAttribute("points", pointsAttr(gesture.stroke));
  });

  function pointerEnd(e, cancelled) {
    if (!pointers.delete(e.pointerId)) return;
    const g = gesture;
    if (!g) return;
    if (g.kind === "pinch") {
      // lifting one finger of a pinch leaves the other moving the map
      const rest = [...pointers.entries()].find(([, p]) => p.type !== "pen");
      gesture = rest ? { kind: "pan", id: rest[0], from: toMap(rest[1].x, rest[1].y), tap: false } : null;
      return;
    }
    if (e.pointerId !== g.id) return;
    gesture = null;
    if (g.kind === "draw") {
      if (cancelled || g.moved < 4 || g.stroke.length < 2) { g.node.remove(); return; }
      remember(run.strokes.slice());
      run.strokes.push(g.stroke);
      save();
      updateButtons();
    } else if (g.kind === "erase") {
      if (run.strokes.length !== g.before.length) { remember(g.before); save(); updateButtons(); }
    } else if (g.tap && !cancelled && state === "result") {
      pickAt(e.clientX, e.clientY); // a tap on the result: which country is that?
    }
  }
  el.map.addEventListener("pointerup", (e) => pointerEnd(e, false));
  el.map.addEventListener("pointercancel", (e) => pointerEnd(e, true));

  el.map.addEventListener("wheel", (e) => {
    if (!view) return;
    e.preventDefault();
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)); // trackpad pinch sends ctrlKey
    zoomAt(k, ...toMap(e.clientX, e.clientY));
  }, { passive: false });

  const zoomCentre = (k) => zoomAt(k, view.x + view.w / 2, view.y + view.h / 2);
  el.zoomIn.addEventListener("click", () => zoomCentre(1.6));
  el.zoomOut.addEventListener("click", () => zoomCentre(1 / 1.6));
  el.zoomFit.addEventListener("click", () => setView(fitView));

  function updateHint() {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    el.hint.textContent = penMode
      ? "Apple Pencil draws. One finger moves the map, two fingers zoom."
      : coarse
        ? "One finger draws; two fingers move and zoom. With an Apple Pencil, the Pencil draws and fingers move the map."
        : "Drag to draw. Scroll to zoom; Shift-drag or right-drag to move the map.";
  }

  // ---------- Scoring ----------
  //
  // The continent is rasterized to a grid of country labels. Real borders are
  // the cells where two of the continent's countries meet. Then, per country:
  //   found    — how much of its border has one of your lines nearby
  //   onTarget — how much of your line inside it lies near a real border
  // Nearness uses a tolerance that scales with the country's size: full
  // credit close to the line, none past the tolerance. Lines along the coast
  // or the faded land's edge are ignored (they're already drawn), and ink
  // near a border counts only up to about the border's own length — past
  // that it's extra lines, so scribbling all over a country doesn't pay. The score is
  // the harmonic mean (F1) of found and onTarget, so it takes both drawing
  // every border and not drawing ones that aren't there; 90% or better is
  // full marks. Countries with no land borders (islands) and the
  // microstates aren't scored.

  const ringCache = new Map();
  function ringsOf(code) {
    if (ringCache.has(code)) return ringCache.get(code);
    const rings = [];
    let ring = null, x = 0, y = 0, m;
    const re = /([Ml])([^MlZ]*)/g; // "M x y", then relative "l dx dy", then "Z"
    while ((m = re.exec(MAP_DATA.shapes[code].d))) {
      const n = m[2].trim().split(/\s+/).map(Number);
      if (m[1] === "M") { [x, y] = n; ring = [[x, y]]; rings.push(ring); }
      else { x += n[0]; y += n[1]; ring.push([x, y]); }
    }
    ringCache.set(code, rings);
    return rings;
  }

  // Chamfer distance transform: for every cell, ~3× the distance in cells
  // to the nearest seed cell.
  function distanceTo(seed, W, H) {
    const d = new Int32Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : 1e9;
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) {
        let v = d[i];
        if (!v) continue;
        if (x > 0) v = Math.min(v, d[i - 1] + 3);
        if (y > 0) {
          v = Math.min(v, d[i - W] + 3);
          if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
          if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
        }
        d[i] = v;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1, i = y * W + x; x >= 0; x--, i--) {
        let v = d[i];
        if (!v) continue;
        if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
        if (y < H - 1) {
          v = Math.min(v, d[i + W] + 3);
          if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
          if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
        }
        d[i] = v;
      }
    }
    return d;
  }

  function scoreMap(strokes) {
    const b = cont().box;
    const R = Math.sqrt(RASTER_PX / (b.w * b.h)); // cells per map unit
    const W = Math.ceil(b.w * R), H = Math.ceil(b.h * R);
    const label = new Uint8Array(W * H);
    const codes = [null];          // label -> country code; 0 is the sea
    const idOf = new Map();
    const inCont = [0];

    // Countries, filled row by row (even-odd, sampling cell centres)
    for (const shape of Object.keys(MAP_DATA.shapes)) {
      const code = PART_OF[shape] || shape;
      if (!idOf.has(code)) {
        idOf.set(code, codes.length);
        codes.push(code);
        inCont.push(contOf(code) === contId ? 1 : 0);
      }
      const id = idOf.get(code);
      const rows = new Map();
      for (const ring of ringsOf(shape)) {
        for (let k = 0; k < ring.length; k++) {
          const [x1, y1] = ring[k], [x2, y2] = ring[(k + 1) % ring.length];
          if (y1 === y2) continue;
          const Y1 = (y1 - b.y) * R, Y2 = (y2 - b.y) * R;
          const j0 = Math.max(0, Math.ceil(Math.min(Y1, Y2) - 0.5));
          const j1 = Math.min(H - 1, Math.ceil(Math.max(Y1, Y2) - 0.5) - 1);
          for (let j = j0; j <= j1; j++) {
            const X = (x1 - b.x + (((j + 0.5) / R + b.y - y1) * (x2 - x1)) / (y2 - y1)) * R;
            if (!rows.has(j)) rows.set(j, []);
            rows.get(j).push(X);
          }
        }
      }
      for (const [j, xs] of rows) {
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(0, Math.ceil(xs[k] - 0.5)), z = Math.min(W, Math.ceil(xs[k + 1] - 0.5));
          if (z > a) label.fill(id, j * W + a, j * W + z);
        }
      }
    }

    // Real borders, and the coast and faded land's edges
    const truth = new Uint8Array(W * H), coast = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) {
        const a = label[i];
        for (const j of [x < W - 1 ? i + 1 : -1, y < H - 1 ? i + W : -1]) {
          if (j < 0 || label[j] === a) continue;
          if (inCont[a] && inCont[label[j]]) truth[i] = truth[j] = 1;
          else coast[i] = coast[j] = 1;
        }
      }
    }

    // Your lines
    const mine = new Uint8Array(W * H);
    for (const s of strokes) {
      for (let k = 0; k < s.length; k++) {
        const [x1, y1] = s[k], [x2, y2] = s[Math.min(k + 1, s.length - 1)];
        const X1 = (x1 - b.x) * R, Y1 = (y1 - b.y) * R, X2 = (x2 - b.x) * R, Y2 = (y2 - b.y) * R;
        const n = Math.max(1, Math.ceil(Math.hypot(X2 - X1, Y2 - Y1) * 2));
        for (let t = 0; t <= n; t++) {
          const X = Math.floor(X1 + ((X2 - X1) * t) / n), Y = Math.floor(Y1 + ((Y2 - Y1) * t) / n);
          if (X >= 0 && X < W && Y >= 0 && Y < H) mine[Y * W + X] = 1;
        }
      }
    }

    const toMine = distanceTo(mine, W, H), toTruth = distanceTo(truth, W, H), toCoast = distanceTo(coast, W, H);
    const n = codes.length;
    const area = new Float64Array(n), borderN = new Float64Array(n), found = new Float64Array(n);
    const near = new Float64Array(n), stray = new Float64Array(n);
    for (let i = 0; i < label.length; i++) area[label[i]]++;
    // tolerance (×3, like the distances): 15% of the country's size, between
    // 0.8 and 3 map units (roughly 30–120 km)
    const tol = Array.from(area, (a) => Math.min(3, Math.max(0.8, (0.15 * Math.sqrt(a)) / R)) * R * 3);
    const credit = (d, T) => (d <= 0.3 * T ? 1 : Math.max(0, 1 - (d - 0.3 * T) / (0.7 * T)));
    for (let i = 0; i < label.length; i++) {
      const a = label[i];
      if (!inCont[a]) continue;
      if (truth[i]) { borderN[a]++; found[a] += credit(toMine[i], tol[a]); }
      if (mine[i] && !(toCoast[i] < toTruth[i] && toCoast[i] <= tol[a])) {
        const c = credit(toTruth[i], tol[a]);
        near[a] += c; stray[a] += 1 - c;
      }
    }

    const scores = {};
    let total = 0, max = 0;
    for (let id = 1; id < n; id++) {
      if (!inCont[id] || !borderN[id]) continue;
      const F = found[id] / borderN[id];
      const useful = Math.min(near[id], 0.9 * borderN[id]); // a traced border is ~0.6–0.8
      const extra = stray[id] + near[id] - useful;
      const P = useful + extra ? useful / (useful + extra) : 1;
      const f1 = F + P ? (2 * F * P) / (F + P) : 0;
      const pts = Math.round(100 * Math.min(1, f1 / 0.9));
      scores[codes[id]] = { pts, found: Math.round(100 * F), onTarget: Math.round(100 * P) };
      total += pts; max += 100;
    }
    return { total, max, scores };
  }

  // ---------- Game flow ----------

  function setState(s) {
    state = s;
    document.body.classList.toggle("drawing", s === "draw");
    el.start.hidden = s !== "start";
    el.end.hidden = s !== "result";
    el.toolbar.hidden = s !== "draw";
    el.hint.hidden = s !== "draw";
    ink.classList.toggle("faded", s === "result" && !el.showLines.checked);
    paintMap();
    renderInk();
    renderHeader();
    view = null;
    layoutMap();
  }

  function renderHeader() {
    el.title.innerHTML = state === "start" ? "Border Draw" : `Border Draw<small>${cont().name}</small>`;
    el.score.textContent = state === "result" ? `${run.result.total} / ${run.result.max}` : "";
  }

  function startDrawing(fresh) {
    if (fresh || !run || run.cont !== contId) run = { cont: contId, strokes: [], result: null };
    undoStack = [];
    tool = "pen";
    save();
    updateHint();
    window.scrollTo(0, 0);
    setState("draw");
  }

  // Scoring can't be undone, so "Score my map" asks for a second tap.
  let armTimer = null;
  function disarmDone() {
    clearTimeout(armTimer);
    el.done.classList.remove("armed");
    el.done.textContent = "Score my map";
  }
  el.done.addEventListener("click", () => {
    if (!run.strokes.length) return;
    if (!el.done.classList.contains("armed")) {
      el.done.classList.add("armed");
      el.done.textContent = "Finished? Tap again";
      armTimer = setTimeout(disarmDone, 4000);
      return;
    }
    disarmDone();
    el.done.textContent = "Scoring…";
    el.done.disabled = true;
    setTimeout(() => {                 // let "Scoring…" paint first
      run.result = scoreMap(run.strokes);
      save();
      showResult(true);
    }, 30);
  });

  function showResult(fresh) {
    const { total, max, scores } = run.result;
    const prevBest = bestFor(run.cont);
    if (fresh && total > prevBest) {
      try { localStorage.setItem(`${BEST_KEY}:${run.cont}`, String(total)); } catch (e) {}
    }
    setState("result");
    const pct = Math.round((100 * total) / max);
    el.finalScore.textContent = `${pct}%`;
    el.finalPct.textContent = `${total} of ${max} points across ${max / 100} countries` +
      (fresh && total > prevBest && prevBest ? " — a new best!" : prevBest ? ` · Your best: ${Math.max(prevBest, total)}` : "");
    el.feedback.className = "info";
    el.feedback.textContent = "Tap a country on the map to see how you did.";

    el.results.textContent = "";
    const name = (code) => byCode.get(code).name;
    const list = Object.entries(scores).sort((a, b) => b[1].pts - a[1].pts || name(a[0]).localeCompare(name(b[0])));
    for (const [code, s] of list) {
      const row = document.createElement("button");
      row.className = s.pts >= 75 ? "pts-hi" : s.pts >= 40 ? "pts-mid" : "pts-lo";
      row.innerHTML = "<span></span><b></b>";
      row.firstChild.textContent = name(code);
      row.lastChild.textContent = s.pts;
      row.addEventListener("click", () => pick(code));
      el.results.appendChild(row);
    }
    const skipped = cont().codes.filter((c) => !scores[c]).map(name).sort();
    el.unscored.textContent = skipped.length
      ? `Not scored — islands with no land borders, or too small for this map: ${skipped.join(", ")}.` : "";
    if (fresh) sound(pct >= 50 ? "complete" : "gameover");
  }

  function pickAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const node = hit && hit.closest && hit.closest("[data-code]");
    const code = node && node.getAttribute("data-code");
    if (code && contOf(code) === contId) pick(PART_OF[code] || code);
  }

  function pick(code) {
    for (const node of el.map.querySelectorAll(".picked")) node.classList.remove("picked");
    for (const [c, node] of mapNodes) if ((PART_OF[c] || c) === code) {
      node.classList.add("picked");
      node.parentNode.insertBefore(node, ink); // on top, so its whole outline shows
    }
    const s = run.result.scores[code], name = byCode.get(code).name;
    el.feedback.className = !s ? "info" : s.pts >= 50 ? "ok" : "err";
    el.feedback.textContent = s
      ? `${name}: ${s.pts} points — ${s.found}% of its borders drawn, ${s.onTarget}% of your lines in it on target`
      : `${name} isn't scored: it has no land borders, or is too small for this map.`;
  }

  function showStart() {
    run = null; undoStack = [];
    save();
    setState("start");
    renderContinents();
  }

  function renderContinents() {
    el.conts.textContent = "";
    for (const c of CONTINENTS) {
      const b = document.createElement("button");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-pressed", String(c.id === contId));
      b.setAttribute("aria-checked", String(c.id === contId));
      b.textContent = c.name;
      b.addEventListener("click", () => {
        contId = c.id;
        try { localStorage.setItem(CONT_KEY, contId); } catch (e) {}
        renderContinents();
        paintMap();
        view = null;
        layoutMap();
      });
      el.conts.appendChild(b);
    }
    const best = bestFor(contId);
    el.startBest.textContent = best ? `Your best on ${cont().name}: ${best} points` : "";
  }

  // ---------- Controls ----------

  el.startBtn.addEventListener("click", () => startDrawing(true));
  el.playagain.addEventListener("click", () => startDrawing(true));
  el.changeCont.addEventListener("click", showStart);
  el.pen.addEventListener("click", () => { tool = "pen"; updateButtons(); });
  el.erase.addEventListener("click", () => { tool = "erase"; updateButtons(); });
  el.undo.addEventListener("click", () => {
    if (!undoStack.length) return;
    run.strokes = undoStack.pop();
    disarmDone();
    save();
    renderInk();
  });
  el.clear.addEventListener("click", () => {
    if (!run.strokes.length) return;
    remember(run.strokes);
    run.strokes = [];
    save();
    renderInk();
  });
  el.showLines.addEventListener("change", () => ink.classList.toggle("faded", !el.showLines.checked));
  document.addEventListener("keydown", (e) => {
    if (state !== "draw" || e.target.closest("input, textarea")) return;
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.undo.click(); }
    else if (e.key === "e" || e.key === "E") el.erase.click();
    else if (e.key === "d" || e.key === "D") el.pen.click();
  });

  MapGame.setupMenu({ onReset: showStart });

  // Resume a saved map (drawing or scored), or show the start screen.
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    if (saved && VIEWS[saved.cont] && Array.isArray(saved.strokes)) {
      run = saved;
      contId = saved.cont;
    }
  } catch (e) {}
  if (run && run.result) showResult(false);
  else if (run) startDrawing(false);
  else showStart();
})();
