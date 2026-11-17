# -*- coding: utf-8 -*-
"""Purification (تطهير): how much of a stock's income is not permissible and has to be given away.

Two kinds of figure exist, and they are never mixed up:
  - "amt": an amount per share for one financial year, in the stock's currency (Al-Maqased centre, Saudi market);
  - "pct": a share of income in percent (the Egyptian lists, the user's own entries, and the program's estimate).

Sources:
  Al-Maqased centre (Dr. Mohammed Al-Osaimi) publishes once a year a PDF study of every Saudi company and REIT
  on the main market and Nomu, with the verdict (pure / mixed / non-compliant) and the purification amount per
  share from the audited annual statements. A copy read from the latest study ships with the app
  (app/data/purify_sa.json); the app re-reads the PDF when the address in the definitions file changes.

The program's own estimate is interest income divided by total revenue for the last financial year. It is only
a rough lower bound (other non-permissible income is not visible in these figures), so it is always labelled
as an estimate and never shown for banks and other financial companies, where interest is the core business.
"""
import io
import re
import time
import unicodedata

MAQASED_SOURCE = "مركز المقاصد (د. محمد العصيمي)"
MAQASED_PAGE = "https://www.argaam.com/ar/article/articledetail/id/1946451"
MIN_ROWS = 200          # the study covers about 380 companies; fewer rows means the file was read wrongly

# a verdict word as it appears in the study, also in the reversed order some PDF readers give for Arabic
_VERDICTS = (("غير متوافقة", "n"), ("غير متوافق", "n"), ("مختلطة", "m"), ("نقية", "p"), ("راجع المنهجية", "s"))
_MARKETS = {"رئيسي": "main", "موازي": "nomu"}
_ROW = re.compile(r"^(\d{5,7})(.*?)(\d+\.\d{1,4})\s*(رئيسي|موازي)\s*$")
_ROW_REV = re.compile(r"^(يسيئر|يزاوم)\s*(\d{1,4}\.\d+)(.*?)(\d{5,7})$")     # the same row read right to left


def _norm(s):
    s = unicodedata.normalize("NFKC", str(s or ""))
    s = s.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    return " ".join(s.replace("‏", "").replace("‎", "").split())


def _verdict(body):
    body = body.replace(" ", "")
    for word, k in _VERDICTS:
        word = word.replace(" ", "")
        if word in body or word[::-1] in body:
            return k
    return "?"


def parse_maqased_text(text):
    """Rows of the Al-Maqased study from the text of its PDF: {code: [amount per share, verdict letter, market]}.

    A row reads: sequence number and company code run together ("2901202" = row 290, code 1202), names, verdict,
    sector, amount, market. Only the last four digits of the leading number are the code."""
    rows = {}
    for raw in str(text or "").splitlines():
        line = _norm(raw).replace(" ", "")
        m = _ROW.match(line)
        if m:
            seq, body, amt, mkt = m.groups()
        else:
            r = _ROW_REV.match(line)
            if not r:
                continue
            mkt_rev, amt_rev, body, seq_rev = r.groups()
            mkt, amt, seq = mkt_rev[::-1], amt_rev[::-1], seq_rev[::-1]
            try:
                float(amt)
            except ValueError:
                continue
        code = seq[-4:]
        try:
            a = round(float(amt), 4)
        except ValueError:
            continue
        if not 0 <= a < 100:
            continue
        rows[code] = [a, _verdict(body), _MARKETS.get(mkt, "")]
    return rows


def pdf_text(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages[:60])


def fetch_maqased(url, year=""):
    """Download the study and read it. Raises FormatChanged when the file no longer reads as the study."""
    from sources.base import format_changed, http_get
    data = http_get(url, headers={"Accept": "application/pdf,*/*"}, timeout=90)
    if not data.startswith(b"%PDF"):
        raise format_changed("maqased", "the address did not return a PDF file", data[:200])
    text = pdf_text(data)
    rows = parse_maqased_text(text)
    if len(rows) < MIN_ROWS:
        raise format_changed("maqased", "read only %d company rows from the study" % len(rows), text[:400])
    return {"source": MAQASED_SOURCE, "url": MAQASED_PAGE, "pdf": url, "date": time.strftime("%Y-%m-%d"),
            "period": str(year or ""), "unit": "amt", "rows": rows}


# ---------------------------------------------------------------- the program's estimate
FINANCIAL_WORDS = ("bank", "financ", "insur", "invest", "brokerage", "capital market", "مصرف", "مصارف", "بنك", "بنوك", "تأمين", "تمويل", "استثمار")


def estimate_pct(revenue, interest, sector=""):
    """Interest income as a share of revenue, in percent, or None when it cannot be worked out honestly."""
    s = str(sector or "").lower()
    if any(w in s for w in FINANCIAL_WORDS):
        return None
    try:
        rev, inc = float(revenue), float(interest)
    except (TypeError, ValueError):
        return None
    if rev <= 0 or inc < 0 or inc > rev:
        return None
    return round(inc / rev * 100, 3)
