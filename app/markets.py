# -*- coding: utf-8 -*-
"""Market data: search, company profiles, market lists, sectors, fundamentals, Sharia lists and screens."""
from core import *  # noqa: F401,F403
from prices import *  # noqa: F401,F403
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
    except Exception:
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
             "dps_common_stock_prim_issue_fy"]
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


def get_fundamentals(code, ex):
    """Company figures and analyst targets from TradingView's scanner, plus the sector's median multiples."""
    market = TV_MARKET_OF.get(ex)
    c = code.strip().upper().split(".")[0]
    if not market or not c:
        return {"ok": False, "error": "unsupported"}
    key = "fund|%s|%s" % (ex, c)
    with MEM_LOCK:
        hit = MEM.get(key)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    body = {"filter": [{"left": "name", "operation": "equal", "right": c}], "columns": FUND_COLS, "range": [0, 10]}
    rows, source = [], "TradingView"
    for attempt in range(2):
        try:
            rows = [dict(zip(FUND_COLS, r["d"])) for r in tv_scan(market, body).get("data") or []]
            break
        except Exception as e:
            if attempt:
                record("WARN", "fundamentals %s %s" % (ex, c), e)
            else:
                time.sleep(1)
    if ex == "US":
        rows.sort(key=lambda r: (r.get("exchange") not in US_PRIMARY, -(r.get("market_cap_basic") or 0)))
    f = rows[0] if rows else None
    if not f:
        try:
            f, source = _fundamentals_yahoo(c, ex), "Yahoo Finance"
        except Exception as e:
            record("WARN", "fundamentals yahoo %s %s" % (ex, c), e)
    if not f:
        return {"ok": False, "error": "لم أجد بيانات مالية لهذه الشركة في TradingView ولا Yahoo Finance."}  # not cached: try again next time
    sec, mkt = {}, {}
    try:
        if f.get("sector"):
            sec = sector_multiples(market, f["sector"])
        if (sec.get("n") or 0) < 5 or (sec.get("ndy") or 0) < 5:
            mkt = market_multiples(market)
    except Exception as e:
        warn("  sector multiples failed: %s" % e)
    res = {"ok": True, "code": c, "f": f, "source": source, "date": time.strftime("%Y-%m-%d"),
           "sectorPE": sec.get("pe"), "sectorPB": sec.get("pb"), "sectorDY": sec.get("dy"), "sectorN": sec.get("n"), "sectorNDY": sec.get("ndy"),
           "marketPE": mkt.get("pe"), "marketPB": mkt.get("pb"), "marketDY": mkt.get("dy"), "marketN": mkt.get("n"),
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
    except Exception:
        stale, _ = cache_get("sa|names")
        return stale or {}




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
                except Exception:
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
        for key, fn in (("sa", sharia.fetch_saudi), ("eg", sharia.fetch_egypt), ("spus", sharia.fetch_spus)):
            try:
                cache_put("sharia|" + key, fn())
                res[key] = True
            except Exception as e:
                warn(" Sharia list (%s) refresh failed (%s)" % (key, e))
                res[key] = False
    finally:
        SHARIA_BUSY.clear()
    return res


def sharia_lists():
    out = {"ok": True, "busy": SHARIA_BUSY.is_set()}
    for key in ("sa", "eg", "spus"):
        hit, _ = cache_get("sharia|" + key)
        out[key] = hit
    return out


def sharia_refresher():
    QUIT.wait(60)
    while not QUIT.is_set():
        _, t1 = cache_get("sharia|sa")
        _, t2 = cache_get("sharia|eg")
        if not t1 or not t2 or time.time() - min(t1, t2) > 7 * 86400:
            sharia_refresh()
        QUIT.wait(12 * 3600)


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
    except Exception:
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
    gl = {"SR": "SA", "CA": "EG"}.get(region, "SA")
    url = ("https://news.google.com/rss/search?q=%s&hl=ar&gl=%s&ceid=%s:ar"
           % (urllib.parse.quote(q), gl, gl))
    try:
        root = ET.fromstring(http_text(url).encode("utf-8"))
    except Exception:
        stale, _ = cache_get(key)
        return stale or {"ok": False, "error": "تعذّر جلب الأخبار."}
    items = []
    for it in root.iter("item"):
        src = it.find("source")
        title = (it.findtext("title") or "").strip()
        source = src.text.strip() if src is not None and src.text else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        items.append({"title": title, "link": it.findtext("link") or "", "date": it.findtext("pubDate") or "",
                      "source": source})
        if len(items) >= 12:
            break
    out = {"ok": True, "items": items}
    cache_put(key, out)
    return out
