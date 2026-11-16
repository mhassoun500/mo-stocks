# -*- coding: utf-8 -*-
"""Data sources. Every source is one connector with the same interface; REG tries them in order."""
from .base import REG, NoData, SourcesFailed, Connector  # noqa: F401
from . import core_sources  # noqa: F401  Yahoo, TradingView, Stooq, Google/Bing News, Sharia lists, Mubasher funds
from . import keyed  # noqa: F401  Twelve Data, Financial Modeling Prep, Alpha Vantage, Finnhub (optional keys)
from . import edgar  # noqa: F401  SEC EDGAR
from . import admin, health, quality, consensus  # noqa: F401
from .order import apply_default_order  # noqa: F401

apply_default_order()
