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
  the setting is remembered; unmuting plays the ding so you can confirm audio
  works. Note: iPhones mute web audio while the physical silent switch is on.
- **Progress is saved** — refresh the page and you pick up where you left off.

## Streak Mode

Race the clock: a pin drops on a world map with **no borders** (coastlines
only), and you type the country it's sitting on.

- You start with **60 seconds**. A right answer adds **+5s**, a wrong country
  takes **−5s** (and briefly shades the country you guessed, so you learn
  where it is), and **Skip** also costs −5s and shows you the answer.
- Your score is how many you name before the clock hits zero; your best is
  saved on the device.
- The map zooms to each country's neighbourhood so small countries are
  placeable; microstates too small to draw show as a dot under the pin.
- Input that isn't a country at all (a typo) costs nothing. Autocomplete and
  voice input work as in Alphabet Mode.
- The clock pauses while the tab or app is in the background.

Switch between modes from the ☰ menu.

## Running it

It's a static page with no build step and no external dependencies:

```
open index.html            # or just double-click it
# — or —
python3 -m http.server     # then visit http://localhost:8000
```

## iOS app

`ios/` holds a native iPhone/iPad app (SwiftUI + `WKWebView`) that bundles
this same web game, so it runs fully offline and always matches the website.
A build phase copies the repo root's `.html`, `.css` and `.js` files into the
app on every build — there's nothing to sync by hand.

To run it you need a Mac with Xcode 15 or newer:

1. Open `ios/MapGame.xcodeproj`.
2. Select the **MapGame** target → **Signing & Capabilities** → pick your
   Team (a free Apple ID works for running on your own phone). Change the
   bundle identifier (`com.mjgibson.mapgame`) if Xcode says it's taken.
3. Choose a simulator or your connected iPhone and press ▶︎.

The app asks for microphone and speech-recognition permission the first time
you tap 🎤. It reopens in whichever mode you last played. Like other games,
its sound effects follow the silent switch.

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
| `index.html` | Alphabet Mode page |
| `streak.html` | Streak Mode page |
| `styles.css` | Styles shared by both modes |
| `shared.js` | Shared by both modes: answer matching, autocomplete, sound, map drawing, voice, menu |
| `app.js` | Alphabet Mode logic: letters, scoring, save/restore |
| `streak.js` | Streak Mode logic: clock, random countries, pin placement and zoom |
| `countries.js` | The 197 countries with ISO codes and accepted aliases |
| `map-data.js` | Generated world-map SVG paths (Natural Earth 110m data, Natural Earth projection) |
| `ios/` | Xcode project for the iOS app |

Map geometry is derived from [Natural Earth](https://www.naturalearthdata.com/)
(public domain), simplified to 110m resolution and pre-projected to SVG paths.

## Planned modes

- Continent mode — guess all the countries of a chosen continent.
