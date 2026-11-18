"""2.18.2: gold per gram as published by local price pages (snippets copied from the real pages on 18 Nov 2026)."""
import localgold

MASRAWY = '''<section class="main"><p> آخر تحديث لأسعار الذهب بتاريخ <span> الأربعاء 18 نوفمبر 2026 12:22 م </span></p>
<div class="currGoldTable"><div class="title"><div class="name">العيار</div><div class="name">سعر البيع</div><div class="name">سعر الشراء</div>
<div class="name">مقدار التغير ( بالجنيه المصري )</div></div>
<!-- Gold 1 Cell -->
<div class="currGoldDtls">
    <h2 class="item">
        سعر الذهب عيار 24
    </h2>
    <div class="item">
        6,665.00
    </div>
    <div class="item">
        6,605.00
    </div>
    <div class="item changeRate down">
        -80
    </div>
</div>
<!-- Gold 2 Cell -->
<div class="currGoldDtls">
    <h2 class="item">
        سعر الذهب عيار 21
    </h2>
    <div class="item">
        5,830.00
    </div>
    <div class="item">
        5,780.00
    </div>
    <div class="item changeRate down">
        -70
    </div>
</div>
</div>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","dateModified":"2026-11-18T12:22:54+02:00","mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"UnitPriceSpecification","name":"سعر الذهب عيار 24","price":"6665","priceCurrency":"EGP"}},{"@type":"ListItem","position":2,"item":{"@type":"UnitPriceSpecification","name":"سعر الذهب عيار 21","price":"5830","priceCurrency":"EGP"}}]}}</script>
</section>'''

ZAHAB = '''<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","dateModified":"2026-11-18T14:23:54+03:00"}]}</script>
<section id="karats" class="pt-6"><table><thead><tr><th>العيار</th><th>السعر</th></tr></thead>
<tbody class="bg-white divide-y divide-slate-200">
<tr class="hover:bg-slate-50">
<td class="px-6 py-4 text-sm text-slate-900 text-start">
<span class="font-medium text-gold-600">
سعر عيار 24
</span>
</td>
<td class="px-6 py-4 text-sm text-slate-900 text-start">
<span class="font-medium">
<span class="inline-flex items-center gap-1" style="vertical-align: middle;">
<span class="sr-only">
٤٥٣.٨٢ ريال
</span>
<span aria-hidden="true" class="inline-flex items-center gap-1">
٤٥٣.٨٢
<svg class="w-4 h-4" fill="currentColor"><use href="https://www.zahabprice.com/icons.svg#saudi-riyal-symbol"></use></svg>
</span></span></span>
</td>
</tr>
<tr class="hover:bg-slate-50">
<td class="px-6 py-4 text-sm text-slate-900 text-start"><span class="font-medium text-gold-600">
سعر عيار 21
</span></td>
<td class="px-6 py-4 text-sm text-slate-900 text-start"><span class="font-medium"><span class="inline-flex items-center gap-1"><span class="sr-only">
٣٩٧.٠٩ ريال
</span><span aria-hidden="true">٣٩٧.٠٩</span></span></span></td>
</tr>
</tbody></table></section>'''


def test_masrawy_sell_buy_change_and_time():
    p = localgold.parse_masrawy(MASRAWY)
    assert p["karats"][21] == {"sell": 5830.0, "buy": 5780.0, "change": -70.0}
    assert p["karats"][24]["sell"] == 6665.0 and p["updated"] == "2026-11-18T12:22:54+02:00"


def test_masrawy_structured_data_when_the_table_changes():
    html = MASRAWY.replace('class="currGoldDtls"', 'class="newLayout"')
    p = localgold.parse_masrawy(html)
    assert p["karats"][21]["sell"] == 5830.0 and p["karats"][21]["buy"] is None


def test_zahab_arabic_digits_and_time():
    p = localgold.parse_zahab(ZAHAB)
    assert p["karats"][24]["sell"] == 453.82 and p["karats"][21]["sell"] == 397.09
    assert p["updated"] == "2026-11-18T14:23:54+03:00"


def test_cards_from_the_pages_and_nothing_made_up(monkeypatch):
    store = {}
    monkeypatch.setattr(localgold, "cache_get", lambda k, max_age=None: (store.get(k), 0))
    monkeypatch.setattr(localgold, "cache_put", lambda k, v: store.__setitem__(k, v))
    pages = {localgold.EG_URL: MASRAWY, localgold.SA_URL: ZAHAB}
    asked = []

    def fetch(u):
        asked.append(u)
        return pages[u]
    sa, eg = localgold.local_gold(fetch)
    assert sa["ok"] and sa["last"] == 453.82 and sa["cur"] == "SAR" and sa["source"] == "ZahabPrice"
    assert eg["ok"] and eg["last"] == 5830.0 and eg["buy"] == 5780.0 and abs(eg["chg"] - (-70 / 5900)) < 1e-12
    localgold.local_gold(fetch)
    assert len(asked) == 2, "kept for 20 minutes"
    store.clear()

    def broken(u):
        raise OSError("403")
    sa, eg = localgold.local_gold(broken)
    assert not sa["ok"] and not eg["ok"] and "last" not in eg, "a page that cannot be read gives no price"
    assert store == {}, "a failure is not kept, so the next visit asks again"
    sa, eg = localgold.local_gold(lambda u: "<html>changed</html>")
    assert not eg["ok"] and "لم يُعثر" in eg["error"]
