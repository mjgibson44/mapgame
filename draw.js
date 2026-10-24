/* MapGame — Border Draw */
(function () {
  "use strict";

  const RUN_KEY = "mapgame-draw-run-v2"; // the map in progress, so a refresh resumes it
  const CONT_KEY = "mapgame-draw-continent";
  const BEST_KEY = "mapgame-draw-best";  // + ":" + continent id
  const PEN_KEY = "mapgame-draw-pen";    // "1" once a stylus has been used here
  const MAX_ZOOM = 12;                   // how far in you can zoom, relative to the whole continent
  const GRID_CELLS = 2.5e6;              // the land grid fills and scoring work on
  const SNAP_PX = 16;                    // a line ending this close to the coast or a border joins it

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
  // Microstates are only dots on this map: you tap where they are instead.
  const isDot = (code) => !!MAP_DATA.dots[code];

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    title: $("drawTitle"), score: $("drawScore"),
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

  function bestFor(id) {
    try { return Number(localStorage.getItem(`${BEST_KEY}:${id}`)) || 0; } catch (e) { return 0; }
  }

  // run = {
  //   cont, current: code you're drawing or null, result: null | { total, max, scores },
  //   order: [codes, as you started them],
  //   slots: [codes] — owner value v in the grid is slots[v - 1],
  //   lines: { code: [[[x, y], …], …] } — the borders you drew for it, in map units,
  //   taps: { code: [x, y] } — where you put each microstate,
  //   fills: the owner grid, run-length encoded
  // }
  let run = null;
  let state = "start"; // "start" | "draw" | "result"
  let actions = [];    // what you've done to the current country, for Undo
  let penMode = false; // a stylus has been used: it draws, and fingers only move the map
  try { penMode = localStorage.getItem(PEN_KEY) === "1"; } catch (e) {}

  const name = (code) => byCode.get(code).name;
  const linesOf = (code) => run.lines[code] || (run.lines[code] = []);
  const slotOf = (code) => {
    let i = run.slots.indexOf(code);
    if (i < 0) { run.slots.push(code); i = run.slots.length - 1; }
    return i + 1;
  };

  // ---------- The land grid ----------
  //
  // The continent is rasterized once into a grid of cells, each labelled with
  // the country it's in. Your countries live in a second grid, `owner`: a
  // fill floods out from where you tap, through land that's on this
  // continent, not yet anyone's and not on one of your lines. So the coast,
  // countries you've already filled and the faded land all act as borders —
  // you only draw the borders that aren't there yet.

  let grid = null;   // { b, R, W, H, label, codes, fillable }
  let owner = null;  // Uint8Array: 0 = nobody, v = run.slots[v - 1]
  let counts = null; // cells owned, per owner value

  const ringCache = new Map();
  function ringsOf(shape) {
    if (ringCache.has(shape)) return ringCache.get(shape);
    const rings = [];
    let ring = null, x = 0, y = 0, m;
    const re = /([Ml])([^MlZ]*)/g; // "M x y", then relative "l dx dy", then "Z"
    while ((m = re.exec(MAP_DATA.shapes[shape].d))) {
      const n = m[2].trim().split(/\s+/).map(Number);
      if (m[1] === "M") { [x, y] = n; ring = [[x, y]]; rings.push(ring); }
      else { x += n[0]; y += n[1]; ring.push([x, y]); }
    }
    ringCache.set(shape, rings);
    return rings;
  }

  const gridCache = new Map();
  function gridFor(id) {
    if (gridCache.has(id)) return gridCache.get(id);
    const b = VIEWS[id];
    const R = Math.sqrt(GRID_CELLS / (b.w * b.h)); // cells per map unit
    const W = Math.ceil(b.w * R), H = Math.ceil(b.h * R);
    const label = new Uint8Array(W * H);
    const codes = [null]; // label -> country code; 0 is the sea
    const idOf = new Map();
    // each country, filled row by row (even-odd, sampling cell centres)
    for (const shape of Object.keys(MAP_DATA.shapes)) {
      const code = PART_OF[shape] || shape;
      if (!idOf.has(code)) { idOf.set(code, codes.length); codes.push(code); }
      const v = idOf.get(code);
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
          if (z > a) label.fill(v, j * W + a, j * W + z);
        }
      }
    }
    // land you can fill: this continent's countries
    const ok = codes.map((c) => (c && byCode.has(c) && contOf(c) === id ? 1 : 0));
    const fillable = new Uint8Array(W * H);
    for (let i = 0; i < label.length; i++) fillable[i] = ok[label[i]];
    const g = { b, R, W, H, label, codes, fillable };
    gridCache.set(id, g);
    return g;
  }

  function cellOf([x, y]) {
    const { b, R, W, H } = grid;
    const cx = Math.floor((x - b.x) * R), cy = Math.floor((y - b.y) * R);
    return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx;
  }
  const cellCentre = (i) => [grid.b.x + ((i % grid.W) + 0.5) / grid.R, grid.b.y + (Math.floor(i / grid.W) + 0.5) / grid.R];

  // Marks every cell a line passes through (8-connected, so a fill can't
  // squeeze through it).
  function rasterLines(lines, mask) {
    const { b, R, W, H } = grid;
    for (const s of lines) {
      for (let k = 0; k + 1 < s.length || k === 0; k++) {
        const [x1, y1] = s[k], [x2, y2] = s[Math.min(k + 1, s.length - 1)];
        const X1 = (x1 - b.x) * R, Y1 = (y1 - b.y) * R, X2 = (x2 - b.x) * R, Y2 = (y2 - b.y) * R;
        const n = Math.max(1, Math.ceil(Math.hypot(X2 - X1, Y2 - Y1) * 2));
        for (let t = 0; t <= n; t++) {
          const X = Math.floor(X1 + ((X2 - X1) * t) / n), Y = Math.floor(Y1 + ((Y2 - Y1) * t) / n);
          if (X >= 0 && X < W && Y >= 0 && Y < H) mask[Y * W + X] = 1;
        }
        if (s.length < 2) break;
      }
    }
    return mask;
  }

  function encodeOwner() {
    const out = [];
    for (let i = 0; i < owner.length;) {
      const v = owner[i];
      let j = i + 1;
      while (j < owner.length && owner[j] === v) j++;
      out.push(v, j - i);
      i = j;
    }
    return out.join(",");
  }
  function decodeOwner(s) {
    const a = new Uint8Array(grid.W * grid.H);
    if (!s) return a;
    const nums = s.split(",").map(Number);
    for (let k = 0, i = 0; k + 1 < nums.length; k += 2) { a.fill(nums[k], i, i + nums[k + 1]); i += nums[k + 1]; }
    return a;
  }
  function recount() {
    counts = new Int32Array(256);
    for (let i = 0; i < owner.length; i++) counts[owner[i]]++;
  }

  function save() {
    try {
      if (run) {
        if (owner) run.fills = encodeOwner();
        localStorage.setItem(RUN_KEY, JSON.stringify(run));
      } else localStorage.removeItem(RUN_KEY);
    } catch (e) {}
  }

  const hasDrawing = (code) => (isDot(code) ? !!run.taps[code] : counts[slotOf(code)] > 0);
  const drawnCodes = () => run.order.filter(hasDrawing);

  // ---------- Map ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  const mapNodes = MapGame.buildMap(el.map);
  // your countries (a picture of the owner grid), then your lines, above the land
  const fillsImg = document.createElementNS(SVG_NS, "image");
  fillsImg.setAttribute("class", "fills");
  fillsImg.setAttribute("preserveAspectRatio", "none");
  el.map.appendChild(fillsImg);
  const ink = document.createElementNS(SVG_NS, "g");
  ink.setAttribute("class", "ink");
  el.map.appendChild(ink);

  // The visible part of the map, in map units. The view is always the
  // element's own shape, so a map unit is square.
  let view = null, fitView = null;

  function setView(v) {
    view = v;
    el.map.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
    // microstate dots and taps stay the same size on screen at any zoom
    const px = v.w / el.map.clientWidth;
    for (const dot of el.map.querySelectorAll(".dot")) dot.setAttribute("r", String(4 * px));
    for (const t of ink.querySelectorAll(".tap")) t.setAttribute("r", String(6 * px));
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
      node.classList.add(s.pts >= 75 ? "pts-hi" : s.pts >= 40 ? "pts-mid" : "pts-lo");
    }
  }

  // ---------- Your map ----------

  // The owner grid as a picture: each country you've filled is shaded, the
  // one you're on more strongly, with a dark edge wherever it meets land
  // that isn't its own. On the result only the edges are drawn.
  const canvas = document.createElement("canvas");
  let fillsUrl = null;
  function inkRGB() {
    const probe = document.createElement("span");
    probe.style.color = "var(--ink)";
    document.body.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/\d+/g).map(Number);
    probe.remove();
    return m;
  }
  function renderFills() {
    if (!grid || !owner) { fillsImg.removeAttribute("href"); return; }
    const { W, H, b, fillable } = grid;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    const [r, g, bl] = inkRGB();
    const rgba = (a) => ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0; // little-endian RGBA
    const cur = run.current && !isDot(run.current) ? run.slots.indexOf(run.current) + 1 : -1;
    const edgesOnly = state === "result";
    const EDGE = rgba(edgesOnly ? 235 : 215), CUR = rgba(80), DONE = rgba(34);
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) {
        const v = owner[i];
        if (!v) continue;
        const edge = (x > 0 && fillable[i - 1] && owner[i - 1] !== v) || (x < W - 1 && fillable[i + 1] && owner[i + 1] !== v) ||
          (y > 0 && fillable[i - W] && owner[i - W] !== v) || (y < H - 1 && fillable[i + W] && owner[i + W] !== v);
        if (edge) px[i] = EDGE;
        else if (!edgesOnly) px[i] = v === cur ? CUR : DONE;
      }
    }
    ctx.putImageData(img, 0, 0);
    fillsImg.setAttribute("x", b.x); fillsImg.setAttribute("y", b.y);
    fillsImg.setAttribute("width", W / grid.R); fillsImg.setAttribute("height", H / grid.R);
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (fillsUrl) URL.revokeObjectURL(fillsUrl);
      fillsUrl = URL.createObjectURL(blob);
      fillsImg.setAttribute("href", fillsUrl);
    });
  }

  const pointsAttr = (s) => s.map((p) => p.join(",")).join(" ");
  function svgEl(tag, cls, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    n.setAttribute("class", cls);
    parent.appendChild(n);
    return n;
  }

  // Your lines for the country you're on, and the microstates you've placed.
  // No names go on the map.
  function renderInk() {
    ink.textContent = "";
    if (run) {
      if (run.current && state === "draw") {
        for (const s of linesOf(run.current)) svgEl("polyline", "line", ink).setAttribute("points", pointsAttr(s));
      }
      for (const [code, [x, y]] of Object.entries(run.taps)) {
        const c = svgEl("circle", code === run.current ? "tap current" : "tap", ink);
        c.setAttribute("cx", x); c.setAttribute("cy", y);
      }
      if (view) setView(view);
    }
    updateControls();
  }

  function updateControls() {
    if (!run || state !== "draw") return;
    const cur = run.current;
    el.naming.hidden = !!cur;
    el.now.hidden = !cur;
    if (cur) el.nowName.textContent = name(cur);
    el.undo.disabled = !actions.length;
    el.clear.disabled = !cur || (!linesOf(cur).length && !hasDrawing(cur));
    el.next.disabled = !cur;
    const drawn = drawnCodes();
    el.done.disabled = !drawn.length;
    el.score.textContent = drawn.length ? `${drawn.length} drawn` : "";

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

  // ---------- Drawing a country ----------

  // A line that ends just short of the coast, a filled country or another of
  // your lines is extended to meet it, so the fill can't leak through the gap.
  function snapEnds(stroke) {
    const others = rasterLines(linesOf(run.current), new Uint8Array(grid.W * grid.H));
    const blocks = (i) => !grid.fillable[i] || owner[i] || others[i];
    const reach = Math.ceil(SNAP_PX * unitsPerPx() * grid.R);
    const nearest = (p) => {
      const i = cellOf(p);
      if (i < 0 || blocks(i)) return null; // already over the sea or a border
      const cx = i % grid.W, cy = Math.floor(i / grid.W);
      let best = null, bestD = Infinity;
      for (let dy = -reach; dy <= reach; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= grid.H) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const x = cx + dx, d = dx * dx + dy * dy;
          if (x < 0 || x >= grid.W || d >= bestD || d > reach * reach) continue;
          if (blocks(y * grid.W + x)) { bestD = d; best = y * grid.W + x; }
        }
      }
      return best === null ? null : cellCentre(best).map(round);
    };
    const a = nearest(stroke[0]), z = nearest(stroke[stroke.length - 1]);
    if (a) stroke.unshift(a);
    if (z) stroke.push(z);
    return stroke;
  }

  // Tap inside the country: floods the land your lines and the borders
  // around it enclose. Tapping a piece that's already this country's
  // removes it.
  function fillAt(p) {
    const code = run.current, v = slotOf(code);
    const start = cellOf(p);
    if (start < 0 || !grid.fillable[start]) {
      say(`That isn't land in ${cont().name} — tap inside ${name(code)}.`, "err");
      return;
    }
    const was = owner[start];
    if (was && was !== v) {
      say(`That's already ${name(run.slots[was - 1])}. To change it, pick ${name(run.slots[was - 1])} from the list below.`, "err");
      return;
    }
    const { W, H, fillable } = grid;
    const lines = rasterLines(linesOf(code), new Uint8Array(W * H));
    if (!was && lines[start]) { say("That's right on one of your lines — tap a little inside it."); return; }
    const N = W * H;
    const around = (i) => {
      const x = i % W;
      return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i + W < N ? i + W : -1];
    };
    // floods from `from` through cells that pass `ok`, giving them to `to`
    const cells = [];
    const flood = (from, ok, to) => {
      const stack = [from];
      owner[from] = to;
      while (stack.length) {
        const i = stack.pop();
        cells.push(i);
        for (const j of around(i)) if (j >= 0 && ok(j)) { owner[j] = to; stack.push(j); }
      }
    };
    if (was) {
      flood(start, (i) => owner[i] === v, 0);
    } else {
      // A line passing close to a border without touching it leaves a pinhole
      // a fill would leak through. So first flood only cells at least GAP
      // cells from any border (sealing those), then grow back GAP cells to
      // reach the borders.
      const GAP = 1;
      const free = (i) => fillable[i] && !owner[i] && !lines[i];
      let near = new Uint8Array(N);
      for (let i = 0; i < N; i++) near[i] = free(i) ? 0 : 1;
      for (let k = 0; k < GAP; k++) {
        const next = near.slice();
        for (let i = 0; i < N; i++) if (near[i]) for (const j of around(i)) if (j >= 0) next[j] = 1;
        near = next;
      }
      let seed = start;
      if (near[seed]) { // tapped close to a border: start from the nearest open cell
        seed = -1;
        const cx = start % W, cy = Math.floor(start / W);
        for (let r = 1; r <= 2 * GAP + 2 && seed < 0; r++) {
          for (let dy = -r; dy <= r && seed < 0; dy++) for (let dx = -r; dx <= r; dx++) {
            const x = cx + dx, y = cy + dy, i = y * W + x;
            if (x >= 0 && y >= 0 && x < W && y < H && !near[i] && free(i)) { seed = i; break; }
          }
        }
      }
      if (seed < 0) flood(start, free, v); // a sliver too thin to seal: fill it as it is
      else {
        flood(seed, (i) => !near[i] && free(i), v);
        let edge = cells.slice();
        for (let k = 0; k < GAP; k++) {
          const grown = [];
          for (const i of edge) for (const j of around(i)) if (j >= 0 && free(j)) { owner[j] = v; grown.push(j); cells.push(j); }
          edge = grown;
        }
      }
      // your line is the border: its cells next to the fill join the country
      for (const i of cells.slice()) {
        for (const j of around(i)) if (j >= 0 && lines[j] && fillable[j] && !owner[j]) { owner[j] = v; cells.push(j); }
      }
    }
    counts[v] += was ? -cells.length : cells.length;
    actions.push({ t: was ? "unfill" : "fill", v, cells: Int32Array.from(cells) });
    say(was ? `Removed that piece of ${name(code)}.`
      : `Filled. More pieces? Draw and tap them too. Then “Next country”.`);
    changed();
  }

  function changed() {
    disarmDone();
    save();
    renderFills();
    renderInk();
  }

  // ---------- Choosing a country ----------

  // Done with the current country: forget it if nothing was filled or placed.
  function putDown() {
    const cur = run.current;
    if (cur && !hasDrawing(cur)) {
      run.order = run.order.filter((c) => c !== cur);
      delete run.lines[cur];
    }
    run.current = null;
    actions = [];
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
    putDown();
    run.current = c.code;
    const fresh = !run.order.includes(c.code);
    if (fresh) run.order.push(c.code);
    if (isDot(c.code)) {
      say(`${c.name} is too small to draw on this map — tap where it is.`);
    } else if (fresh) {
      say(`Draw ${c.name}'s borders that aren't on the map yet — coast to coast, or up to a country you've ` +
        `drawn — then tap inside it to fill it.`);
    } else {
      say(`Fixing ${c.name}: tap a piece of it to remove it, or draw and tap to add more.`);
    }
    el.guess.value = "";
    closeSuggestions();
    el.guess.blur();
    save();
    renderFills();
    renderInk();
  }

  function nextCountry() {
    const cur = run.current;
    if (!cur) return;
    if (!isDot(cur) && linesOf(cur).length && !hasDrawing(cur)) {
      say(`Tap inside ${name(cur)} to fill it first — or Clear to drop it.`, "err");
      return;
    }
    putDown();
    say(`${drawnCodes().length} drawn. Which one next? When you think you've drawn them all, score your map.`);
    save();
    renderFills();
    renderInk();
    // on a touch screen, don't pop up the keyboard over the map unasked
    if (!window.matchMedia("(pointer: coarse)").matches) el.guess.focus();
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
  // Mouse: drag draws a line, a click fills; Shift-drag or a right/middle
  // button drag moves the map, and the wheel zooms. Touch: one finger draws
  // or taps, two move and zoom. Once a stylus (Apple Pencil) is used, the
  // stylus draws and taps and fingers only move and zoom the map — so a palm
  // resting on the screen never draws. Until you've said which country
  // you're drawing, any drag moves the map.

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
      const line = [at.map(round)];
      gesture = { kind: "draw", id: e.pointerId, pen: e.pointerType === "pen", touch: e.pointerType === "touch", line,
                  node: svgEl("polyline", "line", ink), last: [e.clientX, e.clientY], moved: 0 };
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
      gesture.line.push(toMap(ev.clientX, ev.clientY).map(round));
    }
    gesture.node.setAttribute("points", pointsAttr(gesture.line));
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
      if (cancelled) return;
      const code = run.current;
      if (g.moved < (g.touch ? 8 : 3)) {
        // a tap: fill (or place a microstate)
        if (isDot(code)) {
          actions.push({ t: "tap", prev: run.taps[code] || null });
          run.taps[code] = g.line[0];
          say(`Placed ${name(code)}. Tap again to move it, or “Next country”.`);
          changed();
        } else fillAt(g.line[0]);
        return;
      }
      if (isDot(code)) { say(`${name(code)} is too small to draw — just tap where it is.`); return; }
      linesOf(code).push(snapEnds(g.line));
      actions.push({ t: "line" });
      changed();
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
      ? "Apple Pencil draws and taps. One finger moves the map, two fingers zoom."
      : coarse
        ? "One finger draws and taps; two fingers move and zoom. With an Apple Pencil, the Pencil draws and fingers move the map."
        : "Drag to draw a border, click to fill. Scroll to zoom; Shift-drag or right-drag to move the map.";
  }

  // ---------- Scoring ----------
  //
  // Each country's filled area is compared with the real country, cell by
  // cell on the land grid: the overlap divided by the combined area
  // (intersection over union). 90% overlap or better is full marks, with a
  // gentle curve below that; countries you didn't draw score 0.

  const drawPoints = (iou) => Math.round(100 * Math.pow(Math.min(1, iou / 0.9), 0.75));

  // Microstates: full marks within about 40 km (1 map unit) of where you
  // tapped, nothing beyond about 400 km.
  function dotPoints(code, [x, y]) {
    const [dx, dy] = MAP_DATA.dots[code];
    return Math.round(100 * Math.max(0, Math.min(1, 1 - (Math.hypot(x - dx, y - dy) - 1) / 9)));
  }

  function scoreMap() {
    const { label, codes } = grid;
    const realN = new Map(), mineN = new Map(), both = new Map();
    const add = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (let i = 0; i < label.length; i++) {
      const real = codes[label[i]], v = owner[i];
      if (real) add(realN, real);
      if (v) {
        const mine = run.slots[v - 1];
        add(mineN, mine);
        if (mine === real) add(both, mine);
      }
    }
    const scores = {};
    let total = 0;
    for (const code of cont().codes) {
      let s;
      if (isDot(code)) s = run.taps[code] ? { pts: dotPoints(code, run.taps[code]), drawn: true } : { pts: 0, drawn: false };
      else if (!mineN.get(code)) s = { pts: 0, drawn: false };
      else {
        const inter = both.get(code) || 0;
        const iou = inter / (mineN.get(code) + (realN.get(code) || 0) - inter);
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
    fillsImg.classList.toggle("faded", s === "result" && !el.showLines.checked);
    ink.classList.toggle("result", s === "result");
    paintMap();
    renderFills();
    renderInk();
    renderHeader();
    view = null;
    layoutMap();
  }

  function renderHeader() {
    el.title.innerHTML = state === "start" ? "Border Draw" : `Border Draw<small>${cont().name}</small>`;
    el.score.textContent = state === "result" ? `${run.result.total} / ${run.result.max}`
      : state === "draw" && drawnCodes().length ? `${drawnCodes().length} drawn` : "";
  }

  function loadGrid() {
    grid = gridFor(run.cont);
    owner = decodeOwner(run.fills);
    recount();
  }

  function startDrawing(fresh) {
    if (fresh || !run || run.cont !== contId) {
      run = { cont: contId, current: null, result: null, order: [], slots: [], lines: {}, taps: {}, fills: null };
    }
    actions = [];
    loadGrid();
    save();
    updateHint();
    window.scrollTo(0, 0);
    setState("draw");
    if (run.current) say(`Drawing ${name(run.current)}.`);
    else say(run.order.length ? `${drawnCodes().length} drawn. Which one next?`
      : "Type the country you're going to draw first.");
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
      el.done.textContent = "Drawn them all? Tap again";
      armTimer = setTimeout(disarmDone, 4000);
      return;
    }
    disarmDone();
    putDown();
    run.result = scoreMap();
    save();
    showResult(true);
  });

  function showResult(fresh) {
    const { total, max, scores } = run.result;
    const prevBest = bestFor(run.cont);
    if (fresh && total > prevBest) {
      try { localStorage.setItem(`${BEST_KEY}:${run.cont}`, String(total)); } catch (e) {}
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

  function pick(code) {
    for (const node of el.map.querySelectorAll(".picked")) node.classList.remove("picked");
    for (const [c, node] of mapNodes) if ((PART_OF[c] || c) === code) {
      node.classList.add("picked");
      node.parentNode.insertBefore(node, fillsImg); // on top, so its whole outline shows
    }
    const s = run.result.scores[code];
    el.pickInfo.className = s.pts >= 50 ? "ok" : "err";
    el.pickInfo.textContent = !s.drawn ? `${name(code)}: not drawn — 0 points`
      : s.overlap === undefined ? `${name(code)}: ${s.pts} points, for where you put it`
      : `${name(code)}: ${s.pts} points — your area overlaps it ${s.overlap}%`;
  }

  function showStart() {
    run = null; owner = null; grid = null;
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
  el.undo.addEventListener("click", () => {
    const a = actions.pop();
    if (!a) return;
    const code = run.current;
    if (a.t === "line") linesOf(code).pop();
    else if (a.t === "tap") { if (a.prev) run.taps[code] = a.prev; else delete run.taps[code]; }
    else if (a.t === "fill" || a.t === "unfill") {
      const to = a.t === "fill" ? 0 : a.v;
      for (const i of a.cells) owner[i] = to;
      counts[a.v] += a.t === "fill" ? -a.cells.length : a.cells.length;
    } else if (a.t === "clear") {
      run.lines[code] = a.lines;
      if (a.tap) run.taps[code] = a.tap;
      for (const i of a.cells) owner[i] = a.v;
      counts[a.v] += a.cells.length;
    }
    changed();
  });
  el.clear.addEventListener("click", () => {
    const code = run.current;
    if (!code) return;
    const v = slotOf(code), cells = [];
    for (let i = 0; i < owner.length; i++) if (owner[i] === v) { owner[i] = 0; cells.push(i); }
    counts[v] = 0;
    actions.push({ t: "clear", v, cells: Int32Array.from(cells), lines: linesOf(code), tap: run.taps[code] || null });
    run.lines[code] = [];
    delete run.taps[code];
    say(`Cleared ${name(code)}.`);
    changed();
  });
  el.next.addEventListener("click", nextCountry);
  el.showLines.addEventListener("change", () => fillsImg.classList.toggle("faded", !el.showLines.checked));
  document.addEventListener("keydown", (e) => {
    if (state !== "draw" || e.target.closest("input, textarea")) return;
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.undo.click(); }
    else if (e.key === "Enter" && !e.target.closest("button") && !el.next.disabled) { e.preventDefault(); nextCountry(); }
  });

  MapGame.setupMenu({ onReset: showStart });

  // Resume a saved map (drawing or scored), or show the start screen.
  try {
    localStorage.removeItem("mapgame-draw-run"); // the earlier outline-only format
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) || "null");
    if (saved && VIEWS[saved.cont] && Array.isArray(saved.order) && Array.isArray(saved.slots) &&
        saved.lines && saved.taps && saved.order.every((c) => byCode.has(c))) {
      run = saved;
      contId = saved.cont;
    }
  } catch (e) {}
  if (run && run.result) { loadGrid(); showResult(false); }
  else if (run) startDrawing(false);
  else showStart();
})();
