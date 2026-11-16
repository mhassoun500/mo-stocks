# -*- coding: utf-8 -*-
"""Default order of the sources for each kind of data, best first."""
from .base import REG, ORDER_HOOKS

DEFAULT = {
    "history": ["tradingview", "yahoo", "stooq", "twelvedata", "fmp"],
    "fundamentals": ["tvscan", "yahoo", "fmp", "alphavantage", "finnhub", "edgar"],
    "news": ["googlenews", "bingnews"],
    "dividends": ["yahoo"],
    "sharia": ["argaam", "egsharia", "spus"],
    "funds": ["mubasher"],
}


def _history_hook(ids, market):
    """Yahoo comes first when the user chose it in the settings; TradingView then stays as a backup."""
    try:
        import core
        if core.pref("dataSource", "tv") == "yahoo" and "tradingview" in ids and "yahoo" in ids:
            ids = [i for i in ids if i != "tradingview"]
            ids.insert(ids.index("yahoo") + 1, "tradingview")
    except Exception:
        pass
    return ids


def apply_default_order():
    for k, ids in DEFAULT.items():
        REG.set_order(k, ids)
    ORDER_HOOKS["history"] = _history_hook
