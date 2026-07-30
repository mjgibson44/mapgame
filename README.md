# MapGame

A country-guessing game on a black-and-white world map.

## Alphabet Mode

Name every country that starts with each letter of the alphabet (letters
with no countries — W and X — are skipped). For each letter you see how many
countries there are, how many you've found, and how many remain; the header
tracks letters completed and total countries found. When every letter is
resolved you get a final score out of 197 and a per-letter breakdown.

- **Free navigation** — click any letter in the strip to jump to it, or use
  the ←/→ arrows. Letter chips show four states: untouched, gray = partially
  complete, black = every country found, dashed/struck-through = revealed.
- **Reveal answers** — stuck on a letter? Reveal its remaining countries;
  they count against your final score.
- **Autocomplete** — type 3+ letters for a suggestion. Only one suggestion
  is shown at a time so the list never gives away answers ("chi" won't
  reveal both China and Chile).
- **Voice input** — tap the mic and say country names (uses the browser's
  Web Speech API; works in Chrome/Edge/Safari, requires mic permission).
- **Live map** — every correct answer lights up that country on a
  black-and-white world map (borders only, no labels). Microstates too small
  to draw (Singapore, Malta, Vatican City, …) appear as small dots.
- **Aliases accepted** — USA, UK, Burma, Swaziland, Czechia, Cabo Verde,
  Côte d'Ivoire, DRC, etc. all count. Matching ignores case, accents, and
  punctuation.
- **Sound effects** — a rising ding for a correct guess, a low buzz for a
  real country guessed at the wrong time, and a soft tick when input doesn't
  match any country (including mic mishears). All synthesized with the Web
  Audio API — no audio files. The 🔊 button in the top right mutes them, and
  the setting is remembered.
- **Progress is saved** — refresh the page and you pick up where you left off.

## Running it

It's a static page with no build step and no external dependencies:

```
open index.html            # or just double-click it
# — or —
python3 -m http.server     # then visit http://localhost:8000
```

## Deployment

The repo is connected to [Cloudflare Pages](https://pages.cloudflare.com/)
via its Git integration: **pushes to `main` deploy to production**
(map.mjgibson.com / mapgame-9y8.pages.dev), and pushes to any other branch
create a preview deployment with its own URL, visible in the Cloudflare
dashboard under Deployments. To ship a feature branch to production, merge
it into `main`.

### Caching

`_headers` sets `Cache-Control: max-age=0, must-revalidate` on everything:
browsers revalidate on each load (a fast 304 when nothing changed) and pick
up new deploys immediately — no stale-JS-with-fresh-HTML mismatches. If the
site ever gains a build step, switch to fingerprinted asset URLs plus
long-lived caching instead.

## The country list

197 countries: the 193 UN member states plus Vatican City, Palestine,
Kosovo, and Taiwan. Countries are filed under their common English name:
Democratic Republic of the Congo under **D**, Republic of the Congo
("Congo") under **C**, Ivory Coast under **I**, East Timor under **E**,
North Macedonia and North Korea under **N**, Eswatini under **E**.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure and styles |
| `app.js` | Game logic: letters, autocomplete, voice, map, scoring, save/restore |
| `countries.js` | The 197 countries with ISO codes and accepted aliases |
| `map-data.js` | Generated world-map SVG paths (Natural Earth 110m data, Natural Earth projection) |

Map geometry is derived from [Natural Earth](https://www.naturalearthdata.com/)
(public domain), simplified to 110m resolution and pre-projected to SVG paths.

## Planned modes

- Continent mode — guess all the countries of a chosen continent.
