"""All page scripts share one scope: a name declared twice stops the whole page. This catches it before a release."""
import os
import re

JS = os.path.join(os.path.dirname(__file__), "..", "..", "app", "web", "js")
DECL = re.compile(r"^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|class)\s+([A-Za-z_$][\w$]*))", re.M)


def test_no_name_is_declared_twice_at_the_top_level():
    seen, dup = {}, []
    for f in sorted(os.listdir(JS)):
        if not f.endswith(".js"):
            continue
        for m in DECL.finditer(open(os.path.join(JS, f), encoding="utf-8").read()):
            n = m.group(1) or m.group(2)
            if n in seen:
                dup.append("%s in %s and %s" % (n, seen[n], f))
            seen[n] = f
    assert dup == []
