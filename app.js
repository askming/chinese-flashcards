"use strict";

/* ============================================================
 * 汉字 Flashcards
 *   Home (calendar, stats, day log) · Levels: grade → unit → character grid → cards · Summary
 *   Everything is stored on the device in localStorage.
 * ============================================================ */

const DATA_URL = "data/characters.json";
// Each learner profile: {id, name, avatar, voice, metaAt, createdAt, updatedAt, resetAt,
//   progress: {字: {known, unknown, last, at}},
//   activity: {"2026-11-14": {sec, n, t, r: {字: 1|0}, lv: [unitId]}},
//   _dirty, _synced}   (underscore fields stay on this device)
const PROFILES_KEY = "hanzi-flashcards-profiles-v1";
const CURRENT_KEY = "hanzi-flashcards-current-profile";
// pre-profile versions kept one device-wide record; it is adopted by the first profile
const LEGACY_PROGRESS_KEY = "hanzi-flashcards-progress-v1";
const LEGACY_ACTIVITY_KEY = "hanzi-flashcards-activity-v1";
const AVATARS = ["🐼", "🐯", "🐰", "🦊", "🐨", "🐸", "🐵", "🐶", "🐱", "🦁", "🐻", "🐧", "🦄", "🐲", "🐳", "🦋"];
const IDLE_CAP_MS = 2 * 60 * 1000; // time on one card beyond this isn't counted as practice

const $ = (id) => document.getElementById(id);
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ZH = /[㐀-鿿]/;

let DATA = { grades: [], levels: [], characters: [] };
let profiles = load(PROFILES_KEY);
let current = profiles[localStorage.getItem(CURRENT_KEY)] || null;
let progress = current?.progress || {};
let activity = current?.activity || {};
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
/* ---------- profiles ---------- */
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function useProfile(p) {
  current = p;
  progress = p ? (p.progress ||= {}) : {};
  activity = p ? (p.activity ||= {}) : {};
  p ? localStorage.setItem(CURRENT_KEY, p.id) : localStorage.removeItem(CURRENT_KEY);
}
function saveProfiles() { save(PROFILES_KEY, profiles); }
/** The current profile changed: store it and schedule a sync. */
function touch() {
  if (!current) return;
  current.updatedAt = Date.now();
  current._dirty = true;
  saveProfiles();
  scheduleSync();
}
function createProfile(name, avatar) {
  const now = Date.now();
  const p = { id: newId(), name, avatar, voice: null, metaAt: now, createdAt: now, updatedAt: now, resetAt: 0,
              progress: {}, activity: {}, _dirty: true, _synced: false };
  // the very first profile inherits progress recorded before profiles existed
  if (!Object.keys(profiles).length) {
    p.progress = load(LEGACY_PROGRESS_KEY);
    p.activity = load(LEGACY_ACTIVITY_KEY);
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
    localStorage.removeItem(LEGACY_ACTIVITY_KEY);
  }
  profiles[p.id] = p;
  saveProfiles();
  return p;
}
const masteredOf = (p) => Object.values(p.progress || {}).filter((x) => x.last === "known").length;

/* ---------- merging two copies of a profile (this device vs. the repo) ---------- */
const dayEnd = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d + 1).getTime(); };
function mergeProfiles(a, b) {
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const progress = {};
  for (const src of [b.progress || {}, a.progress || {}]) {
    for (const [ch, x] of Object.entries(src)) {
      if ((x.at || 0) < resetAt) continue;
      if (!progress[ch] || (x.at || 0) >= (progress[ch].at || 0)) progress[ch] = x;
    }
  }
  const activity = {};
  const days = new Set([...Object.keys(a.activity || {}), ...Object.keys(b.activity || {})]);
  for (const day of days) {
    const x = a.activity?.[day], y = b.activity?.[day];
    let e;
    if (!x || !y) e = x || y;
    else {
      const [hi, lo] = (x.n || 0) >= (y.n || 0) ? [x, y] : [y, x];
      e = { sec: Math.max(x.sec || 0, y.sec || 0), n: Math.max(x.n || 0, y.n || 0), t: Math.max(x.t || 0, y.t || 0),
            r: { ...(lo.r || {}), ...(hi.r || {}) }, lv: [...new Set([...(x.lv || []), ...(y.lv || [])])] };
    }
    if ((e.t || dayEnd(day)) >= resetAt) activity[day] = e;
  }
  const meta = (a.metaAt || 0) >= (b.metaAt || 0) ? a : b;
  return { id: a.id, name: meta.name, avatar: meta.avatar, voice: meta.voice ?? null, metaAt: meta.metaAt || 0,
           createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity), updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
           resetAt, progress, activity };
}
const stable = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}"
  : JSON.stringify(v));
const shareable = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith("_")));

/* ---------- sync with the private GitHub repo ---------- */
const syncState = { status: "idle", at: 0, msg: "" };
let syncTimer = null, syncing = false, syncAgain = false;

function scheduleSync(delay = 15000) {
  if (!Sync.connected) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}
async function syncNow() {
  if (!Sync.connected) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  clearTimeout(syncTimer);
  Object.assign(syncState, { status: "syncing", msg: "" });
  renderSyncStatus();
  try {
    const remote = await Sync.list();
    const remoteIds = new Set(remote.map((r) => r.id));
    for (const r of remote) {
      const l = profiles[r.id];
      if (!l) { profiles[r.id] = { ...r, _synced: true, _dirty: false }; continue; }
      const m = mergeProfiles(l, r);
      profiles[r.id] = { ...m, _synced: true, _dirty: stable(m) !== stable(shareable(r)) };
    }
    for (const [id, l] of Object.entries(profiles)) {
      if (remoteIds.has(id)) continue;
      if (l._synced) delete profiles[id];          // deleted on another device
      else l._dirty = true;                        // new here: upload
    }
    for (const p of Object.values(profiles)) {
      if (!p._dirty) continue;
      if ((await Sync.put(shareable(p))) === "conflict") {
        const r = await Sync.get(p.id);            // changed elsewhere meanwhile: merge and retry once
        if (r) Object.assign(p, mergeProfiles(p, r));
        if ((await Sync.put(shareable(p))) === "conflict") throw new Sync.SyncError("Couldn't save — please try again");
      }
      p._dirty = false;
      p._synced = true;
    }
    saveProfiles();
    useProfile(current && profiles[current.id] ? profiles[current.id] : null);
    Object.assign(syncState, { status: "ok", at: Date.now() });
    refreshAfterSync();
  } catch (e) {
    saveProfiles();
    Object.assign(syncState, { status: "error", msg: e.message || String(e) });
  } finally {
    syncing = false;
    renderSyncStatus();
    if (syncAgain) { syncAgain = false; scheduleSync(1000); }
  }
}
function refreshAfterSync() {
  renderProfileChip();
  const active = document.querySelector(".screen.active")?.id;
  if (!current) return showProfiles();
  if (active === "home") renderHome();
  else if (active === "levels") renderLevels();
  else if (active === "stats") { renderStats(); renderVoices(); }
  else if (active === "profiles") renderProfiles();
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
  return (activity[dayKey()] ||= { sec: 0, n: 0, t: Date.now(), r: {}, lv: [] });
}
function startClock() { lastTick = Date.now(); }
function tick() {
  const now = Date.now();
  if (lastTick !== null) today().sec += Math.min(now - lastTick, IDLE_CAP_MS) / 1000;
  lastTick = now;
  today().t = now;
  touch();
}
function stopClock() {
  if (lastTick !== null) tick();
  lastTick = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) syncNow();
  else scheduleSync(500);                                  // back in the app: pick up other devices' changes
  if (!$("study").classList.contains("active") || session.mode !== "practice") return;
  document.hidden ? stopClock() : startClock();
});

function record(c, knew) {
  const p = progress[c.char] || { known: 0, unknown: 0 };
  knew ? p.known++ : p.unknown++;
  p.last = knew ? "known" : "unknown";
  p.at = Date.now();
  progress[c.char] = p;

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
const TAB_OF = { home: "home", levels: "levels", detail: "levels", study: "levels", done: "levels", stats: "stats", profiles: "profiles" };
function show(screenId) {
  if (!current && screenId !== "profiles") {                          // everything else needs a profile
    screenId = "profiles";
    editing = Object.keys(profiles).length ? null : "new";
    renderProfiles();
  }
  if ($("study").classList.contains("active") && screenId !== "study") {
    stopClock();
    stopAudio();
    scheduleSync(1500);                                                // practice ended: save soon
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
  profiles: () => showProfiles(),
  detail: (scope) => { renderDetail(scope); show("detail"); },
};

/* ---------- audio: pre-generated neural voice clips ---------- */
const player = new Audio();
let playToken = 0;

function stopAudio() {
  playToken++;
  player.pause();
}
// The chosen voice id (one of DATA.voices).
function voiceId() {
  const ids = (DATA.voices || []).map((x) => x.id);
  const v = current?.voice;
  return ids.includes(v) ? v : ids[0];
}
// Play a clip in the chosen voice; if that clip is missing, try the other voices.
function speak(_text, key, voice = voiceId()) {
  stopAudio();
  if (!key) return;
  const order = [voice, ...(DATA.voices || []).map((v) => v.id).filter((id) => id !== voice)];
  const token = playToken;
  const tryNext = (i) => {
    if (i >= order.length || token !== playToken) return;
    player.onerror = () => tryNext(i + 1);
    player.src = `audio/${order[i]}/${key}.mp3`;
    player.play().catch((e) => { if (e.name !== "AbortError") tryNext(i + 1); });
  };
  tryNext(0);
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

/* ---------- Profiles: who's practicing? + sync settings ---------- */
let editing = null;   // profile id being edited, "new", or null

function renderProfileChip() {
  $("profile-chip").innerHTML = current
    ? `<span class="pc-avatar">${esc(current.avatar)}</span><span class="pc-name">${esc(current.name)}</span>`
    : `<span class="pc-avatar">👤</span>`;
}

function showProfiles() {
  editing = Object.keys(profiles).length ? null : "new";
  renderProfiles();
  show("profiles");
}

function renderProfiles() {
  const list = Object.values(profiles).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  $("profiles-sub").textContent = list.length
    ? "Tap your name to start. Each profile keeps its own progress."
    : "Create a profile to start practicing.";
  $("profile-grid").innerHTML = list.map((p) => `
    <div class="profile-card ${current?.id === p.id ? "current" : ""}">
      <button type="button" class="pf-pick" data-pick="${esc(p.id)}">
        <span class="pf-avatar">${esc(p.avatar)}</span>
        <span class="pf-name">${esc(p.name)}</span>
        <span class="pf-stat">⭐ ${masteredOf(p)} mastered</span>
      </button>
      <button type="button" class="pf-edit" data-edit="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">✎</button>
    </div>`).join("") +
    `<button type="button" class="profile-card pf-new" data-new><span class="pf-avatar">＋</span><span class="pf-name">New profile</span></button>`;

  const form = $("profile-form");
  form.hidden = !editing;
  if (editing) {
    const p = editing === "new" ? null : profiles[editing];
    $("pf-title").textContent = p ? `Edit ${p.name}` : "New profile 新建";
    $("pf-name").value = p?.name || "";
    const used = new Set(list.map((x) => x.avatar));
    form.dataset.avatar = p?.avatar || AVATARS.find((a) => !used.has(a)) || AVATARS[0];
    $("pf-avatars").innerHTML = AVATARS.map((a) =>
      `<button type="button" class="av ${a === form.dataset.avatar ? "on" : ""}" data-av="${a}">${a}</button>`).join("");
    $("pf-delete").hidden = !p;
    $("pf-cancel").hidden = !list.length;
  }
  renderSyncCard();
}

function renderSyncCard() {
  const card = $("sync-card");
  if (!Sync.connected) {
    card.innerHTML = `
      <h3>☁️ Sync across devices</h3>
      <p class="sub">Save profiles to your private GitHub repo, so progress follows each learner to every device.</p>
      <label class="field">Repository<input id="sync-repo" value="askming/chinese-flashcards-data" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label class="field">Access token<input id="sync-token" type="password" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <button type="button" id="sync-connect" class="btn btn-blue">Connect</button>
      <p id="sync-msg" class="sync-msg"></p>
      <details class="howto"><summary>How to get a token</summary><ol>
        <li>On GitHub (signed in as the repo owner) open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Fine-grained tokens → Generate new token</a>.</li>
        <li>Name it e.g. <em>汉字 flashcards</em>, choose an expiration.</li>
        <li><strong>Repository access:</strong> Only select repositories → <code>chinese-flashcards-data</code>.</li>
        <li><strong>Permissions → Repository → Contents:</strong> Read and write.</li>
        <li>Generate, copy, and paste it above. On other devices, use “Set up another device” instead of retyping it.</li>
      </ol></details>`;
  } else {
    card.innerHTML = `
      <h3>☁️ Synced with <code>${esc(Sync.repoName)}</code></h3>
      <p id="sync-msg" class="sync-msg"></p>
      <div class="sync-btns">
        <button type="button" id="sync-now" class="chip">⟳ Sync now</button>
        <button type="button" id="sync-share" class="chip">📲 Set up another device</button>
        <button type="button" id="sync-disconnect" class="chip">Disconnect</button>
      </div>
      <p class="sub small">The setup link contains this device's access key — only send it to your own devices (e.g. AirDrop).</p>`;
  }
  renderSyncStatus();
}

function renderSyncStatus() {
  const el = document.getElementById("sync-msg");
  if (!el || !Sync.connected) return;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : new Date(t).toLocaleString(); };
  el.className = `sync-msg ${syncState.status}`;
  el.textContent = syncState.status === "syncing" ? "Syncing…"
    : syncState.status === "error" ? `⚠ ${syncState.msg}`
    : syncState.at ? `✓ Synced ${ago(syncState.at)}` : "Not synced yet";
}

async function connectSync(repo, token) {
  const msg = $("sync-msg");
  if (msg) { msg.className = "sync-msg syncing"; msg.textContent = "Checking…"; }
  try {
    await Sync.connect(repo, token);
    renderSyncCard();
    await syncNow();
    renderProfiles();
  } catch (e) {
    if (msg) { msg.className = "sync-msg error"; msg.textContent = `⚠ ${e.message}`; }
  }
}

async function shareSetupLink() {
  const url = Sync.setupLink();
  try {
    if (navigator.share) await navigator.share({ title: "汉字 Flashcards setup", url });
    else { await navigator.clipboard.writeText(url); alert("Setup link copied. Open it on the other device."); }
  } catch (e) {
    if (e.name !== "AbortError") prompt("Copy this setup link and open it on the other device:", url);
  }
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
  const opts = DATA.voices || [];
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

  // Profiles
  $("profile-grid").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]"), edit = e.target.closest("[data-edit]");
    if (pick) { useProfile(profiles[pick.dataset.pick]); renderProfileChip(); go.home(); }
    else if (edit) { editing = edit.dataset.edit; renderProfiles(); $("profile-form").scrollIntoView({ behavior: "smooth" }); }
    else if (e.target.closest("[data-new]")) { editing = "new"; renderProfiles(); $("pf-name").focus(); }
  });
  $("pf-avatars").addEventListener("click", (e) => {
    const b = e.target.closest("[data-av]");
    if (!b) return;
    $("profile-form").dataset.avatar = b.dataset.av;
    document.querySelectorAll("#pf-avatars .av").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("profile-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("pf-name").value.trim().slice(0, 20);
    if (!name) return $("pf-name").focus();
    const avatar = $("profile-form").dataset.avatar;
    if (editing === "new") {
      useProfile(createProfile(name, avatar));
      editing = null;
      touch();
      renderProfileChip();
      return go.home();
    }
    const p = profiles[editing];
    Object.assign(p, { name, avatar, metaAt: Date.now() });
    if (current?.id === p.id) useProfile(p);
    editing = null;
    p.updatedAt = Date.now(); p._dirty = true; saveProfiles(); scheduleSync(500);
    renderProfileChip();
    renderProfiles();
  });
  $("pf-cancel").onclick = () => { editing = null; renderProfiles(); };
  $("pf-delete").onclick = async () => {
    const p = profiles[editing];
    if (!p || !confirm(`Delete ${p.name}'s profile and all of its progress? This can't be undone.`)) return;
    delete profiles[p.id];
    saveProfiles();
    if (current?.id === p.id) useProfile(null);
    editing = null;
    renderProfileChip();
    renderProfiles();
    if (Sync.connected && p._synced) {
      try { await Sync.remove(p.id); } catch (err) { Object.assign(syncState, { status: "error", msg: err.message }); renderSyncStatus(); }
    }
  };
  $("sync-card").addEventListener("click", (e) => {
    const id = e.target.closest("button")?.id;
    if (id === "sync-connect") connectSync($("sync-repo").value, $("sync-token").value);
    else if (id === "sync-now") syncNow();
    else if (id === "sync-share") shareSetupLink();
    else if (id === "sync-disconnect" && confirm("Disconnect this device? Profiles stay on this device, but stop syncing.")) {
      Sync.disconnect();
      renderSyncCard();
    }
  });

  // Voice settings
  $("voice-list").addEventListener("change", (e) => {
    if (e.target.name === "voice" && current) {
      current.voice = e.target.value;
      current.metaAt = Date.now();
      touch();
    }
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
    if (current && confirm(`Clear all of ${current.name}'s progress and practice history?`)) {
      current.resetAt = Date.now();
      current.progress = {};
      current.activity = {};
      useProfile(current);
      touch();
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
  renderProfileChip();
  const link = Sync.takeSetupLink();
  if (link) {
    showProfiles();
    await connectSync(`${link.owner}/${link.repo}`, link.token);
  } else if (Sync.connected) {
    syncNow();                                   // pick up other devices' changes in the background
  }
  current ? go.home() : showProfiles();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
