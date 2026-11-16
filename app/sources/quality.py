# -*- coding: utf-8 -*-
"""Checks run on price history before it is shown. Nothing is changed: doubtful data gets a warning, never a silent fix.
Each issue is {"code", "n", "level"}; the page words it in the user's language."""
import time

JUMP = 0.35          # one-day move that looks like a data error rather than a market move
BIG_GAP_DAYS = 10    # days with no bar inside the last year (long holidays stay below this)


def _near_split(splits, t, days=3):
    return any(abs(s[0] - t) <= days * 86400000 for s in (splits or []))


def check_history(res):
    """Issues found in a history result. Daily bars only."""
    rows = res.get("rows") or []
    if res.get("interval", "1d") != "1d" or len(rows) < 5:
        return []
    issues = []

    def add(code, n, level):
        if n:
            issues.append({"code": code, "n": n, "level": level})

    zero = bad = order = 0
    for r in rows:
        t, o, h, l, c = r[0], r[1], r[2], r[3], r[4]
        vals = [x for x in (o, h, l, c) if x is not None]
        if any(x <= 0 for x in vals):
            zero += 1
        elif h is not None and l is not None and (h < l * 0.9999 or (c is not None and (c > h * 1.0001 or c < l * 0.9999))):
            bad += 1
    for a, b in zip(rows, rows[1:]):
        if b[0] <= a[0]:
            order += 1
    add("zero", zero, "bad")
    add("order", order, "bad")
    add("bar", bad, "warn")
    jumps = 0
    splits = res.get("splits") or []
    for a, b in zip(rows, rows[1:]):
        if a[4] and b[4] and a[4] > 0 and abs(b[4] / a[4] - 1) > JUMP and not _near_split(splits, b[0]):
            jumps += 1
    add("jump", jumps, "warn")
    recent = rows[-260:]
    gaps = sum(1 for a, b in zip(recent, recent[1:]) if (b[0] - a[0]) / 86400000.0 > BIG_GAP_DAYS)
    add("gap", gaps, "warn")
    if not res.get("offline") and time.time() - rows[-1][0] / 1000.0 > 7 * 86400:
        add("stale", 1, "warn")
    return issues
