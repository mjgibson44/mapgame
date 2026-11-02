// Builds map-states.js: Border Draw's "US states" and "Canada" maps. Each is
// in its own projection, centred on its country, the way atlases draw them
// (not the world map's, which leans and squashes them):
//   US     — Albers equal-area (d3.geoAlbersUsa), Alaska and Hawaii as insets
//   Canada — Lambert conformal conic, parallels 49° and 77°, centred on
//            91.87° W (Statistics Canada's)
// Each map has its states or provinces and territories (Natural Earth 50m
// admin-1; the District of Columbia is folded into Maryland), the land around
// them (50m countries, faded in the game), and the big lakes — the admin-1
// outlines run out into the lakes, so the game draws them as water. Each is
// fitted to 1000 map units wide. The US map's insets get "frames": panels the
// game clears of the land around (which the projection draws under them too).
//
//   npm install d3-geo@3
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson
//   node make-map-states.mjs <dir with the .geojson files> > ../map-states.js
import * as d3 from "d3-geo";
import fs from "fs";

const dir = process.argv[2] || ".";
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const countries = read("ne_50m_admin_0_countries.geojson");
const admin1 = read("ne_50m_admin_1_states_provinces.geojson");
const lakes = read("ne_50m_lakes.geojson");

const MAPS = {
  us: { country: "US", projection: () => d3.geoAlbersUsa(), insets: ["US-AK", "US-HI"] },
  canada: { country: "CA", projection: () => d3.geoConicConformal().parallels([49, 77]).rotate([91.87, 0]) },
};
const WIDTH = 1000;
const MARGIN = 25;       // map units round the country
const MIN = 0.25;        // drop points closer than this to the last one kept…
const MIN_AROUND = 0.8;  // …or this, for the faded land around
const LAKE_SHARE = 6e-5; // keep lakes covering at least this share of the map's box

// Projected rings of a feature.
function ringsOf(projection, feature) {
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

// Thins the points (dropping any closer than min to the last kept), rounds
// to 0.01, and writes an SVG path in map-data.js's format: "M x y", then
// relative "l dx dy", then "Z".
const r2 = (v) => Math.round(v * 100) / 100;
function pathOf(rings, min = MIN) {
  let d = "";
  for (const ring of rings) {
    const kept = [ring[0]];
    for (const p of ring.slice(1)) {
      const q = kept[kept.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) kept.push(p);
    }
    if (kept.length < 3) continue;
    const pts = kept.map(([x, y]) => [r2(x), r2(y)]);
    d += `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += `l${r2(pts[i][0] - pts[i - 1][0])} ${r2(pts[i][1] - pts[i - 1][1])}`;
    d += "Z";
  }
  return d;
}

const MERGE = { "US-DC": "US-MD" };
const out = {};
for (const [id, { country, projection: make, insets = [] }] of Object.entries(MAPS)) {
  const states = admin1.features.filter((f) => f.properties.iso_a2 === country);
  const projection = make().fitWidth(WIDTH - 2 * MARGIN, { type: "FeatureCollection", features: states });
  const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds({ type: "FeatureCollection", features: states });
  projection.translate(projection.translate().map((t, i) => t + MARGIN - [x0, y0][i]));
  const box = [0, 0, WIDTH, r2(y1 - y0 + 2 * MARGIN)];
  // the land around is cut well outside the box, so a screen wider or
  // taller than the map still shows it (the US projection cuts it to its
  // panels itself)
  const BLEED = 400;
  if (projection.clipExtent) projection.clipExtent([[box[0] - BLEED, box[1] - BLEED], [box[2] + BLEED, box[3] + BLEED]]);
  const path = d3.geoPath(projection);

  const shapes = {};
  for (const f of states) {
    const { postal, name } = f.properties;
    const own = `${country}-${postal}`, code = MERGE[own] || own;
    if (!shapes[code]) shapes[code] = { n: name, rings: [] };
    if (code === own) shapes[code].n = name; // Maryland, not DC
    shapes[code].rings.push(...ringsOf(projection, f));
  }
  const land = {};
  for (const f of countries.features) {
    if (f.properties.ISO_A2_EH === country) continue;
    const d = pathOf(ringsOf(projection, f), MIN_AROUND);
    if (d) land[f.properties.ADM0_A3] = d;
  }
  const big = (f) => {
    const [[a, b], [c, e]] = path.bounds(f);
    return path.area(f) >= LAKE_SHARE * box[2] * box[3] && a >= 0 && b >= 0 && c <= box[2] && e <= box[3];
  };

  const frames = insets.map((code) => {
    const pts = shapes[code].rings.flat(), pad = 10;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const fx = Math.min(...xs) - pad, fy = Math.min(...ys) - pad;
    return [r2(fx), r2(fy), r2(Math.max(...xs) + pad - fx), r2(Math.max(...ys) + pad - fy)];
  });

  out[id] = {
    box,
    frames,
    shapes: Object.fromEntries(Object.keys(shapes).sort().map((c) => [c, { n: shapes[c].n, d: pathOf(shapes[c].rings) }])),
    land,
    // one path; fill it even-odd, since islands in a lake are rings too
    lakes: pathOf(lakes.features.filter(big).flatMap((f) => ringsOf(projection, f))),
  };
}

process.stdout.write("// Generated by tools/make-map-states.mjs from Natural Earth 50m data.\n");
process.stdout.write(`const MAP_STATES = ${JSON.stringify(out)};\n`);
