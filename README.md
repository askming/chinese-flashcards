# 汉字 Flashcards

A phone-first flip-card app for reviewing Chinese characters. It's a static site (no build step) that runs on GitHub Pages and can be installed on an iPhone home screen.

**Flow:** pick a level → characters appear in random order → tap **I know** / **I don't know** → the card flips to show pinyin, meaning, an animated stroke order, example words and a sentence → **Next**. At the end you get a score and can re-drill the characters you missed.

## Project layout

| Path | What it is |
|---|---|
| `index.html` | The three screens: level picker, flashcard, summary |
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

## Notes

- Progress is saved per device in the browser (`localStorage`). It isn't synced across devices.
- Pronunciation uses the iPhone's built-in Chinese voice: tap 🔊, any word, or the sentence.
- Offline use: once a card has been viewed online, its stroke data is cached.
