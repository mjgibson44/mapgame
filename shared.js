/* MapGame — code shared by every mode: answer matching, sound, map, voice, menu */
window.MapGame = (function () {
  "use strict";

  // ---------- Normalization & lookup ----------

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")     // punctuation -> space
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^the /, "");
  }

  // Every accepted normalized form -> country
  const lookup = new Map();
  for (const c of COUNTRIES) {
    c.norms = [normalize(c.name), ...(c.aliases || []).map(normalize)];
    for (const n of c.norms) if (!lookup.has(n)) lookup.set(n, c);
  }

  // The single autocomplete suggestion for typed text q among candidates, as
  // { c, via } (via = the alias that matched, or null), or null. Only one is
  // ever shown, and only after 3 letters — more would hand out answers (e.g.
  // "chi" revealing both China and Chile). An exact match wins, then a name
  // that starts with q, then one with a word that does, so "Sudan" suggests
  // Sudan rather than South Sudan.
  function suggest(q, candidates) {
    const nq = normalize(q);
    if (nq.length < 3) return null;
    const tests = [
      (nf) => nf === nq,
      (nf) => nf.startsWith(nq),
      (nf) => nf.split(" ").some((w) => w.startsWith(nq)),
    ];
    for (const test of tests) {
      for (const c of candidates) {
        for (const form of [c.name, ...(c.aliases || [])]) {
          if (test(normalize(form))) return { c, via: form === c.name ? null : form };
        }
      }
    }
    return null;
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
  // | "gameover" (falling three-note phrase) | "complete" (rising arpeggio)
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
      } else if (kind === "complete") {
        note(523.25, "triangle", t, 0.16, 0.12);        // C5
        note(659.25, "triangle", t + 0.13, 0.16, 0.12); // E5
        note(783.99, "triangle", t + 0.26, 0.16, 0.12); // G5
        note(1046.5, "triangle", t + 0.39, 0.6, 0.13);  // C6
      } else if (kind === "gameover") {
        note(523.25, "triangle", t, 0.18, 0.12);        // C5
        note(392, "triangle", t + 0.16, 0.18, 0.12);    // G4
        note(261.63, "triangle", t + 0.32, 0.45, 0.12); // C4
      } else {
        note(293.66, "triangle", t, 0.12, 0.07);    // D4 — quiet, non-judgmental
      }
    } catch (e) { /* audio unavailable — play silently */ }
  }

  // ---------- Map ----------

  // Draws every country into the <svg> and returns code -> svg node.
  // Countries too small to draw at this resolution are circles ("dots").
  function buildMap(svg) {
    const nodes = new Map();
    svg.setAttribute("viewBox", MAP_DATA.viewBox);
    const frag = document.createDocumentFragment();
    for (const [code, shape] of Object.entries(MAP_DATA.shapes)) {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", shape.d);
      p.setAttribute("class", "land");
      p.setAttribute("data-code", code);
      frag.appendChild(p);
      nodes.set(code, p);
    }
    for (const [code, [x, y]] of Object.entries(MAP_DATA.dots)) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 3.2);
      c.setAttribute("class", "dot");
      c.setAttribute("data-code", code);
      frag.appendChild(c);
      nodes.set(code, c);
    }
    svg.appendChild(frag);
    return nodes;
  }

  // ---------- Voice input ----------

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

  // Wires the mic button to continuous speech recognition. Callbacks:
  // onFinal(transcript, countriesHeard), onInterim(text), onStatus(msg, kind).
  // Returns { stop(), isListening() }; hides the mic where unsupported.
  function setupVoice(mic, { onFinal, onInterim, onStatus }) {
    let recognition = null;
    let listening = false;

    function stop() {
      listening = false;
      mic.classList.remove("listening");
      if (recognition) { try { recognition.stop(); } catch (e) {} }
    }
    const api = { stop, isListening: () => listening };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { mic.hidden = true; return api; }

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
          onFinal(transcript, findCountriesInTranscript(transcript));
        } else {
          interim += res[0].transcript;
        }
      }
      if (interim) onInterim(interim.trim());
    };
    recognition.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        listening = false;
        mic.classList.remove("listening");
        mic.disabled = true;
        onStatus("Microphone access was blocked — you can still type!", "err");
      }
    };
    recognition.onend = () => {
      if (listening) { try { recognition.start(); } catch (e) {} } // auto-restart after silence
      else mic.classList.remove("listening");
    };

    mic.addEventListener("click", () => {
      if (listening) { stop(); onStatus("Voice input off.", "info"); }
      else {
        listening = true;
        mic.classList.add("listening");
        onStatus("Listening — say a country name…", "info");
        try { recognition.start(); } catch (e) {}
      }
    });
    return api;
  }

  // ---------- Menu ----------

  // Hamburger menu: open/close, sound toggle, and an optional reset item.
  function setupMenu({ onReset } = {}) {
    const $ = (id) => document.getElementById(id);
    const menu = $("menu"), btn = $("menuBtn"), dropdown = $("menuDropdown");
    const soundToggle = $("soundToggle"), resetBtn = $("resetBtn");

    function open() {
      dropdown.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      dropdown.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dropdown.hidden) open(); else close();
    });
    // Clicking anywhere outside (or pressing Escape) dismisses the menu.
    document.addEventListener("click", (e) => {
      if (!dropdown.hidden && !menu.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dropdown.hidden) close();
    });

    function renderMute() {
      soundToggle.textContent = muted ? "🔇 Sound: Off" : "🔊 Sound: On";
      soundToggle.setAttribute("aria-checked", String(!muted));
    }
    soundToggle.addEventListener("click", () => {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
      renderMute();
      // audible confirmation on unmute — also proves sound works on this device
      if (!muted) sound("correct");
    });
    renderMute();

    if (resetBtn && onReset) {
      resetBtn.addEventListener("click", () => { close(); onReset(); });
    }
  }

  // ---------- On-screen keyboard (iOS app) ----------

  // In the iOS app (which tags <html> with .native-app) the system keyboard is
  // swapped for the game's own: Apple's letter-key size and spacing, but no
  // predictive-text bar, emoji/dictation row or Done bar — more room for the
  // map, and no typing help. Hardware keyboards still type into the field.
  const KB_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

  function setupKeyboard(input) {
    if (!document.documentElement.classList.contains("native-app")) return;
    input.setAttribute("inputmode", "none"); // no system keyboard

    const kb = document.createElement("div");
    kb.className = "kb";
    kb.hidden = true;
    function key(label, k, cls) {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = cls ? `kb-key ${cls}` : "kb-key";
      b.textContent = label;
      b.dataset.k = k;
      return b;
    }
    function row(...keys) {
      const r = document.createElement("div");
      r.className = "kb-row";
      r.append(...keys);
      kb.appendChild(r);
    }
    const letters = (s) => [...s].map((ch) => key(ch.toUpperCase(), ch, "letter"));
    const spacer = document.createElement("span");
    spacer.className = "kb-side";
    row(...letters(KB_ROWS[0]));
    row(...letters(KB_ROWS[1]));
    row(spacer, ...letters(KB_ROWS[2]), key("⌫", "back", "special kb-side"));
    row(key("space", " ", "space"), key("return", "enter", "special return"));
    document.body.appendChild(kb);

    // Words are capitalized as they're typed, like autocapitalize="words".
    function press(k) {
      if (input.disabled) return;
      if (k === "enter") {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        return;
      }
      let v = input.value;
      const wordStart = !v || v.endsWith(" ");
      if (k === "back") v = v.slice(0, -1);
      else if (k === " ") { if (wordStart) return; v += " "; }
      else v += wordStart ? k.toUpperCase() : k;
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Keys act on touch-down and never take focus, so the field keeps its
    // focus (and its open suggestion). Holding ⌫ repeats, like Apple's.
    const downKeys = new Map(); // pointerId -> key button
    let repeatTimer = null;
    function stopRepeat() { clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatTimer = null; }
    // Like Apple's, the keyboard has no dead zones: a touch in the gap
    // between keys (easy to hit when typing fast) goes to the nearest key.
    const keys = [...kb.querySelectorAll(".kb-key")];
    function keyAt(x, y) {
      let nearest = null, best = Infinity;
      for (const b of keys) {
        const r = b.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; nearest = b; }
      }
      return nearest;
    }
    kb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const b = keyAt(e.clientX, e.clientY);
      if (!b) return;
      b.classList.add("down");
      downKeys.set(e.pointerId, b);
      press(b.dataset.k);
      if (b.dataset.k === "back") {
        stopRepeat();
        repeatTimer = setTimeout(() => { repeatTimer = setInterval(() => press("back"), 90); }, 450);
      }
    });
    function release(e) {
      const b = downKeys.get(e.pointerId);
      if (!b) return;
      downKeys.delete(e.pointerId);
      b.classList.remove("down");
      if (b.dataset.k === "back") stopRepeat();
    }
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    // On iOS a tap blurs the field unless its touch and mouse events are
    // cancelled too (pointerdown alone isn't enough).
    kb.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    kb.addEventListener("mousedown", (e) => e.preventDefault());

    // Shown whenever the field is on screen; dimmed while it's disabled.
    // The page reserves the keyboard's height at the bottom so nothing
    // ends up hidden behind it.
    function update() {
      const show = input.offsetParent !== null;
      if (kb.hidden === show) kb.hidden = !show;
      kb.classList.toggle("off", input.disabled);
      document.body.classList.toggle("kb-open", show);
      if (show) document.documentElement.style.setProperty("--kb-h", `${kb.offsetHeight}px`);
    }
    new MutationObserver(update).observe(document.body, {
      subtree: true, attributes: true, attributeFilter: ["hidden", "disabled"],
    });
    window.addEventListener("resize", update);
    update();
  }

  return { normalize, lookup, suggest, sound, buildMap, setupVoice, setupMenu, setupKeyboard };
})();
