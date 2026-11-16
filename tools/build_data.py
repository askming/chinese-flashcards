#!/usr/bin/env python3
"""Build data/characters.json from the unit source files in sources/*.json.

    /tmp/fc-tools/venv/bin/python tools/build_data.py            # needs: pip install pypinyin
    /tmp/fc-tools/venv/bin/python tools/build_data.py --report   # also print everything for proofreading

For each character (from a sub-lesson's "write"/"recognize" list):
  pinyin    the textbook's printed pinyin
  words     读一读 words of its sub-lesson that contain it, then the lesson's 本课词语 (max 4)
  sentence  a sentence from the lesson text containing it; preference goes to one that
            uses one of its words and doesn't read the character differently (e.g. 藏着 cáng
            vs. 宝藏 zàng)
Word and sentence pinyin are generated with pypinyin, corrected with tone-sandhi rules
for 一/不, and finally overridden by the "overrides" map in each source file
(term → pinyin, longest match wins).
"""
import argparse, glob, json, os, re, sys
from pypinyin import lazy_pinyin, Style, load_phrases_dict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_WORDS = 4

# Readings pypinyin commonly gets wrong in children's texts.
load_phrases_dict({
    "衣服": [["yī"], ["fu"]], "时辰": [["shí"], ["chen"]], "打量": [["dǎ"], ["liang"]],
    "地质": [["dì"], ["zhì"]], "趴着": [["pā"], ["zhe"]], "藏着": [["cáng"], ["zhe"]],
    "埋着": [["mái"], ["zhe"]], "看着": [["kàn"], ["zhe"]], "带着": [["dài"], ["zhe"]],
    "指着": [["zhǐ"], ["zhe"]], "工作着": [["gōng"], ["zuò"], ["zhe"]], "笑着": [["xiào"], ["zhe"]],
    "跟着": [["gēn"], ["zhe"]], "长满": [["zhǎng"], ["mǎn"]], "长大": [["zhǎng"], ["dà"]],
    "叔叔": [["shū"], ["shu"]], "爸爸": [["bà"], ["ba"]], "妈妈": [["mā"], ["ma"]],
    "孩子": [["hái"], ["zi"]], "杯子": [["bēi"], ["zi"]], "石子": [["shí"], ["zǐ"]],
    "茧子": [["jiǎn"], ["zi"]], "叶子": [["yè"], ["zi"]], "身子": [["shēn"], ["zi"]],
    "明白": [["míng"], ["bai"]], "东西": [["dōng"], ["xi"]], "事情": [["shì"], ["qing"]],
    "时候": [["shí"], ["hou"]], "什么": [["shén"], ["me"]], "怎么": [["zěn"], ["me"]],
    "这么": [["zhè"], ["me"]], "那么": [["nà"], ["me"]], "多么": [["duō"], ["me"]],
    "地方": [["dì"], ["fang"]], "认识": [["rèn"], ["shi"]], "朋友": [["péng"], ["you"]],
    "舒服": [["shū"], ["fu"]], "麻烦": [["má"], ["fan"]], "觉得": [["jué"], ["de"]],
    "睡觉": [["shuì"], ["jiào"]], "得使用": [["děi"], ["shǐ"], ["yòng"]],
    "倒过来": [["dào"], ["guò"], ["lái"]], "倒影": [["dào"], ["yǐng"]],
    "月亮": [["yuè"], ["liang"]], "漂亮": [["piào"], ["liang"]], "眼睛": [["yǎn"], ["jing"]], "耳朵": [["ěr"], ["duo"]], "狐狸": [["hú"], ["li"]], "哥哥": [["gē"], ["ge"]], "姐姐": [["jiě"], ["jie"]], "弟弟": [["dì"], ["di"]], "妹妹": [["mèi"], ["mei"]], "奶奶": [["nǎi"], ["nai"]], "爷爷": [["yé"], ["ye"]], "姥姥": [["lǎo"], ["lao"]], "宝宝": [["bǎo"], ["bao"]], "娃娃": [["wá"], ["wa"]], "星星": [["xīng"], ["xing"]], "厉害": [["lì"], ["hai"]], "热闹": [["rè"], ["nao"]], "豆腐": [["dòu"], ["fu"]], "萝卜": [["luó"], ["bo"]], "葡萄": [["pú"], ["tao"]], "名字": [["míng"], ["zi"]], "先生": [["xiān"], ["sheng"]], "姑娘": [["gū"], ["niang"]], "嘴巴": [["zuǐ"], ["ba"]], "尾巴": [["wěi"], ["ba"]], "衣裳": [["yī"], ["shang"]], "窗户": [["chuāng"], ["hu"]], "休息": [["xiū"], ["xi"]], "消息": [["xiāo"], ["xi"]], "故事": [["gù"], ["shi"]], "清楚": [["qīng"], ["chu"]], "暖和": [["nuǎn"], ["huo"]], "聪明": [["cōng"], ["ming"]], "喜欢": [["xǐ"], ["huan"]], "脑袋": [["nǎo"], ["dai"]], "石头": [["shí"], ["tou"]], "木头": [["mù"], ["tou"]], "骨头": [["gǔ"], ["tou"]], "早上": [["zǎo"], ["shang"]], "晚上": [["wǎn"], ["shang"]], "脾气": [["pí"], ["qi"]], "道理": [["dào"], ["li"]], "商量": [["shāng"], ["liang"]], "云彩": [["yún"], ["cai"]], "风筝": [["fēng"], ["zheng"]], "招呼": [["zhāo"], ["hu"]], "收拾": [["shōu"], ["shi"]], "打扮": [["dǎ"], ["ban"]], 
    "呱呱": [["guā"], ["guā"]], "高兴得": [["gāo"], ["xìng"], ["de"]], "长时间": [["cháng"], ["shí"], ["jiān"]],
    "安稳觉": [["ān"], ["wěn"], ["jiào"]], "睡个": [["shuì"], ["gè"]],
})

ZH = re.compile(r"[㐀-鿿]")
AUDIO_DIR = os.path.join(ROOT, "audio")
RATE = "-10%"
# Neural voices offered in the app (first = default). Clips live in audio/<id>/<key>.mp3.
VOICES = [
    {"id": "xiaoxiao", "voice": "zh-CN-XiaoxiaoNeural", "name": "晓晓 · 女声"},
    {"id": "yunxi", "voice": "zh-CN-YunxiNeural", "name": "云希 · 男声"},
]


def audio_key(text):
    """Voice-independent clip name for a spoken text."""
    import hashlib
    return hashlib.md5(f"{RATE}|{text}".encode()).hexdigest()[:12]


def attach_audio(obj, spoken):
    key = audio_key(spoken)
    obj["audio"] = key          # clip name is deterministic; make_audio.py creates the files
    return key
PUNCT_SPACE = re.compile(r"\s+([，。！？、；：”’）》…])")


def tone_of(syl):
    for ch in syl:
        for t, marks in enumerate(("āēīōūǖ", "áéíóúǘ", "ǎěǐǒǔǚ", "àèìòùǜ"), 1):
            if ch in marks:
                return t
    return 5


def syllables(text):
    """Per-character pinyin list aligned to text; non-Chinese chars map to themselves."""
    out = []
    for i, seg in enumerate(lazy_pinyin(text, style=Style.TONE, errors=lambda x: list(x), neutral_tone_with_five=False)):
        out.append(seg)
    # lazy_pinyin keeps one item per Chinese char and one per non-Chinese char (via errors=list)
    chars = list(text)
    if len(out) != len(chars):  # fallback: align conservatively
        out = [lazy_pinyin(c, style=Style.TONE)[0] if ZH.match(c) else c for c in chars]
    # tone sandhi for 一 and 不, as printed in children's textbooks
    for i, c in enumerate(chars):
        nxt = out[i + 1] if i + 1 < len(chars) and ZH.match(chars[i + 1]) else None
        if c == "一" and nxt:
            prev_zh = i > 0 and ZH.match(chars[i - 1])
            ordinal = prev_zh and chars[i - 1] in "第十"
            if not ordinal:
                out[i] = "yí" if tone_of(nxt) == 4 else "yì"
        if c == "不" and nxt and tone_of(nxt) == 4:
            out[i] = "bú"
        # adverbial 地 (…地 + verb) is "de"; leave 地 inside nouns like 地上/陆地/土地 alone
        if c == "地" and i > 0 and ZH.match(chars[i - 1]) and out[i] == "dì":
            starts_noun = i + 1 < len(chars) and chars[i + 1] in "方上下面图球点区址铁板毯位带震质主里头"
            redup = i > 1 and chars[i - 1] == chars[i - 2]          # 慢慢地 轻轻地 静静地: always adverbial
            if redup or (chars[i - 1] in "奇心真慢快渐气然兴静巧拙乐悄轻重好细" and not starts_noun):
                out[i] = "de"
    return chars, out


def apply_overrides(chars, syl, overrides):
    text = "".join(chars)
    for term in sorted(overrides, key=len, reverse=True):
        rep = overrides[term].split()
        if len(rep) != len(term):
            sys.exit(f"override {term!r}: need one syllable per character, got {rep}")
        for m in re.finditer(re.escape(term), text):
            syl[m.start(): m.end()] = rep
    return syl


def join_syllables(chars, syl):
    """Space-separated syllables; an override syllable "r" (儿化) attaches to the previous one."""
    out = []
    for c, y in zip(chars, syl):
        if y == "r" and out:
            out[-1] += "r"
        else:
            out.append(y)
    return " ".join(out)


def aligned_pinyin(text, overrides):
    """One entry per character of text: its syllable, or "" for punctuation/non-Chinese.
    儿化 is kept as a separate "r" over 儿 so every character has its own annotation."""
    chars, syl = syllables(text)
    syl = apply_overrides(chars, syl, overrides)
    return [y if ZH.match(c) else "" for c, y in zip(chars, syl)]


def readable(text, py):
    """Pinyin as one line, for the proofreading report."""
    return join_syllables([c for c in text if ZH.match(c)], [y for c, y in zip(text, py) if ZH.match(c)])


def balance_quotes(s):
    if s.count("“") > s.count("”"):
        s += "”"
    elif s.count("”") > s.count("“"):
        s = "“" + s
    return s


def split_sentences(text):
    # split after 。！？… keeping a closing quote with its sentence
    parts = re.findall(r"[^。！？…]*[。！？…]+[”’]?|[^。！？…]+$", text)
    out = []
    for p in (p.strip() for p in parts):
        if not ZH.search(p):
            continue
        # long sentences with ； are split into their clauses
        clauses = re.findall(r"[^；]+；?", p) if len(ZH.findall(p)) > 30 and "；" in p else [p]
        for c in clauses:
            c = re.sub(r"；$", "。", c.strip())
            out.append(balance_quotes(c))
    return out


def char_reading_in(sent, idx, overrides):
    chars, syl = syllables(sent)
    return apply_overrides(chars, syl, overrides)[idx]


def strip_tone(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").replace("ü", "v")


def reads_differently(got, py, ch):
    if strip_tone(got) != strip_tone(py):
        return True
    # same letters: a toneless reading of a toned character (哪 na vs nǎ) is a different word,
    # except 一/不 whose tones change by rule
    return ch not in "一不" and tone_of(got) == 5 and tone_of(py) != 5


def pick_sentence(ch, py, words, sentences, overrides):
    best, best_score = None, None
    for s in sentences:
        if ch not in s:
            continue
        score = 0
        if any(w in s for w in words):
            score += 10
        idx = s.index(ch)
        if reads_differently(char_reading_in(s, idx, overrides), py, ch):
            score -= 20      # character read differently here (多音字, or a neutral-tone particle like 哪 na)
        n = len(ZH.findall(s))
        score -= 0 if 8 <= n <= 28 else (abs(n - 18) / 4)
        if best_score is None or score > best_score or (score == best_score and len(s) < len(best)):
            best, best_score = s, score
    return best


_seg_cache = {}


def text_words(text):
    """2–4 character words of a text, in order (needs jieba; returns [] without it)."""
    if text not in _seg_cache:
        try:
            import jieba, logging
            jieba.setLogLevel(logging.WARNING)
            _seg_cache[text] = list(dict.fromkeys(w for w in jieba.cut(text) if 2 <= len(w) <= 4 and all(ZH.match(c) for c in w)))
        except ImportError:
            _seg_cache[text] = []
    return _seg_cache[text]


def parse_chars(spec):
    out = []
    for tok in spec.split():
        ch, py = tok.split(":")
        out.append((ch, py))
    return out


def char_speech_text(ch, py):
    """Text to synthesize for a lone character. If its default reading differs from the
    textbook's (多音字, e.g. 藏 cáng vs zàng), speak a common single-reading homophone."""
    if strip_tone(lazy_pinyin(ch, style=Style.TONE)[0]) == strip_tone(py) and \
            lazy_pinyin(ch, style=Style.TONE)[0] == py:
        return ch
    from pypinyin import pinyin_dict
    for code in range(0x4E00, 0x9FA6):
        c = chr(code)
        try:
            b = c.encode("gb2312")
        except UnicodeEncodeError:
            continue
        if not (0xB0 <= b[0] <= 0xD7):       # GB2312 level-1 = the ~3,750 most common characters
            continue
        readings = pinyin_dict.pinyin_dict.get(code, "").split(",")
        if readings == [py]:
            return c
    return ch


# Material series, in the order shown in the app. Sources without "series" are "bl".
SERIES = [
    {"id": "bl", "name": "Biling Chinese"},
    {"id": "rj", "name": "人教版 · 部编教材"},
]
BOOKS = {"a": "上册", "b": "下册"}


def grade_name(gid):
    m = re.match(r"G(\d+)$", gid)
    return f"Grade {m.group(1)}" if m else gid


def build(source_paths, report=False, check=False):
    grades, levels, characters, issues, speech = {}, [], [], [], {}
    order = {s["id"]: i for i, s in enumerate(SERIES)}
    sources = sorted((json.load(open(p)) for p in source_paths),
                     key=lambda s: (order.get(s.get("series", "bl"), 99), s["grade"], s.get("book", ""), int(s["unit"])))
    # fallback word pool: every official word list of the same series
    pool = {}
    for src in sources:
        bag = pool.setdefault(src.get("series", "bl"), [])
        for L in src["lessons"]:
            bag.extend(L.get("vocab", []))
            for sub in L["subLessons"]:
                bag.extend(sub.get("readWords", []))
    pool = {k: list(dict.fromkeys(v)) for k, v in pool.items()}

    for src in sources:
        overrides = src.get("overrides", {})
        series = src.get("series", "bl")
        gid = src["grade"] if series == "bl" else f"{series.upper()}-{src['grade']}"
        grades.setdefault(gid, {"id": gid, "series": series, "name": src.get("gradeName") or grade_name(src["grade"])})
        if series == "bl":
            level_id = f"{src['grade']}-U{src['unit']}"
            level = {"id": level_id, "series": series, "grade": gid, "name": src["name"].split(" ", 1)[-1]}
        else:
            level_id = f"{gid}{src.get('book', '').upper()}-U{src['unit']}"
            level = {"id": level_id, "series": series, "grade": gid, "book": BOOKS.get(src.get("book"), ""),
                     "name": src["name"].split(" ")[-1]}
        levels.append(level)
        for L in src["lessons"]:
            sentences = split_sentences(L["text"])
            for sub in L["subLessons"]:
                for kind in ("write", "recognize"):
                    for ch, py in parse_chars(sub[kind]):
                        cand = [w for w in sub["readWords"] + L["vocab"] if ch in w and w != ch]
                        if series != "bl" and len(cand) < 2:
                            # few words in this lesson/unit: borrow from the series' other official word lists,
                            # then real words from the lesson text (segmented with jieba)
                            cand += [w for w in pool.get(series, []) if ch in w and w != ch and len(w) <= 4][:4]
                            if len(cand) < 2:
                                cand += [w for w in text_words(L["text"]) if ch in w and w != ch][:3]
                        words = list(dict.fromkeys(cand))[:MAX_WORDS]
                        sent = pick_sentence(ch, py, words, sentences, overrides)
                        if not sent and ch in L["title"]:
                            sent = L["title"]      # the character only appears in the lesson title
                        entry = {"char": ch, "level": level_id, "pinyin": py, "words": [],
                                 "lesson": sub["id"], "lessonTitle": L["title"], "kind": kind}
                        speech[attach_audio(entry, char_speech_text(ch, py))] = char_speech_text(ch, py)
                        for w in words:
                            wo = {"word": w, "pinyin": aligned_pinyin(w, overrides)}
                            spoken = re.sub(r"，", "，", w)
                            speech[attach_audio(wo, spoken)] = spoken
                            entry["words"].append(wo)
                        if sent:
                            so = {"text": sent, "pinyin": aligned_pinyin(sent, overrides)}
                            speech[attach_audio(so, sent)] = sent
                            entry["sentence"] = so
                        characters.append(entry)
                        # Flag words where generated pinyin reads the character differently from the textbook.
                        for w in entry["words"]:
                            got = w["pinyin"][w["word"].index(ch)]
                            if strip_tone(got) != strip_tone(py):
                                issues.append(f"{ch} ({py}) read as {got} in word {w['word']}")
                        if not words:
                            issues.append(f"{ch}: no words found")
                        if not sent:
                            issues.append(f"{ch}: no sentence found in lesson text")

    used = {g["series"] for g in grades.values()}
    out = {"series": [s for s in SERIES if s["id"] in used], "grades": list(grades.values()), "levels": levels, "characters": characters,
           "voices": [{"id": v["id"], "name": v["name"]} for v in VOICES]}
    if check:   # proofreading only: write nothing
        print(f"[check] {len(characters)} characters in {len(levels)} unit(s)")
        for i in issues:
            print("⚠", i)
        if report:
            print_report(characters)
        return
    with open(os.path.join(ROOT, "data", "characters.json"), "w") as f:
        f.write('{\n  "voices": ' + json.dumps(out["voices"], ensure_ascii=False))
        f.write(',\n  "series": ' + json.dumps(out["series"], ensure_ascii=False))
        f.write(',\n  "grades": ' + json.dumps(out["grades"], ensure_ascii=False))
        f.write(',\n  "levels": [\n' + ",\n".join("    " + json.dumps(l, ensure_ascii=False) for l in levels))
        f.write('\n  ],\n  "characters": [\n' + ",\n".join("    " + json.dumps(c, ensure_ascii=False) for c in characters) + "\n  ]\n}\n")
    # what make_audio.py needs to synthesize
    with open(os.path.join(ROOT, "audio", "_speech.json"), "w") as f:
        json.dump(speech, f, ensure_ascii=False, indent=0)

    have = min(sum(1 for k in speech if os.path.exists(os.path.join(AUDIO_DIR, v["id"], k + ".mp3"))) for v in VOICES)
    print(f"{len(characters)} characters in {len(levels)} unit(s), {len(grades)} grade(s) → data/characters.json")
    print(f"audio: {have}/{len(speech)} clips present for every voice" + ("" if have == len(speech) else " — run tools/make_audio.py, then rebuild"))
    for i in issues:
        print("⚠", i)
    if report:
        print_report(characters)


def print_report(characters):
    if True:
        for c in characters:
            print(f"\n{c['lesson']} {c['kind'][0]} {c['char']} {c['pinyin']}")
            print("   词:", "  ".join(f"{w['word']} {readable(w['word'], w['pinyin'])}" for w in c["words"]))
            if "sentence" in c:
                print("   句:", c["sentence"]["text"])
                print("      ", readable(c["sentence"]["text"], c["sentence"]["pinyin"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sources", nargs="*", help="default: sources/*.json")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--check", action="store_true", help="proofread the given sources; write no files")
    a = ap.parse_args()
    paths = a.sources or sorted(glob.glob(os.path.join(ROOT, "sources", "*.json")))
    build(paths, a.report, a.check)
