# -*- coding: utf-8 -*-
"""The sources the app already used (Yahoo Finance, TradingView, Stooq, Google News, Argaam, the Egyptian
list, SPUS, Mubasher funds), moved behind the connector interface. They call the same functions as before."""
import urllib.parse
import xml.etree.ElementTree as ET

from .base import Connector, NoData, http_get, REG


def _prices():
    import prices
    return prices


def _markets():
    import markets
    return markets


class Yahoo(Connector):
    id, name = "yahoo", "Yahoo Finance"
    kinds = ("history", "fundamentals", "dividends")
    markets = ("SR", "CA", "US", "XX")
    gap = 0.15
    per_min = 120

    def history(self, code, ex, rng, interval="1d", lite=False):
        p = _prices()
        return p.fetch_yahoo(p.yahoo_symbol(code, ex), rng, interval)

    def fundamentals(self, code, ex):
        return _markets()._fundamentals_yahoo(code, ex)

    def dividends(self, code, ex, rng="5y"):
        p = _prices()
        r = p.fetch_yahoo(p.yahoo_symbol(code, ex), "max" if rng == "max" else "5y", "1d")
        return {"dividends": r["dividends"], "splits": r["splits"]}


class TradingView(Connector):
    id, name = "tradingview", "TradingView"
    kinds = ("history",)
    markets = ("SR", "CA", "US", "XX")
    official = False
    gap = 0.1
    per_min = 120
    retries = 1

    def ready(self):
        import tvdata
        return tvdata.CLIENT.available()

    def history(self, code, ex, rng, interval="1d", lite=False):
        r = _prices().fetch_tv(code, ex, rng, interval, lite)
        if not r:
            raise NoData()
        return r


class TVScan(Connector):
    id, name, label = "tvscan", "TradingView Scanner", "TradingView"
    kinds = ("fundamentals",)
    gap = 0.1
    per_min = 120
    retries = 1
    retry_delay = 1.0

    def fundamentals(self, code, ex):
        return _markets().fundamentals_tradingview(code, ex)


class Stooq(Connector):
    id, name = "stooq", "Stooq"
    kinds = ("history",)
    markets = ("US", "XX")
    gap = 0.3
    per_min = 30
    retries = 0
    note = "الأسهم الأمريكية فقط، بشموع يومية"

    def history(self, code, ex, rng, interval="1d", lite=False):
        p = _prices()
        suffix = p.EXCHANGES.get(ex, (None, None, None, None))[3]
        if interval != "1d" or not suffix:
            raise NoData()
        rows = p.trim_range(p.fetch_stooq(code.split(".")[0] + suffix), rng)
        return {"ok": True, "source": "Stooq", "symbol": code.upper(), "interval": "1d", "name": code.upper(),
                "currency": "", "rows": rows, "dividends": [], "splits": []}


def parse_rss(raw, limit=12):
    root = ET.fromstring(raw)
    items = []
    for it in root.iter("item"):
        source = ""
        for ch in it:
            if ch.tag.split("}")[-1].lower() == "source" and (ch.text or "").strip():
                source = ch.text.strip()
        title = (it.findtext("title") or "").strip()
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        items.append({"title": title, "link": it.findtext("link") or "", "date": it.findtext("pubDate") or "",
                      "source": source})
        if len(items) >= limit:
            break
    return items


class GoogleNews(Connector):
    id, name = "googlenews", "Google News"
    kinds = ("news",)
    markets = ("SR", "CA", "US", "XX")
    gap = 0.3
    per_min = 40

    def news(self, q, region):
        gl = {"SR": "SA", "CA": "EG"}.get(region, "SA")
        url = "https://news.google.com/rss/search?q=%s&hl=ar&gl=%s&ceid=%s:ar" % (urllib.parse.quote(q), gl, gl)
        items = parse_rss(http_get(url, timeout=20))
        if not items:
            raise NoData()
        return items


class BingNews(Connector):
    id, name = "bingnews", "Bing News"
    kinds = ("news",)
    markets = ("SR", "CA", "US", "XX")
    gap = 0.3
    per_min = 40

    def news(self, q, region):
        mkt = {"SR": "ar-SA", "CA": "ar-EG"}.get(region, "en-US")
        url = "https://www.bing.com/news/search?q=%s&format=rss&mkt=%s" % (urllib.parse.quote(q), mkt)
        items = parse_rss(http_get(url, timeout=20))
        if not items:
            raise NoData()
        return items


class ArgaamSharia(Connector):
    id, name = "argaam", "أرقام (Argaam)"
    kinds = ("sharia",)
    markets = ("SR",)
    dataset = "sa"
    gap = 1.0

    def sharia(self):
        import sharia
        return sharia.fetch_saudi()


class EgyptSharia(Connector):
    id, name = "egsharia", "قائمة أسهم حلال (مصر)"
    kinds = ("sharia",)
    markets = ("CA",)
    dataset = "eg"
    gap = 1.0

    def sharia(self):
        import sharia
        return sharia.fetch_egypt()


class SpusSharia(Connector):
    id, name = "spus", "SP Funds (SPUS)"
    kinds = ("sharia",)
    markets = ("US",)
    dataset = "spus"
    gap = 1.0

    def sharia(self):
        import sharia
        return sharia.fetch_spus()


class MaqasedPurify(Connector):
    """Al-Maqased centre's yearly study: purification amount per share for every Saudi company (a PDF, read once a year)."""
    id, name = "maqased", "مركز المقاصد (التطهير)"
    kinds = ("sharia",)
    markets = ("SR",)
    dataset = "pur_sa"
    gap = 2.0
    retries = 1
    note = "مبلغ التطهير لكل سهم من دراسة مركز المقاصد السنوية (د. محمد العصيمي)"

    def sharia(self):
        import core
        import purify
        from . import defs
        p = defs.purify("maqased_sa")
        hit, _ = core.cache_get("sharia|pur_sa")
        if hit and hit.get("pdf") == p["url"]:
            return hit                      # already read this year's file
        if p["url"] == defs.DEFAULTS["purify"]["maqased_sa"]["url"]:
            raise NoData()                  # the copy inside the app is this very file: nothing newer to read
        return purify.fetch_maqased(p["url"], p.get("period", ""))


class TadawulFunds(Connector):
    """Saudi Exchange's official fund screener and daily unit prices (Saudi funds only)."""
    id, name = "tadawul_funds", "تداول السعودية (صناديق)"
    kinds = ("funds",)
    markets = ("SR",)
    official = True
    gap = 0.5
    note = "قائمة الصناديق السعودية الرسمية وأسعار وحداتها اليومية، مع تصنيفها الشرعي في تداول"

    def funds(self, op, country="SA", fid=None):
        import funds
        if op == "list":
            if country != "SA":
                raise NoData()
            return funds.fetch_tadawul_list()
        if not str(fid).upper().startswith("SA"):
            raise NoData()
        return funds.fetch_tadawul_history(fid)


class MubasherFunds(Connector):
    id, name = "mubasher", "مباشر (صناديق)"
    kinds = ("funds",)
    markets = ("CA", "SR")
    gap = 0.5
    retries = 0

    def funds(self, op, country="EG", fid=None):
        import funds
        return funds.fetch_fund_list(country) if op == "list" else funds.fetch_fund_history(fid)


for _c in (Yahoo, TradingView, TVScan, Stooq, GoogleNews, BingNews, ArgaamSharia, EgyptSharia, SpusSharia, MaqasedPurify, TadawulFunds, MubasherFunds):
    REG.register(_c())
