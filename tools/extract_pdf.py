#!/usr/bin/env python3
"""Extract a unit skeleton from a 比邻中文 student-book PDF.

    python3 -I tools/extract_pdf.py BOOK.pdf --grade G2 --unit 10 > sources/g2-u10.json

Pulls from the PDF's text layer:
  - each sub-lesson's 读一读 word list
  - each lesson's 本课词语 list
  - each lesson's 课文 (lesson text), used for example sentences

The 我会写 / 我会认 characters on the 字词乐园 pages are images, so they are left
as empty "write"/"recognize" strings to fill in, e.g. "忠:zhōng 实:shí 导:dǎo".
The pages to look at are listed in "_charPages".
Needs poppler's `pdftotext` (brew install poppler).
"""
import argparse, json, re, subprocess, sys

FOOTER = re.compile(r"比邻中文\s*G\d+\s*第\S{1,3}单元\s*学生用书\s*(\d+)\s*/\s*\d+")
NOT_LESSON = re.compile(r"学以致用|学生字帖|练一练|字词乐园|选字填空|课内阅读|单元总结|[一二三四五六]、")


def pages_of(pdf):
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    parts = FOOTER.split(txt)
    return {int(parts[i + 1]): parts[i] for i in range(0, len(parts) - 1, 2)}


def words_in(block):
    return [w for w in re.split(r"[\s　]+", block) if re.search(r"[一-鿿]", w)]


def zh_num(n):
    n = int(n)
    d = "零一二三四五六七八九"
    return d[n] if n < 10 else ("十" if n < 20 else d[n // 10] + "十") + (d[n % 10] if n % 10 else "")


def squash(s):
    return re.sub(r"[\s　]+", "", s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--grade", required=True)
    ap.add_argument("--unit", required=True)
    a = ap.parse_args()
    pages = pages_of(a.pdf)

    readwords = {}
    for body in pages.values():
        for m in re.finditer(r"(\d+\.\d+)\s*\n\s*◼\s*读一读(.*?)◼\s*练一练", body, re.S):
            readwords[m.group(1)] = words_in(m.group(2))

    lessons = []
    for p in sorted(pages):
        body = pages[p]
        if "字词乐园" not in body:
            continue
        m = re.search(r"我会写\s*\n\s*([\d.\s]+)\n", body)
        subs = m.group(1).split() if m else []
        vocab = words_in(body.split("本课词语", 1)[1]) if "本课词语" in body else []
        # 课文 = consecutive pages right before 字词乐园 that aren't exercise pages
        text_pages, q = [], p - 1
        while q in pages and not NOT_LESSON.search(pages[q]):
            text_pages.insert(0, q)
            q -= 1
        raw = "".join(pages[q] for q in text_pages)
        lines = [l.strip() for l in raw.splitlines() if l.strip()]
        title = lines[0] if lines else ""
        lessons.append({
            "title": title,
            "textPages": text_pages,
            "text": squash("".join(lines[1:])),
            "vocab": vocab,
            "subLessons": [{"id": s, "write": "", "recognize": "", "readWords": readwords.get(s, [])} for s in subs],
            "_charPages": p,
        })

    json.dump({"grade": a.grade, "unit": int(a.unit), "name": f"{a.grade} 第{zh_num(a.unit)}单元",
               "overrides": {}, "lessons": lessons}, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
