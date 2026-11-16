# -*- coding: utf-8 -*-
"""Cross-check the important numbers of one company between sources, and take the majority when they disagree."""
import threading

from .base import REG, NoData

# field -> (label shown in the page, tolerance)  tolerance: ("rel", fraction) or ("abs", points)
FIELDS = {
    "close": ("السعر", ("rel", 0.02)),
    "price_earnings_ttm": ("مكرر الربحية", ("rel", 0.10)),
    "price_book_fq": ("مكرر القيمة الدفترية", ("rel", 0.10)),
    "price_target_average": ("متوسط سعر المحللين", ("rel", 0.15)),
    "dividends_yield_current": ("عائد التوزيعات", ("abs", 0.5)),
}


def close_to(a, b, tol):
    kind, v = tol
    if kind == "abs":
        return abs(a - b) <= v
    return abs(a - b) <= v * max(abs(a), abs(b), 1e-9)


def vote(values, tol):
    """values: {source: number}. Returns (majority_value or None, outliers) - a majority needs three or more
    sources, and more than half of them close to each other."""
    items = [(k, v) for k, v in values.items() if v is not None]
    if len(items) < 3:
        return None, []
    best = []
    for _, v in items:
        grp = [k for k, w in items if close_to(v, w, tol)]
        if len(grp) > len(best):
            best = grp
    if len(best) * 2 <= len(items):
        return None, []
    nums = sorted(v for k, v in items if k in best)
    mid = nums[len(nums) // 2] if len(nums) % 2 else (nums[len(nums) // 2 - 1] + nums[len(nums) // 2]) / 2.0
    return mid, [k for k, _ in items if k not in best]


def cross_check(market, primary_id, primary_f, code, ex, extra=2, timeout=6.0):
    """Ask up to `extra` other sources for the same company and compare. Returns (f, report):
    f is the primary figures with any majority-corrected values, report = {"sources": [...], "conflicts": [...]}."""
    others = [c for c in REG.chain("fundamentals", market) if c.id != primary_id][:extra]
    if not others:
        return primary_f, None
    got = {}

    def ask(c):
        tried = []
        v, err = REG._attempt(c, "fundamentals", tried, dict(code=code, ex=ex), market)
        if err is None and isinstance(v, dict):
            got[c.id] = v

    ths = [threading.Thread(target=ask, args=(c,), daemon=True) for c in others]
    for t in ths:
        t.start()
    for t in ths:
        t.join(timeout)
    if not got:
        return primary_f, None
    names = {primary_id: REG.items[primary_id].label or REG.items[primary_id].name}
    for cid in got:
        names[cid] = REG.items[cid].label or REG.items[cid].name
    f = dict(primary_f)
    conflicts = []
    for key, (label, tol) in FIELDS.items():
        vals = {primary_id: primary_f.get(key)}
        vals.update({cid: v.get(key) for cid, v in got.items()})
        vals = {k: v for k, v in vals.items() if isinstance(v, (int, float))}
        if len(vals) < 2:
            continue
        maj, outliers = vote(vals, tol)
        if maj is not None:
            for cid in vals:
                REG.vote("fundamentals", market, cid, cid not in outliers)
            if outliers:
                conflicts.append({"key": key, "label": label, "values": {names[k]: v for k, v in vals.items()},
                                  "used": maj, "against": [names[k] for k in outliers]})
                if primary_id in outliers:
                    f[key] = maj
            continue
        agreed = all(close_to(a, b, tol) for a in vals.values() for b in vals.values())
        for cid in vals:
            REG.vote("fundamentals", market, cid, agreed)
        if not agreed:
            conflicts.append({"key": key, "label": label, "values": {names[k]: v for k, v in vals.items()},
                              "used": None, "against": []})
    return f, {"sources": sorted(names.values()), "conflicts": conflicts}
