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
  assert.ok(fv.methods.length >= 4);
  assert.ok(fv.lo <= fv.fair && fv.fair <= fv.hi);
  const a = T.fairValue(fixture('AAPL_fund'));
  const gr = a.methods.find(m => m.k === 'gr');
  assert.equal(gr.use, false, 'Graham is skipped when price/book is very high');
  assert.ok(!a.methods.some(m => m.k === 'pb'), 'book-value method is only for banks');
});
test('fair value: rebuilt from raw figures when there is no ready P/E', () => {
  const r = fixture('4014_fund');
  assert.equal(r.f.price_earnings_ttm, null);
  const fv = T.fairValue(r);
  assert.ok(fv.fair > 0 && fv.eps > 0, 'earnings per share comes from the raw figures');
  assert.ok(fv.why.includes('لا يغطي المحللون هذا السهم'));
});
test('fair value: book value stands in when there are no earnings', () => {
  const fv = T.fairValue(fixture('AMII_fund'));
  assert.ok(fv.fair > 0);
  assert.equal(fv.n, 1, 'flagged as a one-method estimate');
});
test('fair value: token dividends are not counted', () => {
  const dy = T.fairValue(fixture('AAPL_fund')).methods.find(m => m.k === 'dy');
  assert.ok(!dy || dy.use === false);
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

/* ---------- advanced tools ---------- */
for (const name of ASSETS) {
  test(name + ': advanced tools are consistent', () => {
    const D = T.rowsToData(fixture(name).rows), r = T.advCompute(D), N = D.length - 1;
    assert.equal(r.st.line.length, D.length);
    for (let i = 0; i <= N; i++) {
      if (r.st.line[i] == null) continue;
      if (r.st.dir[i] > 0) assert.ok(r.st.line[i] <= D[i].h + 1e-9, 'up-trend line sits under the bar');
      else assert.ok(r.st.line[i] >= D[i].l - 1e-9, 'down-trend line sits over the bar');
    }
    for (const f of r.st.flips) assert.equal(r.st.dir[f.i], f.dir);
    for (const e of r.smc.events) { assert.ok(e.from < e.i); assert.ok(['BOS', 'CHoCH'].includes(e.type)); assert.ok(e.dir > 0 ? D[e.i].c > e.p : D[e.i].c < e.p); }
    for (const g of r.smc.fvgs) assert.ok(g.lo < g.hi);
    for (const o of r.smc.obs) assert.ok(o.lo <= o.hi && o.i >= 0);
    for (let j = 1; j < r.zz.length; j++) assert.notEqual(r.zz[j].hi, r.zz[j - 1].hi, 'zigzag alternates highs and lows');
    for (let i = 0; i <= N; i++) if (r.nw.up[i] != null) assert.ok(r.nw.up[i] >= r.nw.lo[i]);
    const s = T.advSummary(D);
    assert.ok([1, -1].includes(s.st) && [1, -1, 0].includes(s.ichi));
    const f = T.yearFib(D, 'ytd');
    assert.ok(f && f.hi >= f.lo && D[f.hiI].t >= Date.UTC(new Date(D[N].t).getUTCFullYear(), 0, 1));
  });
}
test('advanced tools do not repaint: adding a bar never changes earlier values', () => {
  const D = T.rowsToData(fixture('1120').rows), A = T.advCompute(D.slice(0, -20)), B = T.advCompute(D);
  const n = D.length - 20;
  for (const k of ['cf', 'cs', 'e200']) for (let i = 0; i < n; i++) assert.equal(A[k][i], B[k][i]);
  for (let i = 0; i < n; i++) { assert.equal(A.st.line[i], B.st.line[i]); assert.equal(A.nw.mid[i], B.nw.mid[i]); assert.equal(A.ichi.sa[i], B.ichi.sa[i]); }
  const evA = A.smc.events.map(e => e.i + e.type), evB = B.smc.events.filter(e => e.i < n).map(e => e.i + e.type);
  assert.deepEqual(evA, evB, 'structure breaks already found stay the same');
});
test('supertrend on a clean up-trend then a crash', () => {
  const D = []; let p = 100;
  for (let i = 0; i < 80; i++) { p *= 1.01; D.push({ t: i * 864e5, o: p * 0.995, h: p * 1.005, l: p * 0.99, c: p, v: 1 }); }
  for (let i = 80; i < 100; i++) { p *= 0.95; D.push({ t: i * 864e5, o: p * 1.02, h: p * 1.03, l: p * 0.99, c: p, v: 1 }); }
  const st = T.supertrendCalc(D, 10, 3);
  assert.equal(st.dir[79], 1);
  assert.equal(st.dir[99], -1);
  assert.ok(st.flips.some(f => f.dir === -1 && f.i >= 80));
});
