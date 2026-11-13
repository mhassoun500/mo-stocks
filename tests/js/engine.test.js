/* Tests for the analysis engine, run with:  node --test tests/js
   Snapshot values live in tests/fixtures/expected.json; refresh them on purpose with
   UPDATE_SNAPSHOTS=1 node --test tests/js   after a deliberate change to the engine. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, fixture } = require('./harness');

const T = load();
const ASSETS = ['1120', 'COMI', 'AAPL', 'GOLD'];
const SNAP = path.join(__dirname, '..', 'fixtures', 'expected.json');
const OPTS = { span: 250, sens: 5, zoneCount: 6, stopMult: 0.5 };

function run(name, opts = OPTS) {
  const D = T.rowsToData(fixture(name).rows);
  const I = T.computeInd(D);
  return { D, I, A: T.analyzeCore(D, I, opts) };
}
const r6 = x => (x == null || !isFinite(x)) ? null : +(+x).toPrecision(6);
function summary(A) {
  return { stance: A.stance, close: r6(A.close), entry: r6(A.entry), stop: r6(A.stop), t1: r6(A.t1), t2: r6(A.t2), t3: r6(A.t3),
    rsi: r6(A.rsi), zones: A.zones.map(z => [z.kind, r6(z.lo), r6(z.hi)]), trend: A.trend };
}

for (const name of ASSETS) {
  test(name + ': plan levels are in a sensible order', () => {
    const { A } = run(name);
    assert.ok(A.stop < A.entry, 'stop below entry');
    assert.ok(A.entry <= A.close * 1.0001, 'entry at or below the price');
    assert.ok(A.t1 > A.close, 'first target above the price');
    assert.ok(A.t1 < A.t2 && A.t2 < A.t3, 'targets rise');
    assert.equal(A.tSrc.length, 3);
    if (A.rr != null) assert.ok(A.rr > 0);
  });
  test(name + ': zones and indicators are valid', () => {
    const { A, I, D } = run(name);
    assert.ok(A.zones.length >= 2);
    for (const z of A.zones) { assert.ok(z.lo <= z.hi); assert.ok(z.kind === 's' || z.kind === 'r'); }
    for (let i = 1; i < A.zones.length; i++) assert.ok(A.zones[i - 1].mid >= A.zones[i].mid, 'zones sorted from high to low');
    for (const v of I.rsi) if (v != null) assert.ok(v >= 0 && v <= 100);
    assert.equal(I.rsi.length, D.length);
    assert.ok(['buy', 'sell', 'neutral'].includes(A.stance));
    assert.ok(Array.isArray(A.reasons) && A.reasons.length > 0);
  });
  test(name + ': backtest returns counts', () => {
    const { A, I, D } = run(name);
    const bt = T.runBacktest(D, I, { span: A.span, sens: 5, zoneCount: 6, stopMult: 0.5 });
    for (const k of ['zone', 'rsi', 'cross', 'macd', 'brk']) { assert.ok(bt[k]); assert.ok(bt[k].w <= bt[k].n); }
  });
  test(name + ': weekly timeframe works', () => {
    const D = T.rowsToData(fixture(name).rows);
    const W = T.aggregateWeekly(D);
    assert.ok(W.length > 90 && W.length < D.length / 4);
    const A = T.analyzeCore(W, T.computeInd(W), { span: 104, sens: 3, zoneCount: 6, stopMult: 0.5 });
    assert.ok(A && A.stop < A.close && A.t3 > A.close);
  });
}

test('results match the saved snapshot (catches unintended changes)', () => {
  const now = Object.fromEntries(ASSETS.map(n => [n, summary(run(n).A)]));
  now.fair = { COMI: r6(T.fairValue(fixture('COMI_fund')).fair), AAPL: r6(T.fairValue(fixture('AAPL_fund')).fair) };
  if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(SNAP)) { fs.writeFileSync(SNAP, JSON.stringify(now, null, 1)); return; }
  assert.deepEqual(JSON.parse(JSON.stringify(now)), JSON.parse(fs.readFileSync(SNAP, 'utf8')));
});

test('fair value: methods and median', () => {
  const fv = T.fairValue(fixture('COMI_fund'));
  assert.equal(fv.methods.length, 4);
  assert.ok(fv.lo <= fv.fair && fv.fair <= fv.hi);
  const a = T.fairValue(fixture('AAPL_fund'));
  const gr = a.methods.find(m => m.k === 'gr');
  assert.equal(gr.use, false, 'Graham is skipped when price/book is very high');
  assert.ok(!a.methods.some(m => m.k === 'pb'), 'book-value method is only for banks');
});
test('fair value: missing or loss-making data', () => {
  assert.equal(T.fairValue(null), null);
  assert.equal(T.fairValue({ ok: false }), null);
  const loss = T.fairValue({ ok: true, f: { close: 10, price_earnings_ttm: null, price_book_fq: null, net_income_ttm: -5 } });
  assert.equal(loss.fair, null);
  assert.equal(loss.loss, true);
});
test('AI answer rendering escapes HTML', () => {
  const h = T.mdLite('## Title\n- **bold** <script>alert(1)</script>\nplain');
  assert.ok(h.includes('<h4>Title</h4>'));
  assert.ok(h.includes('<b>bold</b>'));
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
});
