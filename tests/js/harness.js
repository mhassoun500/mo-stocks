/* Loads the page's own script files (core, indicators, engine, plan) into a sandbox with a fake DOM,
   so the analysis engine can be tested without a browser. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
function stub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'textContent' || k === 'innerHTML' || k === 'value') return '{}';
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}
function load(files = ['core', 'indicators', 'engine', 'plan']) {
  const s = stub();
  const store = {};
  const ctx = {
    console, Math, JSON, Date, Intl, Set, Map, Array, Object, Number, String, RegExp, Promise, Symbol, Error, TypeError, SyntaxError,
    isFinite, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, URLSearchParams, setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: s, navigator: { language: 'ar', clipboard: s }, location: { hash: '', reload() {} }, innerWidth: 1400, innerHeight: 900,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener() {}, fetch: () => Promise.reject(new Error('no network in tests')), devicePixelRatio: 1, getComputedStyle: () => s,
    MutationObserver: function () { return { observe() {}, disconnect() {} }; }, Blob: function () {}, TextDecoder, TextEncoder,
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  let src = (files.includes('views') ? '' : 'const S={};\n') + files.map(n => fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', n + '.js'), 'utf8')).join('\n');
  /* expose the functions the tests need (they are top-level declarations inside the page's closure) */
  src += '\n;globalThis.__T={rowsToData,computeInd,aggregateWeekly,analyzeCore,runBacktest,blendConfidence,fairValue,mdLite,fp,pct,P,S};';
  vm.runInContext(src, ctx, { filename: 'page.js' });
  return ctx.__T;
}
function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name + '.json'), 'utf8'));
}
module.exports = { load, fixture };
