#!/usr/bin/env python3
"""Extract unit skeletons from a whole-semester student book (G3 and later).

    python3 -I tools/extract_bl_book.py BOOK.pdf --grade G3 --outdir sources

Writes one sources/g3-u<N>.json per unit found in the book's 目录. Lessons follow
the 目录 ("1.3-1.4 花的学校"); each lesson's page with 本课新字 holds the 我会写 /
我会认 characters, which are images — "write"/"recognize" are left empty to fill in,
and "_charPage" gives the PDF page to look at. From the text layer it takes:
  - 课文: from the lesson title to 本课新字, minus inline pinyin and page numbers
  - 本课词语 → vocab
  - each sub-lesson's 学以致用 读一读 → readWords
Needs poppler's `pdftotext`.
"""
import argparse, json, os, re, subprocess

ZH = "零一二三四五六七八九"
CN = r"[一-鿿]"


def zh_num(n):
    return ZH[n] if n < 10 else ("十" if n < 20 else ZH[n // 10] + "十") + (ZH[n % 10] if n % 10 else "")


def squash(s):
    return re.sub(r"[\s　]+", "", s)


def words_in(block):
    return [w for w in re.split(r"[\s　]+", block) if re.search(CN, w)]


def clean_page(p):
    keep = []
    for line in p.splitlines():
        s = line.strip()
        if not s or not re.search(CN, s):          # blank, page numbers, pinyin-only lines
            continue
        if re.match(r"比邻中文\s*G\d", s) or s.startswith("新东方"):
            continue
        keep.append(s)
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--grade", required=True)
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    txt = subprocess.run(["pdftotext", "-layout", a.pdf, "-"], capture_output=True, text=True, check=True).stdout
    pages = txt.split("\f")

    # 目录
    toc_page = next(i for i, p in enumerate(pages) if "目录" in p)
    toc = "\n".join(pages[toc_page:toc_page + 3])
    units, cur = [], None
    for line in toc.splitlines():
        s = line.strip()
        m = re.match(r"第(\S+?)单元[：:](\S+)", s)
        if m:
            cur = {"zh": m.group(1), "theme": m.group(2), "lessons": []}
            units.append(cur)
            continue
        m = re.match(r"(\d+)\.(\d+)(?:-\d+\.(\d+))?\s+(.+?)\s+\d+$", s)
        if m and cur is not None and "总结" not in m.group(4):
            first, last = int(m.group(2)), int(m.group(3) or m.group(2))
            cur["num"] = int(m.group(1))
            cur["lessons"].append({"title": m.group(4).strip(),
                                   "subs": [f"{m.group(1)}.{k}" for k in range(first, last + 1)]})

    newchar = [i for i, p in enumerate(pages) if "本课新字" in p and "我会写" in p]
    # 读一读 per sub-lesson, in reading order
    readwords, sub = {}, None
    for p in pages:
        for m in re.finditer(r"(?:学生字帖\s*\n\s*(\d+\.\d+)\s*会写字|学以致用\s*\n\s*(\d+\.\d+))|读一读(.*?)(?:练一练|$)", p, re.S):
            if m.group(1) or m.group(2):
                sub = m.group(1) or m.group(2)
            elif sub and m.group(3) is not None:
                readwords.setdefault(sub, words_in(m.group(3)))

    idx, search_from = 0, toc_page + 1
    for u in units:
        lessons = []
        for les in u["lessons"]:
            title = les["title"]
            key = squash(title)
            start = next(i for i in range(search_from, len(pages)) if key in squash(pages[i]))
            cp = next(i for i in newchar if i >= start)
            body = []
            for i in range(start, cp + 1):
                p = pages[i]
                if i == cp:
                    p = p.split("本课新字")[0]
                body += clean_page(p)
            text = squash("".join(body))
            text = text[text.find(key) + len(key):] if key in text else text
            after = pages[cp].split("本课新字", 1)[1] + "\n" + pages[cp + 1]
            vocab = words_in(re.split(r"文化驿站|学生字帖|学以致用", after.split("本课词语", 1)[1])[0]) if "本课词语" in after else []
            lessons.append({
                "title": title,
                "textPages": list(range(start + 1, cp + 2)),
                "text": text,
                "vocab": vocab,
                "subLessons": [{"id": s, "write": "", "recognize": "", "readWords": readwords.get(s, [])} for s in les["subs"]],
                "_charPage": cp + 1,
            })
            search_from = cp + 1
            idx += 1
        n = u["num"]
        out = {"grade": a.grade, "unit": n, "name": f"{a.grade} 第{u['zh']}单元",
               "theme": u["theme"], "overrides": {}, "lessons": lessons}
        path = os.path.join(a.outdir, f"{a.grade.lower()}-u{n}.json")
        with open(path, "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(path, len(lessons), "lessons", sum(len(l["subLessons"]) for l in lessons), "sub-lessons")


if __name__ == "__main__":
    main()
