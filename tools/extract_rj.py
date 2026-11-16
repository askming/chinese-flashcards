#!/usr/bin/env python3
"""Build unit source files from a 人教版 (部编版) 语文 textbook + its 写字 copybook sheet.

    python3 -I tools/extract_rj.py BOOK.pdf SHEET.pdf --grade 2 --half a --out sources/
        → sources/rj-g2a-u1.json … rj-g2a-u8.json   (half: a = 上册, b = 下册)

What comes from where:
  characters + lesson   the textbook's 写字表 (rows "N  字字字…", under 课文/识字 headers in grade 2)
  character pinyin      the 写字表's pinyin row when printed (grade 2: an obfuscated font, decoded
                        below), otherwise the copybook sheet; the sheet is also the authority for
                        which characters belong to the table (drops 统编版 watermark letters)
  words                 the 词语表 row for the lesson (readWords) and the whole unit (vocab)
  lesson text           the lesson's pages, located through the 目录; pinyin lines, author notes,
                        page numbers and the exercises after the text are removed
  unit                  1 + the number of 语文园地 entries before the lesson in the 目录

Needs poppler (pdftotext, pdfinfo). Output is meant to be proofread with
`build_data.py --check --report`, like the other sources.
"""
import argparse, json, os, re, subprocess, sys
from collections import OrderedDict

ZH = r"[一-鿿]"
ZH_NUM = "一二三四五六七八九十"
# The textbook's pinyin font maps tone-marked vowels to capital letters.
TONE_FONT = {
    "Q": "ā", "W": "á", "A": "ǎ", "S": "à",
    "E": "ē", "R": "é", "D": "ě", "F": "è",
    "U": "ī", "I": "í", "J": "ǐ", "K": "ì",
    "T": "ō", "Y": "ó", "G": "ǒ", "H": "ò",
    "O": "ū", "P": "ú", "L": "ǔ", "M": "ù",
    "X": "ǖ", "Z": "ǘ", "C": "ǚ", "V": "ǜ",
}
STRUCTURES = "单一|左右|上下|半包围|全包围|左中右|上中下|独体|品字"
WATERMARK = set("统编版")


def pdf_text(f, a=None, b=None, crop=None):
    """Text of pages a..b. crop = (x, y, w, h) in points reads only that region (e.g. one column)."""
    cmd = ["pdftotext", "-layout"] + (["-f", str(a), "-l", str(b)] if a else [])
    if crop:
        cmd += ["-x", str(int(crop[0])), "-y", str(int(crop[1])), "-W", str(int(crop[2])), "-H", str(int(crop[3]))]
    out = subprocess.run(cmd + [f, "-"], capture_output=True, text=True).stdout
    return out.replace("\u200b", "").replace("\ufeff", "")


def page_size(f, p):
    out = subprocess.run(["pdfinfo", "-f", str(p), "-l", str(p), f], capture_output=True, text=True).stdout
    m = re.search(r"Page\s+%d size:\s+([\d.]+) x ([\d.]+)" % p, out) or re.search(r"Page size:\s+([\d.]+) x ([\d.]+)", out)
    return float(m.group(1)), float(m.group(2))


def n_pages(f):
    out = subprocess.run(["pdfinfo", f], capture_output=True, text=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", out).group(1))


def decode_pinyin(s):
    return "".join(TONE_FONT.get(c, c) for c in s).lower() if s else s


def find_heading(f, title, lo, hi):
    pat = re.compile(r"^\s*" + r"\s*".join(title) + r"\s*$", re.M)
    for p in range(lo, hi + 1):
        if pat.search(pdf_text(f, p, p)):
            return p
    return None


# ---------- copybook sheet: char → pinyin ----------
def sheet_chars(sheet):
    lines = pdf_text(sheet).splitlines()
    out = OrderedDict()
    for i, l in enumerate(lines):
        m = re.match(rf"^\s*({ZH})\s+({STRUCTURES})\b", l)
        if not m:
            continue
        py = None
        for k in (2, 1, 3):
            if i - k >= 0 and re.fullmatch(r"\s*[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+\s*", lines[i - k]):
                py = lines[i - k].strip()
                break
        out[m.group(1)] = py
    return out


# ---------- 写字表 / 词语表 rows ----------
def table_rows(book, start, end):
    """[(section, number, [chars] or [words], pinyin_tokens_above)] in printed order."""
    rows, section = [], "课文"
    lines = pdf_text(book, start, end).splitlines()
    for i, l in enumerate(lines):
        s = l.strip()
        if s in ("课文", "识字"):
            section = s
            continue
        m = re.match(r"^\s*(\d+)\s+(.+)$", l)
        if not m or not re.search(ZH, m.group(2)):
            # a row that wrapped onto the next printed line (no lesson number): continue the last row
            body = re.sub(r"\s{3,}[统编版]\s*$", "", s)
            if (rows and re.search(ZH, body) and not re.search(r"[A-Za-z]", body)
                    and not re.search(r"共\s*\d+|写\s*字\s*表|词\s*语\s*表|识\s*字\s*表", body) and not set(body.replace(" ", "")) <= WATERMARK):
                sec0, num0, body0, py0 = rows[-1]
                rows[-1] = (sec0, num0, body0 + " " + body, py0 if not py0 else py0)
            continue
        prev = lines[i - 1] if i else ""
        rows.append((section, int(m.group(1)), m.group(2), prev.split() if re.search(r"[A-Za-z]", prev) and not re.search(ZH, prev) else []))
    return rows


# ---------- 目录 ----------
def toc_entries(book):
    """Lesson / 语文园地 / unit entries with their book page numbers, sorted by page."""
    entries = []
    for p in range(2, 9):
        full = pdf_text(book, p, p)
        if "目录" not in full and not entries:
            continue
        w, h = page_size(book, p)
        # two-column 目录: read each column on its own so entries don't interleave
        t = pdf_text(book, p, p, crop=(0, 0, w / 2, h)) + "\n" + pdf_text(book, p, p, crop=(w / 2, 0, w / 2, h))
        t = re.sub(r"\.{2,}\s*\n\s*(\d+)", r"........\1", t)       # page number wrapped onto the next line
        for line in t.splitlines():
            # a stray digit bleeding in from the other column: "1   4    曹冲称象…28"
            line = re.sub(r"^\s*\d{1,3}\s{2,}(?=\d+\s*\*?\s+\S|◎)", "", line)
            m = re.match(r"^\s*(?:(?P<num>\d+)\s*\*?\s+|(?P<mark>◎)\s*)?(?P<title>[^\s.·…\d][^.…]*?)\s*[.·…]{2,}[ .·…]*(?P<page>\d+)\s*$", line)
            if not m:
                continue
            title = re.sub(r"\s+", "", m.group("title"))
            entries.append({"num": int(m.group("num")) if m.group("num") else None, "title": title,
                            "page": int(m.group("page")), "garden": "语文园地" in title, "unitHead": bool(re.match(r"第.单元", title))})
        if entries and ("词语表" in full or "写字表" in full):
            break
    seen, out = set(), []
    for e in sorted(entries, key=lambda e: e["page"]):
        k = (e["title"], e["page"])
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


def page_offset(book):
    """PDF page number minus printed page number (found via the page carrying printed number 1)."""
    for p in range(3, 20):
        lines = [l for l in pdf_text(book, p, p).splitlines() if l.strip()]
        if lines and re.search(r"(^|\s)1\s*$", lines[-1]) and not re.search(r"目\s*录", "".join(lines)):
            return p - 1
    raise SystemExit("could not find the printed page 1")


# ---------- lesson text cleanup ----------
EXERCISE = re.compile(r"^(○|◎|●|朗读|读一读|读读|说一说|背诵|默读|照样子|写一写|想一想|找一找|选做|小练笔|阅读链接|资料袋|你|课文|根据|用“|结合|和同学|交流|演一演|分角色)")
DROP = re.compile(r"^(本文作者|作者|选作课文时|选自|原文|本文|注释|[①②③④⑤⑥⑦⑧⑨])")


def clean_lesson_text(raw, title):
    out = []
    started = False
    for line in raw.splitlines():
        s = line.strip()
        if not s:
            continue
        n_zh, n_lat = len(re.findall(ZH, s)), len(re.findall(r"[A-Za-z]", s))
        if n_lat and n_lat >= n_zh:            # pinyin line
            continue
        s = re.sub(r"\s{3,}[统编版]\s*$", "", s)
        s = re.sub(r"[A-Za-z]+", "", s)
        s = re.sub(rf"(?<={ZH}|[，。！？、；：“”‘’（）《》…—])\s+(?={ZH}|[，。！？、；：“”‘’（）《》…—])", "", s).strip()
        if not s or set(s) <= WATERMARK or re.fullmatch(r"\d+", s):
            continue
        if DROP.match(s):
            continue
        if re.sub(r"[\d*\s]", "", s) in (title, "课文", "识字") or re.fullmatch(r"\d+\*?" + re.escape(title), s):
            continue
        if started and EXERCISE.match(s):
            break
        started = True
        out.append(s)
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("book")
    ap.add_argument("sheet")
    ap.add_argument("--grade", type=int, required=True)
    ap.add_argument("--half", choices=["a", "b"], required=True)
    ap.add_argument("--out", default="sources")
    a = ap.parse_args()

    total = n_pages(a.book)
    w_page = find_heading(a.book, "写字表", total - 30, total)
    v_page = find_heading(a.book, "词语表", w_page, total)
    end_page = find_heading(a.book, "后记", v_page, total) or total
    sheet = sheet_chars(a.sheet)

    # 写字表: lesson → chars (+ printed pinyin)
    write = OrderedDict()
    for sec, num, body, py in table_rows(a.book, w_page, v_page - 1):
        chars = [c for c in re.findall(ZH, body)]
        if py and len(py) != len(chars):
            py = []
        for k, c in enumerate(chars):
            if c in WATERMARK and c not in sheet:
                continue
            write.setdefault((sec, num), []).append((c, decode_pinyin(py[k]) if py else None))

    # 词语表: lesson → words
    words = OrderedDict()
    for sec, num, body, _ in table_rows(a.book, v_page, end_page - 1):
        ws = [w for w in re.split(r"\s+", body) if re.fullmatch(rf"{ZH}+", w) and not set(w) <= WATERMARK]
        words.setdefault((sec, num), []).extend(ws)

    # 目录 → lesson titles, pages, units
    toc = toc_entries(a.book)
    off = page_offset(a.book)
    lesson_entries = [e for e in toc if e["num"] is not None]
    # Match table keys (in printed order) to 目录 lessons (in page order) by number.
    keys = list(OrderedDict.fromkeys(list(write) + list(words)))
    keys.sort(key=lambda k: list(write).index(k) if k in write else 10_000 + list(words).index(k))
    used, lesson_of = set(), {}
    for key in keys:
        for i, e in enumerate(lesson_entries):
            if i not in used and e["num"] == key[1]:
                used.add(i)
                lesson_of[key] = e
                break

    def unit_of(e):
        return 1 + sum(1 for x in toc if x["garden"] and x["page"] < e["page"])

    def next_page(e):
        later = [x["page"] for x in toc if x["page"] > e["page"]]
        return (min(later) if later else w_page - off) - 1

    units = OrderedDict()
    problems, unverified = [], []
    try:
        from pypinyin import lazy_pinyin, Style
        guess = lambda c: lazy_pinyin(c, style=Style.TONE)[0]
    except ImportError:
        guess = lambda c: None
    printed_total = re.search(r"共\s*(\d+)\s*个字", pdf_text(a.book, w_page, v_page))
    prev = None
    for key, chars in write.items():
        e = lesson_of.get(key)
        if not e:
            # not matched in the 目录: keep the characters under a placeholder in the previous lesson's unit
            problems.append(f"no 目录 entry for {key}: placeholder lesson (fix title/text from the page images)")
            e = {"title": f"[?] {key[0]}{key[1]}", "page": prev["page"] if prev else 1, "placeholder": True}
        else:
            prev = e
        u = unit_of(e)
        if e.get("placeholder"):
            pdf_a = pdf_b = None
            text = ""
        else:
            pdf_a, pdf_b = e["page"] + off, next_page(e) + off
            text = clean_lesson_text(pdf_text(a.book, pdf_a, pdf_b), e["title"])
        spec = []
        for c, py in chars:
            p = py or sheet.get(c)
            if py and sheet.get(c) and py != sheet[c]:
                problems.append(f"{c} ({key}): textbook {py} vs sheet {sheet[c]} — using textbook")
            if not p:
                p = guess(c) or "?"
                unverified.append(c)
            spec.append(f"{c}:{p}")
        lid = f"{'识字' if key[0] == '识字' else ''}{key[1]}"
        units.setdefault(u, []).append({
            "title": e["title"], "textPages": list(range(pdf_a, pdf_b + 1)) if pdf_a else [], "text": text, "vocab": [],
            "subLessons": [{"id": lid, "write": " ".join(spec), "recognize": "", "readWords": words.get(key, [])}],
        })
    n_table = sum(len(cs) for cs in write.values())
    if printed_total and int(printed_total.group(1)) != n_table:
        problems.append(f"写字表 says 共{printed_total.group(1)}个字 but {n_table} were read")
    if unverified:
        problems.append(f"pinyin generated (not printed in the book or sheet) for {len(unverified)} characters — verify: {''.join(unverified)}")

    os.makedirs(a.out, exist_ok=True)
    half_name = "上册" if a.half == "a" else "下册"
    for u, lessons in units.items():
        unit_words = list(OrderedDict.fromkeys(w for L in lessons for s in L["subLessons"] for w in s["readWords"]))
        for L in lessons:
            L["vocab"] = unit_words
        src = {"series": "rj", "grade": f"G{a.grade}", "book": a.half, "unit": u,
               "name": f"{half_name} 第{ZH_NUM[u - 1]}单元", "overrides": {}, "lessons": lessons,
               "source": os.path.basename(a.book)}
        path = os.path.join(a.out, f"rj-g{a.grade}{a.half}-u{u}.json")
        with open(path, "w") as f:
            json.dump(src, f, ensure_ascii=False, indent=2)
    n = sum(len(s["write"].split()) for L in [x for ls in units.values() for x in ls] for s in L["subLessons"])
    print(f"G{a.grade}{a.half}: {n} characters (写字表 {n_table}, sheet {len(sheet)}), {len(units)} units, pages 写字表 {w_page} 词语表 {v_page}, offset {off}")
    for p in problems:
        print("  ⚠", p)


if __name__ == "__main__":
    main()
