"use strict";

/* ============================================================
 * 汉字 Flashcards
 *   Home (calendar + stats) · Levels → level grid → flip cards · Summary
 *   Everything is stored on the device in localStorage.
 * ============================================================ */

const DATA_URL = "data/characters.json";
const PROGRESS_KEY = "hanzi-flashcards-progress-v1"; // { 字: {known, unknown, last, at} }
const ACTIVITY_KEY = "hanzi-flashcards-activity-v1"; // { "2026-11-14": {sec, n} }
const RANDOM = "__random__";
const IDLE_CAP_MS = 2 * 60 * 1000; // time on one card beyond this isn't counted as practice

const $ = (id) => document.getElementById(id);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let DATA = { levels: [], characters: [] };
let progress = load(PROGRESS_KEY);
let activity = load(ACTIVITY_KEY);
const session = { levelId: null, title: "", deck: [], i: 0, known: [], unknown: [] };
let detailLevel = null;
let writer = null;

/* ---------- storage ---------- */
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}
const isMastered = (ch) => progress[ch]?.last === "known";
const status = (ch) => (!progress[ch] ? "new" : isMastered(ch) ? "mastered" : "missed");

/* ---------- practice-time tracking ---------- */
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let lastTick = null;

function startClock() { lastTick = Date.now(); }
function tick(countCard = false) {
  const now = Date.now();
  const day = (activity[dayKey()] ||= { sec: 0, n: 0 });
  if (lastTick !== null) day.sec += Math.min(now - lastTick, IDLE_CAP_MS) / 1000;
  if (countCard) day.n++;
  lastTick = now;
  save(ACTIVITY_KEY, activity);
}
function stopClock() {
  if (lastTick !== null) tick();
  lastTick = null;
}
document.addEventListener("visibilitychange", () => {
  if (!$("study").classList.contains("active")) return;
  document.hidden ? stopClock() : startClock();
});

function record(char, knew) {
  const p = progress[char] || { known: 0, unknown: 0 };
  knew ? p.known++ : p.unknown++;
  p.last = knew ? "known" : "unknown";
  p.at = Date.now();
  progress[char] = p;
  save(PROGRESS_KEY, progress);
  tick(true);
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
  levelId === RANDOM ? DATA.characters : DATA.characters.filter((c) => c.level === levelId);
const levelName = (levelId) =>
  levelId === RANDOM ? "Random" : DATA.levels.find((l) => l.id === levelId)?.name || levelId;
const highlight = (text, term) =>
  term ? esc(text).split(esc(term)).join(`<mark>${esc(term)}</mark>`) : esc(text);

/* ---------- navigation ---------- */
const TAB_OF = { home: "home", levels: "levels", detail: "levels", study: "levels", done: "levels", stats: "stats" };
function show(screenId) {
  if ($("study").classList.contains("active") && screenId !== "study") {
    stopClock();
    window.speechSynthesis?.cancel();
  }
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === screenId));
  document.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("current", b.dataset.nav === TAB_OF[screenId]));
  window.scrollTo(0, 0);
}
const go = {
  home: () => { renderHome(); show("home"); },
  levels: () => { renderLevels(); show("levels"); },
  stats: () => { renderStats(); show("stats"); },
  detail: (levelId) => { renderDetail(levelId); show("detail"); },
};

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

/* ---------- Home ---------- */
const practiced = (d) => (activity[dayKey(d)]?.n || 0) > 0;

function renderHome() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  $("home-date").textContent = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Month calendar: practiced days are filled in.
  const firstDow = new Date(y, m, 1).getDay();
  const nDays = new Date(y, m + 1, 0).getDate();
  let html = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="dow">${d}</div>`).join("");
  html += "<div></div>".repeat(firstDow);
  for (let d = 1; d <= nDays; d++) {
    const a = activity[dayKey(new Date(y, m, d))];
    const cls = [a?.n ? "practiced" : "", d === now.getDate() ? "today" : ""].join(" ");
    const tip = a?.n ? ` title="${a.n} cards · ${Math.round(a.sec / 60)} min"` : "";
    html += `<div class="day ${cls}"${tip}>${d}</div>`;
  }
  $("calendar").innerHTML = html;

  // Streak: consecutive practiced days ending today (or yesterday, if today isn't done yet).
  let streak = 0;
  const d = new Date();
  if (!practiced(d)) d.setDate(d.getDate() - 1);
  while (practiced(d)) { streak++; d.setDate(d.getDate() - 1); }

  // Daily average: minutes per practiced day this month.
  const monthPrefix = dayKey(now).slice(0, 7);
  const monthDays = Object.entries(activity).filter(([k, v]) => k.startsWith(monthPrefix) && v.n > 0);
  const avgMin = monthDays.length ? Math.round(monthDays.reduce((s, [, v]) => s + v.sec, 0) / 60 / monthDays.length) : 0;

  const mastered = new Set(DATA.characters.filter((c) => isMastered(c.char)).map((c) => c.char)).size;

  $("home-stats").innerHTML = `
    <li>🔥 <strong>${streak}</strong>-day streak</li>
    <li>⏱ Daily average: <strong>${avgMin}</strong> min${avgMin === 1 ? "" : "s"} <span class="sub">(this month)</span></li>
    <li>⭐ Mastered <strong>${mastered}</strong> character${mastered === 1 ? "" : "s"} so far</li>`;
}

/* ---------- Levels ---------- */
function renderLevels() {
  const rows = [...DATA.levels, { id: RANDOM, name: "Random", description: "All levels, mixed" }];
  $("level-list").innerHTML = rows.map((lv) => {
    const chars = charsIn(lv.id);
    const m = chars.filter((c) => isMastered(c.char)).length;
    return `<li><button class="level-btn" type="button" data-level="${esc(lv.id)}">
        <span class="level-name">${esc(lv.name)}</span>
        <span class="level-count">${m}/${chars.length}</span>
        ${lv.description ? `<span class="level-desc">${esc(lv.description)}</span>` : ""}
        <span class="chev">›</span>
      </button></li>`;
  }).join("");
}

function renderDetail(levelId) {
  detailLevel = levelId;
  const chars = charsIn(levelId);
  const m = chars.filter((c) => isMastered(c.char)).length;
  $("detail-title").textContent = `${levelName(levelId)} Characters`;
  $("detail-sub").textContent = `${chars.length} characters · ${m} mastered`;
  $("detail-grid").innerHTML = chars
    .map((c) => `<span class="cell ${status(c.char)}">${esc(c.char)}</span>`)
    .join("");
}

/* ---------- Study session ---------- */
function startSession(levelId, chars = charsIn(levelId), title = levelName(levelId)) {
  if (!chars.length) return;
  Object.assign(session, { levelId, title, deck: shuffle(chars), i: 0, known: [], unknown: [] });
  $("study-title").textContent = `Currently reviewing: ${title}`;
  show("study");
  startClock();
  renderCard();
}

function renderCard() {
  const c = session.deck[session.i];
  const card = $("card");
  const wrap = card.parentElement;

  // Un-flip instantly (no animation) so the next answer isn't revealed.
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
  $("back-pinyin").textContent = c.pinyin || "";
  $("back-meaning").textContent = c.meaning || "";
  $("back-meaning").hidden = !c.meaning;

  const words = c.words || [];
  $("words-block").hidden = !words.length;
  $("back-words").innerHTML = words.map((w) =>
    `<li data-speak="${esc(w.word)}">
       <span class="word-zh">${highlight(w.word, c.char)}</span>
       <span class="word-py">${esc(w.pinyin || "")}</span>
       ${w.meaning ? `<span class="word-en">${esc(w.meaning)}</span>` : ""}
     </li>`).join("");

  // In the sentence, highlight the example word it uses (e.g. 单位), else the character.
  const s = c.sentence;
  $("sentence-block").hidden = !s?.text;
  if (s?.text) {
    const term = words.map((w) => w.word).find((w) => w && s.text.includes(w)) || c.char;
    $("back-sentence").innerHTML =
      `<div class="sent-zh">${highlight(s.text, term)}</div>
       ${s.pinyin ? `<div class="sent-py">${esc(s.pinyin)}</div>` : ""}
       ${s.meaning ? `<div class="sent-en">${esc(s.meaning)}</div>` : ""}`;
    $("back-sentence").dataset.speak = s.text;
  }

  // Stroke-order box is built lazily on flip.
  $("writer").innerHTML = "";
  $("writer").classList.remove("fallback");
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
  tag.textContent = knew ? "✓ 认识" : "✗ 不认识";
  tag.className = `result-tag ${knew ? "known" : "unknown"}`;

  card.querySelector(".back-scroll").scrollTop = 0;
  card.classList.add("flipped");
  buildWriter(c.char);
}

function next() {
  window.speechSynthesis?.cancel();
  session.i++;
  if (session.i >= session.deck.length) return showDone();
  renderCard();
}

function viewAll() {
  session.levelId === RANDOM || !DATA.levels.some((l) => l.id === session.levelId)
    ? go.levels()
    : go.detail(session.levelId);
}

/* ---------- stroke order (Hanzi Writer) ---------- */
function buildWriter(ch) {
  const box = $("writer");
  const fallback = () => { box.classList.add("fallback"); box.textContent = ch; };
  if (!window.HanziWriter) return fallback();
  const size = box.clientWidth || 180;
  writer = HanziWriter.create(box, ch, {
    width: size, height: size, padding: 10,
    showOutline: true,
    strokeColor: "#222", radicalColor: "#c0392b", outlineColor: "#ece2dc",
    strokeAnimationSpeed: 1.1, delayBetweenStrokes: 250,
    onLoadCharDataError: () => { writer = null; fallback(); $("writer-msg").textContent = "No stroke data (offline?)"; },
  });
  setTimeout(() => writer?.animateCharacter(), 600); // play once after the flip
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
  $("writer-msg").textContent = "按笔顺写一写 · Trace each stroke in order";
  writer.quiz({
    showHintAfterMisses: 2,
    onMistake: () => { mistakes++; },
    onComplete: () => {
      $("writer-msg").textContent = mistakes === 0 ? "太棒了！Perfect 🎉" : `写完了 · ${mistakes} slip${mistakes > 1 ? "s" : ""}`;
    },
  });
}

/* ---------- end of session ---------- */
function showDone() {
  $("sum-known").textContent = session.known.length;
  $("sum-unknown").textContent = session.unknown.length;
  $("sum-missed").textContent = session.unknown.map((c) => c.char).join("");
  $("btn-review-missed").hidden = session.unknown.length === 0;
  show("done");
}

/* ---------- Summary ---------- */
function renderStats() {
  const all = DATA.characters;
  const total = all.filter((c) => isMastered(c.char)).length;
  $("stats-total").textContent = `Overall: ${total}/${all.length} mastered`;
  $("stats-list").innerHTML = DATA.levels.map((lv) => {
    const chars = charsIn(lv.id);
    const m = chars.filter((c) => isMastered(c.char)).length;
    const pct = chars.length ? Math.round((100 * m) / chars.length) : 0;
    return `<li><button class="stat-row" type="button" data-level="${esc(lv.id)}" ${m === chars.length ? "disabled" : ""}>
        <span class="stat-name">${esc(lv.name)}</span>
        <span class="stat-bar"><span class="ok" style="width:${pct}%"></span><span class="no" style="width:${100 - pct}%"></span></span>
        <span class="stat-num">${m}/${chars.length} (${pct}%)</span>
      </button></li>`;
  }).join("");
}

/* ---------- wiring ---------- */
function wire() {
  document.querySelector(".topnav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (b) go[b.dataset.nav]();
  });
  $("level-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (!b) return;
    b.dataset.level === RANDOM ? startSession(RANDOM) : go.detail(b.dataset.level);
  });
  $("btn-start").onclick = () => startSession(detailLevel);
  $("stats-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (!b) return;
    const id = b.dataset.level;
    const todo = charsIn(id).filter((c) => !isMastered(c.char));
    startSession(id, todo, `${levelName(id)} · 未掌握`);
  });

  $("btn-known").onclick = () => answer(true);
  $("btn-unknown").onclick = () => answer(false);
  $("btn-next").onclick = next;
  $("btn-viewall").onclick = viewAll;
  $("btn-animate").onclick = animateStrokes;
  $("btn-quiz").onclick = quiz;

  document.querySelector("[data-speak-char]").onclick = () => speak(session.deck[session.i]?.char);
  $("back-words").addEventListener("click", (e) => speak(e.target.closest("[data-speak]")?.dataset.speak));
  $("back-sentence").onclick = (e) => speak(e.currentTarget.dataset.speak);

  $("btn-review-missed").onclick = () => startSession(session.levelId, session.unknown, `${session.title.split(" · ")[0]} · 不认识`);
  $("btn-again").onclick = () => startSession(session.levelId);
  $("btn-to-levels").onclick = go.levels;
  $("reset-progress").onclick = () => {
    if (confirm("Clear all saved progress and practice history?")) {
      progress = {}; activity = {};
      save(PROGRESS_KEY, progress); save(ACTIVITY_KEY, activity);
      renderStats();
    }
  };

  // Keyboard shortcuts for desktop testing: → 认识, ← 不认识, space/enter 下一个
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
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent = `Couldn't load ${DATA_URL} (${err.message}).`;
  }
  go.home();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
