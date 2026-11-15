#!/usr/bin/env python3
"""Synthesize natural-sounding audio for every character, word and sentence, in every voice.

    /tmp/fc-tools/venv/bin/python tools/make_audio.py      # needs: pip install edge-tts; ffmpeg
    /tmp/fc-tools/venv/bin/python tools/build_data.py      # rebuild so the data points at the clips

Reads audio/_speech.json (written by build_data.py) and creates missing clips in
audio/<voice-id>/<key>.mp3 with Microsoft neural voices via edge-tts, re-encoded to
32 kbps mono to keep the site small. Existing clips are skipped.
"""
import asyncio, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from build_data import VOICES, RATE, AUDIO_DIR  # noqa: E402

import edge_tts  # noqa: E402


async def synth(sem, text, voice, path):
    async with sem:
        err = None
        for attempt in range(4):
            try:
                tmp = path + ".raw.mp3"
                await edge_tts.Communicate(text, voice, rate=RATE).save(tmp)
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-ac", "1", "-b:a", "32k", path)
                await proc.wait()
                os.remove(tmp)
                if proc.returncode == 0:
                    return True
                err = f"ffmpeg exit {proc.returncode}"
            except Exception as e:  # network hiccups / throttling: back off and retry
                err = e
                await asyncio.sleep(2 * (attempt + 1))
        print(f"✗ [{voice}] {text}: {err}")
        return False


async def main():
    speech = json.load(open(os.path.join(AUDIO_DIR, "_speech.json")))
    sem = asyncio.Semaphore(6)
    for v in VOICES:
        d = os.path.join(AUDIO_DIR, v["id"])
        os.makedirs(d, exist_ok=True)
        todo = [(t, os.path.join(d, k + ".mp3")) for k, t in speech.items() if not os.path.exists(os.path.join(d, k + ".mp3"))]
        print(f"{v['id']}: {len(speech)} clips, {len(todo)} to create")
        results = await asyncio.gather(*(synth(sem, t, v["voice"], p) for t, p in todo))
        print(f"  created {sum(results)}, failed {len(results) - sum(results)}")


asyncio.run(main())
