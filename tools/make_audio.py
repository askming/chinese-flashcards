#!/usr/bin/env python3
"""Synthesize natural-sounding audio for every character, word and sentence.

    /tmp/fc-tools/venv/bin/python tools/make_audio.py      # needs: pip install edge-tts
    /tmp/fc-tools/venv/bin/python tools/build_data.py      # rebuild so the data points at the clips

Reads audio/_speech.json (written by build_data.py), creates any missing clips with a
Microsoft neural voice via edge-tts, and skips clips that already exist.
"""
import asyncio, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from build_data import VOICE, RATE  # noqa: E402

import edge_tts  # noqa: E402


async def synth(sem, text, path):
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(path + ".part")
                os.replace(path + ".part", path)
                return True
            except Exception as e:  # network hiccups: retry
                err = e
                await asyncio.sleep(1 + attempt)
        print(f"✗ {text}: {err}")
        return False


async def main():
    speech = json.load(open(os.path.join(ROOT, "audio", "_speech.json")))
    todo = [(t, os.path.join(ROOT, rel)) for rel, t in speech.items() if not os.path.exists(os.path.join(ROOT, rel))]
    print(f"{len(speech)} clips, {len(todo)} to create with {VOICE}")
    sem = asyncio.Semaphore(6)
    results = await asyncio.gather(*(synth(sem, t, p) for t, p in todo))
    print(f"created {sum(results)}, failed {len(results) - sum(results)}")


asyncio.run(main())
