#!/usr/bin/env node
// Check data/characters.json before publishing:  node tools/validate.mjs [path]
//   - required fields, duplicate characters, unknown level ids
//   - sentence/words actually contain the character
//   - (with --strokes) every character has stroke-order data on jsDelivr
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const checkStrokes = args.includes("--strokes");
const path = args.find((a) => !a.startsWith("--")) || new URL("../data/characters.json", import.meta.url);

let data;
try { data = JSON.parse(readFileSync(path, "utf8")); }
catch (e) { console.error(`✗ Cannot parse JSON: ${e.message}`); process.exit(1); }

const errors = [], warnings = [];
const levelIds = new Set((data.levels || []).map((l) => l.id));
const seen = new Map();

if (!Array.isArray(data.characters)) errors.push(`"characters" must be an array`);
(data.characters || []).forEach((c, i) => {
  const at = `#${i + 1} ${c.char ?? "?"}`;
  if (!c.char || [...c.char].length !== 1) errors.push(`${at}: "char" must be exactly one character`);
  if (!c.pinyin) errors.push(`${at}: missing "pinyin"`);
  if (!c.level) errors.push(`${at}: missing "level"`);
  else if (levelIds.size && !levelIds.has(c.level)) errors.push(`${at}: level "${c.level}" is not in "levels"`);
  if (seen.has(c.char)) warnings.push(`${at}: duplicate of entry #${seen.get(c.char)} (both will appear)`);
  seen.set(c.char, i + 1);
  if (!c.words?.length) warnings.push(`${at}: no "words"`);
  (c.words || []).forEach((w) => {
    if (!w.word) errors.push(`${at}: a word is missing "word"`);
    else if (!w.word.includes(c.char)) warnings.push(`${at}: word "${w.word}" doesn't contain ${c.char}`);
    if (!w.pinyin) warnings.push(`${at}: word "${w.word}" has no pinyin`);
  });
  if (!c.sentence?.text) warnings.push(`${at}: no sentence`);
  else if (!c.sentence.text.includes(c.char)) warnings.push(`${at}: sentence doesn't contain ${c.char}`);
});

if (checkStrokes) {
  const chars = [...seen.keys()].filter(Boolean);
  const results = await Promise.all(chars.map(async (ch) => {
    try {
      const r = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${encodeURIComponent(ch)}.json`, { method: "HEAD" });
      return r.ok ? null : ch;
    } catch { return ch; }
  }));
  const missing = results.filter(Boolean);
  if (missing.length) warnings.push(`No stroke-order data for: ${missing.join(" ")}`);
}

const perLevel = {};
(data.characters || []).forEach((c) => (perLevel[c.level] = (perLevel[c.level] || 0) + 1));
console.log(`${data.characters?.length ?? 0} characters · ` +
  Object.entries(perLevel).map(([k, v]) => `${k}: ${v}`).join(", "));
warnings.forEach((w) => console.log(`⚠ ${w}`));
errors.forEach((e) => console.log(`✗ ${e}`));
console.log(errors.length ? `\n${errors.length} error(s) — fix before publishing.` : "✓ OK");
process.exit(errors.length ? 1 : 0);
