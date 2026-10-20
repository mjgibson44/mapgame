// Builds map-detail.js: detailed (Natural Earth 10m) outlines of the small
// island countries for Streak Mode's close-up inset, in the same projection
// as map-data.js. Each entry has the country's outline, the other land in its
// close-up box (so neighbouring islands show too), the box, and a spot on
// the biggest island for the main map to circle.
//
//   npm install d3-geo@3
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//   node make-map-detail.mjs <dir with the .geojson files> > ../map-detail.js
import * as d3 from "d3-geo";
import fs from "fs";

// Island countries too small to see at Streak Mode's zoom: those drawn as
// dots on the 110m map, plus a few that are only a handful of pixels across.
const CODES = ("AG BB BH CV DM FM GD KI KM KN LC MH MT MU MV NR PW SC SG ST TO TV VC WS " +
  "TT JM CY TL VU BN").split(" ");

const dir = process.argv[2] || ".";
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const world110 = read("ne_110m_admin_0_countries.geojson");
const world10 = read("ne_10m_admin_0_countries.geojson");

// map-data.js was made with this projection: Natural Earth, fitted to 1000 wide.
const projection = d3.geoNaturalEarth1().fitWidth(1000, world110);

// Projected rings of a feature, cut at the antimeridian like the main map.
function ringsOf(feature) {
  const rings = [];
  let ring;
  d3.geoPath(projection, {
    moveTo(x, y) { ring = [[x, y]]; rings.push(ring); },
    lineTo(x, y) { ring.push([x, y]); },
    closePath() {},
    arc() {},
  })(feature);
  return rings.filter((r) => r.length > 2);
}

const area = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};
const bbox = (pts) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
};
const inside = (px, py, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const edgeDist = (px, py, r) => {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    best = Math.min(best, (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2);
  }
  return Math.sqrt(best);
};

// Sutherland–Hodgman: clip a ring to the box (x0, y0)–(x1, y1).
function clip(ring, x0, y0, x1, y1) {
  const edges = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  let out = ring;
  for (const [isIn, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (isIn(b)) {
        if (!isIn(a)) out.push(cut(a, b));
        out.push(b);
      } else if (isIn(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

// Douglas–Peucker on a closed ring.
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  // split a closed ring at its farthest point from the start first
  let far = 0, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  keep[far] = 1;
  stack.pop();
  stack.push([0, far], [far, ring.length - 1]);
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = ring[s], [bx, by] = ring[e];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * (ring[i][0] - ax) - dx * (ring[i][1] - ay)) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return ring.filter((_, i) => keep[i]);
}

// Same path format as map-data.js: "M x y" then relative "l dx dy", "Z".
function pathOf(rings, tol) {
  const q = (v) => Math.round(v / tol) * tol;
  const dec = Math.max(0, Math.ceil(-Math.log10(tol)));
  const f = (v) => String(+v.toFixed(dec));
  let d = "";
  for (const raw of rings) {
    const r = simplify(raw, tol / 2);
    let [px, py] = [q(r[0][0]), q(r[0][1])];
    d += `M${f(px)} ${f(py)}`;
    let segs = [];
    for (let i = 1; i < r.length; i++) {
      const [x, y] = [q(r[i][0]), q(r[i][1])];
      if (x === px && y === py) continue;
      segs.push(`${f(x - px)} ${f(y - py)}`);
      [px, py] = [x, y];
    }
    // Islets smaller than a pixel (atolls) stay as an open zero-length
    // segment, which the inset's round-capped stroke draws as a dot.
    d += segs.length < 2 ? "l0 0" : `l${segs.join("l")}Z`;
  }
  return d;
}

const code10 = (f) => (f.properties.ISO_A2_EH !== "-99" ? f.properties.ISO_A2_EH : f.properties.ISO_A2);
const allLand = world10.features.map((f) => ({ code: code10(f), rings: ringsOf(f) }));
const src110 = fs.readFileSync(new URL("../map-data.js", import.meta.url), "utf8");
const MAP_DATA = JSON.parse(src110.slice(src110.indexOf("{"), src110.lastIndexOf("}") + 1));

const out = {};
for (const code of CODES) {
  const own = allLand.find((l) => l.code === code);
  if (!own) throw new Error(`no 10m outline for ${code}`);
  // Countries spread over a huge area (Kiribati, Micronesia) zoom in on the
  // islands around the 110m map's dot, or else around the biggest island.
  const dot = MAP_DATA.dots[code];
  const biggest = own.rings.reduce((a, b) => (area(b) > area(a) ? b : a));
  const centre = (r) => { const b = bbox(r); return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]; };
  const anchor = dot
    ? centre(own.rings.reduce((a, b) => (Math.hypot(...centre(b).map((v, i) => v - dot[i])) <
        Math.hypot(...centre(a).map((v, i) => v - dot[i])) ? b : a)))
    : centre(biggest);
  const near = own.rings.filter((r) => Math.hypot(...centre(r).map((v, i) => v - anchor[i])) < 9);
  const b = bbox(near.flat());
  // a square box around those islands, with a margin
  const w = Math.max(0.8, 1.3 * Math.max(b.maxX - b.minX, b.maxY - b.minY));
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const box = [cx - w / 2, cy - w / 2, w];
  const tol = w / 500; // ~half a pixel in a 250px inset
  const inBox = (rings) => rings.map((r) => clip(r, box[0], box[1], box[0] + w, box[1] + w)).filter((r) => r.length > 2);
  // the main map circles the visual centre of the biggest island in the box
  const main = near.reduce((a, r) => (area(r) > area(a) ? r : a));
  const mb = bbox(main);
  let pin = centre(main), pinD = -1;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
    const x = mb.minX + ((mb.maxX - mb.minX) * i) / 40, y = mb.minY + ((mb.maxY - mb.minY) * j) / 40;
    if (!inside(x, y, main)) continue;
    const d = edgeDist(x, y, main);
    if (d > pinD) { pinD = d; pin = [x, y]; }
  }
  const r = (v) => +v.toFixed(3);
  out[code] = {
    box: box.map(r),
    pin: pin.map(r),
    d: pathOf(inBox(own.rings), tol),
    ctx: pathOf(allLand.filter((l) => l.code !== code).flatMap((l) => inBox(l.rings)), tol),
  };
}

process.stdout.write(
  "// Generated by tools/make-map-detail.mjs from Natural Earth 10m data.\n" +
  `const MAP_DETAIL = ${JSON.stringify(out)};\n`);
