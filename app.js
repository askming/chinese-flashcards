"use strict";

/* ============================================================
 * 汉字 Flashcards
 *   home → pick level → shuffled deck of flip cards → summary
 *   Progress is stored per character in localStorage.
 * ============================================================ */

const DATA_URL = "data/characters.json";
const STORE_KEY = "hanzi-flashcards-progress-v1";
const ALL = "__all__";

const $ = (id) => document.getElementById(id);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let DATA = { levels: [], characters: [] };
let progress = loadProgress();
const session = { levelId: null, deck: [], i: 0, known: [], unknown: [] };
let writer = null;

/* ---------- storage ---------- */
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* private mode / quota */ }
}
function record(char, knew) {
  const p = progress[char] || { known: 0, unknown: 0 };
  knew ? p.known++ : p.unknown++;
  p.last = knew ? "known" : "unknown";
  p.at = Date.now();
  progress[char] = p;
  saveProgress();
}

/* ---------- helpers ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const charsIn = (levelId) =>
  levelId === ALL ? DATA.characters : DATA.characters.filter((c) => c.level === levelId);
const highlight = (text, ch) => esc(text).split(esc(ch)).join(`<mark>${esc(ch)}</mark>`);

function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === screenId));
  window.scrollTo(0, 0);
}

/* ---------- speech (iOS has built-in zh-CN voices) ---------- */
let zhVoice = null;
function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  zhVoice = voices.find((v) => v.lang === "zh-CN") || voices.find((v) => v.lang.startsWith("zh")) || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  if (zhVoice) u.voice = zhVoice;
  u.rate = 0.8;
  speechSynthesis.speak(u);
}

/* ---------- home ---------- */
function renderHome() {
  const levels = [...DATA.levels];
  if (levels.length > 1) levels.push({ id: ALL, name: "All levels", description: "Mixed review" });

  $("level-list").innerHTML = levels.map((lv) => {
    const chars = charsIn(lv.id);
    const knownNow = chars.filter((c) => progress[c.char]?.last === "known").length;
    const pct = chars.length ? Math.round((100 * knownNow) / chars.length) : 0;
    return `<li><button class="level-btn" type="button" data-level="${esc(lv.id)}">
        <span class="level-name">${esc(lv.name)}</span>
        <span class="level-count">${knownNow} / ${chars.length}<br>known</span>
        <span class="level-desc">${esc(lv.description || "")}</span>
        <span class="level-preview">${esc(chars.slice(0, 12).map((c) => c.char).join(""))}</span>
        <span class="level-bar"><div style="width:${pct}%"></div></span>
      </button></li>`;
  }).join("");
}

/* ---------- study session ---------- */
function startSession(levelId, chars = charsIn(levelId)) {
  if (!chars.length) return;
  Object.assign(session, { levelId, deck: shuffle(chars), i: 0, known: [], unknown: [] });
  show("study");
  renderCard();
}

function renderCard() {
  const c = session.deck[session.i];
  const card = $("card");

  // Un-flip instantly (no animation) so the next answer isn't revealed.
  const wrap = card.parentElement;
  card.classList.add("no-anim");
  card.classList.remove("flipped");
  wrap.classList.remove("enter");
  void card.offsetWidth;
  card.classList.remove("no-anim");
  wrap.classList.add("enter");

  $("front-char").textContent = c.char;
  $("progress-text").textContent = `${session.i + 1} / ${session.deck.length}`;
  $("progress-bar").style.width = `${(100 * session.i) / session.deck.length}%`;

  // Pre-fill the back (hidden until flip)
  $("back-char").textContent = c.char;
  $("back-pinyin").textContent = c.pinyin || "";
  $("back-meaning").textContent = c.meaning || "";
  $("back-words").innerHTML = (c.words || []).map((w) =>
    `<li data-speak="${esc(w.word)}">
       <span class="word-zh">${highlight(w.word, c.char)}</span>
       <span class="word-py">${esc(w.pinyin || "")}</span>
       ${w.meaning ? `<span class="word-en">${esc(w.meaning)}</span>` : ""}
     </li>`).join("");
  const s = c.sentence;
  $("back-sentence").innerHTML = s
    ? `<div class="sent-zh">${highlight(s.text, c.char)}</div>
       ${s.pinyin ? `<div class="sent-py">${esc(s.pinyin)}</div>` : ""}
       ${s.meaning ? `<div class="sent-en">${esc(s.meaning)}</div>` : ""}`
    : "";
  $("back-sentence").dataset.speak = s?.text || "";
  $("back-sentence").hidden = !s;

  // Reset stroke-order box; it is built lazily on flip.
  $("writer").innerHTML = "";
  $("writer-msg").textContent = "";
  writer = null;
}

function answer(knew) {
  const card = $("card");
  if (card.classList.contains("flipped")) return;
  const c = session.deck[session.i];
  record(c.char, knew);
  (knew ? session.known : session.unknown).push(c);

  const tag = $("result-tag");
  tag.textContent = knew ? "✓ You knew it" : "✗ Keep practicing";
  tag.className = `result-tag ${knew ? "known" : "unknown"}`;

  card.querySelector(".back-scroll").scrollTop = 0;
  card.classList.add("flipped");
  buildWriter(c.char);
}

function next() {
  window.speechSynthesis?.cancel();
  session.i++;
  if (session.i >= session.deck.length) return showSummary();
  renderCard();
}

/* ---------- stroke order (Hanzi Writer) ---------- */
function buildWriter(ch) {
  if (!window.HanziWriter) { $("writer-msg").textContent = "Stroke data unavailable"; return; }
  const box = $("writer");
  const size = box.clientWidth || 150;
  writer = HanziWriter.create(box, ch, {
    width: size, height: size, padding: 8,
    showOutline: true,
    strokeColor: "#222", radicalColor: "#c0392b", outlineColor: "#e8dcd6",
    strokeAnimationSpeed: 1.1, delayBetweenStrokes: 250,
    onLoadCharDataError: () => { $("writer-msg").textContent = "No stroke data (offline?)"; },
  });
  // Auto-play once after the flip finishes.
  setTimeout(() => writer?.animateCharacter(), 600);
}

function animateStrokes() {
  if (!writer) return;
  writer.cancelQuiz();
  $("writer-msg").textContent = "";
  writer.showCharacter();
  writer.animateCharacter();
}

function quiz() {
  if (!writer) return;
  let mistakes = 0;
  $("writer-msg").textContent = "Trace each stroke in order";
  writer.quiz({
    showHintAfterMisses: 2,
    onMistake: () => { mistakes++; },
    onComplete: () => {
      $("writer-msg").textContent = mistakes === 0 ? "Perfect! 太棒了 🎉" : `Done, ${mistakes} slip${mistakes > 1 ? "s" : ""}`;
    },
  });
}

/* ---------- summary ---------- */
function showSummary() {
  $("sum-known").textContent = session.known.length;
  $("sum-unknown").textContent = session.unknown.length;
  $("sum-missed").textContent = session.unknown.map((c) => c.char).join("");
  $("btn-review-missed").hidden = session.unknown.length === 0;
  show("summary");
}

/* ---------- wiring ---------- */
function wire() {
  $("level-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (b) startSession(b.dataset.level);
  });
  $("btn-known").onclick = () => answer(true);
  $("btn-unknown").onclick = () => answer(false);
  $("btn-next").onclick = next;
  $("btn-animate").onclick = animateStrokes;
  $("btn-quiz").onclick = quiz;
  $("quit").onclick = () => { window.speechSynthesis?.cancel(); renderHome(); show("home"); };

  document.querySelector("[data-speak-char]").onclick = () => speak(session.deck[session.i]?.char);
  $("back-words").addEventListener("click", (e) => speak(e.target.closest("[data-speak]")?.dataset.speak));
  $("back-sentence").onclick = (e) => speak(e.currentTarget.dataset.speak);

  $("btn-review-missed").onclick = () => startSession(session.levelId, session.unknown);
  $("btn-again").onclick = () => startSession(session.levelId);
  $("btn-home").onclick = () => { renderHome(); show("home"); };
  $("reset-progress").onclick = () => {
    if (confirm("Clear all saved progress?")) { progress = {}; saveProgress(); renderHome(); }
  };

  // Keyboard shortcuts for desktop testing: ← don't know, → know, space/enter next
  document.addEventListener("keydown", (e) => {
    if (!$("study").classList.contains("active")) return;
    const flipped = $("card").classList.contains("flipped");
    if (!flipped && e.key === "ArrowRight") answer(true);
    else if (!flipped && e.key === "ArrowLeft") answer(false);
    else if (flipped && (e.key === " " || e.key === "Enter")) { e.preventDefault(); next(); }
  });
}

/* ---------- boot ---------- */
async function init() {
  wire();
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
    if (!DATA.levels?.length) {
      // Derive levels from characters if the JSON omits a "levels" list.
      DATA.levels = [...new Set(DATA.characters.map((c) => c.level))].map((id) => ({ id, name: `Level ${id}` }));
    }
    renderHome();
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent = `Couldn't load ${DATA_URL} (${err.message}).`;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
