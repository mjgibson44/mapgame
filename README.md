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
- **Map areas** — on the start screen, toggle which parts of the world pins
  drop in: **Americas**, **Europe**, **Asia** (Australia included),
  **Africa** and **Global Islands**. Global Islands is the 30 island
  countries small enough to get a close-up (see below) — Malta, the
  Maldives, Singapore, the small Caribbean and Pacific nations and so on —
  wherever they are; bigger islands such as the UK, Iceland, Japan, Cuba
  and Madagascar stay with their continent, and New Zealand, Papua New
  Guinea, Fiji and the Solomon Islands go with Australia in Asia. The map previews your pick, and the choice is
  remembered. "Change map areas" on the end screen takes you back to it.
- Your score is how many you name before the clock hits zero; your best is
  saved on the device, separately for each choice of map areas.
- The pin sits at the visual centre of the country, and the map zooms so
  the whole country fills a good part of the view: close enough to see
  exactly where the pin is, but zoomed out further whenever the view would be
  a featureless blob of land or open ocean, so there's always enough
  coastline to tell which continent you're on. The map wraps around the
  Pacific like a globe. Microstates too small to draw show as a dot under
  the pin.
- **Island close-ups** — island countries too small to see at that zoom
  (Malta, the Maldives, the Caribbean and Pacific islands, Singapore, Trinidad,
  Cyprus, …) get a close-up inset in the corner of the map, drawn from
  detailed outlines, with the country shaded darker than its neighbours. On the
  main map the island is circled instead of pinned, with a line to the inset.
- Input that isn't a country at all (a typo) costs nothing. Autocomplete and
  voice input work as in Alphabet Mode.
- The clock pauses while the tab or app is in the background.

## Border Draw

Pick a continent — **Americas**, **Europe**, **Asia** (Australia included)
or **Africa**, the same areas as Streak Mode — and you get an empty map: its
coastline with no borders and no names. Then, one country at a time:

1. **Say which country you'll draw** — type it (3 letters bring up one
   suggestion, from all 197 countries so it doesn't give away which are on
   the map).
2. **Draw its outline** — a loop around it. Countries in pieces (the US and
   Alaska, Indonesia, …) take a loop per piece. Undo and Clear fix mistakes.
3. **Next country** — your outline stays on the map, and you pick the next.

Nothing is checked until you press **Score my map**, and nothing tells you
how many countries are left — knowing when you've drawn them all is part of
the game. The only borders you see while playing are your own. The row of
countries you've drawn lets you reopen one to fix it.

- **Scoring:** each of the continent's countries scores up to 100 points for
  how well your outline overlaps the real country (intersection over union,
  computed by rasterizing both on a canvas), counting **land only** — loop
  out to sea round the coast and it costs nothing, so it's the land borders
  that matter. 90% overlap or better is full marks, with a gentle curve
  below that. Countries you didn't draw score 0. Microstates that are only
  dots on this map (Andorra, Liechtenstein, Monaco, San Marino, Vatican City)
  are scored on where your loop is centred: full marks within about 40 km,
  nothing beyond about 400 km.
- **Results:** every country appears with its real borders, shaded green,
  yellow or red by score, with your outlines dashed on top (you can hide
  them). Tap a country, or a name in the list, to see its score. Your best
  total is saved for each continent, and a map in progress survives a
  refresh.
- **Apple Pencil (iPad):** the first time the Pencil touches the map, the
  game switches to drawing-app rules: the Pencil draws, one finger moves the
  map, two fingers zoom, and a palm resting on the screen never draws.
  Without a Pencil, one finger draws and two fingers move and zoom. With a
  mouse, drag to draw, scroll to zoom, and Shift-drag or right-drag to move
  the map.
- Other continents, the island microstates (Streak Mode's Global Islands)
  and territories that aren't one of the 197 countries (Western Sahara,
  Greenland) are shown faded. Europe's map stops at the Urals.

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
you tap 🎤. It opens on the home page, where you pick a mode. Instead of the
system keyboard it shows the game's own: the same size as Apple's letter keys,
but with no predictive-text bar, emoji/dictation row or Done bar, which saves
space and gives no typing help. Like other games, its sound effects follow the
silent switch.

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
| `index.html` | Home page: pick a mode (`home.js` shows your progress in each) |
| `alphabet.html` | Alphabet Mode page |
| `streak.html` | Streak Mode page |
| `draw.html` | Border Draw page |
| `styles.css` | Styles shared by all the modes |
| `shared.js` | Shared by all the modes: answer matching, autocomplete, sound, map drawing, voice, menu, the iOS app's keyboard |
| `app.js` | Alphabet Mode logic: letters, scoring, save/restore |
| `streak.js` | Streak Mode logic: clock, random countries, pin placement and zoom |
| `draw.js` | Border Draw logic: naming and drawing countries (mouse, touch, Apple Pencil), zoom, scoring, save/restore |
| `countries.js` | The 197 countries with ISO codes and accepted aliases, and the Streak Mode map areas |
| `map-data.js` | Generated world-map SVG paths (Natural Earth 110m data, Natural Earth projection) |
| `map-detail.js` | Generated detailed outlines (Natural Earth 10m) of the small island countries, for Streak Mode's close-ups |
| `tools/make-map-detail.mjs` | Regenerates `map-detail.js` (instructions at the top of the file) |
| `ios/` | Xcode project for the iOS app |

Map geometry is derived from [Natural Earth](https://www.naturalearthdata.com/)
(public domain), simplified to 110m resolution (10m for the island
close-ups) and pre-projected to SVG paths.

## Planned modes

- Continent mode — guess all the countries of a chosen continent.
