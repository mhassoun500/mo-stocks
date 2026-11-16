# -*- coding: utf-8 -*-
"""Read a Sharia-compliance list from a CSV or PDF file the user chose, and return it for preview.

Nothing is saved here: the page shows the result, the user confirms, and only then is it added to his own list.
"""
import csv
import io
import re

MAX_BYTES = 5 * 1024 * 1024
MAX_PAGES = 200

NO_WORDS = ["غير متوافق", "غير متوافقة", "غير شرعي", "غير شرعية", "غير مطابق", "غير ملتزم", "مخالف", "حرام", "محرم",
            "non-compliant", "non compliant", "noncompliant", "not compliant", "haram", "fail", "no", "0", "false", "✘", "✗", "x"]
DOUBT_WORDS = ["محل نظر", "مشبوه", "مشتبه", "doubtful", "questionable", "mixed", "doubt"]
OK_WORDS = ["متوافق", "متوافقة", "شرعي", "شرعية", "مطابق", "ملتزم", "حلال", "compliant", "halal", "pass", "yes", "1", "true", "✔", "✓"]
STOP = {"PDF", "SAR", "EGP", "USD", "LTD", "CO", "INC", "NO", "OK", "YES", "FAIL", "PASS", "HALAL", "HARAM", "TOTAL", "PAGE", "NAME",
        "CODE", "SYMBOL", "STATUS", "DATE", "THE", "AND", "FOR", "SA", "EG", "US", "LLC", "PLC", "CORP", "SAE"}
CODE_HEAD = ("symbol", "code", "ticker", "رمز", "الرمز", "كود", "الكود", "الشركة رمز", "stock")
STATUS_HEAD = ("status", "compliance", "ruling", "result", "verdict", "حكم", "الحكم", "الحالة", "حالة", "التوافق", "توافق", "شرعي", "الشرعي")


def _variants(words):
    out = set()
    for w in words:
        out.add(w.lower())
        if re.search(r"[؀-ۿ]", w):
            out.add(w[::-1])  # text pulled out of an Arabic PDF is often in reverse order
    return out


_NO, _DOUBT, _OK = _variants(NO_WORDS), _variants(DOUBT_WORDS), _variants(OK_WORDS)
_ARABIC_NEG = ("غير", "ريغ")


def classify(text):
    """'ok' | 'no' | 'doubt' | None for a cell or a line."""
    t = " ".join(str(text or "").lower().replace("‏", "").split())
    if not t:
        return None
    if t in _NO:
        return "no"
    if t in _DOUBT:
        return "doubt"
    if t in _OK:
        return "ok"
    # inside a longer line: look for phrases, negative ones first; short symbols like "1" or "x" only count as a whole cell
    for group, kind in ((_NO, "no"), (_DOUBT, "doubt"), (_OK, "ok")):
        for w in sorted(group, key=len, reverse=True):
            if len(w) >= 3 and re.search(r"(?<![\w؀-ۿ])" + re.escape(w) + r"(?![\w؀-ۿ])", t):
                return kind
    return None


def norm_code(s, ex="auto"):
    t = str(s or "").strip().upper().replace("‏", "")
    t = re.sub(r"\.(SR|CA|TADAWUL|EGX)$", "", t)
    if ex in ("SR", "auto") and re.fullmatch(r"\d{4}", t):
        return t
    if ex in ("CA", "US", "auto") and re.fullmatch(r"[A-Z]{1,5}([.\-][A-Z])?", t) and t not in STOP:
        return t
    return None


def _decode(data):
    for enc in ("utf-8-sig", "cp1256", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def parse_csv(data, ex="auto"):
    text = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if not rows:
        return [], 0
    head = [c.strip().lower() for c in rows[0]]
    has_head = any(any(k in h for k in CODE_HEAD + STATUS_HEAD) for h in head) and norm_code(rows[0][0], ex) is None
    body = rows[1:] if has_head else rows
    width = max(len(r) for r in rows)
    ci = si = None
    if has_head:
        ci = next((i for i, h in enumerate(head) if any(k in h for k in CODE_HEAD)), None)
        si = next((i for i, h in enumerate(head) if any(k in h for k in STATUS_HEAD)), None)
    if ci is None:   # the column that holds the most things that look like symbols
        ci = max(range(width), key=lambda i: sum(1 for r in body if i < len(r) and norm_code(r[i], ex)))
    if si is None:   # the column that holds the most recognisable verdicts
        cand = [i for i in range(width) if i != ci]
        si = max(cand, key=lambda i: sum(1 for r in body if i < len(r) and classify(r[i])), default=None)
    out, skipped = [], 0
    for r in body:
        code = norm_code(r[ci], ex) if ci < len(r) else None
        st = classify(r[si]) if si is not None and si < len(r) else None
        if code and st:
            out.append((code, st))
        else:
            skipped += 1
    return out, skipped


def parse_pdf(data, ex="auto"):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise ValueError("قراءة PDF تحتاج مكتبة pypdf وهي غير مثبتة.")
    rd = PdfReader(io.BytesIO(data))
    if getattr(rd, "is_encrypted", False):
        raise ValueError("ملف PDF محمي بكلمة مرور.")
    out, skipped, chars = [], 0, 0
    for page in rd.pages[:MAX_PAGES]:
        text = page.extract_text() or ""
        chars += len(text)
        for line in text.splitlines():
            if not line.strip():
                continue
            st = classify(line)
            code = None
            if st:
                for tok in re.split(r"[\s,;|:()\[\]]+", line):
                    code = norm_code(tok, ex)
                    if code:
                        break
            if code and st:
                out.append((code, st))
            else:
                skipped += 1
    if chars < 20:
        raise ValueError("لا يوجد نص في الملف (ربما هو صورة ممسوحة ضوئيًا). استخدم ملف CSV أو انسخ الرموز يدويًا.")
    return out, skipped


def preview(name, data, ex="auto"):
    if not data:
        return {"ok": False, "error": "الملف فارغ."}
    if len(data) > MAX_BYTES:
        return {"ok": False, "error": "الملف أكبر من 5 ميغابايت."}
    ex = ex if ex in ("SR", "CA", "US") else "auto"
    try:
        if data[:5] == b"%PDF-" or str(name).lower().endswith(".pdf"):
            pairs, skipped = parse_pdf(data, ex)
            kind = "pdf"
        else:
            pairs, skipped = parse_csv(data, ex)
            kind = "csv"
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": "تعذّرت قراءة الملف: %s" % str(e)[:120]}
    seen = {}
    for code, st in pairs:
        seen.setdefault(code, set()).add(st)
    conflicts = sorted(c for c, s in seen.items() if len(s) > 1)
    ok = sorted(c for c, s in seen.items() if s == {"ok"})
    no = sorted(c for c, s in seen.items() if s == {"no"})
    doubt = sorted(c for c, s in seen.items() if s == {"doubt"})
    if not (ok or no or doubt):
        return {"ok": False, "error": "لم أجد في الملف رموزًا مع حكمها. تأكد أن في كل سطر رمز السهم وبجانبه الحكم (متوافق / غير متوافق)."}
    sample = [[c, "ok" if c in ok else "no" if c in no else "doubt"] for c in (ok[:4] + no[:4] + doubt[:2])]
    return {"ok": True, "kind": kind, "ok_list": ok, "no_list": no, "doubt": doubt, "conflicts": conflicts,
            "skipped": skipped, "sample": sample}
