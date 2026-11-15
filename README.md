# 汉字 Flashcards

A phone-first flip-card app for reviewing Chinese characters. It's a static site (no build step) that runs on GitHub Pages and can be installed on an iPhone home screen.

**Flow:** **Home** shows a practice calendar, streak, daily minutes and characters mastered. **Levels** → pick a grade → see all its characters → 开始练习 → each card shows a character; tap **认识** / **不认识** → the card flips to show pinyin, animated stroke order (笔顺, plus 练写 tracing), 组词 and 造句 → **下一个**. **看全部** returns to the level's character grid. **Summary** shows mastered vs. not mastered per level; tap a bar to practice the ones you haven't mastered. A character counts as *mastered* when your most recent answer was 认识.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | Screens: Home (calendar + streak), Levels → level grid → flashcard, Summary |
| `styles.css` | Mobile-first styles (safe areas, 3D flip, 米字格 grid) |
| `app.js` | App logic: loading data, shuffling, flipping, progress, speech |
| `data/characters.json` | **Your character list.** Edit or replace this file |
| `vendor/hanzi-writer.min.js` | [Hanzi Writer](https://hanziwriter.org) v3.7.3 (MIT) for stroke order |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline support |
| `tools/validate.mjs` | Checks the data file before you publish |

## Data format (`data/characters.json`)

```json
{
  "levels": [
    { "id": "L1", "name": "Level 1", "description": "optional subtitle" }
  ],
  "characters": [
    {
      "char": "山",
      "level": "L1",
      "pinyin": "shān",
      "meaning": "mountain",
      "words": [
        { "word": "爬山", "pinyin": "páshān", "meaning": "to climb a mountain" }
      ],
      "sentence": {
        "text": "周末我们去爬山。",
        "pinyin": "Zhōumò wǒmen qù páshān.",
        "meaning": "We go hiking on the weekend."
      }
    }
  ]
}
```

- **Required:** `char`, `level`, `pinyin`. Everything else is optional; sections with no data are left out.
- `level` must match an `id` in `levels`. If you leave out `levels`, they're built from the characters.
- The character is highlighted automatically wherever it appears in the words and the sentence.
- Stroke order comes from Hanzi Writer's open dataset (about 9,000 characters), so you don't need to supply it.

Validate after editing (`--strokes` also checks that stroke data exists for each character):

```sh
node tools/validate.mjs --strokes
```

## Building the data from textbook PDFs

```sh
# 1. Extract a unit skeleton (word lists, vocab, lesson texts) from the PDF's text layer
python3 -I tools/extract_pdf.py "BOOK.pdf" --grade G2 --unit 10 > sources/g2-u10.json
# 2. Fill in each sub-lesson's "write"/"recognize" characters from the 字词乐园 pages
#    (they're images), e.g. "write": "忠:zhōng 实:shí 导:dǎo"; fix any text-layer glitches
# 3. Build data/characters.json from every file in sources/ and proofread the report
python3 -m venv /tmp/fc-tools/venv && /tmp/fc-tools/venv/bin/pip install pypinyin
/tmp/fc-tools/venv/bin/python tools/build_data.py --report
/tmp/fc-tools/venv/bin/pip install edge-tts
/tmp/fc-tools/venv/bin/python tools/make_audio.py   # natural voice clips (only missing ones)
/tmp/fc-tools/venv/bin/python tools/build_data.py   # rebuild so cards point at the clips
node tools/validate.mjs --strokes
```

Units are grouped by grade (Levels → Grade → Unit). Character pinyin comes from the textbook. 组词 comes from 读一读 and 本课词语, and 造句 is a sentence from the 课文. Word and sentence pinyin is generated with pypinyin, using tone-sandhi rules and a few readings fixed in code. Per-unit fixes go in the source file's `"overrides"` (`"term": "syllables, one per character"`; use `r` for 儿化, e.g. `"点儿": "diǎn r"`). Extra fields (`lesson`, `lessonTitle`, `kind`: write/recognize) are kept for future filtering.

## Run locally

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

On a computer you can use the keyboard: **←** don't know, **→** know, **Space** next.

## Publish on GitHub Pages

1. Create a repo and push this folder to `main`.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)`.
3. Open `https://<user>.github.io/<repo>/` on the iPhone in Safari → Share → **Add to Home Screen**.

**Updating:** edits to `characters.json` show up on the next online launch. If you change app code (HTML/CSS/JS), bump `VERSION` in `sw.js` so installed copies refresh.

## Profiles and sync

- **Profiles:** the 👤 chip in the top bar opens *Who's practicing?*. Each profile (name + emoji) has its own progress, calendar and voice. Progress recorded before profiles existed moves into the first profile.
- **Sync (optional):** profiles can be stored in a **private** GitHub repo, `askming/chinese-flashcards-data`, as `profiles/<id>.json`, so they follow each learner to every device. The browser talks to the GitHub API directly with a **fine-grained personal access token** that can only reach that one repo:
  1. Go to github.com → Settings → Developer settings → Fine-grained tokens → **Generate new token**.
  2. Under **Repository access**, choose *Only select repositories* → `chinese-flashcards-data`.
  3. Under **Permissions → Repository → Contents**, choose *Read and write*.
  4. Paste the token on the profiles page and tap **Connect**.
- **Other devices:** tap **Set up another device** to get a link (send it by AirDrop) that connects that device without retyping the token. The link contains the token, so only send it to your own devices.
- **How it syncs:** after practice, when the app goes to the background, and when it opens. Conflicting edits are merged: per character, the latest answer wins; days are combined. The token is stored only in each device's browser storage. To revoke access, delete the token on GitHub.

## Notes

- Pronunciation: pre-generated neural-voice clips in `audio/` (Microsoft `zh-CN-XiaoxiaoNeural` via edge-tts; set `VOICE`/`RATE` in `tools/build_data.py`). Tap 🔊, any word, or the sentence. If a clip is missing, the app falls back to the device voice. A lone 多音字 is spoken via a single-reading homophone so it matches the textbook (藏 zàng → 葬).
- Offline use: once a card has been viewed online, its stroke data is cached.
