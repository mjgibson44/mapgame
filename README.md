# MapGame

A country-guessing game on a black-and-white world map.

## Alphabet Mode

Work through the alphabet from A to Z, naming every country that starts with
the current letter (letters with no countries — W and X — are skipped
automatically). For each letter you can see how many countries there are,
how many you've found, and how many remain. When you finish the alphabet you
get a final score out of 197 and a per-letter breakdown of what you missed.

- **Autocomplete** — type 2+ letters and pick from suggestions, so you never
  have to type a full country name.
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
- **Give up** — if you're stuck on a letter, reveal the ones you missed and
  move on; they count against your final score.

## Running it

It's a static page with no build step and no external dependencies:

```
open index.html            # or just double-click it
# — or —
python3 -m http.server     # then visit http://localhost:8000
```

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
