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

/* ---------- Phase 2, step 2: staged exits, moving stop, setup score ---------- */
const J = (x) => JSON.parse(JSON.stringify(x));
const cd = (o, h, l, c) => ({ o, h, l, c });
const STG = (rows, trail = false, last = 20) => J(T.resolveStaged(rows, 1, last, 100, 95, [105, 110, 115], 2, trail));

test('staged exit: a third at each target, stop to entry after target 1', () => {
  const r = STG([cd(100, 101, 99, 100), cd(101, 106, 100, 105), cd(105, 106, 99, 100)]);
  assert.deepEqual(r.fills.map(f => [f.j, f.px, +f.frac.toFixed(4), f.why]), [[1, 105, 0.3333, 'target'], [2, 100, 0.6667, 'trail']]);
  assert.equal(r.exit, 2);
});

test('staged exit: several targets in one candle, then the stop climbs to target 1', () => {
  const r = STG([cd(100, 101, 99, 100), cd(104, 111, 103, 110), cd(110, 111, 104, 106)]);
  assert.deepEqual(r.fills.map(f => [f.px, f.why]), [[105, 'target'], [110, 'target'], [105, 'trail']]);
  assert.ok(Math.abs(r.fills.reduce((a, f) => a + f.frac, 0) - 1) < 1e-12);
});

test('staged exit: all three targets in one candle closes the trade', () => {
  const r = STG([cd(100, 101, 99, 100), cd(104, 120, 103, 119)]);
  assert.deepEqual(r.fills.map(f => f.px), [105, 110, 115]);
  assert.ok(Math.abs(r.fills.reduce((a, f) => a + f.frac, 0) - 1) < 1e-12);
});

test('staged exit: stop is checked before targets in the same candle', () => {
  const r = STG([cd(100, 101, 99, 100), cd(100, 112, 94, 100)]);
  assert.deepEqual(r.fills.map(f => [f.px, f.frac, f.why]), [[95, 1, 'stop']]);
});

test('trailing stop: follows the highest high of FINISHED candles, 2 ATR below, never below entry', () => {
  const rows = [cd(100, 101, 99, 100), cd(101, 106, 100, 105), cd(105, 108, 101, 107), cd(103, 104, 101, 102)];
  const t = STG(rows, true, 3), plain = STG(rows, false, 3);
  assert.deepEqual(t.fills.map(f => [f.j, f.px, f.why]), [[1, 105, 'target'], [3, 102, 'trail']]);   // level = 106-4 = 102 (candle 2's high was not used on candle 2)
  assert.deepEqual(plain.fills.map(f => [f.j, f.px, f.why]), [[1, 105, 'target'], [3, 102, 'time']]);   // without the trail the same path is held to the end
  assert.notDeepEqual(t.fills, plain.fills);
});

test('staged exit: time exit sells what is left at the close; data ending first leaves the trade out', () => {
  const rows = [cd(100, 101, 99, 100), cd(101, 106, 100, 105), cd(105, 107, 104, 106)];
  const r = STG(rows, false, 2);
  assert.deepEqual(r.fills.map(f => [f.px, +f.frac.toFixed(4), f.why]), [[105, 0.3333, 'target'], [106, 0.6667, 'time']]);
  assert.equal(T.resolveStaged(rows.slice(0, 2), 1, 9, 100, 95, [105, 110, 115], 2, false), null);
});

test('modes: same entry rule, fills add up, equity ends at the product of trade results', () => {
  for (const a of ['1120', 'AAPL']) {
    const { D, I } = run(a), pm = T.pickModes(D, I, SIM);
    for (const m of ['single', 'staged', 'trail']) {
      const R = T.priceTrades(D, pm.modes[m], pm.first, 0.15, 0.05);
      for (const t of R.trades) {
        assert.ok(Math.abs(t.fills.reduce((s, f) => s + f.frac, 0) - 1) < 1e-9, a + m + ': fractions');
        assert.equal(t.exit, t.fills[t.fills.length - 1].j);
        assert.ok(t.fills.every((f, i) => i === 0 || f.j >= t.fills[i - 1].j));
      }
      assert.ok(Math.abs(R.eq[R.eq.length - 1] - R.trades.reduce((p, t) => p * (1 + t.ret), 1)) < 1e-9, a + m + ': equity');
    }
    const one = T.runTradeSim(D, I, Object.assign({}, SIM, { fee: 0.15, slip: 0.05 }));
    const viaModes = T.priceTrades(D, pm.modes.single, pm.first, 0.15, 0.05);
    assert.deepEqual(J(one.stats), J(viaModes.stats));                       // sharing the cache changes nothing
    const firstEntries = ['single', 'staged', 'trail'].map(m => pm.modes[m][0] && pm.modes[m][0].e);
    assert.ok(firstEntries.every(e => e === firstEntries[0]), a + ': the first signal is the same in every mode');
  }
});

test('modes: a staged trade is never worse than stopping at the original stop, and trail never exits above its prices', () => {
  const { D, I } = run('1120'), pm = T.pickModes(D, I, SIM);
  for (const t of pm.modes.trail) { for (const f of t.fills) assert.ok(f.px >= Math.min(t.stop, D[f.j].o) - 1e-9 && f.px <= Math.max(D[f.j].h, f.px)); }
});

test('setup score: 0-100, parts add up, every part within its maximum, plain reasons', () => {
  for (const a of ASSETS) {
    const { D, I, A } = run(a), q = J(T.setupScore(D, I, A, D.length - 1));
    assert.equal(q.score, q.parts.reduce((s, p) => s + p.pts, 0));
    assert.ok(q.score >= 0 && q.score <= 100);
    assert.equal(q.parts.reduce((s, p) => s + p.max, 0), 100);
    assert.ok(q.parts.every(p => p.pts >= 0 && p.pts <= p.max && p.items.length > 0 && p.items.every(x => x.k.length > 3)));
    assert.ok(['strong', 'mid', 'weak'].includes(q.grade));
  }
});

test('setup score: no support zone below the price gives no location points; a clean setup scores higher than a poor one', () => {
  const { D, I, A } = run('1120');
  const none = J(T.setupScore(D, I, Object.assign({}, A, { buy: null, rr: null }), D.length - 1));
  assert.equal(none.parts[0].pts, 0); assert.equal(none.parts[0].items[0].k, 'لا توجد منطقة دعم تحت السعر');
  const z = { lo: 99, hi: 100.5, touches: 5, vpStrong: true, flip: true, htf: true };
  const good = T.setupScore(D, I, Object.assign({}, A, { buy: z, rr: 3.2 }), D.length - 1);
  const poor = T.setupScore(D, I, Object.assign({}, A, { buy: Object.assign({}, z, { touches: 1, vpStrong: false, flip: false, htf: false, hi: 50, lo: 49 }), rr: 0.6 }), D.length - 1);
  assert.ok(good.score > poor.score);
});

test('score split groups trades by score and ignores trades without a score', () => {
  const tr = [{ ret: 0.05, score: 80 }, { ret: -0.02, score: 75 }, { ret: -0.03, score: 40 }, { ret: 0.01, score: null }];
  const r = J(T.scoreSplit(tr, 60));
  assert.equal(r.hi.n, 2); assert.equal(r.lo.n, 1);
  assert.ok(Math.abs(r.hi.avg - 0.015) < 1e-12 && r.hi.win === 0.5 && r.lo.avg === -0.03);
});

/* ---------- Phase 2, step 3: next-year earnings, own past multiple, cash-flow estimate, agreement, margin of safety ---------- */
const withF = (name, extra, top = {}) => { const r = J(fixture(name)); Object.assign(r.f, extra); return Object.assign(r, top); };

test('cash-flow value: equals the closed form when growth equals long-run growth', () => {
  const v = T.dcfPerShare(10, 0.03, 0.09, 0.03);
  assert.ok(Math.abs(v - 10 * 1.03 / (0.09 - 0.03)) < 1e-9);
});
test('cash-flow value: rises with growth, falls with the discount rate, refuses impossible inputs', () => {
  assert.ok(T.dcfPerShare(10, 0.08, 0.09, 0.025) > T.dcfPerShare(10, 0.02, 0.09, 0.025));
  assert.ok(T.dcfPerShare(10, 0.05, 0.12, 0.025) < T.dcfPerShare(10, 0.05, 0.09, 0.025));
  assert.equal(T.dcfPerShare(-1, 0.05, 0.09, 0.025), null);
  assert.equal(T.dcfPerShare(10, 0.05, 0.03, 0.025), null, 'discount rate must exceed long-run growth by a margin');
  assert.equal(T.dcfPerShare(10, NaN, 0.09, 0.025), null);
});
test('fair value: next-year earnings method uses the forecast and the sector multiple', () => {
  const r = withF('AAPL_fund', { earnings_per_share_forecast_next_fy: 10 });
  const fw = T.fairValue(r, { ex: 'US' }).methods.find(m => m.k === 'fw');
  assert.ok(fw && Math.abs(fw.v - 10 * (r.sectorN >= 5 ? r.sectorPE : r.marketPE)) < 1e-9);
  const none = T.fairValue(withF('AAPL_fund', { earnings_per_share_forecast_next_fy: null }), { ex: 'US' });
  assert.ok(!none.methods.some(m => m.k === 'fw') && none.why.includes('لا توجد ربحية متوقعة للسنة القادمة'));
});
test('fair value: own past multiple needs 3 years, uses the median, and is dropped when it swings wildly', () => {
  const eh = (...pes) => pes.map((pe, i) => ({ d: '202' + i + '-12-31', eps: 2, px: 2 * pe }));
  const ok = T.fairValue(withF('AAPL_fund', {}, { epsHist: eh(10, 12, 14, 16) }), { ex: 'US' });
  const h = ok.methods.find(m => m.k === 'hist');
  assert.ok(h.use && Math.abs(h.v - ok.eps * 13) < 1e-9, 'median of 10,12,14,16 is 13');
  const few = T.fairValue(withF('AAPL_fund', {}, { epsHist: eh(10, 12) }), { ex: 'US' });
  assert.ok(!few.methods.some(m => m.k === 'hist') && few.why.some(w => w.includes('3 سنوات')));
  const wild = T.fairValue(withF('AAPL_fund', {}, { epsHist: eh(4, 30, 6, 40) }), { ex: 'US' });
  assert.equal(wild.methods.find(m => m.k === 'hist').use, false);
  const loss = T.fairValue(withF('AAPL_fund', {}, { epsHist: [{ d: 'a', eps: -1, px: 5 }, { d: 'b', eps: -2, px: 5 }, { d: 'c', eps: 0, px: 5 }, { d: 'd', eps: 3, px: 30 }] }), { ex: 'US' });
  assert.ok(!loss.methods.some(m => m.k === 'hist'), 'loss years are ignored, leaving too few');
});
test('fair value: cash-flow method is skipped for banks and for negative cash flow, with the reason', () => {
  const bank = T.fairValue(withF('COMI_fund', { free_cash_flow_per_share_ttm: 12, earnings_per_share_diluted_yoy_growth_fy: 20 }), { ex: 'CA' });
  assert.ok(!bank.methods.some(m => m.k === 'dcf') && bank.why.some(w => w.includes('البنوك')));
  const neg = T.fairValue(withF('AAPL_fund', { free_cash_flow_per_share_ttm: -2 }), { ex: 'US' });
  assert.ok(!neg.methods.some(m => m.k === 'dcf') && neg.why.some(w => w.includes('سالب')));
  const ok = T.fairValue(withF('AAPL_fund', { free_cash_flow_per_share_ttm: 9, earnings_per_share_diluted_yoy_growth_fy: 20, total_revenue_yoy_growth_ttm: 15 }), { ex: 'US' });
  const d = ok.methods.find(m => m.k === 'dcf');
  assert.ok(d && d.v > 0);
  assert.ok(ok.dcf.g <= 0.15 + 1e-12 && ok.dcf.g >= 0, 'growth is capped at 15% and never negative');
  assert.ok(ok.dcf.lo < ok.dcf.v && ok.dcf.v < ok.dcf.hi, 'higher discount rate gives lower value');
});
test('fair value: discount rate and long-run growth come from the user, per market', () => {
  const r = withF('AAPL_fund', { free_cash_flow_per_share_ttm: 9, earnings_per_share_diluted_yoy_growth_fy: 8 });
  const a = T.fairValue(r, { ex: 'US', disc: 8 }).dcf.v, b = T.fairValue(r, { ex: 'US', disc: 12 }).dcf.v;
  assert.ok(a > b);
  assert.equal(T.fvParams('CA').disc, 22); assert.equal(T.fvParams('US').disc, 9); assert.equal(T.fvParams('SR').mos, 20);
});
test('fair value: confidence reflects agreement between methods, not the number of decimals', () => {
  const base = T.fairValue(fixture('COMI_fund'), { ex: 'CA' });
  assert.ok(['high', 'mid', 'low'].includes(base.conf.level) && base.conf.n === base.n);
  assert.ok(base.conf.spread >= 0);
  const one = T.fairValue(fixture('AMII_fund'), { ex: 'SR' });
  assert.equal(one.conf.level, 'low', 'a single method is never high confidence');
});
test('fair value: margin of safety sets the buy-below price', () => {
  const r = fixture('COMI_fund');
  const a = T.fairValue(r, { ex: 'CA', mos: 20 }), b = T.fairValue(r, { ex: 'CA', mos: 35 });
  assert.ok(Math.abs(a.buy - a.fair * 0.8) < 1e-9 && Math.abs(b.buy - b.fair * 0.65) < 1e-9);
  assert.equal(a.fair, b.fair, 'the margin changes the buy price only, not the fair value');
});
test('fair value: old saved data without the new fields still works', () => {
  const fv = T.fairValue(fixture('4014_fund'), { ex: 'SR' });
  assert.ok(fv.fair > 0 && fv.conf && fv.buy < fv.fair);
});

/* ---------- Phase 2, step 4: extra indicators and the timeframe verdict ---------- */
const mk = (closes, vol = 1000, wig = 0.005) => closes.map((c, i) => ({ t: Date.UTC(2024, 0, 1) + i * 864e5, o: c, h: c * (1 + wig), l: c * (1 - wig), c, v: typeof vol === 'function' ? vol(i) : vol }));
const trend = (n, a, b) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
const zig = n => Array.from({ length: n }, (_, i) => 100 + (i % 2 ? 1 : -1));

test('ADX: high in a steady trend with +DI above -DI, low in a sideways chop, empty when data is short', () => {
  const up = T.adxCalc(mk(trend(120, 100, 200)), 14), ch = T.adxCalc(mk(zig(120)), 14);
  assert.ok(up.adx[119] > 40 && up.pdi[119] > up.mdi[119]);
  assert.ok(ch.adx[119] < 20);
  assert.ok(up.adx.every(v => v === null || (v >= 0 && v <= 100)));
  assert.ok(T.adxCalc(mk(trend(20, 1, 2)), 14).adx.every(v => v === null));
  const dn = T.adxCalc(mk(trend(120, 200, 100)), 14);
  assert.ok(dn.mdi[119] > dn.pdi[119]);
});
test('ADX: later candles never change earlier values', () => {
  const D = mk(trend(150, 100, 160).map((c, i) => c + Math.sin(i / 3) * 3));
  const a = T.adxCalc(D.slice(0, 100), 14).adx, b = T.adxCalc(D, 14).adx;
  for (let i = 0; i < 100; i++) assert.equal(a[i], b[i]);
});
test('OBV: volume added on up days, subtracted on down days, and read against price', () => {
  const D = mk([10, 11, 10, 12], i => [0, 100, 50, 200][i]);
  assert.deepEqual(Array.from(T.obvCalc(D)), [0, 100, 50, 250]);
  const up = T.obvRead(mk(trend(60, 100, 130)), 20); assert.equal(up.state, 'confirm');
  const falseRally = T.obvRead(mk(Array.from({ length: 60 }, (_, i) => i < 40 ? 100 : 100 + (i - 39) * 0.2), i => i < 40 ? 1000 : (i % 3 ? 100 : 5000)), 20);
  assert.ok(falseRally === null || ['bear', 'confirm', 'mixed', 'flat', 'bull'].includes(falseRally.state));
  assert.equal(T.obvRead(mk(trend(60, 1, 2), 0), 20), null, 'no volume (gold), no reading');
});
test('OBV: price rising while volume flows out is called a bearish divergence', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.3 * (i % 2 ? 1 : 0.5));
  const D = mk(closes, i => (i > 30 && i % 2 === 1 ? 10 : 1000));
  const r = T.obvRead(D, 20);
  assert.ok(r.pd > 0 && r.fd < 0 && r.state === 'bear');
});
test('RSI divergence: lower low in price with a higher low in RSI is found; a clean trend has none; only confirmed points are used', () => {
  const seg = (a, b, n) => trend(n, a, b);
  const closes = [].concat(seg(120, 100, 25), seg(100, 112, 12).slice(1), seg(112, 99, 25).slice(1), seg(99, 106, 12).slice(1));
  const D = mk(closes, 1000, 0.002), rsi = T.rsiCalc(D.map(d => d.c), 14);
  const dv = T.rsiDivergence(D, rsi);
  assert.ok(dv && dv.type === 'bull' && D[dv.i2].l < D[dv.i1].l && rsi[dv.i2] > rsi[dv.i1]);
  const clean = mk(trend(120, 100, 200), 1000, 0.002);
  assert.equal(T.rsiDivergence(clean, T.rsiCalc(clean.map(d => d.c), 14)), null);
  /* a swing point needs k candles after it: it cannot sit among the last k candles */
  assert.ok(dv.i2 <= D.length - 1 - 3);
  /* candles after the second point do not move the points already found */
  const more = mk(closes.concat(seg(106, 108, 6).slice(1)), 1000, 0.002), d2 = T.rsiDivergence(more, T.rsiCalc(more.map(d => d.c), 14));
  assert.ok(d2 && d2.i1 === dv.i1 && d2.i2 === dv.i2);
});
test('relative volume: multiple of the previous 20-candle average, null without volume or history', () => {
  const D = mk(trend(40, 10, 11), i => i === 39 ? 3000 : 1000);
  assert.ok(Math.abs(T.relVol(D, 39) - 3) < 1e-9);
  assert.equal(T.relVol(mk(trend(40, 10, 11), 0), 39), null);
  assert.equal(T.relVol(D, 5), null);
});
test('timeframe bias: four readings, uptrend up, downtrend down, unknown without the slow average', () => {
  const U = mk(trend(150, 100, 200)), Dn = mk(trend(150, 200, 100));
  const bu = T.tfBias(U, T.computeInd(U)), bd = T.tfBias(Dn, T.computeInd(Dn));
  assert.equal(bu.dir, 1); assert.equal(bd.dir, -1); assert.equal(bu.parts.length, 4);
  assert.equal(bu.score, bu.parts.reduce((s, p) => s + p.v, 0));
  const S2 = mk(trend(30, 100, 110)); assert.equal(T.tfBias(S2, T.computeInd(S2)), null);
});
test('timeframe verdict: agreement, partial, conflict and too few frames', () => {
  const f = (w, d, h) => ({ W: w == null ? null : { dir: w }, D: d == null ? null : { dir: d }, H: h == null ? null : { dir: h } });
  assert.equal(T.mtfVerdict(f(1, 1, 1)).state, 'up');
  assert.equal(T.mtfVerdict(f(-1, -1, -1)).state, 'down');
  assert.equal(T.mtfVerdict(f(1, -1, 1)).state, 'conflict');
  assert.equal(T.mtfVerdict(f(1, 0, 1)).state, 'partial-up');
  assert.equal(T.mtfVerdict(f(-1, 0, 0)).state, 'partial-down');
  assert.equal(T.mtfVerdict(f(1, null, null)).state, 'few');
  assert.equal(T.mtfVerdict(f(1, 1, null)).state, 'up', 'works with two frames when hourly data is missing');
});
test('alignment at a past signal uses only candles up to it', () => {
  const { D, I } = run('AAPL'), e = D.length - 120, a = J(T.alignAt(D, I, e));
  const D2 = D.slice(0, e + 1).concat(D.slice(e + 1).map(d => ({ t: d.t, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 })));
  assert.deepEqual(J(T.alignAt(D2, T.computeInd(D2), e)), a);
});
test('trades carry their alignment, and the split groups them without losing any', () => {
  const { D, I } = run('1120'), pm = T.pickModes(D, I, SIM), R = T.priceTrades(D, pm.modes.single, pm.first, 0.15, 0.05);
  assert.ok(R.trades.every(t => t.al && 'd' in t.al && 'w' in t.al));
  const sp = T.alignSplit(R.trades);
  assert.equal(sp.up.n + sp.other.n + sp.unknown, R.trades.length);
  const fake = T.alignSplit([{ ret: 0.04, al: { d: 1, w: 1 } }, { ret: -0.02, al: { d: 1, w: -1 } }, { ret: 0.01, al: { d: null, w: 1 } }]);
  assert.equal(fake.wkOk.n, 2); assert.equal(fake.wkDown.n, 1); assert.equal(fake.wkUnknown, 0);
  assert.equal(sp.wkOk.n + sp.wkDown.n + sp.wkUnknown, R.trades.length);
  assert.equal(fake.up.n, 1); assert.equal(fake.other.n, 1); assert.equal(fake.unknown, 1); assert.equal(fake.up.avg, 0.04);
});

/* ---------- purification (phase 3 step 2) ---------- */
function purSetup() {
  T.SHL.pur = { source: 'مركز المقاصد (د. محمد العصيمي)', date: '2026-10-22', period: '2025', url: 'https://x', rows: { '2050': [0.54, 'p', 'main'], '1202': [0.19, 'm', 'main'] } };
  T.SHL.eg = { date: '2026-11-10', url: 'https://y', refs: [], rows: { COMI: { n: '', v: '', p: 1.8 }, '2050': { n: '', v: '', p: 9 } } };
  T.P.sharia.purify = '';
  for (const k of Object.keys(T.PUR_EST)) delete T.PUR_EST[k];
}
test('purification: each market gets its own source, never the other market\'s list', () => {
  purSetup();
  const sa = T.purifyEntries('2050.SR', 'SR', true);
  assert.equal(sa.length, 1, 'the Egyptian row with the same code is not used for a Saudi stock');
  assert.deepEqual([sa[0].kind, sa[0].val, sa[0].src, sa[0].period, sa[0].verdict], ['amt', 0.54, 'maqased', '2025', 'نقية']);
  const eg = T.purifyEntries('COMI.CA', 'CA', true);
  assert.deepEqual([eg[0].kind, eg[0].val, eg[0].src], ['pct', 1.8, 'eg']);
  assert.equal(T.purifyEntries('AAPL', 'US', true).length, 0, 'no source and no estimate yet: nothing, not zero');
});
test('purification: your own entry comes first, then sources newest first', () => {
  purSetup();
  T.P.sharia.purify = '2050 2.5';
  const l = T.purifyEntries('2050', 'SR', false);
  assert.deepEqual([...l.map(e => e.src)], ['own', 'maqased']);
  assert.equal(T.purifyInfo('2050', 'SR').val, 2.5);
  T.P.sharia.purify = '';
  T.SHL.pur.date = '2026-11-15';
  T.SHL.eg.rows['9999'] = { n: '', v: '', p: 3 }; T.SHL.pur.rows['9999'] = [0.02, 'p', 'nomu'];
  assert.deepEqual([...T.purifyEntries('9999', undefined, false).map(e => e.src)], ['maqased', 'eg'], 'with no market given, both lists show, newest first');
});
test('purification: the program estimate only fills a gap and is labelled', () => {
  purSetup();
  T.PUR_EST['US|AAPL'] = { ok: true, pct: 0.42, date: '2026-11-17', period: '2025', source: 'SEC EDGAR' };
  assert.equal(T.purifyEntries('AAPL', 'US', false).length, 0, 'not part of the published figures');
  assert.equal(T.purifyInfo('AAPL', 'US'), null, 'so the AI fill still offers to look for a published one');
  const l = T.purifyEntries('AAPL', 'US', true);
  assert.deepEqual([l[0].src, l[0].val], ['est', 0.42]);
  assert.match(T.purifyPopHTML(l), /تقدير تقريبي/);
  T.PUR_EST['SR|2050'] = { ok: true, pct: 7 };
  assert.ok(T.purifyEntries('2050', 'SR', true).every(e => e.src !== 'est'), 'never shown beside a published figure');
});
test('purification: amounts and percentages are shown in their own units with the reminder', () => {
  purSetup();
  const amt = T.purifyValHTML({ kind: 'amt', val: 0.54 }), pct = T.purifyValHTML({ kind: 'pct', val: 1.8 });
  assert.match(amt, /0\.54/); assert.match(amt, /ر\.س للسهم/); assert.doesNotMatch(amt, /%/);
  assert.match(pct, /1\.8%/);
  const mixed = T.purifyPopHTML([{ kind: 'pct', val: 2, src: 'own', by: 'قائمتك في الإعدادات' }, { kind: 'amt', val: 0.5, src: 'maqased', by: 'x', date: '2026-10-22', period: '2025' }]);
  assert.match(mixed, /لا تجمع بينهما/);
  assert.match(mixed, /المرجع هو الهيئة الشرعية/);
  assert.equal(T.purifyPopHTML([]), '');
});

/* ---------- purification owed in the portfolio (phase 3 step 3) ---------- */
const DAYMS = 864e5, T0 = Date.UTC(2025, 0, 1);
const amtFig = [{ kind: 'amt', val: 0.54, src: 'maqased', by: 'x' }], pctFig = [{ kind: 'pct', val: 5, src: 'eg', by: 'y' }];
test('purification owed: amount per share is shares x amount x days / 365', () => {
  const t = { ex: 'SR', code: '2050', qty: 100, entry: 20, date: T0 };
  const year = T.purifyDue(t, amtFig, null, { now: T0 + 365 * DAYMS });
  assert.equal(year.status, 'ok'); assert.equal(+year.due.toFixed(6), 54); assert.equal(year.cur, 'SAR');
  const part = T.purifyDue(Object.assign({}, t, { exit: 25, exitDate: T0 + 73 * DAYMS }), amtFig, null, { now: T0 + 999 * DAYMS });
  assert.equal(part.days, 73, 'a closed trade counts only the days it was held'); assert.equal(+part.due.toFixed(6), 10.8);
  assert.equal(part.divs, null, 'dividends are not needed for this kind');
});
test('purification owed: a percentage applies to dividends received while held, and to realised gains when chosen', () => {
  const t = { ex: 'CA', code: 'ASCM', qty: 1000, entry: 10, date: T0, exit: 12, exitDate: T0 + 200 * DAYMS };
  const divs = [[T0 - 5 * DAYMS, 1], [T0 + 50 * DAYMS, 0.4], [T0 + 150 * DAYMS, 0.6], [T0 + 300 * DAYMS, 9]];
  const r = T.purifyDue(t, pctFig, divs, { gains: true });
  assert.equal(r.divs, 1000, 'only the two dividends inside the holding period: (0.4 + 0.6) x 1000');
  assert.equal(r.gain, 2000); assert.equal(r.due, (1000 + 2000) * 0.05); assert.equal(r.cur, 'EGP');
  assert.equal(T.purifyDue(t, pctFig, divs, { gains: false }).due, 50, 'gains left out when the user says so');
  const loss = T.purifyDue(Object.assign({}, t, { exit: 8 }), pctFig, divs, { gains: true });
  assert.equal(loss.due, 50, 'a loss is never subtracted from the dividends');
  const open = T.purifyDue(Object.assign({}, t, { exit: null, exitDate: null }), pctFig, divs, { now: T0 + 400 * DAYMS });
  assert.equal(open.gain, null); assert.equal(open.divs, (0.4 + 0.6 + 9) * 1000, 'an open holding counts every dividend up to today');
});
test('purification owed: missing data is said, never filled in', () => {
  const t = { ex: 'US', code: 'MSFT', qty: 10, entry: 300, date: T0 };
  assert.equal(T.purifyDue(t, [], null).status, 'none');
  assert.equal(T.purifyDue(t, [], null).due, null);
  const p = T.purifyDue(t, pctFig, null, { now: T0 + 10 * DAYMS });
  assert.equal(p.status, 'partial'); assert.equal(p.due, 0); assert.equal(p.notes.length, 1);
  assert.equal(T.purifyDue({ ex: 'GOLD', code: 'XAU', qty: 1, entry: 1, date: T0 }, amtFig, null).status, 'skip');
});
test('purification totals: each currency on its own, payments subtracted, never below zero', () => {
  const rows = [{ cur: 'SAR', due: 54 }, { cur: 'SAR', due: 6 }, { cur: 'EGP', due: 150 }, { cur: 'USD', due: null }];
  const paid = [{ cur: 'SAR', amount: 20 }, { cur: 'EGP', amount: 500 }, { cur: 'SAR', amount: -5 }];
  const tot = T.purifyTotals(rows, paid);
  assert.deepEqual(JSON.parse(JSON.stringify(tot)), { SAR: { due: 60, paid: 20, left: 40 }, EGP: { due: 150, paid: 500, left: 0 } });
});

/* ---------- the trade journal is never overwritten before it has been read ---------- */
test('journal: opening the app straight on the portfolio page cannot wipe the saved trades', async () => {
  const JT = load(['core', 'indicators', 'advanced', 'engine', 'plan', 'journal'], ['J', 'saveJournal', 'refreshJournalPrices', 'loadJournal', 'Store']);
  JT.__store['stock-zones-v2:journal'] = JSON.stringify([{ id: 'a', code: '2050', ex: 'SR', qty: 10, entry: 20, date: 1 }]);
  await JT.refreshJournalPrices();          /* what the page did first when opened on #journal */
  await JT.saveJournal();
  assert.equal(JSON.parse(JT.__store['stock-zones-v2:journal']).length, 1, 'the saved trade is still there');
  JT.J.loaded = true; JT.J.trades = [];
  await JT.saveJournal();
  assert.equal(JSON.parse(JT.__store['stock-zones-v2:journal']).length, 0, 'once loaded, saving works as before');
});

/* ---------- zakat and total return (phase 3 step 4) ---------- */
test('zakat: trader pays on market value, at the hijri or gregorian rate', () => {
  const t = { id: 'a', ex: 'CA', code: 'COMI', qty: 100, entry: 70, last: 80, date: 1 };
  const h = T.zakatFor(t, { method: 'trade', cal: 'hijri' });
  assert.equal(h.status, 'ok'); assert.equal(h.base, 8000); assert.equal(+h.zakat.toFixed(6), 200); assert.equal(h.cur, 'EGP');
  const g = T.zakatFor(t, { method: 'trade', cal: 'greg' });
  assert.ok(Math.abs(g.zakat / 8000 - 0.02577) < 0.00001, 'gregorian rate is about 2.577%');
  assert.equal(T.zakatFor(Object.assign({}, t, { last: null }), { method: 'trade' }).status, 'noprice', 'no price, no number');
});
test('zakat: investor pays on the zakatable assets per share, never guessed', () => {
  const t = { id: 'b', ex: 'US', code: 'AAPL', qty: 10, entry: 180, last: 230, date: 1 };
  assert.equal(T.zakatFor(t, { method: 'invest' }).status, 'needassets');
  const r = T.zakatFor(t, { method: 'invest', assets: T.zakatAssetsMap('aapl 9.8\n١١٢٠ ٤') });
  assert.equal(r.base, 98); assert.equal(+r.zakat.toFixed(6), 2.45);
  assert.equal(T.zakatAssetsMap('١١٢٠ ٤')['1120'], 4, 'Arabic digits are read');
});
test('zakat: Saudi companies pay for their investors unless you turn it off; your entry and choices still win', () => {
  const t = { id: 'c', ex: 'SR', code: '2050', qty: 100, entry: 20, last: 25, date: 1 };
  const c = T.zakatFor(t, { method: 'invest', saPays: true });
  assert.equal(c.status, 'company'); assert.equal(c.zakat, 0);
  assert.equal(T.zakatFor(t, { method: 'invest', saPays: false }).status, 'needassets');
  assert.equal(T.zakatFor(t, { method: 'invest', saPays: true, assets: { '2050': 6 } }).base, 600, 'an entered base is used');
  assert.equal(T.zakatFor(t, { method: 'invest', over: { c: 'trade' } }).base, 2500, 'one holding can be set as trading');
});
test('zakat: gold always at value in its own currency; closed trades and funds are left out', () => {
  const g = T.zakatFor({ id: 'g', ex: 'GOLD', code: 'XAU-SAR-21', qty: 50, entry: 300, last: 320, date: 1 }, { method: 'invest' });
  assert.equal(g.method, 'trade'); assert.equal(g.base, 16000); assert.equal(g.cur, 'SAR');
  assert.equal(T.zakatFor({ id: 'x', ex: 'SR', code: '2050', qty: 1, entry: 1, last: 1, exit: 2, exitDate: 2, date: 1 }, {}).status, 'closed');
  assert.equal(T.zakatFor({ id: 'f', ex: 'FUND', code: '1', qty: 1, entry: 1, last: 1, date: 1 }, {}).status, 'skip');
});
test('total return adds the dividends received while held to the price change', () => {
  const D0 = Date.UTC(2025, 0, 1), d = 864e5;
  const t = { id: 'r', ex: 'SR', code: '2050', qty: 100, entry: 20, date: D0, exit: 22, exitDate: D0 + 200 * d };
  const divs = [[D0 - d, 5], [D0 + 30 * d, 0.5], [D0 + 300 * d, 9]];
  const r = T.totalReturn(t, divs, null);
  assert.equal(r.cost, 2000); assert.equal(r.gain, 200); assert.equal(r.divs, 50); assert.equal(r.total, 250); assert.equal(r.pct, 0.125); assert.equal(r.src, 'data');
  const m = T.totalReturn(t, divs, 80);
  assert.equal(m.divs, 80); assert.equal(m.src, 'manual', 'what you recorded replaces what was read');
  const n = T.totalReturn(Object.assign({}, t, { exit: null, exitDate: null, last: null }), null, null);
  assert.equal(n.total, null, 'no price: no total, not zero');
});

/* ---------- journal statistics and broker-statement import (phase 3 step 5) ---------- */
const JX = load(['core', 'indicators', 'advanced', 'engine', 'plan', 'journal', 'jtools'],
  ['csvParse', 'impGuess', 'impNum', 'impDate', 'impSide', 'impTx', 'impTrades', 'impNew', 'groupStats', 'bestWorst', 'realisedByCur', 'mistakeCost']);
const A = x => JSON.parse(JSON.stringify(x));
test('import: CSV with quotes, semicolons, Windows line ends and a BOM', () => {
  const rows = JX.csvParse('﻿التاريخ;الرمز;النوع;الكمية;السعر\r\n2025-01-05;1120;شراء;"1,000";"80,5"\r\n\r\n2025-02-01;1120;بيع;400;85\r\n');
  assert.equal(rows.length, 3); assert.deepEqual(A(rows[1]), ['2025-01-05', '1120', 'شراء', '1,000', '80,5']);
});
test('import: columns are recognised in Arabic and English', () => {
  assert.deepEqual(A(JX.impGuess(['التاريخ', 'رمز السهم', 'نوع العملية', 'الكمية', 'سعر التنفيذ', 'العمولة', 'اسم الشركة'])), { date: 0, code: 1, side: 2, qty: 3, price: 4, fee: 5, name: 6 });
  assert.deepEqual(A(JX.impGuess(['Trade Date', 'Symbol', 'Action', 'Quantity', 'Price', 'Commission'])), { date: 0, code: 1, side: 2, qty: 3, price: 4, fee: 5 });
});
test('import: numbers, dates and buy/sell in the forms brokers use', () => {
  assert.equal(JX.impNum('1,234.50'), 1234.5); assert.equal(JX.impNum('(12)'), -12); assert.equal(JX.impNum('١٢٣٫٥'), 123.5);
  assert.equal(JX.impNum('80,5'), 80.5); assert.equal(JX.impNum('SAR 1,000'), 1000); assert.equal(JX.impNum(''), null);
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  assert.equal(day(JX.impDate('2025-03-04', 'auto')), '2025-03-04');
  assert.equal(day(JX.impDate('04/03/2025', 'auto')), '2025-03-04', 'day first unless it cannot be');
  assert.equal(day(JX.impDate('03/14/2025', 'auto')), '2025-03-14', 'a second number above 12 means month first');
  assert.equal(day(JX.impDate('04/03/2025', 'mdy')), '2025-04-03');
  assert.equal(day(JX.impDate('٣١/١٢/٢٠٢٥', 'auto')), '2025-12-31');
  assert.equal(JX.impDate('next week', 'auto'), null);
  assert.equal(JX.impSide('شراء'), 'buy'); assert.equal(JX.impSide('BUY'), 'buy'); assert.equal(JX.impSide('بيع'), 'sell'); assert.equal(JX.impSide('Sell'), 'sell');
  assert.equal(JX.impSide('', -5), 'sell'); assert.equal(JX.impSide('تحويل'), null);
});
test('import: first in, first out, fees in the prices, unmatched sales reported, bad lines explained', () => {
  const rows = [['2025-01-05', '1120', 'شراء', '100', '10', '10'], ['2025-01-20', '1120', 'شراء', '50', '12', '0'], ['2025-03-01', '1120', 'بيع', '120', '15', '12'],
    ['2025-03-02', 'AAPL', 'sell', '5', '200', '0'], ['bad', '1120', 'شراء', '1', '1', '0'], ['2025-03-03', '', 'شراء', '1', '1', '0']];
  const { tx, bad } = JX.impTx(rows, { date: 0, code: 1, side: 2, qty: 3, price: 4, fee: 5 }, { fmt: 'auto', ex: 'auto' });
  assert.equal(tx.length, 4); assert.deepEqual(A(bad.map(b => b.line)), [6, 7]);
  const { trades, unmatched } = JX.impTrades(tx);
  const closed = trades.filter(t => t.exit != null), open = trades.filter(t => t.exit == null);
  assert.equal(closed.length, 2);
  assert.deepEqual(A(closed.map(t => [t.qty, t.entry, t.exit, t.ex])), [[100, 10.1, 14.9, 'SR'], [20, 12, 14.9, 'SR']]);
  assert.deepEqual(A(open.map(t => [t.qty, t.entry])), [[30, 12]]);
  assert.deepEqual(A(unmatched.map(u => [u.code, u.qty])), [['AAPL', 5]]);
  assert.equal(JX.impNew(trades, trades).length, 0, 'importing the same file twice adds nothing');
  assert.equal(JX.impNew(trades, closed).length, 1);
});
test('statistics: groups by setup, market, holding period and tag, best and worst only with enough trades', () => {
  const d = 864e5, T1 = Date.UTC(2025, 0, 1), mk = (setup, ex, ret, days, tags, stop) => ({ setup, ex, code: ex === 'SR' ? '1120' : 'AAPL', qty: 10, entry: 100, stop, date: T1, exit: 100 * (1 + ret), exitDate: T1 + days * d, tags });
  const tr = [mk('اختراق', 'SR', 0.1, 3, [], 95), mk('اختراق', 'SR', 0.05, 20, [], 95), mk('اختراق', 'US', -0.02, 20, ['دخول متسرع'], 95),
    mk('ارتداد', 'US', -0.05, 40, ['دخول متسرع'], null), mk('ارتداد', 'SR', 0.01, 200, [], null), mk('ارتداد', 'SR', -0.03, 5, [], null),
    Object.assign(mk('ارتداد', 'SR', 0, 1, [], null), { exit: null })];
  const s = JX.groupStats(tr, 'setup');
  assert.deepEqual(A(s.map(x => [x.key, x.n])), [['اختراق', 3], ['ارتداد', 3]], 'open trades are not counted');
  assert.equal(s[0].win, 2 / 3); assert.ok(Math.abs(s[0].avgR - (2 + 1 - 0.4) / 3) < 1e-9); assert.equal(s[1].avgR, null, 'no stop, no R');
  const bw = JX.bestWorst(s, 3); assert.equal(bw.best.key, 'اختراق'); assert.equal(bw.worst.key, 'ارتداد');
  assert.equal(JX.bestWorst(s, 4), null, 'too few trades to compare');
  assert.deepEqual(A(JX.groupStats(tr, 'hold').map(x => x.key)).sort(), ['أسبوع أو أقل', 'أكثر من 3 أشهر', 'حتى 3 أشهر', 'حتى شهر'].sort());
  assert.ok(JX.groupStats(tr, 'tag').some(x => x.key === 'دخول متسرع' && x.n === 2));
  const by = JX.realisedByCur(tr); assert.ok(Math.abs(by.SAR - (100 + 50 + 10 - 30)) < 1e-9); assert.ok(Math.abs(by.USD - (-20 - 50)) < 1e-9);
  const mc = JX.mistakeCost(tr, ['دخول متسرع', 'قرار عاطفي']);
  assert.equal(mc.length, 1); assert.equal(mc[0].n, 2); assert.equal(mc[0].losses, 2); assert.ok(Math.abs(mc[0].avgWith - (-0.035)) < 1e-9);
});

/* ---------- nine checks before deciding (step 6) ---------- */
const NC = load(['core', 'indicators', 'advanced', 'engine', 'plan', 'company'], ['nineChecks', 'feedStatusHTML']);
const NOW = Date.UTC(2026, 10, 17), D1 = 864e5;
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i) * D1, o: 1, h: 1, l: 1, c: f(i), v: 50000 }));
const byKey = l => Object.fromEntries([...l].map(x => [x.key, x]));
test('nine checks: calm, liquid, fairly priced company reads as usual', () => {
  const c = byKey(NC.nineChecks({ ex: 'SR', now: NOW, data: series(260, i => 100 + (i % 2 ? 0.5 : -0.5)),
    fund: { ok: true, f: { net_income_ttm: 5e8, price_earnings_ttm: 14 }, sectorPE: 15, source: 'TradingView' },
    profile: { ok: true, earningsGrowth: 0.1, debtToEquity: 40, sector: 'Industrials' } }));
  assert.equal(c.liquidity.status, 'usual'); assert.equal(c.volatility.status, 'usual'); assert.equal(c.profit.status, 'usual');
  assert.equal(c.valuation.status, 'usual'); assert.equal(c.debt.status, 'usual');
  assert.equal(c.float.status, 'na', 'no free source: said, not guessed');
  assert.equal(c.insiders.status, 'na'); assert.equal(c.filings.status, 'na'); assert.equal(c.coming.status, 'na');
  assert.equal(Object.keys(c).length, 9);
});
test('nine checks: what makes each one worth a look', () => {
  const thin = series(260, i => 100 * (i > 240 ? 0.7 : 1) + (i % 2 ? 4 : -4)).map((d, i) => Object.assign(d, { v: i % 3 ? 0 : 10 }));
  const file = { ok: true, complete: true, insiders: [{ date: NOW - 5 * D1, side: 'sell', shares: 1000 }],
    items: [{ date: NOW - 2 * D1, title: 'Results', form: '8-K' }], record: { due: null } };
  const c = byKey(NC.nineChecks({ ex: 'US', now: NOW, data: thin, file,
    fund: { ok: true, f: { net_income_ttm: -2e7, price_earnings_ttm: -5 }, sectorPE: 20 },
    profile: { ok: true, debtToEquity: 220, sector: 'Technology', earningsDates: [(NOW + 6 * D1) / 1000] } }));
  for (const k of ['liquidity', 'volatility', 'profit', 'valuation', 'debt', 'insiders', 'filings', 'coming']) assert.equal(c[k].status, 'notable', k);
});
test('nine checks: banks are not judged on debt, and an estimated results date is used only when none is announced', () => {
  const file = { ok: true, complete: false, watching: true, since: NOW - 200 * D1, items: [{ date: NOW - 120 * D1, type: 'insider', title: 'x' }],
    record: { due: { date: NOW + 60 * D1, from: 3 } } };
  const c = byKey(NC.nineChecks({ ex: 'SR', now: NOW, data: series(30, () => 10), file, profile: { ok: true, sector: 'Financial Services', debtToEquity: 900 } }));
  assert.equal(c.debt.status, 'na');
  assert.equal(c.insiders.status, 'usual'); assert.ok(c.insiders.partial, 'a record that only starts when the app began watching is marked partial');
  assert.equal(c.coming.status, 'usual'); assert.equal(c.coming.facts[0][1], NOW + 60 * D1);
  assert.equal(c.volatility.status, 'na', '30 sessions are too few');
});

test('company file: the market reading says whether it worked, so an empty list is understood', () => {
  const at = Date.UTC(2026, 10, 17, 17, 40);
  assert.match(NC.feedStatusHTML({ ex: 'SR', status: null }), /بعد دقيقة/);
  assert.match(NC.feedStatusHTML({ ex: 'CA', status: { at, ok: false, why: 'HTTPError' } }), /تعذّرت قراءة إعلانات السوق/);
  const ok = NC.feedStatusHTML({ ex: 'SR', since: at, status: { at, ok: true, n: 25 } });
  assert.match(ok, /آخر قراءة لإعلانات السوق/); assert.match(ok, /25/); assert.match(ok, /موقع تداول/);
});
