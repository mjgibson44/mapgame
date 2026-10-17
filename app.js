/* MapGame — Alphabet Mode */
(function () {
  "use strict";

  const STORAGE_KEY = "mapgame-alphabet-v2";

  const { normalize, lookup, sound } = MapGame;

  // country -> letter it belongs to
  const letterOf = (c) => c.name[0].toUpperCase();

  // Letters that actually have countries, in order
  const byLetter = new Map();
  for (const c of COUNTRIES) {
    const L = letterOf(c);
    if (!byLetter.has(L)) byLetter.set(L, []);
    byLetter.get(L).push(c);
  }
  const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((L) => byLetter.has(L));

  // ---------- State ----------

  let state = {
    li: 0,                 // index into LETTERS (letter currently being played)
    found: new Set(),      // country codes guessed correctly
    revealed: new Set(),   // letters given up on (their misses shown)
  };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        li: state.li, found: [...state.found], revealed: [...state.revealed],
      }));
    } catch (e) { /* storage unavailable — play without saving */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.li === "number" && Array.isArray(s.found) && Array.isArray(s.revealed)) {
        state.li = Math.min(Math.max(0, s.li), LETTERS.length - 1);
        state.found = new Set(s.found);
        state.revealed = new Set(s.revealed);
      }
    } catch (e) { /* ignore corrupt saves */ }
  }
  function reset() {
    state = { li: 0, found: new Set(), revealed: new Set() };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  const currentLetter = () => LETTERS[state.li];
  const currentCountries = () => byLetter.get(currentLetter()) || [];
  const remainingCountries = () => currentCountries().filter((c) => !state.found.has(c.code));

  // A letter is complete when every country is found, and resolved when it's
  // complete or given up — resolved letters count toward the header tally,
  // and the game ends once every letter is resolved.
  const isComplete = (L) => byLetter.get(L).every((c) => state.found.has(c.code));
  const isRevealed = (L) => state.revealed.has(L);
  const isResolved = (L) => isComplete(L) || isRevealed(L);
  const resolvedCount = () => LETTERS.filter(isResolved).length;

  function nextUnresolved(from) {
    for (let k = 1; k <= LETTERS.length; k++) {
      const i = (from + k) % LETTERS.length;
      if (!isResolved(LETTERS[i])) return i;
    }
    return -1;
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const el = {
    strip: $("letterStrip"), big: $("bigLetter"), headline: $("letterHeadline"),
    nTotal: $("nTotal"), nFound: $("nFound"), nLeft: $("nLeft"),
    guess: $("guess"), mic: $("micBtn"), sug: $("suggestions"),
    feedback: $("feedback"), chips: $("foundChips"), skip: $("skipBtn"),
    total: $("totalProgress"), panel: $("gamePanel"), end: $("endscreen"),
    finalScore: $("finalScore"), finalPct: $("finalPct"),
    breakdown: $("breakdown"), missedlist: $("missedlist"), playagain: $("playagain"),
    map: $("map"), lettersProgress: $("lettersProgress"),
    back: $("backBtn"), next: $("nextBtn"),
  };

  // ---------- Map ----------

  const mapNodes = MapGame.buildMap(el.map); // code -> svg node

  function paintMap() {
    for (const [code, node] of mapNodes) {
      node.classList.toggle("guessed", state.found.has(code));
    }
  }

  function flashCountry(code) {
    const node = mapNodes.get(code);
    if (!node) return;
    node.classList.add("flash");
    setTimeout(() => {
      node.classList.remove("flash");
      node.classList.add("guessed");
    }, 650);
  }

  // ---------- Rendering ----------

  function renderStrip() {
    el.strip.innerHTML = "";
    const gameOver = resolvedCount() === LETTERS.length;
    LETTERS.forEach((L, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = L;
      b.dataset.i = i;
      const list = byLetter.get(L);
      const foundHere = list.filter((c) => state.found.has(c.code)).length;
      const cls = [];
      if (isComplete(L)) cls.push("done");
      else if (isRevealed(L)) cls.push("given");
      else if (foundHere > 0) cls.push("partial");
      if (i === state.li && !(gameOver && el.panel.hidden)) cls.push("current");
      b.className = cls.join(" ");
      b.title = `${foundHere}/${list.length}`;
      b.setAttribute("aria-label", `Letter ${L}: ${foundHere} of ${list.length} found`);
      el.strip.appendChild(b);
    });
  }

  function renderTotal() {
    el.total.textContent = `${state.found.size} / ${COUNTRIES.length} countries`;
    el.lettersProgress.innerHTML =
      `<b>${resolvedCount()} / ${LETTERS.length}</b><small>letters complete</small>`;
  }

  function renderLetter() {
    const L = currentLetter();
    const list = currentCountries();
    const found = list.filter((c) => state.found.has(c.code));
    el.big.textContent = L;
    el.headline.textContent =
      `${list.length} ${list.length === 1 ? "country starts" : "countries start"} with “${L}”`;
    el.nTotal.textContent = list.length;
    el.nFound.textContent = found.length;
    el.nLeft.textContent = list.length - found.length;

    el.chips.innerHTML = "";
    for (const c of found) {
      const s = document.createElement("span");
      s.textContent = c.name;
      el.chips.appendChild(s);
    }
    if (isRevealed(L)) {
      for (const c of list) {
        if (state.found.has(c.code)) continue;
        const s = document.createElement("span");
        s.className = "missed";
        s.textContent = c.name;
        el.chips.appendChild(s);
      }
    }

    el.guess.disabled = isResolved(L);
    const gameOver = resolvedCount() === LETTERS.length;
    el.skip.textContent = gameOver ? "See final results →" : "Reveal answers";
    el.skip.disabled = !gameOver && isResolved(L);
    renderStrip();
    renderTotal();
  }

  function setFeedback(msg, kind) {
    el.feedback.textContent = msg;
    el.feedback.className = kind || "info";
  }

  // ---------- Autocomplete ----------

  let sugItems = [];
  let sugActive = -1;

  function matchSuggestions(q) {
    const s = MapGame.suggest(q, remainingCountries());
    return s ? [s] : [];
  }

  function renderSuggestions() {
    el.sug.innerHTML = "";
    if (!sugItems.length) { el.sug.classList.remove("open"); sugActive = -1; return; }
    sugItems.forEach((item, i) => {
      const d = document.createElement("div");
      d.textContent = item.c.name;
      if (item.via) {
        const sm = document.createElement("small");
        sm.textContent = `(${item.via})`;
        d.appendChild(sm);
      }
      if (i === sugActive) d.className = "active";
      d.addEventListener("mousedown", (e) => { e.preventDefault(); pick(item.c); });
      el.sug.appendChild(d);
    });
    el.sug.classList.add("open");
  }

  function closeSuggestions() {
    sugItems = []; sugActive = -1;
    el.sug.classList.remove("open");
    el.sug.innerHTML = "";
  }

  function pick(country) {
    el.guess.value = "";
    closeSuggestions();
    acceptCountry(country, false);
  }

  // ---------- Guess handling ----------

  function acceptCountry(c, viaVoice) {
    const L = currentLetter();
    if (state.found.has(c.code)) {
      setFeedback(`Already got ${c.name}!`, "info"); // repeat, not a wrong guess — no sound
      return;
    }
    if (letterOf(c) !== L) {
      sound("wrong");
      setFeedback(`${c.name} starts with “${letterOf(c)}” — you're on “${L}”.`, "err");
      wiggle();
      return;
    }
    if (isRevealed(L)) {
      setFeedback(`“${L}” is already revealed — hit “Next letter” to move on.`, "info");
      return;
    }
    state.found.add(c.code);
    save();
    sound("correct");
    flashCountry(c.code);
    paintMap();
    renderLetter();
    setFeedback(`✓ ${c.name}${viaVoice ? " (heard you!)" : ""}`, "ok");

    if (remainingCountries().length === 0) {
      setFeedback(`Letter “${L}” complete! 🎉`, "ok");
      advanceTimer = setTimeout(advance, 1300);
    }
  }

  function submitText(text) {
    const nq = normalize(text);
    if (!nq) return;
    const c = lookup.get(nq);
    if (c) {
      el.guess.value = "";
      closeSuggestions();
      acceptCountry(c, false);
    } else {
      sound("nomatch");
      setFeedback(`“${text.trim()}” isn't a country we recognize — keep trying!`, "err");
      wiggle();
    }
  }

  function wiggle() {
    el.guess.classList.remove("shake");
    void el.guess.offsetWidth; // restart animation
    el.guess.classList.add("shake");
  }

  let advanceTimer = null;

  function gotoLetter(i) {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.li = i;
    save();
    el.end.hidden = true;
    el.panel.hidden = false;
    setFeedback("", "info");
    el.guess.value = "";
    closeSuggestions();
    renderLetter();
    // While the mic is on, voice is the input method — don't steal focus
    // (focusing would pop the keyboard on mobile).
    if (!voice.isListening() && !isResolved(currentLetter())) el.guess.focus();
  }

  function advance() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    const next = nextUnresolved(state.li);
    if (next === -1) { showEnd(); return; }
    gotoLetter(next);
  }

  // ---------- End screen ----------

  function showEnd() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    stopVoice();
    el.panel.hidden = true;
    el.end.hidden = false;
    renderStrip();
    renderTotal();
    const total = COUNTRIES.length;
    const got = state.found.size;
    el.finalScore.textContent = `${got} / ${total}`;
    el.finalPct.textContent = `${Math.round((got / total) * 100)}% of the world's countries`;

    el.breakdown.innerHTML = "";
    for (const L of LETTERS) {
      const list = byLetter.get(L);
      const f = list.filter((c) => state.found.has(c.code)).length;
      const s = document.createElement("span");
      s.innerHTML = `<b>${L}</b>${f}/${list.length}`;
      if (f === list.length) s.className = "full";
      el.breakdown.appendChild(s);
    }

    const missed = COUNTRIES.filter((c) => !state.found.has(c.code));
    el.missedlist.innerHTML = "";
    if (missed.length) {
      const h = document.createElement("div");
      h.innerHTML = `<b>You missed ${missed.length}:</b> ` +
        missed.map((c) => c.name).join(", ");
      el.missedlist.appendChild(h);
    } else {
      el.missedlist.innerHTML = "<b>Perfect score — every single country! 🏆</b>";
    }
  }

  // ---------- Voice input ----------

  const voice = MapGame.setupVoice(el.mic, {
    onFinal(transcript, hits) {
      if (hits.length) {
        for (const c of hits) acceptCountry(c, true);
      } else {
        sound("nomatch");
        setFeedback(`Heard “${transcript.trim()}” — no country match.`, "info");
      }
    },
    onInterim: (text) => setFeedback(`Listening… “${text}”`, "info"),
    onStatus: setFeedback,
  });
  const stopVoice = voice.stop;

  // ---------- Events ----------

  let blurCloseTimer = null;

  el.guess.addEventListener("input", () => {
    // A pending blur-close (e.g. from clicking a letter) must not wipe
    // suggestions for text typed after focus returned.
    if (blurCloseTimer) { clearTimeout(blurCloseTimer); blurCloseTimer = null; }
    sugItems = matchSuggestions(el.guess.value);
    sugActive = sugItems.length ? 0 : -1;
    renderSuggestions();
  });

  el.guess.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && sugItems.length) {
      e.preventDefault();
      sugActive = (sugActive + 1) % sugItems.length;
      renderSuggestions();
    } else if (e.key === "ArrowUp" && sugItems.length) {
      e.preventDefault();
      sugActive = (sugActive - 1 + sugItems.length) % sugItems.length;
      renderSuggestions();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sugActive >= 0 && sugItems[sugActive]) pick(sugItems[sugActive].c);
      else submitText(el.guess.value);
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  el.guess.addEventListener("blur", () => {
    blurCloseTimer = setTimeout(closeSuggestions, 150);
  });
  el.guess.addEventListener("focus", () => {
    if (blurCloseTimer) { clearTimeout(blurCloseTimer); blurCloseTimer = null; }
  });

  el.strip.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) gotoLetter(Number(b.dataset.i));
  });

  el.back.addEventListener("click", () => {
    gotoLetter((state.li - 1 + LETTERS.length) % LETTERS.length);
  });
  el.next.addEventListener("click", () => {
    gotoLetter((state.li + 1) % LETTERS.length);
  });

  el.skip.addEventListener("click", () => {
    const L = currentLetter();
    if (resolvedCount() === LETTERS.length) { showEnd(); return; }
    if (isResolved(L)) return;
    state.revealed.add(L);
    save();
    const n = remainingCountries().length;
    setFeedback(`Revealed ${n} missed ${n === 1 ? "country" : "countries"}.`, "info");
    renderLetter();
    if (resolvedCount() === LETTERS.length) {
      // that was the last open letter — show results after a beat so the
      // revealed answers are readable first
      advanceTimer = setTimeout(showEnd, 1800);
    }
  });

  function resetGame() {
    reset();
    stopVoice();
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    el.end.hidden = true;
    el.panel.hidden = false;
    paintMap();
    setFeedback("", "info");
    el.guess.value = "";
    closeSuggestions();
    renderLetter();
    if (!voice.isListening()) el.guess.focus();
  }

  MapGame.setupMenu({ onReset: resetGame });
  MapGame.setupKeyboard(el.guess);

  el.playagain.addEventListener("click", resetGame);

  // ---------- Init ----------

  load();
  paintMap();
  if (LETTERS.every(isResolved)) showEnd();
  else {
    renderLetter();
    if (!isResolved(currentLetter())) el.guess.focus();
  }
})();
