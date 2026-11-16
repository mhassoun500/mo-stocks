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

/* ---------- Phase 2, step 1: trade simulation with costs ---------- */
const SIM = { span: 250, sens: 5, zoneCount: 6, stopMult: 0.5, fee: 0, slip: 0 };
function sim(name, o = {}) { const { D, I } = run(name); return { D, I, S: T.runTradeSim(D, I, Object.assign({}, SIM, o)) }; }

test('simulation: trades are consistent and fills follow the rules', () => {
  for (const a of ASSETS) {
    const { D, S } = sim(a);
    for (const t of S.trades) {
      assert.ok(t.j0 === t.e + 1 && t.exit >= t.j0 && t.exit <= t.e + 30, a + ': timing');
      assert.equal(t.open, D[t.j0].o, a + ': entry at the next open');
      assert.ok(t.open > t.stop && t.open < t.target, a + ': plan valid at the open');
      if (t.why === 'target') assert.equal(t.px, t.target);
      if (t.why === 'stop') assert.ok(t.px <= t.stop);
    }
    for (let i = 1; i < S.trades.length; i++) assert.ok(S.trades[i].e > S.trades[i - 1].exit, a + ': no overlap');
    assert.equal(S.stats.n, S.trades.length);
    assert.equal(S.eq.length, D.length - S.first);
    assert.ok(S.stats.maxDD <= 0 && S.stats.bhDD <= 0);
  }
});

test('simulation: costs only ever reduce the result, and zero costs match the plain price move', () => {
  const free = sim('1120').S, paid = sim('1120', { fee: 0.15, slip: 0.05 }).S;
  assert.equal(free.trades.length, paid.trades.length);
  free.trades.forEach((t, i) => {
    assert.ok(Math.abs(t.ret - (t.px / t.open - 1)) < 1e-12);
    assert.ok(paid.trades[i].ret < t.ret);
  });
  assert.ok(paid.stats.total <= free.stats.total && paid.stats.bhTotal < free.stats.bhTotal);
  const expectedCost = (1 - 0.0005) * (1 - 0.0015) / ((1 + 0.0005) * (1 + 0.0015));      // one flat trade, both sides
  const t0 = free.trades[0], t1 = paid.trades[0];
  assert.ok(Math.abs((1 + t1.ret) - (1 + t0.ret) * expectedCost) < 1e-9);
});

test('simulation: statistics add up and equity ends where the trades say', () => {
  const { S } = sim('AAPL', { fee: 0.1, slip: 0.05 });
  const prod = S.trades.reduce((p, t) => p * (1 + t.ret), 1);
  assert.ok(Math.abs(S.eq[S.eq.length - 1] - prod) < 1e-9);
  if (S.stats.n) {
    assert.ok(Math.abs(S.stats.expectancy - S.trades.reduce((s, t) => s + t.ret, 0) / S.stats.n) < 1e-12);
    assert.equal(S.stats.byWhy.stop + S.stats.byWhy.target + S.stats.byWhy.time, S.stats.n);
  }
  assert.equal(S.stats.lowSample, S.stats.n < 20);
});

test('simulation: repricing with new costs equals a full re-run', () => {
  const { D, I, S } = sim('COMI');
  const again = T.priceTrades(D, S.raw, S.first, 0.3, 0.1), full = sim('COMI', { fee: 0.3, slip: 0.1 }).S;
  assert.deepEqual(again.stats, full.stats);
});

test('no look-ahead: scrambling every candle after the signal does not change the plan', () => {
  const { D, I } = run('1120');
  const first = D.length - 400, picked = T.pickTrades(D, I, Object.assign({}, SIM, { first }));
  assert.ok(picked.raw.length > 0);
  for (const t of picked.raw.slice(0, 4)) {
    const D2 = D.map((d, i) => i <= t.e ? d : Object.assign({}, d, { o: d.o * 1.7, h: d.h * 2.1, l: d.l * 0.4, c: d.c * 1.3 }));
    const I2 = T.computeInd(D2), o = { end: t.e + 1, span: 250, sens: 5, zoneCount: 6, stopMult: 0.5, lite: true };
    const a = T.analyzeCore(D, I, o), b = T.analyzeCore(D2, I2, o);
    assert.equal(a.stop, b.stop); assert.equal(a.t1, b.t1);
    assert.deepEqual(a.buy, b.buy); assert.deepEqual(a.zones.map(z => [z.lo, z.hi]), b.zones.map(z => [z.lo, z.hi]));
  }
});

test('no look-ahead: trades that finished before a cut-off are the same with or without the later data', () => {
  const { D, I } = run('AAPL');
  const first = D.length - 450, cut = D.length - 150;
  const full = T.pickTrades(D, I, Object.assign({}, SIM, { first })).raw;
  const part = T.pickTrades(D.slice(0, cut), T.computeInd(D.slice(0, cut)), Object.assign({}, SIM, { first })).raw;
  const done = full.filter(t => t.exit < cut - 1);
  assert.ok(done.length > 0);
  assert.deepEqual(part.slice(0, done.length).map(t => [t.e, t.exit, t.px]), done.map(t => [t.e, t.exit, t.px]));
});

test('exit rules: stop first when one candle touches both, gap fills at the open, target at its price, time exit at the close', () => {
  const c = (o, h, l, cl) => ({ o, h, l, c: cl });
  const X = (...a) => JSON.parse(JSON.stringify(T.resolveExit(...a)));
  assert.deepEqual(X([c(100, 101, 99, 100), c(100, 112, 94, 100)], 1, 5, 95, 110), { exit: 1, px: 95, why: 'stop' });
  assert.deepEqual(X([c(100, 101, 99, 100), c(90, 91, 88, 89)], 1, 5, 95, 110), { exit: 1, px: 90, why: 'stop' });
  assert.deepEqual(X([c(100, 101, 99, 100), c(105, 120, 104, 118)], 1, 5, 95, 110), { exit: 1, px: 110, why: 'target' });
  assert.deepEqual(X([c(100, 101, 99, 100), c(100, 102, 98, 101), c(101, 103, 99, 102)], 1, 2, 95, 110), { exit: 2, px: 102, why: 'time' });
  assert.equal(X([c(100, 101, 99, 100), c(100, 102, 98, 101)], 1, 5, 95, 110), null);      // data ends first: trade left out
});
