/* MapGame — Border Draw */
(function () {
  "use strict";

  const RUN_KEY = "mapgame-draw-run";    // the map in progress, so a refresh resumes it
  const CONT_KEY = "mapgame-draw-continent";
  const BEST_KEY = "mapgame-draw-best";  // + ":" + continent id (+ ":guided")
  const STYLE_KEY = "mapgame-draw-style"; // "free" (you name each country) or "guided" (the game does)
  const PEN_KEY = "mapgame-draw-pen";    // "1" once a stylus has been used here
  const MAX_ZOOM = 12;                   // how far in you can zoom, relative to the whole continent
  const RASTER = 400;                    // scoring resolution: cells along the longer side

  const { lookup, sound } = MapGame;

  // The four continents, from the Streak Mode map areas (Asia includes
  // Australia), each with the part of the map to show: Russia is cut off east
  // of the Urals, and France's overseas territories fall outside Europe.
  // The island microstates (Streak's Global Islands) aren't part of this
  // mode; they're shown faded, like the other continents.
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
    styles: $("styles"), styleHint: $("styleHint"),
    start: $("startPanel"), conts: $("continents"), startBest: $("startBest"), startBtn: $("startBtn"),
    toolbar: $("toolbar"), naming: $("naming"), guess: $("guess"), sug: $("suggestions"),
    now: $("drawingNow"), nowName: $("nowName"), undo: $("undoBtn"), clear: $("clearBtn"), next: $("nextBtn"),
    done: $("doneBtn"), feedback: $("feedback"), hint: $("drawHint"), drawnList: $("drawnList"),
    end: $("endscreen"), finalScore: $("finalScore"), finalPct: $("finalPct"), showLines: $("showLines"),
    pickInfo: $("pickInfo"), results: $("results"),
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

  // Two ways to play: "free" — you name each country you draw, and nothing
  // says how many are left; "guided" — the game names every country of the
  // continent in turn. Each keeps its own best score.
  const STYLES = [
    { id: "free", label: "You name them", hint: "Type each country you draw. Nothing tells you how many are left — knowing when you've drawn them all is part of the game." },
    { id: "guided", label: "Game names them", hint: "The game gives you every country of the continent, one at a time, each next to ones you've drawn where it can. Your map is scored when you've done them all." },
  ];
  let style = "free";
  try { if (localStorage.getItem(STYLE_KEY) === "guided") style = "guided"; } catch (e) {}

  const bestKey = (id, guided) => `${BEST_KEY}:${id}${guided ? ":guided" : ""}`;
  function bestFor(id, guided) {
    try { return Number(localStorage.getItem(bestKey(id, guided))) || 0; } catch (e) { return 0; }
  }

  // run = { cont, order: [codes, as you drew them], drawings: { code: [loop, …] },
  //         current: code you're drawing or null, result: null | { total, max, scores },
  //         guided: the game names the countries; queue: [codes] it hasn't given you yet }
  // A loop is a closed outline, as [[x, y], …] in map units.
  let run = null;
  let state = "start"; // "start" | "draw" | "result"
  let penMode = false; // a stylus has been used: it draws, and fingers only move the map
  try { penMode = localStorage.getItem(PEN_KEY) === "1"; } catch (e) {}

  function save() {
    try {
      if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
      else localStorage.removeItem(RUN_KEY);
    } catch (e) {}
  }

  const name = (code) => byCode.get(code).name;
  const loopsOf = (code) => run.drawings[code] || [];
  const drawnCodes = () => run.order.filter((c) => loopsOf(c).length);

  // ---------- Map ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  const mapNodes = MapGame.buildMap(el.map);
  const ink = document.createElementNS(SVG_NS, "g"); // your outlines, above the land
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
      node.classList.add(s.pts >= 75 ? "pts-hi" : s.pts >= 40 ? "pts-mid" : "pts-lo");
    }
  }

  // ---------- Your outlines ----------

  const pointsAttr = (s) => s.map((p) => p.join(",")).join(" ");
  function svgEl(tag, cls, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    n.setAttribute("class", cls);
    parent.appendChild(n);
    return n;
  }

  // Each country you've drawn is a group of filled loops; the one you're
  // drawing now is highlighted. No names go on the map.
  function renderInk() {
    ink.textContent = "";
    if (run) {
      for (const code of run.order) {
        const g = svgEl("g", code === run.current ? "shape current" : "shape", ink);
        g.setAttribute("data-for", code);
        for (const loop of loopsOf(code)) svgEl("polygon", "loop", g).setAttribute("points", pointsAttr(loop));
      }
    }
    updateControls();
  }

  function updateControls() {
    if (!run || state !== "draw") return;
    const cur = run.current;
    el.naming.hidden = !!cur || !!run.guided;
    el.now.hidden = !cur;
    if (cur) el.nowName.textContent = name(cur);
    el.undo.disabled = !cur || !loopsOf(cur).length;
    el.clear.disabled = el.undo.disabled;
    el.next.disabled = !cur; // with nothing drawn, it just puts the country down
    // given a country you'd rather not draw, Next skips it
    el.next.textContent = run.guided && cur && !loopsOf(cur).length ? "Skip ›" : "Next country ›";
    const drawn = drawnCodes();
    el.done.disabled = !drawn.length;
    const total = cont().codes.length;
    el.score.textContent = run.guided ? `${total - run.queue.length} of ${total}`
      : drawn.length ? `${drawn.length} drawn` : "";

    // the countries you've drawn so far — tap one to fix it
    el.drawnList.hidden = !run.order.length;
    el.drawnList.textContent = "";
    for (const code of run.order) {
      const b = document.createElement("button");
      b.textContent = name(code);
      if (code === cur) b.className = "current";
      b.addEventListener("click", () => choose(byCode.get(code)));
      el.drawnList.appendChild(b);
    }
  }

  function say(text, kind) {
    el.feedback.className = `${kind || "info"} draw-note`;
    el.feedback.textContent = text;
  }

  // ---------- Choosing a country ----------

  // Done with the current country: forget it if nothing was drawn.
  function putDown() {
    const cur = run.current;
    if (cur && !loopsOf(cur).length) {
      delete run.drawings[cur];
      run.order = run.order.filter((c) => c !== cur);
    }
    run.current = null;
  }

  function choose(c) {
    if (contOf(c.code) !== contId) {
      say(`${c.name} isn't part of ${cont().name} on this map.`, "err");
      sound("nomatch");
      wiggle();
      return;
    }
    if (c.code === run.current) return;
    disarmDone();
    // guided: reopening an earlier country puts the one you were given back first in line
    if (run.guided && run.current && !loopsOf(run.current).length) run.queue.unshift(run.current);
    putDown();
    run.current = c.code;
    if (!run.drawings[c.code]) {
      run.drawings[c.code] = [];
      run.order.push(c.code);
      say(`Draw ${c.name}: loop around it. In pieces? Draw a loop for each. Then “Next country”.`);
    } else {
      say(`Fixing ${c.name}: add loops, or Clear to start it again.`);
    }
    el.guess.value = "";
    closeSuggestions();
    el.guess.blur();
    save();
    renderInk();
  }

  function nextCountry() {
    if (!run.current) return;
    putDown();
    if (run.guided) { giveNext(); return; }
    say(`${drawnCodes().length} drawn. Which one next? When you think you've drawn them all, score your map.`);
    save();
    renderInk();
    // on a touch screen, don't pop up the keyboard over the map unasked
    if (!window.matchMedia("(pointer: coarse)").matches) el.guess.focus();
  }

  // Guided: the order the game gives countries in. It starts on a random
  // country and walks from neighbour to neighbour — next is one bordering the
  // latest country given, or else the one before it, and so on — so you work
  // across the continent rather than jumping around it. Countries count as
  // neighbours when their outlines come within a fraction of a map unit;
  // microstates neighbour the country they sit in.
  function guidedOrder() {
    const codes = cont().codes;
    const cellOf = (x, y) => `${Math.floor(x / 0.4)},${Math.floor(y / 0.4)}`;
    const near = new Map(); // grid cell -> codes with a vertex in it or next to it
    const re = /([Ml])([^MlZ]*)/g;
    for (const code of codes) {
      for (const shape of Object.keys(MAP_DATA.shapes).filter((sh) => (PART_OF[sh] || sh) === code)) {
        let m, x = 0, y = 0;
        re.lastIndex = 0;
        while ((m = re.exec(MAP_DATA.shapes[shape].d))) {
          const n = m[2].trim().split(/\s+/).map(Number);
          if (m[1] === "M") [x, y] = n; else { x += n[0]; y += n[1]; }
          for (const dx of [-0.4, 0, 0.4]) for (const dy of [-0.4, 0, 0.4]) {
            const k = cellOf(x + dx, y + dy);
            if (!near.has(k)) near.set(k, new Set());
            near.get(k).add(code);
          }
        }
      }
    }
    const adj = new Map(codes.map((c) => [c, new Set()]));
    const link = (a, b) => { if (a !== b) { adj.get(a).add(b); adj.get(b).add(a); } };
    for (const set of near.values()) for (const a of set) for (const b of set) link(a, b);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of codes) {
      if (!MAP_DATA.dots[c]) continue;
      const [x, y] = MAP_DATA.dots[c];
      const host = codes.find((h) => MAP_DATA.shapes[h] && ctx.isPointInPath(pathOf(h), x, y));
      if (host) link(c, host);
    }
    const left = new Set(codes), order = [];
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    while (left.size) {
      let next = null;
      for (let k = order.length - 1; k >= 0 && !next; k--) {
        const n = [...adj.get(order[k])].filter((c) => left.has(c));
        if (n.length) next = pick(n);
      }
      // to start, or after an island: a fresh random country — with
      // neighbours if any are left, and not a microstate
      if (!next) {
        const big = [...left].filter((c) => !MAP_DATA.dots[c]);
        const joined = big.filter((c) => [...adj.get(c)].some((n) => left.has(n)));
        next = pick(joined.length ? joined : big.length ? big : [...left]);
      }
      order.push(next);
      left.delete(next);
    }
    return order;
  }

  // Guided: gives you the next country, or scores the map when there are none left.
  function giveNext() {
    if (!run.queue.length) {
      say("That's every country — scoring your map…");
      setTimeout(() => {
        run.result = scoreMap();
        save();
        showResult(true);
      }, 30);
      return;
    }
    choose(byCode.get(run.queue.shift()));
  }

  function wiggle() {
    el.guess.classList.remove("shake");
    void el.guess.offsetWidth; // restart animation
    el.guess.classList.add("shake");
  }

  // Autocomplete: one suggestion at a time, after 3 letters, from all 197
  // countries — limiting it to the continent would give the answers away.
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
    d.addEventListener("mousedown", (e) => { e.preventDefault(); choose(chosen); });
    el.sug.appendChild(d);
    el.sug.classList.add("open");
  }
  function closeSuggestions() {
    sug = null;
    el.sug.classList.remove("open");
    el.sug.innerHTML = "";
  }
  el.guess.addEventListener("input", () => {
    sug = MapGame.suggest(el.guess.value, COUNTRIES);
    renderSuggestions();
  });
  el.guess.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const c = sug ? sug.c : lookup.get(MapGame.normalize(el.guess.value));
      if (c) choose(c);
      else if (el.guess.value.trim()) {
        sound("nomatch");
        say(`“${el.guess.value.trim()}” isn't a country we recognize.`);
        wiggle();
      }
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });
  el.guess.addEventListener("blur", () => setTimeout(closeSuggestions, 150));

  // ---------- Pointer input ----------
  //
  // Mouse: drag draws; Shift-drag or a right/middle-button drag moves the
  // map, and the wheel zooms. Touch: one finger draws, two move and zoom.
  // Once a stylus (Apple Pencil) is used, the stylus draws and fingers only
  // move and zoom the map — so a palm resting on the screen never draws.
  // Until you've said which country you're drawing, any drag moves the map.

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
    const at = toMap(e.clientX, e.clientY);
    const moveMap = e.shiftKey || e.button === 1 || e.button === 2 ||
      (penMode && e.pointerType === "touch") || state !== "draw" || !run.current;
    if (moveMap) {
      gesture = { kind: "pan", id: e.pointerId, from: at, start: [e.clientX, e.clientY], tap: true };
    } else {
      const loop = [at.map(round)];
      const group = ink.querySelector(".shape.current") || ink;
      gesture = { kind: "draw", id: e.pointerId, pen: e.pointerType === "pen", loop,
                  node: svgEl("polyline", "stroke", group), last: [e.clientX, e.clientY], moved: 0 };
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
      const d = Math.hypot(ev.clientX - gesture.last[0], ev.clientY - gesture.last[1]);
      if (d < 1.5) continue;
      gesture.moved += d;
      gesture.last = [ev.clientX, ev.clientY];
      gesture.loop.push(toMap(ev.clientX, ev.clientY).map(round));
    }
    gesture.node.setAttribute("points", pointsAttr(gesture.loop));
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
      g.node.remove();
      if (cancelled || g.moved < 12 || g.loop.length < 3) return;
      run.drawings[run.current].push(g.loop); // closed into a loop
      disarmDone();
      save();
      renderInk();
    } else if (g.tap && !cancelled && state === "result") {
      pickAt(e.clientX, e.clientY); // a tap on the result: which country is that?
    } else if (g.tap && !cancelled && state === "draw" && !run.current) {
      say("First type which country you're drawing.");
      wiggle();
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

  // Each outline is compared with the real country by rasterizing both on a
  // canvas, keeping only land: the overlap divided by the combined area
  // (intersection over union). Drawing over the sea costs nothing; drawing
  // over a neighbour, or missing part of the country, does.
  const pathCache = new Map();
  const pathOf = (shape) => {
    if (!pathCache.has(shape)) pathCache.set(shape, new Path2D(MAP_DATA.shapes[shape].d));
    return pathCache.get(shape);
  };
  const shapesOf = (code) => Object.keys(MAP_DATA.shapes).filter((s) => (PART_OF[s] || s) === code);
  const boxCache = new Map();
  function shapeBox(shape) {
    if (boxCache.has(shape)) return boxCache.get(shape);
    // paths are "M x y", then relative "l dx dy" segments, then "Z"
    const re = /([Ml])([^MlZ]*)/g;
    let m, x = 0, y = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    while ((m = re.exec(MAP_DATA.shapes[shape].d))) {
      const n = m[2].trim().split(/\s+/).map(Number);
      if (m[1] === "M") [x, y] = n;
      else { x += n[0]; y += n[1]; }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const b = { minX, minY, maxX, maxY };
    boxCache.set(shape, b);
    return b;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function overlap(code, loops) {
    const cb = cont().box;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of [...loops.flat(), ...shapesOf(code).flatMap((s) => {
      const b = shapeBox(s);
      return [[b.minX, b.minY], [b.maxX, b.maxY]];
    })]) {
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
      for (const s of Object.keys(MAP_DATA.shapes)) {
        const b = shapeBox(s);
        if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY) ctx.fill(pathOf(s));
      }
    });
    // evenodd: holes such as Lesotho stay out
    const truth = layer(() => { for (const s of shapesOf(code)) ctx.fill(pathOf(s), "evenodd"); });
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
  const drawPoints = (iou) => Math.round(100 * Math.pow(Math.min(1, iou / 0.9), 0.75));

  // Microstates are dots on this map: they're scored on where your loop is
  // centred — full marks within about 40 km (1 map unit), nothing beyond
  // about 400 km.
  function dotPoints(code, loops) {
    const pts = loops.flat();
    const x = pts.reduce((s, p) => s + p[0], 0) / pts.length, y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const [dx, dy] = MAP_DATA.dots[code];
    return Math.round(100 * Math.max(0, Math.min(1, 1 - (Math.hypot(x - dx, y - dy) - 1) / 9)));
  }

  function scoreMap() {
    const scores = {};
    let total = 0;
    for (const code of cont().codes) {
      const loops = loopsOf(code);
      let s;
      if (!loops.length) s = { pts: 0, drawn: false };
      else if (MAP_DATA.dots[code]) s = { pts: dotPoints(code, loops), drawn: true };
      else {
        const iou = overlap(code, loops);
        s = { pts: drawPoints(iou), overlap: Math.round(100 * iou), drawn: true };
      }
      scores[code] = s;
      total += s.pts;
    }
    return { total, max: cont().codes.length * 100, scores };
  }

  // ---------- Game flow ----------

  function setState(s) {
    state = s;
    document.body.classList.toggle("drawing", s === "draw");
    el.start.hidden = s !== "start";
    el.end.hidden = s !== "result";
    el.toolbar.hidden = s !== "draw";
    el.hint.hidden = s !== "draw";
    el.feedback.hidden = s !== "draw";
    el.drawnList.hidden = s !== "draw" || !run.order.length;
    ink.classList.toggle("faded", s === "result" && !el.showLines.checked);
    ink.classList.toggle("result", s === "result");
    paintMap();
    renderInk();
    renderHeader();
    view = null;
    layoutMap();
  }

  function renderHeader() {
    el.title.innerHTML = state === "start" ? "Border Draw" : `Border Draw<small>${cont().name}</small>`;
    if (state === "result") el.score.textContent = `${run.result.total} / ${run.result.max}`;
    else if (state === "draw") updateControls(); // it keeps the count up to date
    else el.score.textContent = "";
  }

  function startDrawing(fresh) {
    if (fresh || !run || run.cont !== contId) {
      run = { cont: contId, order: [], drawings: {}, current: null, result: null, guided: style === "guided", queue: null };
      if (run.guided) run.queue = guidedOrder();
    }
    save();
    updateHint();
    window.scrollTo(0, 0);
    setState("draw");
    if (run.current) say(`Drawing ${name(run.current)}.`);
    else if (run.guided) giveNext();
    else say(run.order.length ? `${drawnCodes().length} drawn. Which one next?`
      : "Type the country you're going to draw first, then draw its outline on the map.");
  }

  // Scoring can't be undone, so "Score my map" asks for a second tap.
  let armTimer = null;
  function disarmDone() {
    clearTimeout(armTimer);
    el.done.classList.remove("armed");
    el.done.textContent = "Score my map";
  }
  el.done.addEventListener("click", () => {
    if (!drawnCodes().length) return;
    if (!el.done.classList.contains("armed")) {
      el.done.classList.add("armed");
      el.done.textContent = run.guided && run.queue.length ? "Finish early? Tap again" : "Drawn them all? Tap again";
      armTimer = setTimeout(disarmDone, 4000);
      return;
    }
    disarmDone();
    putDown();
    el.done.textContent = "Scoring…";
    el.done.disabled = true;
    setTimeout(() => {                 // let "Scoring…" paint first
      run.result = scoreMap();
      save();
      showResult(true);
    }, 30);
  });

  function showResult(fresh) {
    const { total, max, scores } = run.result;
    const prevBest = bestFor(run.cont, run.guided);
    if (fresh && total > prevBest) {
      try { localStorage.setItem(bestKey(run.cont, run.guided), String(total)); } catch (e) {}
    }
    setState("result");
    const pct = Math.round((100 * total) / max);
    const n = Object.keys(scores).length, drawn = Object.values(scores).filter((s) => s.drawn).length;
    el.finalScore.textContent = `${pct}%`;
    el.finalPct.textContent = `${total} of ${max} points · you drew ${drawn} of ${n} countries` +
      (fresh && total > prevBest && prevBest ? " — a new best!" : prevBest ? ` · Your best: ${Math.max(prevBest, total)}` : "");
    el.pickInfo.className = "info";
    el.pickInfo.textContent = "Tap a country on the map to see how you did.";

    el.results.textContent = "";
    const list = Object.entries(scores).sort((a, b) => b[1].pts - a[1].pts || name(a[0]).localeCompare(name(b[0])));
    for (const [code, s] of list) {
      const row = document.createElement("button");
      row.className = (s.pts >= 75 ? "pts-hi" : s.pts >= 40 ? "pts-mid" : "pts-lo") + (s.drawn ? "" : " missed");
      row.innerHTML = "<span></span><b></b>";
      row.firstChild.textContent = name(code);
      row.lastChild.textContent = s.drawn ? s.pts : "not drawn";
      row.addEventListener("click", () => pick(code));
      el.results.appendChild(row);
    }
    if (fresh) sound(pct >= 50 ? "complete" : "gameover");
  }

  function pickAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const node = hit && hit.closest && hit.closest("[data-code]");
    const code = node && node.getAttribute("data-code");
    if (code && contOf(code) === contId) pick(PART_OF[code] || code);
  }

  // Highlights a country on the result, with your outline for it.
  function pick(code) {
    for (const node of el.map.querySelectorAll(".picked")) node.classList.remove("picked");
    for (const [c, node] of mapNodes) if ((PART_OF[c] || c) === code) {
      node.classList.add("picked");
      node.parentNode.insertBefore(node, ink); // on top, so its whole outline shows
    }
    const mine = ink.querySelector(`[data-for="${code}"]`);
    if (mine) mine.classList.add("picked");
    const s = run.result.scores[code];
    el.pickInfo.className = s.pts >= 50 ? "ok" : "err";
    el.pickInfo.textContent = !s.drawn ? `${name(code)}: not drawn — 0 points`
      : s.overlap === undefined ? `${name(code)}: ${s.pts} points, for where you put it`
      : `${name(code)}: ${s.pts} points — your outline overlaps it ${s.overlap}% (on land)`;
  }

  function showStart() {
    run = null;
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
    el.styles.textContent = "";
    for (const st of STYLES) {
      const b = document.createElement("button");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-pressed", String(st.id === style));
      b.setAttribute("aria-checked", String(st.id === style));
      b.textContent = st.label;
      b.addEventListener("click", () => {
        style = st.id;
        try { localStorage.setItem(STYLE_KEY, style); } catch (e) {}
        renderContinents();
      });
      el.styles.appendChild(b);
    }
    el.styleHint.textContent = STYLES.find((st) => st.id === style).hint;
    const best = bestFor(contId, style === "guided");
    el.startBest.textContent = best ? `Your best on ${cont().name}: ${best} points` : "";
  }

  // ---------- Controls ----------

  el.startBtn.addEventListener("click", () => startDrawing(true));
  el.playagain.addEventListener("click", () => startDrawing(true));
  el.changeCont.addEventListener("click", showStart);
  el.undo.addEventListener("click", () => {
    if (!run.current || !loopsOf(run.current).length) return;
    run.drawings[run.current].pop();
    disarmDone();
    save();
    renderInk();
  });
  el.clear.addEventListener("click", () => {
    if (!run.current) return;
    run.drawings[run.current] = [];
    disarmDone();
    save();
    renderInk();
  });
  el.next.addEventListener("click", nextCountry);
  el.showLines.addEventListener("change", () => ink.classList.toggle("faded", !el.showLines.checked));
  document.addEventListener("keydown", (e) => {
    if (state !== "draw" || e.target.closest("input, textarea")) return;
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.undo.click(); }
    else if (e.key === "Enter" && !e.target.closest("button") && !el.next.disabled) { e.preventDefault(); nextCountry(); }
  });

  MapGame.setupMenu({ onReset: showStart });

  // Resume a saved map (drawing or scored), or show the start screen.
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    if (saved && VIEWS[saved.cont] && Array.isArray(saved.order) && saved.drawings &&
        saved.order.every((c) => byCode.has(c))) {
      run = saved;
      contId = saved.cont;
    }
  } catch (e) {}
  if (run && run.result) showResult(false);
  else if (run) startDrawing(false);
  else showStart();
})();
