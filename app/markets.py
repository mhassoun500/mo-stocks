# -*- coding: utf-8 -*-
"""Market data: search, company profiles, market lists, sectors, fundamentals, Sharia lists and screens."""
from core import *  # noqa: F401,F403
from prices import *  # noqa: F401,F403
from sources import REG, NoData, SourcesFailed
import sources.consensus
import localgold
from concurrent.futures import ThreadPoolExecutor
# ---------------------------------------------------------------- search, profile, universe, sectors
def search_yahoo(q, ex):
    url = ("https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=15&newsCount=0&listsCount=0"
           % urllib.parse.quote(q))
    data = http_json(url)
    suffix = EXCHANGES.get(ex, ("",))[0]
    items = []
    for it in data.get("quotes") or []:
        sym = it.get("symbol") or ""
        if not sym or it.get("quoteType") not in (None, "EQUITY", "ETF", "INDEX"):
            continue
        if suffix and not sym.endswith(suffix):
            continue
        if ex == "US" and "." in sym:
            continue
        items.append({"symbol": sym, "name": it.get("longname") or it.get("shortname") or sym,
                      "exch": it.get("exchDisp") or ""})
    return items[:10]


def _raw(v):
    if isinstance(v, dict):
        return v.get("raw", v.get("fmt"))
    return v


def get_profile(symbol):
    key = "p|" + symbol
    cached, _ = cache_get(key, max_age=12 * 3600)
    if cached:
        return cached
    mods = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,calendarEvents"

    def call(crumb):
        url = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=%s&crumb=%s"
               % (urllib.parse.quote(symbol), mods, urllib.parse.quote(crumb)))
        return json.loads(Yahoo.get(url).decode("utf-8"))

    try:
        data = Yahoo.with_crumb(call)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"ok": False, "error": "لا توجد بيانات أساسية لهذا الرمز."}
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب البيانات الأساسية."}
    except Exception as _e:
        record("WARN", "markets.call", _e)
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب البيانات الأساسية."}
    res = ((data.get("quoteSummary") or {}).get("result") or [{}])[0]
    sd = res.get("summaryDetail") or {}
    ks = res.get("defaultKeyStatistics") or {}
    fd = res.get("financialData") or {}
    ap = res.get("assetProfile") or {}
    ce = res.get("calendarEvents") or {}
    pr = res.get("price") or {}
    earn = ce.get("earnings") or {}
    out = {
        "ok": True, "symbol": symbol,
        "name": pr.get("longName") or pr.get("shortName") or symbol,
        "sector": ap.get("sector") or "", "industry": ap.get("industry") or "",
        "summary": (ap.get("longBusinessSummary") or "")[:600], "website": ap.get("website") or "",
        "marketCap": _raw(sd.get("marketCap")) or _raw(pr.get("marketCap")),
        "trailingPE": _raw(sd.get("trailingPE")), "forwardPE": _raw(sd.get("forwardPE")),
        "priceToBook": _raw(ks.get("priceToBook")),
        "dividendYield": _raw(sd.get("dividendYield")), "payoutRatio": _raw(sd.get("payoutRatio")),
        "beta": _raw(sd.get("beta")),
        "profitMargins": _raw(fd.get("profitMargins")) or _raw(ks.get("profitMargins")),
        "returnOnEquity": _raw(fd.get("returnOnEquity")), "debtToEquity": _raw(fd.get("debtToEquity")),
        "revenueGrowth": _raw(fd.get("revenueGrowth")), "earningsGrowth": _raw(fd.get("earningsGrowth")),
        "fiftyTwoWeekHigh": _raw(sd.get("fiftyTwoWeekHigh")), "fiftyTwoWeekLow": _raw(sd.get("fiftyTwoWeekLow")),
        "recommendation": fd.get("recommendationKey") or "",
        "targetMeanPrice": _raw(fd.get("targetMeanPrice")), "targetHighPrice": _raw(fd.get("targetHighPrice")),
        "targetLowPrice": _raw(fd.get("targetLowPrice")), "recommendationMean": _raw(fd.get("recommendationMean")),
        "price": _raw(pr.get("regularMarketPrice")),
        "analysts": _raw(fd.get("numberOfAnalystOpinions")),
        "earningsDates": [_raw(x) for x in (earn.get("earningsDate") or []) if _raw(x)],
        "exDividendDate": _raw(ce.get("exDividendDate")), "dividendDate": _raw(ce.get("dividendDate")),
    }
    cache_put(key, out)
    return out


SCREENER_EXCH = {"SR": "SAU"}

# Yahoo's screener lists Egyptian shares by ISIN codes that mostly carry no price history,
# so the Egyptian market uses this list of EGX trading symbols, each verified on Yahoo
# Finance (at least six months of daily prices). Ordered roughly by size.
EGX_LIST = [
    ("COMI", "Commercial International Bank Egypt (CIB) S.A.E."),
    ("TMGH", "Talaat Moustafa Group Holding"),
    ("EAST", "Eastern Company S.A.E"),
    ("ETEL", "Telecom Egypt Company"),
    ("HRHO", "EFG Holding Company S.A.E"),
    ("SWDY", "El Sewedy Electric Company"),
    ("ABUK", "Abu Qir Fertilizers & Chemical Industries Company (S.A.E)"),
    ("EFIH", "e-finance for Digital and Financial Investments S.A.E."),
    ("FWRY", "Fawry for Banking Technology and Electronic Payments S.A.E."),
    ("ORAS", "Orascom Construction PLC"),
    ("AMOC", "Alexandria Mineral Oils Company"),
    ("HELI", "Heliopolis Co. for Housing & Development"),
    ("JUFO", "Juhayna Food Industries S.A.E."),
    ("MFPC", "Misr Fertilizer Production Company"),
    ("PHDC", "Palm Hills Developments S.A.E."),
    ("CIEB", "Credit Agricole - Egypt Bank (S.A.E.)"),
    ("ADIB", "Abu Dhabi Islamic Bank - Egypt - S.A.E"),
    ("EMFD", "Emaar Misr for Development Company (S.A.E.)"),
    ("ORWE", "Oriental Weavers Carpets Company (S.A.E)"),
    ("CCAP", "QALA For Financial Investments"),
    ("EFID", "Edita Food Industries Company (S.A.E)"),
    ("BTFH", "Beltone Holding S.A.E"),
    ("SKPC", "Sidi Kerir Petrochemicals Co."),
    ("ISPH", "Ibnsina Pharma"),
    ("OCDI", "Sixth of October for Development and Investment Company \"SODIC\" (S.A.E.)"),
    ("MCQE", "Misr Cement (Qena) Company (S.A.E)"),
    ("ARCC", "Arabian Cement Company S.A.E."),
    ("EGAL", "Egypt Aluminum"),
    ("EGCH", "Egyptian Chemical Industries"),
    ("SUGR", "Delta Sugar Company"),
    ("POUL", "Cairo Poultry Company S.A.E."),
    ("EFIC", "Egyptian Financial and Industrial SAE"),
    ("CLHO", "Cleopatra Hospitals Group S.A.E."),
    ("RMDA", "Tenth of Ramadan for Pharmaceutical Industries and Diagnostic Reagents (Rameda) (S.A.E)"),
    ("IRON", "Egyptian Iron and Steel Company"),
    ("ALCN", "Alexandria Container&Cargo Handling Company"),
    ("EGTS", "Egyptian Resorts Company (S.A.E)"),
    ("PHAR", "Egyptian International Pharmaceutical Industries Company"),
    ("OLFI", "Obour Land for Food Industries S.A.E."),
    ("ACGC", "Arabia Cotton Ginning Company"),
    ("DSCW", "Dice For Ready-Made Garments (SAE)"),
    ("ORHD", "Orascom Development Egypt S.A.E."),
    ("PRDC", "Pioneers Properties For Urban Development - PRE Group"),
    ("ZMID", "Zahraa El Maadi Investment and Development Company SAE"),
    ("ATQA", "Misr National Steel - Ataqa"),
    ("SCEM", "Sinai Cement Co. (S.A.E)"),
    ("ARAB", "Arab Developers Holding"),
    ("ASCM", "ASEC Company for Mining ASCOM, S.A.E"),
    ("BINV", "B Investments Holding S.A.E."),
    ("CANA", "Suez Canal Bank (S.A.E)"),
    ("CIRA", "Cairo For Investment And Real Estate Developments-CIRA Education"),
    ("DOMT", "Arabian Food Industries Company (DOMTY) - S.A.E"),
    ("EGAS", "Egypt Gas Company SAE"),
    ("ELEC", "Electro Cable Egypt"),
    ("ENGC", "Industrial Engineering Company for Construction and Development (ICON) (S.A.E.)"),
    ("HDBK", "Housing and Development Bank- Egypt (S.A.E)"),
    ("ISMA", "Ismailia / Misr Poultry Company S.A.E"),
    ("KZPC", "Kafr El Zayat For Pesticides & Chemicals Co.(S.A.E)"),
    ("MASR", "Madinet Masr For Housing and Development"),
    ("MTIE", "MM Group for Industry and International Trade S.A.E."),
    ("NCCW", "Nasr Company for Civil Works"),
    ("OIH", "Orascom Investment Holding S.A.E."),
    ("RAYA", "Raya Holding Company for Financial Investments (S.A.E)"),
    ("SAUD", "alBaraka Bank Egypt S.A.E."),
    ("SPMD", "Speed Medical Co"),
    ("TALM", "Taaleem Management Services Company S.A.E."),
    ("CSAG", "Canal Shipping Agencies Company"),
    ("NIPH", "Nile Pharmaceuticals and Chemical Industries Company"),
    ("MPRC", "Egyptian Media Production City"),
    ("ACAMD", "Arab Co.,for asset management and development"),
    ("EXPA", "Export Development Bank of Egypt (S.A.E.)"),
    ("FAIT", "Faisal Islamic Bank of Egypt"),
    ("CAED", "Cairo Educational Services SAE"),
    ("GDWA", "Gadwa for Industrial Development"),
    ("RREI", "Arab Real Estate Investment Co."),
    ("SDTI", "SHARM DREAMS Co. for Touristic Investment S.A.E"),
    ("UEGC", "El-Saeed Company for Contracting and Real Estate Investment \"SCCD\" (S.A.E.)"),
    ("ELKA", "Cairo for Housing and Development Company (S.A.E)"),
    ("ICFC", "International Company for Fertilizers and Chemicals S.A.E"),
    ("IFAP", "International Company for Agricultural Crops"),
    ("KABO", "El-Nasr Clothing & Textiles Co. (KABO)"),
    ("MENA", "Mena for Touristic & Real Estate Investment"),
    ("MPCO", "Mansoura Poultry co.S.A.E"),
    ("NHPS", "National Company for Housing Professional Syndicates SAE"),
    ("AFDI", "Al Ahly for Development & Investment"),
    ("APSW", "Unirab Polvara Spinning & Weaving Co."),
    ("AJWA", "AJWA For Food Industries Co. Egypt"),
    ("AIFI", "Atlas for Investment & Food Industries SAE"),
    ("ALUM", "Arab Aluminum Company (S.A.E)"),
    ("BIOC", "GlaxoSmithKline S.A.E"),
    ("CERA", "The Arab Ceramic Co."),
    ("COPR", "Copper for Commercial Investment & Real Estate Development"),
    ("DAPH", "Development & Engineering Consultants"),
    ("EALR", "Arab Company For Land Reclamation"),
    ("ECAP", "Al Ezz Ceramics & Porcelain Co."),
    ("EOSB", "El Orouba Securities Brokerage"),
    ("GGCC", "Giza General - Contracting and Real Estate Investment S.A.E"),
    ("GRCA", "Grand Capital for Financial Investments"),
    ("INFI", "Ismailia National Co. for Food Industries"),
    ("LCSW", "Lecico Egypt (S.A.E.)"),
    ("MAAL", "Marseille Almasreia Alkhalegeya For Holding Investment SAE"),
    ("MICH", "Misr Chemical Industries Co."),
    ("MILS", "North Cairo Flour Mills"),
    ("MOSC", "Misr Oils & Soap"),
    ("NINH", "Nozha International Hospital"),
    ("OCPH", "October Pharma S.A.E"),
    ("ODIN", "ODIN Investments (S.A.E)"),
    ("PRCL", "The General Company for Ceramic and Porcelain Products"),
    ("RTVC", "Remco Tourism Villages Construction"),
    ("SMFR", "Samad Misr EGYFERT.S.A.E"),
    ("SNFC", "Sharkia National Company for Food Security"),
    ("SPIN", "Alexandria Spinning & Weaving Co."),
    ("WCDF", "Middle & West Delta Flour Mills"),
    ("ZEOT", "Extracted Oil & Derivatives Co."),
    ("AMER", "Amer Group Holding Company S.A.E."),
    ("EPCO", "Egypt for Poultry"),
    ("EDFM", "East Delta Flour Mills"),
    ("GPPL", "Golden Pyramids Plaza S.A.E."),
    ("CPCI", "Kahira Pharmaceuticals & Chemical Industries Company"),
    ("DEIN", "Delta Insurance Company"),
    ("EBSC", "Osool ESB Securities Brokerage"),
    ("EGSA", "The Egyptian Satellite Company Nilesat"),
    ("ELSH", "Al-Shams Company for Housing and Urban Development"),
    ("IDRE", "Ismailia Development and Real Estate Co"),
    ("MHOT", "Misr Hotels Company"),
    ("MOIL", "Maridive and Oil Services S.A.E."),
    ("NAHO", "Naeem Holding Company For Investments (S.A.E - Free Zone)"),
    ("RACC", "Raya Customer Experience"),
    ("SEIG", "Saudi Egyptian Investment & Finance Co. S.A.E"),
    ("UNIP", "Universal For Paper and Packaging Materials"),
    ("AXPH", "Alexandria Co. For Pharmaceuticals & Chemical Industries"),
    ("AMIA", "Arab Moltaqa Investments Company"),
    ("ELWA", "El Wadi for International and Investment Development SAE"),
    ("EASB", "Egyptian Arabian Company (Themar) for securities Brokerage EAC"),
    ("EHDR", "Egyptians for Housing & Development Co."),
    ("CICH", "CI Capital Holding For Financial Investments (S.A.E)"),
    ("TRTO", "Trans Oceans Tours"),
    ("SPHT", "El Shams Pyramids Co. For Hotels & Touristic Projects S.A.E"),
    ("NEDA", "Northern Upper Egypt For Development & Agricultural Production Co."),
    ("RUBX", "Rubex International for Plastic and Acrylic Manufacturing"),
    ("MEPA", "Medical Packaging Company"),
    ("ICID", "International Co. For Investment & Development"),
    ("MBSC", "Misr Beni Suef Cement Co. S.A.E"),
    ("OFH", "O B Financial Holding S.A.E"),
    ("CNFN", "Contact Financial Holding S.A.E."),
    ("SVCE", "South Valley Cement Company")
]


# ---------------------------------------------------------------- market lists (TradingView scanner)
TV_SECTOR_AR = {
    "Finance": "المالية والبنوك", "Technology Services": "خدمات التقنية", "Electronic Technology": "التقنية الإلكترونية",
    "Health Technology": "تقنية الرعاية الصحية", "Health Services": "خدمات الرعاية الصحية", "Retail Trade": "تجارة التجزئة",
    "Consumer Non-Durables": "السلع الاستهلاكية", "Consumer Durables": "السلع المعمّرة", "Consumer Services": "الخدمات الاستهلاكية",
    "Producer Manufacturing": "الصناعات التحويلية", "Process Industries": "الصناعات الأساسية", "Non-Energy Minerals": "المواد والتعدين",
    "Energy Minerals": "الطاقة", "Utilities": "المرافق العامة", "Transportation": "النقل", "Communications": "الاتصالات",
    "Commercial Services": "الخدمات التجارية", "Distribution Services": "التوزيع", "Industrial Services": "الخدمات الصناعية",
    "Miscellaneous": "متنوع", "Government": "حكومي",
}
TV_MARKET_OF = {"SR": "ksa", "CA": "egypt", "US": "america"}


def tv_scan(market, body, timeout=25):
    req = urllib.request.Request("https://scanner.tradingview.com/%s/scan" % market, data=json.dumps(body).encode("utf-8"),
                                 headers={"User-Agent": UA, "Content-Type": "application/json",
                                          "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


FUND_COLS = ["close", "price_earnings_ttm", "price_book_fq", "earnings_per_share_diluted_ttm", "book_value_per_share_fq",
             "earnings_per_share_forecast_next_fy", "dividends_yield_current", "price_target_average", "price_target_high",
             "price_target_low", "recommendation_mark", "return_on_equity_fq", "sector", "exchange", "currency",
             "market_cap_basic", "net_income_ttm",
             # raw figures, used when TradingView has no ready ratio for the stock
             "earnings_per_share_basic_ttm", "last_annual_eps", "earnings_per_share_fy", "net_income_fy",
             "total_shares_outstanding_fundamental", "book_value_per_share_fy", "total_equity_fq", "total_equity_fy",
             "dps_common_stock_prim_issue_fy",
             # growth and free cash flow, used by the discounted-cash-flow estimate
             "free_cash_flow_per_share_ttm", "earnings_per_share_diluted_yoy_growth_ttm", "earnings_per_share_diluted_yoy_growth_fy",
             "total_revenue_yoy_growth_ttm"]
US_PRIMARY = ("NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "CBOE")


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


def _multiples(market, filters, key):
    hit, _ = cache_get(key, max_age=24 * 3600)
    if hit:
        return hit
    body = {"filter": filters + [{"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
                                 {"left": "price_earnings_ttm", "operation": "in_range", "right": [0.5, 150]}],
            "columns": ["price_earnings_ttm", "price_book_fq", "dividends_yield_current", "market_cap_basic"],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, 400]}
    if market == "america":
        body["filter"].append({"left": "market_cap_basic", "operation": "greater", "right": 3e8})
    rows = [r["d"] for r in tv_scan(market, body).get("data") or []]
    res = {"pe": _median([r[0] for r in rows]), "pb": _median([r[1] for r in rows if r[1] and 0 < r[1] < 60]),
           "dy": _median([r[2] for r in rows if r[2] and 0 < r[2] < 25]), "n": len(rows),
           "ndy": sum(1 for r in rows if r[2] and 0 < r[2] < 25)}
    cache_put(key, res)
    return res


def sector_multiples(market, sector):
    """Median P/E, P/B and dividend yield of profitable companies in one sector of one market (cached for a day)."""
    return _multiples(market, [{"left": "sector", "operation": "equal", "right": sector}], "secm2|%s|%s" % (market, sector))


def market_multiples(market):
    """The same medians for the whole market, used when a sector has too few companies."""
    return _multiples(market, [], "mktm2|%s" % market)


def _fundamentals_yahoo(code, ex):
    """Fallback when TradingView has nothing for the stock: analysts' target and ratios from Yahoo Finance."""
    p = get_profile(yahoo_symbol(code, ex))
    if not p.get("ok") or not p.get("price"):
        return None
    f = {"close": p["price"], "price_earnings_ttm": p.get("trailingPE"), "price_book_fq": p.get("priceToBook"),
         "price_target_average": p.get("targetMeanPrice"), "price_target_high": p.get("targetHighPrice"),
         "price_target_low": p.get("targetLowPrice"), "recommendation_mark": p.get("recommendationMean"),
         "dividends_yield_current": (p.get("dividendYield") or 0) * 100 or None,
         "return_on_equity_fq": (p.get("returnOnEquity") or 0) * 100 or None, "sector": "", "net_income_ttm": None}
    return f


def eps_history(code, ex):
    """Annual diluted EPS of the last few fiscal years (Yahoo) with the month-end price of each fiscal year-end,
    so the page can work out the stock's own past P/E. Returns [] when Yahoo has no such history."""
    sym = yahoo_symbol(code, ex)
    key = "epsh|" + sym
    hit, _ = cache_get(key, max_age=24 * 3600)
    if hit is not None:
        return hit
    out = []
    try:
        def call(crumb):
            url = ("https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/%s"
                   "?type=annualDilutedEPS,annualBasicEPS&period1=1400000000&period2=%d&crumb=%s"
                   % (urllib.parse.quote(sym), int(time.time()) + 86400 * 400, urllib.parse.quote(crumb)))
            return json.loads(Yahoo.get(url).decode("utf-8"))
        data = Yahoo.with_crumb(call)
        series = {}
        for r in ((data.get("timeseries") or {}).get("result") or []):
            for k in ("annualDilutedEPS", "annualBasicEPS"):
                if r.get(k):
                    series[k] = {x["asOfDate"]: _raw(x.get("reportedValue")) for x in r[k] if x and x.get("asOfDate")}
        eps = series.get("annualDilutedEPS") or series.get("annualBasicEPS") or {}
        ch = http_json("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=10y&interval=1mo&includePrePost=false"
                       % urllib.parse.quote(sym))
        res = ((ch.get("chart") or {}).get("result") or [{}])[0]
        closes = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        bars = [[ts * 1000, None, None, None, c] for ts, c in zip(res.get("timestamp") or [], closes) if c]
        for d in sorted(eps)[-6:]:
            t = calendar.timegm(time.strptime(d, "%Y-%m-%d")) * 1000
            prior = [b for b in bars if b[0] <= t]
            if not prior or t - prior[-1][0] > 45 * 86400000 or eps[d] is None:
                continue
            out.append({"d": d, "eps": eps[d], "px": prior[-1][4]})
    except Exception as e:
        record("WARN", "eps_history %s" % sym, e)
        return []
    cache_put(key, out)
    return out


def fundamentals_tradingview(code, ex):
    """Company figures from TradingView's scanner (the first source of the fundamentals chain)."""
    market = TV_MARKET_OF.get(ex)
    c = code.strip().upper().split(".")[0]
    body = {"filter": [{"left": "name", "operation": "equal", "right": c}], "columns": FUND_COLS, "range": [0, 10]}
    rows = [dict(zip(FUND_COLS, r["d"])) for r in tv_scan(market, body).get("data") or []]
    if ex == "US":
        rows.sort(key=lambda r: (r.get("exchange") not in US_PRIMARY, -(r.get("market_cap_basic") or 0)))
    if not rows:
        raise NoData()
    return rows[0]


def _safe_eps_history(code, ex):
    try:
        return eps_history(code, ex)
    except Exception as e:
        record("WARN", "eps_history", e)
        return []


def get_fundamentals(code, ex):
    """Company figures and analyst targets from the first source that has them (TradingView, Yahoo Finance,
    the optional keyed sources, SEC EDGAR), plus the sector's median multiples."""
    market = TV_MARKET_OF.get(ex)
    c = code.strip().upper().split(".")[0]
    if not market or not c:
        return {"ok": False, "error": "unsupported"}
    key = "fund|%s|%s" % (ex, c)
    with MEM_LOCK:
        hit = MEM.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    try:
        f, meta = REG.call("fundamentals", ex, code=c, ex=ex)
        source = meta["label"]
        checks = None
        if Store.get("src_cross", True):
            try:
                f, checks = sources.consensus.cross_check(ex, meta["id"], f, c, ex)
            except Exception as e:
                record("WARN", "cross-check %s %s" % (ex, c), e)
    except (NoData, SourcesFailed):
        return {"ok": False, "error": "لم أجد بيانات مالية لهذه الشركة في أي مصدر."}  # not cached: try again next time
    sec, mkt = {}, {}
    try:
        if f.get("sector"):
            sec = sector_multiples(market, f["sector"])
        if (sec.get("n") or 0) < 5 or (sec.get("ndy") or 0) < 5:
            mkt = market_multiples(market)
    except Exception as e:
        warn("  sector multiples failed: %s" % e)
    res = {"ok": True, "code": c, "ex": ex, "f": f, "source": source, "checks": checks, "date": time.strftime("%Y-%m-%d"),
           "sectorPE": sec.get("pe"), "sectorPB": sec.get("pb"), "sectorDY": sec.get("dy"), "sectorN": sec.get("n"), "sectorNDY": sec.get("ndy"),
           "marketPE": mkt.get("pe"), "marketPB": mkt.get("pb"), "marketDY": mkt.get("dy"), "marketN": mkt.get("n"),
           "epsHist": _safe_eps_history(c, ex),
           "sectorAr": TV_SECTOR_AR.get(f.get("sector") or "", f.get("sector") or "")}
    with MEM_LOCK:
        MEM[key] = (time.time(), res)
    return res


def sa_segment(code):
    """Tadawul codes: 9xxx = Nomu (parallel market); 4330-4349 = REIT funds; everything else = main market."""
    c = str(code).split(".")[0]
    if not c.isdigit():
        return ""
    n = int(c)
    if 9400 <= n <= 9499:  # exchange-traded funds on the main market
        return "main"
    if 9000 <= n <= 9999:
        return "nomu"
    if 4330 <= n <= 4349:
        return "reit"
    return "main"


def sa_names():
    """Arabic company names and Tadawul sectors from Mubasher, kept for a week."""
    hit, _ = cache_get("sa|names", max_age=7 * 86400)
    if hit:
        return hit
    try:
        d = json.loads(http_text("https://www.mubasher.info/api/1/listed-companies?country=sa&size=1000"))
        out = {str(r.get("symbol")): [r.get("name") or "", r.get("sector") or ""] for r in d.get("rows") or [] if r.get("symbol")}
        if out:
            cache_put("sa|names", out)
        return out
    except Exception as _e:
        record("WARN", "markets.sa_names", _e)
        stale, _ = cache_get("sa|names")
        return stale or _sa_names_from_sharia()


def _sa_names_from_sharia():
    """Arabic names without sectors, from Argaam's Sharia table (the saved copy, else the one shipped with the app):
    used when Mubasher's company list does not answer (its old address has been gone since November 2026)."""
    lst, _ = cache_get("sharia|sa")
    if not lst:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "sharia_sa.json"), encoding="utf-8") as f:
                lst = json.load(f)
        except (OSError, ValueError):
            return {}
    out = {}
    for seg in ("main", "nomu"):
        for code, r in (lst.get(seg) or {}).items():
            if r.get("n"):
                out[str(code)] = [r["n"], ""]
    return out




# ---------------------------------------------------------------- preliminary Sharia screen (US stocks)
# AAOIFI-style screen on TradingView data: no prohibited core business, interest-bearing debt below
# 30% of market value, cash and short-term investments below 30% of market value. The share of
# impermissible income cannot be checked from this data, so the result is only preliminary.
SHARIA_EXCLUDED_INDUSTRIES = {
    "Major Banks": "بنوك تقليدية", "Regional Banks": "بنوك تقليدية", "Savings Banks": "بنوك تقليدية",
    "Investment Banks/Brokers": "خدمات مالية تقليدية", "Investment Managers": "خدمات مالية تقليدية",
    "Finance/Rental/Leasing": "تمويل بفائدة", "Financial Conglomerates": "خدمات مالية تقليدية",
    "Life/Health Insurance": "تأمين تقليدي", "Property/Casualty Insurance": "تأمين تقليدي",
    "Multi-Line Insurance": "تأمين تقليدي", "Specialty Insurance": "تأمين تقليدي", "Insurance Brokers/Services": "تأمين تقليدي",
    "Beverages: Alcoholic": "خمور", "Tobacco": "تبغ", "Casinos/Gaming": "قمار",
    "Movies/Entertainment": "ترفيه وإعلام", "Hotels/Resorts/Cruise lines": "فنادق ومنتجعات", "Aerospace & Defense": "أسلحة ودفاع",
}
SHARIA_LIMIT = 0.30


def sharia_screen(industry, cap, debt, cash):
    """Returns (status, reason): status 'ok', 'no' or '' (not enough data)."""
    if industry in SHARIA_EXCLUDED_INDUSTRIES:
        return "no", "النشاط: " + SHARIA_EXCLUDED_INDUSTRIES[industry]
    if not cap or cap <= 0 or debt is None:
        return "", "بيانات الديون غير متاحة"
    dr, cr = (debt or 0) / cap, (cash or 0) / cap
    detail = "الديون %.0f%% والنقد %.0f%% من القيمة السوقية" % (dr * 100, cr * 100)
    if dr >= SHARIA_LIMIT or cr >= SHARIA_LIMIT:
        return "no", detail
    return "ok", detail


UNIVERSE_COLS = ["name", "description", "market_cap_basic", "sector", "change", "close", "exchange", "industry",
                 "total_debt_fq", "cash_n_short_term_invest_fq"]


def tv_universe(ex, size=None):
    """size: a number (largest N by market value), 'cap300' (above $300M) or None/'all'."""
    market = TV_MARKET_OF[ex]
    filt = [{"left": "type", "operation": "equal", "right": "stock"},
            {"left": "is_primary", "operation": "equal", "right": True}]
    if ex == "US":
        filt += [{"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX"]},
                 {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer"]}]
        if size == "cap300":
            filt.append({"left": "market_cap_basic", "operation": "greater", "right": 3e8})
    n = int(size) if str(size or "").isdigit() else 8000
    body = {"filter": filt, "columns": UNIVERSE_COLS, "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
            "range": [0, n]}
    d = tv_scan(market, body, timeout=60)
    names = sa_names() if ex == "SR" else {}
    egx = dict(EGX_LIST) if ex == "CA" else {}
    items = []
    for row in d.get("data") or []:
        v = (row.get("d") or []) + [None] * len(UNIVERSE_COLS)
        if not v[0]:
            continue
        code = str(v[0])
        ar = names.get(code) or ["", ""]
        it = {"symbol": code + {"SR": ".SR", "CA": ".CA"}.get(ex, ""), "name": ar[0] or egx.get(code) or v[1] or code,
              "short": ar[0] or "", "nameEn": v[1] or code, "price": v[5], "chg": v[4], "cap": v[2], "pe": None,
              "dy": None, "chg52": None, "sector": ar[1] or TV_SECTOR_AR.get(v[3] or "", v[3] or ""),
              "sectorEn": v[3] or ""}
        if ex == "SR":
            it["segment"] = sa_segment(code)
        if ex == "US":
            it["exch"] = v[6] or ""
            US_EXCH[code] = it["exch"]
            it["shariaAuto"], it["shariaWhy"] = sharia_screen(v[7], v[2], v[8], v[9])
        items.append(it)
    return items


# ---------------------------------------------------------------- Yaqeen's US Sharia list
# yaaqen.com classifies about 7,900 US stocks as شرعي / غير شرعي / محل نظر and updates monthly.
# A copy ships inside the page; the app refreshes it from the site in the background every two weeks.
YAAQEN_URL = "https://yaaqen.com/stocks/all-stocks"
YAAQEN_BUSY = threading.Event()


def _yaaqen_page(p):
    url = YAAQEN_URL + ("?p=%d" % p if p > 1 else "")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "X-Requested-With": "XMLHttpRequest"})
    with urllib.request.urlopen(req, timeout=40) as r:
        h = r.read().decode("utf-8", errors="replace")
    out = []
    for row in re.findall(r"<tr[^>]*stock-row[^>]*>(.*?)</tr>", h, re.S):
        t = re.search(r"<span class='block w-max text-nowrap'>([^<]+)</span>", row)
        c = re.search(r'data-compliance="(\d)"', row)
        if t and c:
            out.append((t.group(1).strip(), int(c.group(1))))
    last = re.search(r'data-last-page="(\d+)"', h)
    return out, int(last.group(1)) if last else None


def yaaqen_refresh():
    if YAAQEN_BUSY.is_set():
        return
    YAAQEN_BUSY.set()
    try:
        first, last = _yaaqen_page(1)
        rows = list(first)
        for p in range(2, (last or 1) + 1):
            for attempt in range(3):
                try:
                    got, _ = _yaaqen_page(p)
                    rows += got
                    break
                except Exception as _e:
                    record("WARN", "markets.yaaqen_refresh", _e)
                    QUIT.wait(3)
            QUIT.wait(0.3)
            if QUIT.is_set():
                return
        if len(rows) < 1000:  # the site changed; keep the copy we have
            return
        d = dict(rows)
        cache_put("yaaqen|us", {"source": "يقين", "url": YAAQEN_URL, "date": time.strftime("%Y-%m-%d"),
                                "ok": sorted(t for t, c in d.items() if c == 1),
                                "no": sorted(t for t, c in d.items() if c == 0),
                                "doubt": sorted(t for t, c in d.items() if c == 2)})
    except Exception as e:
        warn(" Yaqeen list refresh failed (%s)" % e)
    finally:
        YAAQEN_BUSY.clear()


# ---------------------------------------------------------------- Saudi / Egyptian Sharia lists
SHARIA_BUSY = threading.Event()


def sharia_refresh():
    if SHARIA_BUSY.is_set():
        return {}
    SHARIA_BUSY.set()
    res = {}
    try:
        for c in list(REG.items.values()):
            if "sharia" not in c.kinds or not c.available():
                continue
            try:
                cache_put("sharia|" + c.dataset, REG.call_one(c.id, "sharia"))
                res[c.dataset] = True
            except NoData:
                res[c.dataset] = None       # nothing newer than the copy that ships with the app
            except Exception as e:
                warn(" Sharia list (%s) refresh failed (%s)" % (c.dataset, e))
                res[c.dataset] = False
    finally:
        SHARIA_BUSY.clear()
    return res


def sharia_lists():
    out = {"ok": True, "busy": SHARIA_BUSY.is_set()}
    for key in ("sa", "eg", "spus", "pur_sa"):
        hit, _ = cache_get("sharia|" + key)
        out[key] = hit
    return out


def sharia_refresher():
    QUIT.wait(60)
    while not QUIT.is_set():
        _, t1 = cache_get("sharia|sa")
        eg, t2 = cache_get("sharia|eg")
        old_shape = bool(eg) and not any("p" in r for r in (eg.get("rows") or {}).values())   # saved before purification ratios existed
        if not t1 or not t2 or old_shape or time.time() - min(t1, t2) > 7 * 86400:
            sharia_refresh()
        QUIT.wait(12 * 3600)


# ---------------------------------------------------------------- purification: the program's own estimate
PURIFY_COLS = ["name", "sector", "total_revenue_fy", "non_oper_interest_income_fy", "fiscal_period_end"]


def _purify_tradingview(code, ex):
    market = TV_MARKET_OF.get(ex)
    d = tv_scan(market, {"filter": [{"left": "name", "operation": "equal", "right": code}], "columns": PURIFY_COLS, "range": [0, 5]})
    rows = [dict(zip(PURIFY_COLS, r.get("d") or [])) for r in d.get("data") or []]
    rows = [r for r in rows if r.get("name") == code and r.get("total_revenue_fy")]
    if not rows:
        return None
    r = max(rows, key=lambda x: x.get("total_revenue_fy") or 0)
    year = ""
    if isinstance(r.get("fiscal_period_end"), (int, float)):
        year = time.strftime("%Y", time.gmtime(r["fiscal_period_end"]))
    return {"rev": r.get("total_revenue_fy"), "int": r.get("non_oper_interest_income_fy"), "sector": r.get("sector") or "",
            "period": year, "source": "TradingView"}


def _purify_edgar(code):
    f = REG.items["edgar"].fundamentals(code, "US")
    return {"rev": f.get("total_revenue_fy"), "int": f.get("non_oper_interest_income_fy"), "sector": "",
            "period": f.get("fy_end", ""), "source": "SEC EDGAR"}


def purify_estimate(code, ex):
    """The program's rough purification share for a stock no published source covers: interest income / revenue, last year.
    Labelled as an estimate everywhere it is shown; None (not zero) when the figures are not there."""
    import purify
    c = code.strip().upper().split(".")[0]
    if ex not in ("SR", "CA", "US") or not c:
        return {"ok": False, "error": "unsupported"}
    key = "purest|%s|%s" % (ex, c)
    hit, _ = cache_get(key, max_age=7 * 86400)
    if hit:
        return hit
    found, why = None, "لا تتوفر الإيرادات ودخل الفوائد لهذه الشركة."
    tries = [lambda: _purify_tradingview(c, ex)] + ([lambda: _purify_edgar(c)] if ex == "US" else [])
    for t in tries:
        try:
            f = t()
        except Exception as e:
            record("WARN", "purify estimate %s %s" % (ex, c), e)
            continue
        if not f or f.get("rev") in (None, 0) or f.get("int") is None:
            continue
        pct = purify.estimate_pct(f["rev"], f["int"], f.get("sector"))
        if pct is None:
            why = "لا يصلح التقدير لشركة مالية: الفوائد نشاطها الأساسي." if f.get("sector") else why
            continue
        found = {"ok": True, "pct": pct, "rev": f["rev"], "int": f["int"], "period": f.get("period", ""), "source": f["source"],
                 "date": time.strftime("%Y-%m-%d")}
        break
    out = found or {"ok": False, "error": why}
    if found:
        cache_put(key, out)                 # a failure is not kept: try again next time
    return out


def yaaqen_refresher():
    QUIT.wait(90)
    while not QUIT.is_set():
        _, t = cache_get("yaaqen|us")
        if not t or time.time() - t > 14 * 86400:
            yaaqen_refresh()
        QUIT.wait(12 * 3600)


def us_sharia(code):
    """Preliminary screen for one US ticker (analysis view)."""
    c = code.strip().upper()
    key = "ush|" + c
    hit, _ = cache_get(key, max_age=86400)
    if hit:
        return hit
    d = tv_scan("america", {"filter": [{"left": "name", "operation": "equal", "right": c}],
                            "columns": UNIVERSE_COLS, "range": [0, 5]})
    rows = [r.get("d") or [] for r in d.get("data") or []]
    rows = [r + [None] * len(UNIVERSE_COLS) for r in rows if r and r[0] == c]
    if not rows:
        return {"ok": False}
    v = max(rows, key=lambda r: r[2] or 0)
    st, why = sharia_screen(v[7], v[2], v[8], v[9])
    out = {"ok": True, "status": st, "why": why, "industry": v[7] or ""}
    cache_put(key, out)
    return out


def _scan_filters(ex, size):
    filt = [{"left": "type", "operation": "equal", "right": "stock"},
            {"left": "is_primary", "operation": "equal", "right": True}]
    if ex == "US":
        filt += [{"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX"]},
                 {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer"]}]
        if size == "cap300":
            filt.append({"left": "market_cap_basic", "operation": "greater", "right": 3e8})
    return filt


def medians_by_sector(rows):
    """The same medians as _multiples (profitable companies, P/E 0.5-150), worked out from one market-wide read:
    {sector: {pe, pb, dy, n, ndy}} plus "*" for the whole market."""
    groups = {}
    for f in rows:
        pe = f.get("price_earnings_ttm")
        if pe is None or not (0.5 <= pe <= 150):
            continue
        for k in (f.get("sector") or "", "*"):
            if k:
                groups.setdefault(k, []).append(f)
    out = {}
    for k, g in groups.items():
        dys = [f.get("dividends_yield_current") for f in g if f.get("dividends_yield_current") and 0 < f["dividends_yield_current"] < 25]
        out[k] = {"pe": _median([f["price_earnings_ttm"] for f in g]),
                  "pb": _median([f.get("price_book_fq") for f in g if f.get("price_book_fq") and 0 < f["price_book_fq"] < 60]),
                  "dy": _median(dys), "n": len(g), "ndy": len(dys)}
    return out


def scan_fundamentals(ex, size=None):
    """Company figures for every stock of a market in one TradingView read, with sector medians, so the scanner can
    work out each company's fair value the same way the analysis page does. Kept for 12 hours."""
    market = TV_MARKET_OF.get(ex)
    if not market:
        return {"ok": False, "error": "unsupported"}
    key = "scanf|%s|%s" % (ex, size or "all")
    hit, _ = cache_get(key, max_age=12 * 3600)
    if hit:
        return hit
    n = int(size) if str(size or "").isdigit() else 8000
    cols = ["name"] + FUND_COLS
    try:
        d = tv_scan(market, {"filter": _scan_filters(ex, size), "columns": cols,
                             "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, n]}, timeout=60)
    except Exception as e:
        record("WARN", "markets.scan_fundamentals %s" % ex, e)
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب الأرقام المالية لحساب السعر العادل."}
    f = {}
    for row in d.get("data") or []:
        v = (row.get("d") or []) + [None] * len(cols)
        if v[0]:
            f[str(v[0])] = {c: v[i + 1] for i, c in enumerate(FUND_COLS) if v[i + 1] is not None}
    if not f:
        return {"ok": False, "error": "تعذّر جلب الأرقام المالية لحساب السعر العادل."}
    out = {"ok": True, "ex": ex, "f": f, "med": medians_by_sector(f.values()), "at": time.time(), "source": "TradingView",
           "sectorAr": {k: TV_SECTOR_AR.get(k, k) for k in {x.get("sector") for x in f.values()} if k}}
    cache_put(key, out)
    return out


def scan_fill_yahoo(ex, codes, fetch=None):
    """2.18: Yahoo Finance figures for scanner results that TradingView left without enough numbers for a fair value
    (most often Egyptian companies). Asked only for the rows on screen, at most 25 at a time, each kept for a day,
    including "nothing found", so the same company is not asked again before tomorrow."""
    fetch = fetch or _fundamentals_yahoo
    out, miss = {}, 0
    for c in [str(x).strip().upper().split(".")[0] for x in codes if str(x).strip()][:25]:
        if not re.match(r"^[A-Z0-9\-]{1,12}$", c):
            continue
        key = "scanyf|%s|%s" % (ex, c)
        hit, _ = cache_get(key, max_age=86400)
        if hit is None:
            try:
                f = fetch(c, ex)
            except Exception as e:
                record("WARN", "markets.scan_fill_yahoo %s %s" % (ex, c), e)
                f = None
            hit = {k: v for k, v in (f or {}).items() if v not in (None, "")}
            cache_put(key, hit)
        if hit:
            out[c] = hit
        else:
            miss += 1
    return {"ok": True, "ex": ex, "f": out, "missing": miss, "source": "Yahoo Finance"}


# ---------------------------------------------------------------- events calendar (Phase 4, step 3)
def _asset_events(code, ex, now_ms):
    """Upcoming (and last week's) results, dividend and assembly dates of one stock, each with where it came from.
    Results and dividend dates: Yahoo Finance. US: the next results date estimated from the SEC record when Yahoo has
    none. Saudi and Egypt: assembly and dividend announcements the app has read from the market's list, when it could."""
    import filings
    out = []
    week = 7 * 86400000
    try:
        p = get_profile(yahoo_symbol(code, ex))
    except Exception as e:
        record("WARN", "calendar.profile %s %s" % (ex, code), e)
        p = {}
    if p.get("ok"):
        for t in p.get("earningsDates") or []:
            if t * 1000 >= now_ms - week:
                out.append({"t": int(t * 1000), "kind": "earn", "src": "Yahoo Finance"})
                break
        for k, kind in (("exDividendDate", "exdiv"), ("dividendDate", "divpay")):
            t = p.get(k)
            if t and t * 1000 >= now_ms - week:
                out.append({"t": int(t * 1000), "kind": kind, "src": "Yahoo Finance"})
    if ex == "US" and not any(e["kind"] == "earn" for e in out):
        try:
            due = ((filings.company_file(code, ex).get("record") or {}).get("due") or {})
            if due.get("date"):
                out.append({"t": due["date"], "kind": "earn", "src": "SEC EDGAR", "est": True})
        except Exception as e:
            record("WARN", "calendar.sec %s" % code, e)
    if ex in ("SR", "CA"):
        f = filings.company_file(code, ex)
        for x in (f.get("items") or [])[:20]:
            if x.get("type") in ("assembly", "dividend") and x.get("date", 0) >= now_ms - 30 * 86400000:
                out.append({"t": x["date"], "kind": "ann_" + x["type"], "src": f.get("source") or "", "title": x.get("title", ""),
                            "url": x.get("url", ""), "announced": True})
    return out


def events_calendar(items, now_ms=None):
    """Events of up to 60 assets, read side by side (each source keeps its own cache)."""
    now_ms = now_ms or int(time.time() * 1000)
    seen, todo = set(), []
    for it in items[:60]:
        code, ex = str(it.get("code") or "").strip().upper(), str(it.get("ex") or "")
        if ex in ("SR", "CA", "US") and re.match(r"^[A-Z0-9.\-]{1,12}$", code) and (code, ex) not in seen:
            seen.add((code, ex))
            todo.append((code, ex))
    res = {}

    def one(code, ex):
        try:
            res[(code, ex)] = _asset_events(code, ex, now_ms)
        except Exception as e:
            record("WARN", "calendar %s %s" % (ex, code), e)
            res[(code, ex)] = None
    ths = [threading.Thread(target=one, args=x, daemon=True) for x in todo]
    for i, th in enumerate(ths):
        th.start()
        if i % 6 == 5:
            th.join(30)            # a few at a time: Yahoo answers fewer requests when many arrive together
    for th in ths:
        th.join(45)
    events, failed = [], []
    for (code, ex) in todo:
        evs = res.get((code, ex))
        if evs is None:
            failed.append(code)
            continue
        for e in evs:
            events.append(dict(e, code=code, ex=ex))
    events.sort(key=lambda e: e["t"])
    return {"ok": True, "events": events, "failed": failed, "at": now_ms}


def get_universe(ex, size=None):
    if ex in TV_MARKET_OF:
        key = "tvu2|%s|%s" % (ex, size or "all")
        cached, _ = cache_get(key, max_age=900)
        if cached:
            for it in cached["items"] if ex == "US" else []:
                US_EXCH.setdefault(it["symbol"], it.get("exch") or "")
            return cached
        try:
            items = tv_universe(ex, size)
            if items:
                out = {"ok": True, "ex": ex, "items": items, "at": time.time(), "source": "TradingView"}
                cache_put(key, out)
                return out
        except Exception as e:
            warn(" TradingView market list failed (%s)" % e)
        if ex == "US":
            stale, _ = cache_get(key)
            return stale or {"ok": False, "error": "تعذّر جلب قائمة الشركات الأمريكية من TradingView."}
    return get_universe_yahoo(ex)


def get_universe_yahoo(ex):
    if ex == "CA":
        return {"ok": True, "ex": ex, "at": time.time(),
                "items": [{"symbol": sym + ".CA", "name": name or sym, "short": "", "price": None, "chg": None,
                           "cap": None, "pe": None, "dy": None, "chg52": None} for sym, name in EGX_LIST]}
    if ex not in SCREENER_EXCH:
        return {"ok": False, "error": "ماسح السوق متاح للسوق السعودي والمصري والأمريكي."}
    key = "u|" + ex
    cached, _ = cache_get(key, max_age=3 * 86400)
    if cached:
        return cached

    def page(crumb, offset):
        body = json.dumps({"offset": offset, "size": 250, "sortField": "intradaymarketcap", "sortType": "DESC",
                           "quoteType": "EQUITY", "userId": "", "userIdType": "guid",
                           "query": {"operator": "AND", "operands": [
                               {"operator": "eq", "operands": ["exchange", SCREENER_EXCH[ex]]}]}}).encode()
        url = ("https://query1.finance.yahoo.com/v1/finance/screener?crumb=%s&formatted=false&lang=en-US&region=US"
               % urllib.parse.quote(crumb))
        return json.loads(Yahoo.get(url, data=body, headers={"Content-Type": "application/json"}).decode("utf-8"))

    items = []
    try:
        offset, total = 0, 1
        while offset < total and offset < 1500:
            r = Yahoo.with_crumb(lambda c: page(c, offset))
            res = ((r.get("finance") or {}).get("result") or [{}])[0]
            total = res.get("total") or 0
            quotes = res.get("quotes") or []
            if not quotes:
                break
            for q in quotes:
                items.append({"symbol": q.get("symbol"), "name": q.get("longName") or q.get("shortName") or q.get("symbol"),
                              "short": q.get("shortName") or "", "price": q.get("regularMarketPrice"),
                              "chg": q.get("regularMarketChangePercent"), "cap": q.get("marketCap"),
                              "pe": q.get("trailingPE"), "dy": q.get("dividendYield"),
                              "chg52": q.get("fiftyTwoWeekChangePercent"),
                              "segment": sa_segment((q.get("symbol") or "").split(".")[0])})
            offset += len(quotes)
    except Exception as _e:
        record("WARN", "markets.page", _e)
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب قائمة شركات السوق. تحقق من الاتصال."}
    out = {"ok": True, "ex": ex, "items": [i for i in items if i["symbol"]], "at": time.time()}
    cache_put(key, out)
    return out


SECTOR_FILE = os.path.join(DATA_DIR, "sectors.json")
SECTOR_LOCK = threading.Lock()


def get_sectors(symbols, budget_s=25):
    with SECTOR_LOCK:
        try:
            with open(SECTOR_FILE, encoding="utf-8") as f:
                known = json.load(f)
        except (OSError, ValueError):
            known = {}
    t0 = time.time()
    changed = False
    for s in symbols:
        if s in known or time.time() - t0 > budget_s:
            continue
        p = get_profile(s)
        known[s] = p.get("sector") or "" if p.get("ok") else ""
        changed = True
    if changed:
        with SECTOR_LOCK:
            with open(SECTOR_FILE, "w", encoding="utf-8") as f:
                json.dump(known, f, ensure_ascii=False)
    missing = [s for s in symbols if s not in known]
    return {"ok": True, "sectors": {s: known.get(s, "") for s in symbols if s in known}, "missing": len(missing)}


# 2.18.2: the main indices of each market, for the dashboard: (code, Arabic name, short name, only on TradingView)
MAIN_INDICES = {
    "SR": [("^TASI.SR", "مؤشر تاسي", "TASI", False), ("^MT30", "مؤشر إم تي 30", "MT30", True)],
    "CA": [("^CASE30", "إي جي إكس 30", "EGX30", False), ("^EGX70", "إي جي إكس 70 متساوي الأوزان", "EGX70", True),
           ("^EGX100", "إي جي إكس 100 متساوي الأوزان", "EGX100", True), ("^EGX33", "إي جي إكس 33 للشريعة", "EGX33", True)],
    "US": [("^GSPC", "إس آند بي 500", "S&P 500", False), ("^IXIC", "ناسداك المركب", "Nasdaq", False),
           ("^DJI", "داو جونز الصناعي", "Dow Jones", False)],
}


def index_card(code, name, short, tv_only, hist=None, ex="XX"):
    """Last value, the day's change and the last month of closes for one index."""
    hist = hist or get_history
    out = {"code": code, "name": name, "short": short, "ok": False}
    if tv_only and not prefer_tv():
        out["error"] = "متاح من TradingView فقط."
        return out
    try:
        h = hist(code, ex, "3mo")
    except Exception as e:
        h = {"ok": False, "error": str(e)}
    rows = [r for r in (h.get("rows") or []) if r and r[4]]
    if not h.get("ok") or len(rows) < 2:
        out["error"] = h.get("error") or "لا توجد بيانات."
        return out
    last, prev = rows[-1][4], rows[-2][4]
    out.update(ok=True, last=last, chg=last / prev - 1 if prev else None, t=rows[-1][0],
               month=last / rows[-23][4] - 1 if len(rows) > 23 and rows[-23][4] else None,
               spark=[round(r[4], 4) for r in rows[-23:]], source=h.get("source"), offline=bool(h.get("offline")))
    return out


def get_main_indices(ex=None, hist=None, gold=None):
    markets = [ex] if ex in MAIN_INDICES else list(MAIN_INDICES)
    jobs = [(m, it) for m in markets for it in MAIN_INDICES[m]]
    want_gold = ex in (None, "", "GOLD")
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(lambda j=j: dict(index_card(*j[1], hist=hist), ex=j[0])) for j in jobs]
        if want_gold:
            oz = pool.submit(lambda: dict(index_card("XAU-USD-OZ", "الذهب — أوقية بالدولار", "الأوقية ($)", False, hist=hist, ex="GOLD"), ex="GOLD", open="GOLD:XAU-USD-OZ"))
            loc = pool.submit(gold or localgold.local_gold)
        cards = [f.result() for f in futs]
        if want_gold:
            cards.append(oz.result())
            for c in loc.result():
                c["ex"] = "GOLD"
                c["open"] = "GOLD:" + {"SA24": "XAU-SAR-24", "EG21": "XAU-EGP-21"}.get(c["code"], "XAU-USD-OZ")
                cards.append(c)
    return {"ok": True, "items": cards}


def get_index(ex, rng):
    """Market benchmark. Yahoo carries no history for TASI / EGX30, so for those markets a
    cap-weighted index of the 15 largest listed companies is computed instead."""
    if ex == "GOLD":
        r = get_history("DX-Y.NYB", "XX", rng)
        if r.get("ok"):
            r = dict(r, label="مؤشر الدولار")
        return r
    sym = EXCHANGES.get(ex, (None, None, None))[2]
    if not sym:
        return {"ok": False, "error": "لا يوجد مؤشر مرجعي لهذا السوق."}
    r = get_history(sym, "XX", rng)
    if r.get("ok") and len(r.get("rows") or []) >= 30:
        return dict(r, label={"US": "مؤشر إس آند بي 500", "SR": "مؤشر تاسي", "CA": "مؤشر إي جي إكس 30"}.get(ex, sym))
    key = "ci|%s|%s" % (ex, rng)
    cached, _ = cache_get(key, max_age=1800)
    if cached:
        return cached
    u = get_universe(ex)
    if not u.get("ok"):
        return {"ok": False, "error": "تعذّر حساب مؤشر السوق."}
    capped = [i for i in u["items"] if i.get("cap")]
    top = sorted(capped, key=lambda i: -i["cap"])[:15] if len(capped) >= 15 else u["items"][:15]
    series = []
    for it in top:
        h = get_history(it["symbol"], "XX", rng)
        if h.get("ok") and len(h["rows"]) >= 60:
            series.append((it.get("cap") or 1.0, {r_[0]: r_[4] for r_ in h["rows"]}))
    if len(series) < 5:
        return {"ok": False, "error": "تعذّر حساب مؤشر السوق."}
    days = sorted(set().union(*[set(m_.keys()) for _, m_ in series]))
    last = [None] * len(series)
    base = [None] * len(series)
    tot = sum(c for c, _ in series)
    rows = []
    for d in days:
        val = 0.0
        ok = True
        for k, (cap, m_) in enumerate(series):
            if d in m_:
                last[k] = m_[d]
                if base[k] is None:
                    base[k] = m_[d]
            if last[k] is None:
                ok = False
                break
            val += cap / tot * last[k] / base[k]
        if ok:
            v = round(val * 1000, 3)
            rows.append([d, v, v, v, v, 0])
    out = {"ok": True, "source": "محسوب", "symbol": "TOP15", "rows": rows, "dividends": [], "splits": [],
           "label": "مؤشر أكبر 15 شركة"}
    cache_put(key, out)
    return out


def get_news(q, region):
    key = "n|%s|%s" % (region, q)
    cached, _ = cache_get(key, max_age=1800)
    if cached:
        return cached
    try:
        items, _ = REG.call("news", region, q=q, region=region)
    except (NoData, SourcesFailed):
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب الأخبار."}
    out = {"ok": True, "items": items}
    cache_put(key, out)
    return out
