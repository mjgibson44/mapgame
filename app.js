/* MapGame — Alphabet Mode */
(function () {
  "use strict";

  const STORAGE_KEY = "mapgame-alphabet-v1";

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
    li: 0,                 // index into LETTERS
    found: new Set(),      // country codes guessed correctly
    revealed: false,       // current letter given up / revealed
  };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ li: state.li, found: [...state.found] }));
    } catch (e) { /* storage unavailable — play without saving */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.li === "number" && Array.isArray(s.found)) {
        state.li = Math.min(s.li, LETTERS.length);
        state.found = new Set(s.found);
      }
    } catch (e) { /* ignore corrupt saves */ }
  }
  function reset() {
    state = { li: 0, found: new Set(), revealed: false };
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  const currentLetter = () => LETTERS[state.li];
  const currentCountries = () => byLetter.get(currentLetter()) || [];
  const remainingCountries = () => currentCountries().filter((c) => !state.found.has(c.code));

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
    map: $("map"),
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
    LETTERS.forEach((L, i) => {
      const s = document.createElement("span");
      s.textContent = L;
      const list = byLetter.get(L);
      const foundHere = list.filter((c) => state.found.has(c.code)).length;
      if (i < state.li) s.className = foundHere === list.length ? "done" : "partial";
      else if (i === state.li && state.li < LETTERS.length) s.className = "current";
      el.strip.appendChild(s);
    });
  }

  function renderTotal() {
    el.total.textContent = `${state.found.size} / ${COUNTRIES.length} countries`;
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
    if (state.revealed) {
      for (const c of list) {
        if (state.found.has(c.code)) continue;
        const s = document.createElement("span");
        s.className = "missed";
        s.textContent = c.name;
        el.chips.appendChild(s);
      }
    }

    el.guess.disabled = state.revealed;
    el.skip.textContent = state.revealed
      ? "Next letter →"
      : "I give up on this letter — reveal & next →";
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
    const nq = normalize(q);
    if (nq.length < 2) return [];
    const out = [];
    for (const c of remainingCountries()) {
      let matchedForm = null;
      for (const form of [c.name, ...(c.aliases || [])]) {
        const nf = normalize(form);
        if (nf.startsWith(nq) || nf.split(" ").some((w) => w.startsWith(nq))) {
          matchedForm = form;
          break;
        }
      }
      if (matchedForm !== null) {
        out.push({ c, via: matchedForm === c.name ? null : matchedForm });
        if (out.length >= 8) break;
      }
    }
    return out;
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
      setFeedback(`Already got ${c.name}!`, "info");
      return;
    }
    if (letterOf(c) !== L) {
      setFeedback(`${c.name} starts with “${letterOf(c)}” — you're on “${L}”.`, "err");
      wiggle();
      return;
    }
    if (state.revealed) {
      setFeedback(`“${L}” is already revealed — hit “Next letter” to move on.`, "info");
      return;
    }
    state.found.add(c.code);
    save();
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

  function advance() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.revealed = false;
    state.li += 1;
    save();
    if (state.li >= LETTERS.length) { showEnd(); return; }
    setFeedback("", "info");
    el.guess.value = "";
    closeSuggestions();
    renderLetter();
    el.guess.focus();
  }

  // ---------- End screen ----------

  function showEnd() {
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

  el.guess.addEventListener("input", () => {
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

  el.guess.addEventListener("blur", () => setTimeout(closeSuggestions, 150));

  el.skip.addEventListener("click", () => {
    if (state.revealed) { advance(); }
    else if (remainingCountries().length === 0) { advance(); }
    else {
      state.revealed = true;
      const n = remainingCountries().length;
      setFeedback(`Revealed ${n} missed ${n === 1 ? "country" : "countries"}.`, "info");
      renderLetter();
    }
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
  if (state.li >= LETTERS.length) showEnd();
  else { renderLetter(); el.guess.focus(); }
})();
