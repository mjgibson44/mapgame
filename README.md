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

Every push auto-deploys to [Cloudflare Pages](https://pages.cloudflare.com/)
via `.github/workflows/deploy.yml` — pushes to `main` go to production
(`https://mapgame.pages.dev`), pushes to any other branch get a preview
deployment whose URL is printed in the GitHub Actions log.

One-time setup (the workflow fails with a clear error until this is done):

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), copy your
   **Account ID** (Workers & Pages → overview, right-hand column).
2. Create an **API token** at My Profile → API Tokens → Create Token, using
   the "Edit Cloudflare Workers" template or a custom token with
   **Account → Cloudflare Pages → Edit** permission.
3. In the GitHub repo, add both as Actions secrets
   (Settings → Secrets and variables → Actions):
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

The first run creates the Pages project automatically. If the `mapgame`
name is already taken on pages.dev, change `PROJECT_NAME` at the top of the
workflow.

Alternative: skip the workflow entirely and use Cloudflare's own Git
integration (Workers & Pages → Create → Pages → Connect to Git, no build
command, output directory `/`). If you go that route, delete
`.github/workflows/deploy.yml` so you don't deploy twice.

### Cache busting

Users always get the latest version after a deploy: `_headers` tells
browsers to revalidate HTML on every load, and the deploy workflow stamps
the script URLs in `index.html` with the commit SHA (`app.js?v=<sha>`), so
a fresh page can never pair with stale cached JavaScript. The JS files
themselves are cached for a year — each deploy references new URLs.

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
