"use strict";

/* ============================================================
 * 汉字 Flashcards
 *   Home (calendar, stats, day log) · Levels: grade → unit → character grid → cards · Summary
 *   Everything is stored on the device in localStorage.
 * ============================================================ */

const DATA_URL = "data/characters.json";
const PROGRESS_KEY = "hanzi-flashcards-progress-v1"; // { 字: {known, unknown, last, at} }
const ACTIVITY_KEY = "hanzi-flashcards-activity-v1"; // { "2026-11-14": {sec, n, r: {字: 1|0}, lv: [unitId]} }
const VOICE_KEY = "hanzi-flashcards-voice";              // voice id, or "device"
const IDLE_CAP_MS = 2 * 60 * 1000; // time on one card beyond this isn't counted as practice

const $ = (id) => document.getElementById(id);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ZH = /[㐀-鿿]/;

let DATA = { grades: [], levels: [], characters: [] };
let progress = load(PROGRESS_KEY);
let activity = load(ACTIVITY_KEY);
// mode: "practice" (answer 认识/不认识) or "browse" (look through cards, nothing recorded)
const session = { mode: "practice", scope: null, title: "", deck: [], i: 0, known: [], unknown: [] };
let detailScope = null;
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

/* ---------- scopes: what a grid / session covers ---------- */
// {type: "unit", id} | {type: "grade", id} | {type: "random"} | {type: "list", chars, title}
const gradeOf = (gid) => DATA.grades.find((g) => g.id === gid);
const unitOf = (uid) => DATA.levels.find((l) => l.id === uid);
function charsOf(scope) {
  switch (scope.type) {
    case "unit": return DATA.characters.filter((c) => c.level === scope.id);
    case "grade": {
      const units = new Set(DATA.levels.filter((l) => l.grade === scope.id).map((l) => l.id));
      return DATA.characters.filter((c) => units.has(c.level));
    }
    case "random": return DATA.characters;
    default: return scope.chars;
  }
}
function titleOf(scope) {
  switch (scope.type) {
    case "unit": {
      const u = unitOf(scope.id);
      const g = u && gradeOf(u.grade);
      return g ? `${g.name} · ${u.name}` : u?.name || scope.id;
    }
    case "grade": return `${gradeOf(scope.id)?.name || scope.id} · All`;
    case "random": return "Random";
    default: return scope.title;
  }
}
const masteredCount = (chars) => chars.filter((c) => isMastered(c.char)).length;

/* ---------- practice-time tracking + day log ---------- */
const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let lastTick = null;

function today() {
  return (activity[dayKey()] ||= { sec: 0, n: 0, r: {}, lv: [] });
}
function startClock() { lastTick = Date.now(); }
function tick() {
  const now = Date.now();
  if (lastTick !== null) today().sec += Math.min(now - lastTick, IDLE_CAP_MS) / 1000;
  lastTick = now;
  save(ACTIVITY_KEY, activity);
}
function stopClock() {
  if (lastTick !== null) tick();
  lastTick = null;
}
document.addEventListener("visibilitychange", () => {
  if (!$("study").classList.contains("active") || session.mode !== "practice") return;
  document.hidden ? stopClock() : startClock();
});

function record(c, knew) {
  const p = progress[c.char] || { known: 0, unknown: 0 };
  knew ? p.known++ : p.unknown++;
  p.last = knew ? "known" : "unknown";
  p.at = Date.now();
  progress[c.char] = p;
  save(PROGRESS_KEY, progress);

  const d = today();
  d.n++;
  (d.r ||= {})[c.char] = knew ? 1 : 0;
  d.lv ||= [];
  if (!d.lv.includes(c.level)) d.lv.push(c.level);
  tick();
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
const charByValue = (ch) => DATA.characters.find((c) => c.char === ch);

/** Text with pinyin over each character (<ruby>). `py` is an array aligned to the text
 *  (or a space-separated string of syllables for the Chinese characters). */
function rubyHTML(text, py, hlTerm) {
  const chars = [...text];
  let syl = Array.isArray(py) ? py : null;
  if (!syl && typeof py === "string") {
    const toks = py.trim().split(/\s+/);
    const nZh = chars.filter((c) => ZH.test(c)).length;
    if (toks.length === nZh) { let k = 0; syl = chars.map((c) => (ZH.test(c) ? toks[k++] : "")); }
  }
  const hl = new Array(chars.length).fill(false);
  if (hlTerm) {
    let from = 0, at;
    while ((at = text.indexOf(hlTerm, from)) !== -1) {
      for (let k = at; k < at + hlTerm.length; k++) hl[k] = true;
      from = at + hlTerm.length;
    }
  }
  // Each character is a little column: pinyin on top, character below. The column is as
  // wide as the wider of the two, so syllables never run into each other.
  return chars.map((c, k) => {
    const cls = `pz${hl[k] ? " hl" : ""}${ZH.test(c) ? "" : " punct"}`;
    const top = ZH.test(c) && syl?.[k] ? esc(syl[k]) : "&nbsp;";
    return `<span class="${cls}"><span class="pz-py">${top}</span><span class="pz-zh">${esc(c)}</span></span>`;
  }).join("");
}

/* ---------- navigation ---------- */
const TAB_OF = { home: "home", levels: "levels", detail: "levels", study: "levels", done: "levels", stats: "stats" };
function show(screenId) {
  if ($("study").classList.contains("active") && screenId !== "study") {
    stopClock();
    stopAudio();
  }
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === screenId));
  document.querySelectorAll("[data-nav]").forEach((b) => b.classList.toggle("current", b.dataset.nav === TAB_OF[screenId]));
  window.scrollTo(0, 0);
}
const go = {
  home: () => {
    const t = new Date();
    Object.assign(cal, { y: t.getFullYear(), m: t.getMonth(), sel: dayKey(t) }); // always open on today
    renderHome(); show("home");
  },
  levels: () => { renderLevels(); show("levels"); },
  stats: () => { renderStats(); renderVoices(); show("stats"); },
  detail: (scope) => { renderDetail(scope); show("detail"); },
};

/* ---------- audio: pre-generated neural voice clips, Web Speech as fallback ---------- */
const player = new Audio();
let zhVoice = null;
function pickVoice() {
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => /^zh[-_]CN/i.test(v.lang) || v.lang === "zh");
  // prefer higher-quality voices if the device has them installed
  zhVoice = voices.find((v) => /premium|enhanced|增强|高品质/i.test(v.name)) || voices[0] || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function stopAudio() {
  player.pause();
  window.speechSynthesis?.cancel();
}
// The chosen voice: one of DATA.voices (pre-generated clips) or "device" (Web Speech).
function voiceId() {
  const v = localStorage.getItem(VOICE_KEY);
  const ids = (DATA.voices || []).map((x) => x.id);
  return v === "device" || ids.includes(v) ? v : ids[0] || "device";
}
function speak(text, key, voice = voiceId()) {
  stopAudio();
  if (key && voice !== "device") {
    player.src = `audio/${voice}/${key}.mp3`;
    player.play().catch(() => speakSynth(text));
  } else {
    speakSynth(text);
  }
}
function speakSynth(text) {
  if (!("speechSynthesis" in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  if (zhVoice) u.voice = zhVoice;
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

/* ---------- Home: calendar, stats, day log ---------- */
const now0 = new Date();
const cal = { y: now0.getFullYear(), m: now0.getMonth(), sel: dayKey(now0) };
const practiced = (d) => (activity[dayKey(d)]?.n || 0) > 0;

function renderHome() {
  $("home-date").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  renderCalendar();
  renderHomeStats();
  renderDayPanel();
}

function renderCalendar() {
  const { y, m } = cal;
  const todayKey = dayKey();
  $("cal-title").textContent = new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const firstDow = new Date(y, m, 1).getDay();
  const nDays = new Date(y, m + 1, 0).getDate();
  let html = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="dow">${d}</div>`).join("");
  html += "<div></div>".repeat(firstDow);
  for (let d = 1; d <= nDays; d++) {
    const key = dayKey(new Date(y, m, d));
    const cls = ["day", activity[key]?.n ? "practiced" : "", key === todayKey ? "today" : "", key === cal.sel ? "selected" : ""].join(" ");
    html += `<button type="button" class="${cls}" data-day="${key}">${d}</button>`;
  }
  $("calendar").innerHTML = html;
}

function renderHomeStats() {
  // Streak: consecutive practiced days ending today (or yesterday, if today isn't done yet).
  let streak = 0;
  const d = new Date();
  if (!practiced(d)) d.setDate(d.getDate() - 1);
  while (practiced(d)) { streak++; d.setDate(d.getDate() - 1); }

  // Daily average: minutes per practiced day in the month shown.
  const prefix = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}`;
  const days = Object.entries(activity).filter(([k, v]) => k.startsWith(prefix) && v.n > 0);
  const avg = days.length ? Math.round(days.reduce((s, [, v]) => s + v.sec, 0) / 60 / days.length) : 0;
  const monthName = new Date(cal.y, cal.m, 1).toLocaleDateString("en-US", { month: "short" });

  const mastered = new Set(DATA.characters.filter((c) => isMastered(c.char)).map((c) => c.char)).size;
  $("home-stats").innerHTML = `
    <div><strong>🔥 ${streak}</strong><span>day streak</span></div>
    <div><strong>⏱ ${avg}</strong><span>min/day · ${monthName}</span></div>
    <div><strong>⭐ ${mastered}</strong><span>mastered</span></div>`;
}

function renderDayPanel() {
  const [y, m, d] = cal.sel.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const a = activity[cal.sel];
  if (!a?.n) {
    $("day-panel").innerHTML = `<h3>${label}</h3><p class="sub">No practice on this day.</p>`;
    return;
  }
  const r = a.r || {};
  const knew = Object.keys(r).filter((ch) => r[ch] === 1);
  const missed = Object.keys(r).filter((ch) => r[ch] === 0);
  const units = (a.lv || []).map((id) => titleOf({ type: "unit", id })).join(" · ");
  const chips = (list, cls) => list.map((ch) => `<button type="button" class="chip-char ${cls}" data-char="${esc(ch)}">${esc(ch)}</button>`).join("");
  $("day-panel").innerHTML = `
    <h3>${label}</h3>
    <p class="day-meta">⏱ ${Math.max(1, Math.round(a.sec / 60))} min · 📝 ${a.n} card${a.n === 1 ? "" : "s"}${units ? ` · ${esc(units)}` : ""}</p>
    ${knew.length ? `<div class="day-group"><span class="tag known">认识 ${knew.length}</span><div class="chips">${chips(knew, "known")}</div></div>` : ""}
    ${missed.length ? `<div class="day-group"><span class="tag unknown">不认识 ${missed.length}</span><div class="chips">${chips(missed, "unknown")}</div></div>` : ""}
    ${missed.length ? `<button type="button" class="btn btn-red btn-small" id="day-review">再练不认识的</button>` : ""}
    ${!Object.keys(r).length ? `<p class="sub">(Character details are recorded from Nov 2026 on.)</p>` : ""}`;
  $("day-panel").dataset.knew = knew.join("");
  $("day-panel").dataset.missed = missed.join("");
}

function moveMonth(delta) {
  const d = new Date(cal.y, cal.m + delta, 1);
  cal.y = d.getFullYear();
  cal.m = d.getMonth();
  renderCalendar();
  renderHomeStats();
}

/* ---------- Levels: grades → units ---------- */
function renderLevels() {
  const row = (scope, name, extra = "") => {
    const chars = charsOf(scope);
    return `<li><button class="level-btn ${extra}" type="button" data-scope='${esc(JSON.stringify(scope))}'>
        <span class="level-name">${esc(name)}</span>
        <span class="level-count">${masteredCount(chars)}/${chars.length}</span>
        <span class="chev">›</span>
      </button></li>`;
  };
  let html = "";
  for (const g of DATA.grades) {
    const units = DATA.levels.filter((l) => l.grade === g.id);
    html += `<li class="grade-block"><h3 class="grade-head">${esc(g.name)}</h3><ul class="unit-list">
      ${units.map((u) => row({ type: "unit", id: u.id }, u.name)).join("")}
      ${units.length > 1 ? row({ type: "grade", id: g.id }, `All of ${g.name}`, "grade-all") : ""}
    </ul></li>`;
  }
  html += row({ type: "random" }, "Random", "random");
  $("level-list").innerHTML = html;
}

/* ---------- character grid (all characters of a unit / grade) ---------- */
function renderDetail(scope) {
  detailScope = scope;
  const chars = charsOf(scope);
  $("detail-title").textContent = titleOf(scope);
  $("detail-sub").textContent = `${chars.length} characters · ${masteredCount(chars)} mastered · tap one to open it`;

  // group by lesson within a unit, by unit within a grade
  const groups = new Map();
  for (const c of chars) {
    const key = scope.type === "unit" ? c.lessonTitle || "" : unitOf(c.level)?.name || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  let idx = 0;
  $("detail-grid").innerHTML = [...groups].map(([name, list]) => `
    ${name ? `<h3 class="group-head">${esc(name)}</h3>` : ""}
    <div class="char-grid">${list.map((c) => `<button type="button" class="cell ${status(c.char)}" data-idx="${idx++}">${esc(c.char)}</button>`).join("")}</div>`
  ).join("");
}

/* ---------- study / browse ---------- */
function startSession(scope, chars = charsOf(scope)) {
  if (!chars.length) return;
  Object.assign(session, { mode: "practice", scope, title: titleOf(scope), deck: shuffle(chars), i: 0, known: [], unknown: [] });
  $("study-title").textContent = `Currently reviewing: ${session.title}`;
  show("study");
  startClock();
  renderCard();
}

function browse(scope, chars, i) {
  Object.assign(session, { mode: "browse", scope, title: titleOf(scope), deck: chars, i, known: [], unknown: [] });
  $("study-title").textContent = session.title;
  show("study");
  renderCard();
}

function renderCard() {
  const c = session.deck[session.i];
  const card = $("card");
  const wrap = card.parentElement;
  const browsing = session.mode === "browse";
  $("study").classList.toggle("browsing", browsing);

  // Un-flip instantly (no animation) so the next answer isn't revealed.
  card.classList.add("no-anim");
  card.classList.remove("flipped");
  wrap.classList.remove("enter");
  void card.offsetWidth;
  if (browsing) card.classList.add("flipped");    // browse mode shows the answer side directly
  void card.offsetWidth;
  card.classList.remove("no-anim");
  wrap.classList.add("enter");

  $("front-char").textContent = c.char;
  $("progress-text").textContent = `${session.i + 1} / ${session.deck.length}`;
  $("progress-bar").style.width = `${(100 * (browsing ? session.i + 1 : session.i)) / session.deck.length}%`;

  $("back-pinyin").textContent = c.pinyin || "";
  const words = c.words || [];
  $("words-block").hidden = !words.length;
  $("back-words").innerHTML = words.map((w, k) =>
    `<li data-word="${k}"><span class="word-zh">${rubyHTML(w.word, w.pinyin, c.char)}</span></li>`).join("");

  // In the sentence, highlight the example word it uses (e.g. 单位), else the character.
  const s = c.sentence;
  $("sentence-block").hidden = !s?.text;
  if (s?.text) {
    const term = words.map((w) => w.word).find((w) => w && s.text.includes(w)) || c.char;
    $("back-sentence").innerHTML = `<div class="sent-zh">${rubyHTML(s.text, s.pinyin, term)}</div>`;
  }

  // footer
  $("result-tag").hidden = browsing;
  $("btn-prev").hidden = !browsing;
  $("btn-prev").disabled = session.i === 0;
  $("btn-next").disabled = browsing && session.i === session.deck.length - 1;
  $("btn-next").textContent = browsing ? "下一个 ›" : "下一个";

  $("writer").innerHTML = "";
  $("writer").classList.remove("fallback");
  $("writer-msg").textContent = "";
  writer = null;
  card.querySelector(".back-scroll").scrollTop = 0;
  if (browsing) buildWriter(c.char, 350);
}

function answer(knew) {
  const card = $("card");
  if (card.classList.contains("flipped") || session.mode !== "practice") return;
  const c = session.deck[session.i];
  record(c, knew);
  (knew ? session.known : session.unknown).push(c);

  const tag = $("result-tag");
  tag.textContent = knew ? "✓ 认识" : "✗ 不认识";
  tag.className = `result-tag ${knew ? "known" : "unknown"}`;
  card.querySelector(".back-scroll").scrollTop = 0;
  card.classList.add("flipped");
  buildWriter(c.char, 600);
}

function next() {
  stopAudio();
  if (session.mode === "browse") {
    if (session.i < session.deck.length - 1) { session.i++; renderCard(); }
    return;
  }
  session.i++;
  if (session.i >= session.deck.length) return showDone();
  renderCard();
}
function prev() {
  stopAudio();
  if (session.mode === "browse" && session.i > 0) { session.i--; renderCard(); }
}

function viewAll() {
  const sc = session.scope;
  sc && (sc.type === "unit" || sc.type === "grade") ? go.detail(sc) : go.levels();
}

/* ---------- stroke order (Hanzi Writer) ---------- */
function buildWriter(ch, delay) {
  const box = $("writer");
  const fallback = () => { box.classList.add("fallback"); box.textContent = ch; };
  if (!window.HanziWriter) return fallback();
  const size = box.clientWidth || 160;
  const w = HanziWriter.create(box, ch, {
    width: size, height: size, padding: 10,
    showOutline: true,
    strokeColor: "#222", radicalColor: "#c0392b", outlineColor: "#ece2dc",
    strokeAnimationSpeed: 1.1, delayBetweenStrokes: 250,
    onLoadCharDataError: () => { writer = null; fallback(); $("writer-msg").textContent = "No stroke data (offline?)"; },
  });
  writer = w;
  setTimeout(() => writer === w && w.animateCharacter(), delay); // play once
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
  stopClock();
  $("sum-known").textContent = session.known.length;
  $("sum-unknown").textContent = session.unknown.length;
  $("sum-missed").textContent = session.unknown.map((c) => c.char).join("");
  $("btn-review-missed").hidden = session.unknown.length === 0;
  show("done");
}

/* ---------- Summary ---------- */
function renderStats() {
  const all = DATA.characters;
  $("stats-total").textContent = `Overall: ${masteredCount(all)}/${all.length} mastered`;
  const bar = (scope, name, cls = "") => {
    const chars = charsOf(scope);
    const m = masteredCount(chars);
    const pct = chars.length ? Math.round((100 * m) / chars.length) : 0;
    return `<li><button class="stat-row ${cls}" type="button" data-scope='${esc(JSON.stringify(scope))}' ${m === chars.length ? "disabled" : ""}>
        <span class="stat-name">${esc(name)}</span>
        <span class="stat-bar"><span class="ok" style="width:${pct}%"></span><span class="no" style="width:${100 - pct}%"></span></span>
        <span class="stat-num">${m}/${chars.length} (${pct}%)</span>
      </button></li>`;
  };
  $("stats-list").innerHTML = DATA.grades.map((g) => {
    const units = DATA.levels.filter((l) => l.grade === g.id);
    return `<li class="grade-block">${bar({ type: "grade", id: g.id }, g.name, "grade-row")}
      <ul class="unit-list">${units.map((u) => bar({ type: "unit", id: u.id }, u.name)).join("")}</ul></li>`;
  }).join("");
}

function renderVoices() {
  const cur = voiceId();
  const opts = [...(DATA.voices || []), { id: "device", name: "Device voice · 本机声音" }];
  $("voice-list").innerHTML = opts.map((v) => `
    <li><label class="voice-row">
      <input type="radio" name="voice" value="${esc(v.id)}" ${v.id === cur ? "checked" : ""}>
      <span class="voice-name">${esc(v.name)}</span>
      <button type="button" class="chip" data-sample="${esc(v.id)}">▶ 试听</button>
    </label></li>`).join("");
}

/* ---------- wiring ---------- */
const scopeFrom = (el) => JSON.parse(el.dataset.scope);

function wire() {
  document.querySelector(".topnav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (b) go[b.dataset.nav]();
  });

  // Home
  $("calendar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    cal.sel = b.dataset.day;
    renderCalendar();
    renderDayPanel();
  });
  $("cal-prev").onclick = () => moveMonth(-1);
  $("cal-next").onclick = () => moveMonth(1);
  $("cal-prev-y").onclick = () => moveMonth(-12);
  $("cal-next-y").onclick = () => moveMonth(12);
  $("cal-title").onclick = () => {
    const t = new Date();
    Object.assign(cal, { y: t.getFullYear(), m: t.getMonth(), sel: dayKey(t) });
    renderHome();
  };
  $("day-panel").addEventListener("click", (e) => {
    const p = $("day-panel");
    const list = (s) => [...(s || "")].map(charByValue).filter(Boolean);
    const chip = e.target.closest("[data-char]");
    if (chip) {
      const group = chip.classList.contains("known") ? p.dataset.knew : p.dataset.missed;
      const chars = list(group);
      browse({ type: "list", chars, title: cal.sel }, chars, Math.max(0, chars.findIndex((c) => c.char === chip.dataset.char)));
    } else if (e.target.closest("#day-review")) {
      startSession({ type: "list", chars: list(p.dataset.missed), title: `${cal.sel} · 不认识` });
    }
  });

  // Levels, grid
  $("level-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    const scope = scopeFrom(b);
    scope.type === "random" ? startSession(scope) : go.detail(scope);
  });
  $("detail-grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-idx]");
    if (b) browse(detailScope, charsOf(detailScope), Number(b.dataset.idx));
  });
  $("btn-start").onclick = () => startSession(detailScope);

  // Summary
  $("stats-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scope]");
    if (!b || b.disabled) return;
    const scope = scopeFrom(b);
    const todo = charsOf(scope).filter((c) => !isMastered(c.char));
    startSession({ type: "list", chars: todo, title: `${titleOf(scope)} · 未掌握` });
  });

  // Voice settings
  $("voice-list").addEventListener("change", (e) => {
    if (e.target.name === "voice") localStorage.setItem(VOICE_KEY, e.target.value);
  });
  $("voice-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sample]");
    if (!b) return;
    e.preventDefault();
    const c = DATA.characters.find((x) => x.sentence?.audio) || DATA.characters[0];
    if (c?.sentence) speak(c.sentence.text, c.sentence.audio, b.dataset.sample);
  });

  // Card
  $("btn-known").onclick = () => answer(true);
  $("btn-unknown").onclick = () => answer(false);
  $("btn-next").onclick = next;
  $("btn-prev").onclick = prev;
  $("btn-viewall").onclick = viewAll;
  $("btn-animate").onclick = animateStrokes;
  $("btn-quiz").onclick = quiz;
  document.querySelector("[data-speak-char]").onclick = () => {
    const c = session.deck[session.i];
    speak(c?.char, c?.audio);
  };
  $("back-words").addEventListener("click", (e) => {
    const li = e.target.closest("[data-word]");
    const w = li && session.deck[session.i]?.words?.[li.dataset.word];
    if (w) speak(w.word, w.audio);
  });
  $("back-sentence").onclick = () => {
    const s = session.deck[session.i]?.sentence;
    if (s) speak(s.text, s.audio);
  };

  // End of session
  $("btn-review-missed").onclick = () => startSession({ type: "list", chars: session.unknown, title: `${session.title.split(" · 不认识")[0]} · 不认识` });
  $("btn-again").onclick = () => startSession(session.scope);
  $("btn-to-levels").onclick = go.levels;
  $("reset-progress").onclick = () => {
    if (confirm("Clear all saved progress and practice history?")) {
      progress = {}; activity = {};
      save(PROGRESS_KEY, progress); save(ACTIVITY_KEY, activity);
      renderStats();
    }
  };

  // Keyboard (desktop testing): → 认识, ← 不认识, space/enter 下一个; browse: ← → to move
  document.addEventListener("keydown", (e) => {
    if (!$("study").classList.contains("active")) return;
    if (session.mode === "browse") {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      return;
    }
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
    // Older/simpler data files: levels without grades → one implicit group.
    if (!DATA.levels?.length) {
      DATA.levels = [...new Set(DATA.characters.map((c) => c.level))].map((id) => ({ id, name: `Level ${id}` }));
    }
    if (!DATA.grades?.length) {
      DATA.grades = [{ id: "_", name: "Levels" }];
      DATA.levels.forEach((l) => (l.grade ||= "_"));
    }
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent = `Couldn't load ${DATA_URL} (${err.message}).`;
  }
  go.home();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
