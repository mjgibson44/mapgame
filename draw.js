/* MapGame — Border Draw */
(function () {
  "use strict";

  const RUN_KEY = "mapgame-draw-run";    // the game in progress, so a refresh resumes it
  const CONT_KEY = "mapgame-draw-continent";
  const BEST_KEY = "mapgame-draw-best";  // + ":" + continent id
  const MAX_ZOOM = 12;                   // how far in you can zoom, relative to the whole continent
  const RASTER = 400;                    // scoring resolution: pixels along the longer side

  const { sound } = MapGame;

  // The four continents, from the Streak Mode map areas (Asia includes
  // Australia), each with the part of the map to show: Russia is cut off east
  // of the Urals, and France's overseas territories fall outside Europe.
  // The island microstates (Streak's Global Islands) have no land borders,
  // so they aren't in this mode.
  const VIEWS = {
    americas: { x: 55, y: 0, w: 355, h: 440 },
    europe:   { x: 438, y: 2, w: 226, h: 144 },
    asia:     { x: 560, y: 70, w: 440, h: 342 },
    africa:   { x: 440, y: 128, w: 215, h: 248 },
  };
  const CONTINENTS = REGIONS.filter((r) => VIEWS[r.id]).map((r) => ({ ...r, box: VIEWS[r.id] }));
  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    progress: $("drawProgress"), score: $("drawScore"),
    start: $("startPanel"), conts: $("continents"), startBest: $("startBest"), startBtn: $("startBtn"),
    panel: $("gamePanel"), verb: $("drawVerb"), name: $("drawName"), feedback: $("feedback"),
    undo: $("undoBtn"), clear: $("clearBtn"), skip: $("skipBtn"), done: $("doneBtn"), hint: $("drawHint"),
    end: $("endscreen"), finalScore: $("finalScore"), finalPct: $("finalPct"), results: $("results"),
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

  // run = { cont, order: [codes], results: [{ code, pts }] } — the current
  // country is order[results.length].
  let run = null;
  let strokes = [];      // the current drawing: loops of [x, y] map points
  let tap = null;        // or, for microstates, the [x, y] tapped
  let revealed = false;  // showing the answer, waiting for Next

  function save() {
    try {
      if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
      else localStorage.removeItem(RUN_KEY);
    } catch (e) {}
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const current = () => run && run.order[run.results.length];
  // Microstates are dots on this map, too small to draw: you tap where they are.
  const isTap = (code) => !MAP_DATA.shapes[code];

  // ---------- Map ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  const mapNodes = MapGame.buildMap(el.map);
  const ink = document.createElementNS(SVG_NS, "g"); // your drawing, above the land
  ink.setAttribute("class", "ink");
  el.map.appendChild(ink);

  function svgEl(tag, cls, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    if (cls) n.setAttribute("class", cls);
    parent.appendChild(n);
    return n;
  }

  // The visible part of the map, in map units. The map's height follows the
  // continent's shape, within what fits on screen, and the view is widened to
  // the element's own shape so a map unit is square.
  let view = null, fitView = null;

  function setView(v) {
    view = v;
    el.map.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    sizeDots();
  }

  // Microstate dots and the point you tapped stay the same size on screen
  // at any zoom.
  function sizeDots() {
    const px = view.w / el.map.clientWidth; // map units per pixel
    for (const dot of el.map.querySelectorAll(".dot")) dot.setAttribute("r", String(4 * px));
    const tapped = ink.querySelector(".tap");
    if (tapped) tapped.setAttribute("r", String(6 * px));
  }

  const stacked = window.matchMedia("(max-width: 950px)");
  function layoutMap() {
    const b = cont().box;
    const w = el.map.clientWidth;
    const maxH = window.innerHeight * (stacked.matches ? 0.6 : 0.8);
    const h = Math.round(Math.max(w * 0.55, Math.min(maxH, (w * b.h) / b.w)));
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

  // Other continents' countries are drawn faded, so you know where to draw.
  // Land that isn't one of the 197 countries (Western Sahara, Greenland, …)
  // stays as it is.
  const regionOf = new Map(REGIONS.flatMap((r) => r.codes.map((code) => [code, r.id])));
  function paintContinent() {
    for (const [code, node] of mapNodes) {
      node.classList.toggle("area-off", regionOf.has(code) && regionOf.get(code) !== contId);
      node.classList.remove("answer", "pts-hi", "pts-mid", "pts-lo");
    }
    for (const r of (run && run.cont === contId ? run.results : [])) markDone(r);
  }

  // A country you've drawn keeps its real borders on the map, coloured by
  // how well you did. It's moved to the top so neighbours don't cover its
  // outline.
  function markDone({ code, pts }) {
    const node = mapNodes.get(code);
    node.classList.remove("answer");
    node.classList.add(pts >= 75 ? "pts-hi" : pts >= 40 ? "pts-mid" : "pts-lo");
    node.parentNode.insertBefore(node, ink);
  }

  // ---------- Drawing ----------

  function renderInk() {
    ink.textContent = "";
    for (const s of strokes) {
      const p = svgEl(s.length > 2 && s.closed ? "polygon" : "polyline", s.closed ? "loop" : "stroke", ink);
      p.setAttribute("points", s.map((q) => q.join(",")).join(" "));
    }
    if (tap) {
      const c = svgEl("circle", "tap", ink);
      c.setAttribute("cx", tap[0]); c.setAttribute("cy", tap[1]);
      sizeDots();
    }
    updateButtons();
  }

  function updateButtons() {
    const empty = !strokes.length && !tap;
    el.undo.disabled = revealed || empty;
    el.clear.disabled = revealed || empty;
    el.skip.disabled = revealed;
    el.done.disabled = !revealed && empty;
    el.done.textContent = revealed ? (run.results.length === run.order.length ? "See results" : "Next") : "Done";
  }

  // Pointer input: one finger or the mouse draws; two fingers, Shift-drag or
  // a right/middle-button drag move and zoom the map.
  const pointers = new Map(); // pointerId -> [clientX, clientY]
  let gesture = null;         // { kind: "draw" | "pan" | "pinch", ... }

  el.map.addEventListener("contextmenu", (e) => e.preventDefault());
  el.map.addEventListener("pointerdown", (e) => {
    if (!run || el.panel.hidden) return;
    e.preventDefault();
    try { el.map.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      if (gesture && gesture.kind === "draw") { strokes.pop(); renderInk(); }
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: toMap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
    } else if (pointers.size === 1) {
      if (e.shiftKey || e.button === 1 || e.button === 2 || revealed) {
        gesture = { kind: "pan", from: toMap(e.clientX, e.clientY) };
      } else {
        const s = [toMap(e.clientX, e.clientY)];
        strokes.push(s);
        gesture = { kind: "draw", stroke: s, last: [e.clientX, e.clientY], moved: 0, at: [e.clientX, e.clientY] };
        renderInk();
      }
    }
  });

  el.map.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (!gesture) return;
    if (gesture.kind === "draw") {
      const [lx, ly] = gesture.last;
      const d = Math.hypot(e.clientX - lx, e.clientY - ly);
      if (d < 2) return;
      gesture.moved += d;
      gesture.last = [e.clientX, e.clientY];
      gesture.stroke.push(toMap(e.clientX, e.clientY));
      const line = ink.lastElementChild && ink.lastElementChild.tagName === "polyline" ? ink.lastElementChild : null;
      if (line && !tap) line.setAttribute("points", gesture.stroke.map((q) => q.join(",")).join(" "));
      else renderInk();
    } else if (gesture.kind === "pan") {
      const [x, y] = toMap(e.clientX, e.clientY);
      setView(clampView({ ...view, x: view.x + gesture.from[0] - x, y: view.y + gesture.from[1] - y }));
    } else if (gesture.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      // scale about the original midpoint, then move it under the fingers
      const k = dist / gesture.dist;
      gesture.dist = dist;
      zoomAt(k, ...gesture.mid);
      const [mx, my] = toMap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      setView(clampView({ ...view, x: view.x + gesture.mid[0] - mx, y: view.y + gesture.mid[1] - my }));
    }
  });

  function pointerEnd(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (gesture && gesture.kind === "draw") finishStroke(gesture);
    // lifting one finger of a pinch leaves the other moving the map
    gesture = pointers.size === 1 && gesture && gesture.kind === "pinch"
      ? { kind: "pan", from: toMap(...[...pointers.values()][0]) } : null;
    if (!pointers.size) gesture = null;
  }
  el.map.addEventListener("pointerup", pointerEnd);
  el.map.addEventListener("pointercancel", (e) => {
    if (gesture && gesture.kind === "draw") { strokes.pop(); renderInk(); gesture = null; }
    pointerEnd(e);
  });

  function finishStroke(g) {
    strokes.pop(); // it's re-added below if it's a real loop
    if (isTap(current())) {
      // a tap (or a short scribble) marks a point
      if (g.moved < 12) tap = toMap(...g.at);
    } else if (g.stroke.length >= 3 && g.moved >= 12) {
      g.stroke.closed = true;
      strokes.push(g.stroke);
      el.feedback.textContent = "";
    }
    renderInk();
  }

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

  // ---------- Scoring ----------

  // Your drawing is compared with the real country by rasterizing both on a
  // canvas, keeping only land: the overlap divided by the combined area
  // (intersection over union). Drawing over the sea costs nothing; drawing
  // over a neighbour, or missing part of the country, does.
  const pathCache = new Map();
  const pathOf = (code) => {
    if (!pathCache.has(code)) pathCache.set(code, new Path2D(MAP_DATA.shapes[code].d));
    return pathCache.get(code);
  };
  const boxCache = new Map();
  function shapeBox(code) {
    if (boxCache.has(code)) return boxCache.get(code);
    // paths are "M x y", then relative "l dx dy" segments, then "Z"
    const re = /([Ml])([^MlZ]*)/g;
    let m, x = 0, y = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    while ((m = re.exec(MAP_DATA.shapes[code].d))) {
      const n = m[2].trim().split(/\s+/).map(Number);
      if (m[1] === "M") [x, y] = n;
      else { x += n[0]; y += n[1]; }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const b = { minX, minY, maxX, maxY };
    boxCache.set(code, b);
    return b;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function overlap(code, loops) {
    const cb = cont().box;
    const t = shapeBox(code);
    let minX = t.minX, minY = t.minY, maxX = t.maxX, maxY = t.maxY;
    for (const [x, y] of loops.flat()) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    // only the part of the map this continent shows
    minX = Math.max(minX, cb.x); minY = Math.max(minY, cb.y);
    maxX = Math.min(maxX, cb.x + cb.w); maxY = Math.min(maxY, cb.y + cb.h);
    if (maxX <= minX || maxY <= minY) return 0;
    const scale = RASTER / Math.max(maxX - minX, maxY - minY);
    const W = Math.max(1, Math.ceil((maxX - minX) * scale)), H = Math.max(1, Math.ceil((maxY - minY) * scale));
    canvas.width = W; canvas.height = H;

    function layer(paint) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
      ctx.fillStyle = "#000";
      paint();
      return ctx.getImageData(0, 0, W, H).data;
    }
    const land = layer(() => {
      for (const c of Object.keys(MAP_DATA.shapes)) {
        const b = shapeBox(c);
        if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY) ctx.fill(pathOf(c));
      }
    });
    const truth = layer(() => ctx.fill(pathOf(code), "evenodd")); // evenodd: holes such as Lesotho stay out
    const drawn = layer(() => {
      for (const loop of loops) {
        ctx.beginPath();
        loop.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
    });
    let inter = 0, union = 0;
    for (let i = 3; i < land.length; i += 4) {
      const T = truth[i] >= 128, D = drawn[i] >= 128 && land[i] >= 128;
      if (T && D) inter++;
      if (T || D) union++;
    }
    return union ? inter / union : 0;
  }

  // Points out of 100. A freehand outline never matches exactly, so 90%
  // overlap or better earns full marks, with a gentle curve below that.
  function drawPoints(iou) {
    return Math.round(100 * Math.pow(Math.min(1, iou / 0.9), 0.75));
  }

  // Microstates: full marks within about 40 km (1 map unit), nothing beyond
  // about 400 km.
  function tapPoints(code, [x, y]) {
    const [dx, dy] = MAP_DATA.dots[code];
    const d = Math.hypot(x - dx, y - dy);
    return Math.round(100 * Math.max(0, Math.min(1, 1 - (d - 1) / 9)));
  }

  function verdict(pts) {
    return pts >= 90 ? "Perfect!" : pts >= 75 ? "Great!" : pts >= 50 ? "Good" : pts >= 25 ? "Not quite" : "Way off";
  }

  // ---------- Game flow ----------

  function totalPts() { return run.results.reduce((s, r) => s + r.pts, 0); }

  function renderHeader() {
    if (!run) { el.progress.innerHTML = ""; el.score.textContent = ""; return; }
    const n = run.results.length + (revealed || run.results.length === run.order.length ? 0 : 1);
    el.progress.innerHTML = `${Math.min(n, run.order.length)}/${run.order.length}<small>${cont().name}</small>`;
    el.score.textContent = `${totalPts()} points`;
  }

  function showCountry() {
    const code = current();
    strokes = []; tap = null; revealed = false;
    const c = byCode.get(code);
    el.verb.textContent = isTap(code) ? "Tap where" : "Draw";
    el.name.textContent = isTap(code) ? `${c.name} is` : c.name;
    el.feedback.className = "info";
    el.feedback.textContent = isTap(code) ? `${c.name} is too small to draw — tap its location instead.` : "";
    el.hint.hidden = run.results.length > 2;
    renderInk();
    renderHeader();
  }

  function submit(skipped) {
    const code = current();
    let pts = 0;
    if (!skipped) pts = isTap(code) ? tapPoints(code, tap) : drawPoints(overlap(code, strokes));
    run.results.push({ code, pts });
    revealed = true;
    save();

    const node = mapNodes.get(code);
    node.classList.add("answer");
    node.parentNode.insertBefore(node, ink);
    el.feedback.className = pts >= 50 ? "ok" : skipped || pts < 25 ? "err" : "info";
    el.feedback.textContent = skipped
      ? `Skipped — ${byCode.get(code).name} is shown in green.`
      : `${pts} points — ${verdict(pts)}`;
    sound(skipped || pts < 25 ? "wrong" : pts >= 50 ? "correct" : "nomatch");
    renderInk();
    renderHeader();
  }

  function next() {
    markDone(run.results[run.results.length - 1]);
    if (run.results.length === run.order.length) finish(false);
    else showCountry();
  }

  function startGame() {
    run = { cont: contId, order: shuffled(cont().codes), results: [] };
    save();
    enterGame();
  }

  function enterGame() {
    el.start.hidden = true; el.end.hidden = true; el.panel.hidden = false;
    paintContinent();
    layoutMap();
    setView(fitView);
    if (run.results.length === run.order.length) finish(true);
    else showCountry();
  }

  function finish(resumed) {
    const total = totalPts(), max = run.order.length * 100;
    const prevBest = bestFor(run.cont);
    if (total > prevBest) {
      try { localStorage.setItem(`${BEST_KEY}:${run.cont}`, String(total)); } catch (e) {}
    }
    el.panel.hidden = true; el.end.hidden = false;
    el.finalScore.textContent = `${total} / ${max}`;
    el.finalPct.textContent = `${Math.round((100 * total) / max)}% accurate across ${run.order.length} countries` +
      (total > prevBest && prevBest ? " — a new best!" : prevBest ? ` · Your best: ${prevBest}` : "");
    el.results.textContent = "";
    for (const r of run.results.slice().sort((a, b) => b.pts - a.pts)) {
      const row = document.createElement("div");
      row.className = r.pts >= 75 ? "pts-hi" : r.pts >= 40 ? "pts-mid" : "pts-lo";
      row.innerHTML = "<span></span><b></b>";
      row.firstChild.textContent = byCode.get(r.code).name;
      row.lastChild.textContent = r.pts;
      el.results.appendChild(row);
    }
    renderHeader();
    if (!resumed) sound("complete");
    setView(fitView);
  }

  function showStart() {
    run = null; save();
    strokes = []; tap = null; revealed = false;
    el.start.hidden = false; el.panel.hidden = true; el.end.hidden = true;
    renderInk();
    renderContinents();
    renderHeader();
  }

  function renderContinents() {
    el.conts.textContent = "";
    for (const c of CONTINENTS) {
      const b = document.createElement("button");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-pressed", String(c.id === contId));
      b.setAttribute("aria-checked", String(c.id === contId));
      b.innerHTML = `${c.name}<small>${c.codes.length}</small>`;
      b.addEventListener("click", () => {
        contId = c.id;
        try { localStorage.setItem(CONT_KEY, contId); } catch (e) {}
        renderContinents();
      });
      el.conts.appendChild(b);
    }
    const best = bestFor(contId);
    el.startBest.textContent = best ? `Your best on ${cont().name}: ${best} / ${cont().codes.length * 100}` : "";
    paintContinent();
    layoutMap();
    setView(fitView);
  }

  // ---------- Controls ----------

  el.startBtn.addEventListener("click", startGame);
  el.playagain.addEventListener("click", startGame);
  el.changeCont.addEventListener("click", showStart);
  el.undo.addEventListener("click", () => {
    if (tap) tap = null; else strokes.pop();
    renderInk();
  });
  el.clear.addEventListener("click", () => { strokes = []; tap = null; renderInk(); });
  el.skip.addEventListener("click", () => { if (!revealed) submit(true); });
  el.done.addEventListener("click", () => {
    if (revealed) next();
    else if (strokes.length || tap) submit(false);
  });
  document.addEventListener("keydown", (e) => {
    if (!run || el.panel.hidden || e.target.closest("input, textarea")) return;
    if (e.key === "Enter" && !el.done.disabled && !e.target.closest("button")) { e.preventDefault(); el.done.click(); }
    else if ((e.key === "z" && (e.ctrlKey || e.metaKey)) || e.key === "Backspace") {
      if (!el.undo.disabled) { e.preventDefault(); el.undo.click(); }
    }
  });

  MapGame.setupMenu({ onReset: showStart });

  // Resume a saved game, or show the start screen.
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    if (saved && VIEWS[saved.cont] && Array.isArray(saved.order) && Array.isArray(saved.results) &&
        saved.order.every((c) => byCode.has(c)) && saved.results.length <= saved.order.length) {
      run = saved;
      contId = saved.cont;
    }
  } catch (e) {}
  if (run) enterGame(); else showStart();
})();
