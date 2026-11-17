"""Phase 3 step 5: the words the importer looks for in a broker's file must stay Arabic in the built page."""
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def test_importer_words_are_never_translated():
    page = open(os.path.join(ROOT, "app", "page.html"), encoding="utf-8").read()
    for name in ("IMP_HEAD", "IMP_BUY"):
        m = re.search(r"const %s=(.*?);\n" % name, page, re.S)
        assert m, name
        assert "_t(" not in m.group(1), "%s would follow the interface language" % name
        assert "\\u0634\\u0631\\u0627\\u0621" in m.group(1) or "\\u062a\\u0627\\u0631\\u064a\\u062e" in m.group(1)


def test_journal_tools_are_in_the_page():
    page = open(os.path.join(ROOT, "app", "page.html"), encoding="utf-8").read()
    for el in ('id="stCard"', 'id="impCard"', 'id="fSetup"', "function impTrades", "function groupStats"):
        assert el in page, el
