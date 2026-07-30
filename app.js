/* MapGame — Alphabet Mode */
(function () {
  "use strict";

  const STORAGE_KEY = "mapgame-alphabet-v2";

  // ---------- Normalization & lookup ----------

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")     // punctuation -> space
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^the /, "");
  }

  // country -> letter it belongs to
  const letterOf = (c) => c.name[0].toUpperCase();

  // Every accepted normalized form -> country
  const lookup = new Map();
  for (const c of COUNTRIES) {
    c.norms = [normalize(c.name), ...(c.aliases || []).map(normalize)];
    for (const n of c.norms) if (!lookup.has(n)) lookup.set(n, c);
  }

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

  // ---------- Sound effects ----------

  const MUTE_KEY = "mapgame-muted";
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
  let audioCtx = null;

  function note(freq, type, t, dur, peak) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function ensureAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) { /* audio unavailable */ }
  }

  // Browsers (iOS Safari especially) only start audio from inside a real user
  // gesture. Voice-driven guesses arrive in recognition callbacks — not
  // gestures — so unlock the context on every tap/keypress; this also
  // re-resumes it after iOS suspends audio when the page is backgrounded.
  ["pointerdown", "keydown"].forEach((ev) =>
    document.addEventListener(ev, ensureAudio, { capture: true, passive: true }));

  // kind: "correct" (rising ding) | "wrong" (low descending buzz, real country
  // at the wrong time) | "nomatch" (soft tick, input didn't match any country)
  function sound(kind) {
    if (muted) return;
    try {
      ensureAudio();
      if (!audioCtx) return;
      const t = audioCtx.currentTime;
      if (kind === "correct") {
        note(659.25, "sine", t, 0.15, 0.14);        // E5
        note(987.77, "sine", t + 0.09, 0.22, 0.14); // B5
      } else if (kind === "wrong") {
        note(196, "square", t, 0.12, 0.05);         // G3
        note(147, "square", t + 0.1, 0.2, 0.05);    // D3
      } else {
        note(293.66, "triangle", t, 0.12, 0.07);    // D4 — quiet, non-judgmental
      }
    } catch (e) { /* audio unavailable — play silently */ }
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
    map: $("map"), mute: $("muteBtn"), lettersProgress: $("lettersProgress"),
    back: $("backBtn"), next: $("nextBtn"),
  };

  // ---------- Map ----------

  const mapNodes = new Map(); // code -> svg node
  function buildMap() {
    const svg = el.map;
    svg.setAttribute("viewBox", MAP_DATA.viewBox);
    const frag = document.createDocumentFragment();
    for (const [code, shape] of Object.entries(MAP_DATA.shapes)) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", shape.d);
      p.setAttribute("class", "land");
      p.setAttribute("data-code", code);
      frag.appendChild(p);
      mapNodes.set(code, p);
    }
    for (const [code, [x, y]] of Object.entries(MAP_DATA.dots)) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 3.2);
      c.setAttribute("class", "dot");
      c.setAttribute("data-code", code);
      frag.appendChild(c);
      mapNodes.set(code, c);
    }
    svg.appendChild(frag);
  }

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

  // Show a single suggestion, and only after 3 typed letters — showing more
  // would hand out answers (e.g. "chi" revealing both China and Chile).
  function matchSuggestions(q) {
    const nq = normalize(q);
    if (nq.length < 3) return [];
    for (const c of remainingCountries()) {
      for (const form of [c.name, ...(c.aliases || [])]) {
        const nf = normalize(form);
        if (nf.startsWith(nq) || nf.split(" ").some((w) => w.startsWith(nq))) {
          return [{ c, via: form === c.name ? null : form }];
        }
      }
    }
    return [];
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
    if (!listening && !isResolved(currentLetter())) el.guess.focus();
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

  let recognition = null;
  let listening = false;

  // All (normalized form, country) pairs, longest form first, so that e.g.
  // "South Sudan" consumes its span before "Sudan" can match inside it.
  const voiceForms = COUNTRIES
    .flatMap((c) => c.norms.map((n) => ({ n, c })))
    .sort((a, b) => b.n.length - a.n.length);

  function findCountriesInTranscript(transcript) {
    let nt = ` ${normalize(transcript)} `;
    const hits = [];
    const seen = new Set();
    for (const { n, c } of voiceForms) {
      const needle = ` ${n} `;
      if (nt.includes(needle)) {
        nt = nt.split(needle).join(" ¤ "); // consume the span
        if (!seen.has(c.code)) { hits.push(c); seen.add(c.code); }
      }
    }
    return hits;
  }

  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { el.mic.hidden = true; return; }

    recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) {
          const transcript = res[0].transcript;
          const hits = findCountriesInTranscript(transcript);
          if (hits.length) {
            for (const c of hits) acceptCountry(c, true);
          } else {
            sound("nomatch");
            setFeedback(`Heard “${transcript.trim()}” — no country match.`, "info");
          }
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) setFeedback(`Listening… “${interim.trim()}”`, "info");
    };
    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        listening = false;
        el.mic.classList.remove("listening");
        el.mic.disabled = true;
        setFeedback("Microphone access was blocked — you can still type!", "err");
      }
    };
    recognition.onend = () => {
      if (listening) { try { recognition.start(); } catch (e) {} } // auto-restart after silence
      else el.mic.classList.remove("listening");
    };

    el.mic.addEventListener("click", () => {
      if (listening) { stopVoice(); setFeedback("Voice input off.", "info"); }
      else {
        listening = true;
        el.mic.classList.add("listening");
        setFeedback("Listening — say a country name…", "info");
        try { recognition.start(); } catch (e) {}
      }
    });
  }

  function stopVoice() {
    listening = false;
    el.mic.classList.remove("listening");
    if (recognition) { try { recognition.stop(); } catch (e) {} }
  }

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

  function renderMute() {
    el.mute.textContent = muted ? "🔇" : "🔊";
    el.mute.setAttribute("aria-pressed", String(muted));
    el.mute.title = muted ? "Unmute sounds" : "Mute sounds";
    el.mute.setAttribute("aria-label", el.mute.title);
  }

  el.mute.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
    renderMute();
    // audible confirmation on unmute — also proves sound works on this device
    if (!muted) sound("correct");
  });

  el.playagain.addEventListener("click", () => {
    reset();
    el.end.hidden = true;
    el.panel.hidden = false;
    paintMap();
    setFeedback("", "info");
    renderLetter();
    el.guess.focus();
  });

  // ---------- Init ----------

  buildMap();
  load();
  paintMap();
  setupVoice();
  renderMute();
  if (LETTERS.every(isResolved)) showEnd();
  else {
    renderLetter();
    if (!isResolved(currentLetter())) el.guess.focus();
  }
})();
