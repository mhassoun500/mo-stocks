"""Phase 6: the stock report as a PDF, in Arabic and English, and the files the installed app needs."""
import base64
import io
import json
import os

import pypdf

import main
import report_pdf

PNG = base64.b64encode(bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b1e3c50000000049454e44ae426082")).decode()


def sample(lang):
    return {"lang": lang, "code": "1120", "title": "مصرف الراجحي (1120) — تقرير السهم" if lang == "ar" else "Al Rajhi (1120) — stock report",
            "subtitle": "18 نوفمبر 2026 · السعر 63.95", "chart": "data:image/png;base64," + PNG,
            "sections": [{"title": "الملخص", "pairs": [["آخر سعر", "63.95"], ["العائد إلى المخاطرة", "1 : 1.9"]], "cols": 2},
                         {"title": "رأي المساعد", "text": "## الخلاصة\n- نقطة **أولى**\nنص " * 120},
                         {"title": "تسعة أسئلة", "items": ["هل يسهل الدخول والخروج؟ عادي"] * 5}, "not a section"],
            "disclaimer": "ليست توصية استثمارية.", "footer": "Mo Stocks"}


def test_pdf_in_both_languages_with_several_pages():
    for lang in ("ar", "en"):
        data = report_pdf.build(sample(lang))
        r = pypdf.PdfReader(io.BytesIO(data))
        assert len(r.pages) >= 2, "long answers flow onto more pages"
        assert "IBMPlexSansArabic" in json.dumps([str(f) for f in r.pages[0]["/Resources"]["/Font"].values()]) or r.pages[0]["/Resources"]["/Font"]


def test_arabic_is_joined_and_numbers_keep_their_order():
    v = report_pdf.visual("السعر 63.95", True)
    assert "63.95" in v and any("\ufe70" <= c <= "\ufefc" for c in v), "letters in their joined forms"
    assert report_pdf.visual("1 : 1.9", True) == "1 : 1.9", "a ratio is not reversed"
    assert report_pdf.visual("Apple AAPL", False) == "Apple AAPL"


def test_saved_with_a_safe_name(tmp_path):
    p = report_pdf.save(dict(sample("ar"), code="../../x"), str(tmp_path))
    q = report_pdf.save(dict(sample("ar"), code="../../x"), str(tmp_path))
    assert os.path.dirname(p) == str(tmp_path) and p != q and open(p, "rb").read(4) == b"%PDF"


def test_the_selftest_checks_shipped_files_and_the_pdf():
    main._check_shipped()
    main._check_pdf()
