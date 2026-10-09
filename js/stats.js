// 統計計算（ブラウザ・Node 共通、外部ライブラリなし）
// 精度は tests/test.js で scipy / pandas の値と照合している
(function (root) {
  'use strict';

  // =========================================================================
  // 特殊関数
  // =========================================================================

  // 対数ガンマ関数（Lanczos 近似、相対誤差 1e-15 程度）
  const LG = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < 8; i++) a += LG[i] / (x + i + 1);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // 正則化不完全ベータ関数 I_x(a, b)（連分数展開、Lentz 法）
  function betacf(a, b, x) {
    const TINY = 1e-300;
    let c = 1, d = 1 - (a + b) * x / (a + 1);
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 1000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
    if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
    return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
  }
  // 上側 1 - I_x(a, b) を桁落ちなしで求める
  function ibetaUpper(x, a, b) {
    if (x <= 0) return 1;
    if (x >= 1) return 0;
    const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
    if (x < (a + 1) / (a + b + 2)) return 1 - Math.exp(lbt) * betacf(a, b, x) / a;
    return Math.exp(lbt) * betacf(b, a, 1 - x) / b;
  }

  // 正則化不完全ガンマ関数 P(a, x)・Q(a, x)
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let sum = 1 / a, del = sum, ap = a;
      for (let n = 0; n < 10000; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
    }
    return 1 - gammaQ(a, x);
  }
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaP(a, x);
    const TINY = 1e-300;
    let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
    for (let i = 1; i < 10000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }

  // 単調増加関数 f の f(x) = q となる x を区間 [lo, hi] の二分法で求める
  function invert(f, q, lo, hi) {
    // 上限が足りなければ広げる
    for (let i = 0; i < 200 && f(hi) < q; i++) { lo = hi; hi *= 2; }
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      if (f(mid) < q) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // =========================================================================
  // 分布
  // =========================================================================

  // 正規分布：相補誤差関数（W. J. Cody の有理近似、相対誤差 1e-16 程度）
  function erfc(x) {
    const z = Math.abs(x);
    let r;
    if (z < 0.5) {
      const t = z * z;
      const p = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
      const q = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
      let num = p[4] * t, den = t;
      for (let i = 0; i < 3; i++) { num = (num + p[i]) * t; den = (den + q[i]) * t; }
      const erf = z * (num + p[3]) / (den + q[3]);
      r = 1 - erf;
    } else if (z < 4) {
      const p = [5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02, 8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8];
      const q = [1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03, 3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03];
      let num = p[8] * z, den = z;
      for (let i = 0; i < 7; i++) { num = (num + p[i]) * z; den = (den + q[i]) * z; }
      r = (num + p[7]) / (den + q[7]);
      const zr = Math.floor(z * 16) / 16, del = (z - zr) * (z + zr);
      r *= Math.exp(-zr * zr) * Math.exp(-del);
    } else {
      const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
      const q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
      const t = 1 / (z * z);
      let num = p[5] * t, den = t;
      for (let i = 0; i < 4; i++) { num = (num + p[i]) * t; den = (den + q[i]) * t; }
      r = t * (num + p[4]) / (den + q[4]);
      r = (1 / Math.sqrt(Math.PI) - r) / z;
      const zr = Math.floor(z * 16) / 16, del = (z - zr) * (z + zr);
      r *= Math.exp(-zr * zr) * Math.exp(-del);
    }
    return x < 0 ? 2 - r : r;
  }
  const normCdf = (x, mu = 0, sd = 1) => 0.5 * erfc(-(x - mu) / (sd * Math.SQRT2));
  const normSf = (x, mu = 0, sd = 1) => 0.5 * erfc((x - mu) / (sd * Math.SQRT2));
  const normPdf = (x, mu = 0, sd = 1) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  // 正規分布の分位点（Wichura AS241 PPND16、相対誤差 1e-16 程度）
  function normPpf(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const q = p - 0.5;
    if (Math.abs(q) <= 0.425) {
      const r = 0.180625 - q * q;
      return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608) /
        (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
    }
    let r = q < 0 ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    let v;
    if (r <= 5) {
      r -= 1.6;
      v = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734) /
        (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
    } else {
      r -= 5;
      v = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772) /
        (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
    }
    return q < 0 ? -v : v;
  }

  // カイ二乗分布
  const chi2Cdf = (x, k) => gammaP(k / 2, x / 2);
  const chi2Ppf = (p, k) => invert(x => chi2Cdf(x, k), p, 0, Math.max(1, k * 2));

  // t 分布（自由度は非整数も可。Welch の検定で使う）
  function tCdf(t, df) {
    const x = df / (df + t * t);
    const tail = 0.5 * ibeta(x, df / 2, 0.5);
    return t > 0 ? 1 - tail : tail;
  }
  const tSf = (t, df) => tCdf(-t, df);
  function tPdf(t, df) {
    return Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - (df + 1) / 2 * Math.log1p(t * t / df));
  }
  function tPpf(p, df) {
    if (p === 0.5) return 0;
    if (p < 0.5) return -tPpf(1 - p, df);
    return invert(t => tCdf(t, df), p, 0, 10);
  }

  // F 分布
  const fCdf = (f, d1, d2) => f <= 0 ? 0 : ibeta(d1 * f / (d1 * f + d2), d1 / 2, d2 / 2);
  const fSf = (f, d1, d2) => f <= 0 ? 1 : ibetaUpper(d1 * f / (d1 * f + d2), d1 / 2, d2 / 2);
  function fPdf(f, d1, d2) {
    if (f <= 0) return 0;
    return Math.exp(0.5 * (d1 * Math.log(d1 * f) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * f + d2)) - Math.log(f) -
      (lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2)));
  }
  const fPpf = (p, d1, d2) => invert(f => fCdf(f, d1, d2), p, 0, 10);

  // =========================================================================
  // 記述統計
  // =========================================================================
  const sum = a => { let s = 0; for (const v of a) s += v; return s; };
  const mean = a => sum(a) / a.length;
  function variance(a, ddof = 1) {
    const m = mean(a); let s = 0;
    for (const v of a) s += (v - m) ** 2;
    return s / (a.length - ddof);
  }
  const sd = (a, ddof = 1) => Math.sqrt(variance(a, ddof));
  // 歪度・尖度（pandas の skew() / kurt() と同じ不偏推定。尖度は正規分布で 0）
  function skewness(a) {
    const n = a.length; if (n < 3) return NaN;
    const m = mean(a); let m2 = 0, m3 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    if (m2 === 0) return 0;
    return Math.sqrt(n * (n - 1)) / (n - 2) * m3 / m2 ** 1.5;
  }
  function kurtosis(a) {
    const n = a.length; if (n < 4) return NaN;
    const m = mean(a); let m2 = 0, m4 = 0;
    for (const v of a) { const d = v - m; m2 += d * d; m4 += d ** 4; }
    m2 /= n; m4 /= n;
    if (m2 === 0) return 0;
    const g2 = m4 / (m2 * m2) - 3;
    return (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * g2 + 6);
  }

  // =========================================================================
  // Shapiro-Wilk 検定（Royston 1995, AS R94。scipy.stats.shapiro と同じアルゴリズム）
  // =========================================================================
  const poly = (c, x) => { let r = c[c.length - 1]; for (let i = c.length - 2; i >= 0; i--) r = r * x + c[i]; return r; };
  function shapiro(data) {
    const x = [...data].sort((p, q) => p - q);
    const n = x.length;
    if (n < 3) return { W: NaN, p: NaN };
    const nn2 = Math.floor(n / 2);
    const a = new Array(nn2 + 1).fill(0); // 1 始まりで使う
    if (n === 3) {
      a[1] = Math.SQRT1_2;
    } else {
      const an25 = n + 0.25;
      const m = [0];
      let summ2 = 0;
      for (let i = 1; i <= nn2; i++) { m[i] = normPpf((i - 0.375) / an25); summ2 += m[i] * m[i]; }
      summ2 *= 2;
      const ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
      const a1 = poly([0, 0.221157, -0.147981, -2.071190, 4.434685, -2.706056], rsn) - m[1] / ssumm2;
      let i1, fac;
      if (n > 5) {
        i1 = 3;
        const a2 = -m[2] / ssumm2 + poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], rsn);
        fac = Math.sqrt((summ2 - 2 * m[1] ** 2 - 2 * m[2] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
        a[2] = a2;
      } else {
        i1 = 2;
        fac = Math.sqrt((summ2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2));
      }
      a[1] = a1;
      for (let i = i1; i <= nn2; i++) a[i] = -m[i] / fac;
    }
    const range = x[n - 1] - x[0];
    if (range < 1e-19) return { W: NaN, p: NaN };
    // W = (Σ a_i (x_(n+1-i) - x_(i)))^2 / Σ(x - x̄)^2
    let num = 0;
    for (let i = 1; i <= nn2; i++) num += a[i] * (x[n - i] - x[i - 1]);
    const xm = mean(x); let ssq = 0;
    for (const v of x) ssq += (v - xm) ** 2;
    let W = num * num / ssq;
    if (W > 1) W = 1;
    let p;
    if (n === 3) {
      p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(W)) - 1.04719755119660));
      return { W, p: Math.min(1, p) };
    }
    let w1 = Math.log(1 - W);
    const xx = Math.log(n);
    let mu, s;
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      if (w1 >= gamma) return { W, p: 1e-99 };
      w1 = -Math.log(gamma - w1);
      mu = poly([0.5440, -0.39978, 0.025054, -6.714e-4], n);
      s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else {
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], xx);
      s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], xx));
    }
    p = normSf((w1 - mu) / s);
    return { W, p };
  }

  // =========================================================================
  // 2群の検定・相関
  // =========================================================================
  // F 検定（大きい分散を分子、両側 p = 2 × 上側確率）
  function fTest(a, b) {
    const v1 = variance(a), v2 = variance(b);
    if (!(v1 > 0 && v2 > 0)) return null;
    const big = v1 >= v2;
    const F = big ? v1 / v2 : v2 / v1;
    const dfn = (big ? a.length : b.length) - 1, dfd = (big ? b.length : a.length) - 1;
    return { F, dfn, dfd, p: Math.min(1, 2 * fSf(F, dfn, dfd)) };
  }
  // t 検定。kind: 'paired' | 'pooled'（等分散） | 'welch'（不等分散）
  function tTest(a, b, kind) {
    let t, df;
    if (kind === 'paired') {
      const d = a.map((v, i) => v - b[i]);
      const s = sd(d);
      t = mean(d) / (s / Math.sqrt(d.length)); df = d.length - 1;
    } else {
      const n1 = a.length, n2 = b.length, v1 = variance(a), v2 = variance(b);
      if (kind === 'pooled') {
        const sp = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
        t = (mean(a) - mean(b)) / Math.sqrt(sp * (1 / n1 + 1 / n2)); df = n1 + n2 - 2;
      } else {
        const se2 = v1 / n1 + v2 / n2;
        t = (mean(a) - mean(b)) / Math.sqrt(se2);
        df = se2 * se2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
      }
    }
    return { t, df, p: Math.min(1, 2 * tSf(Math.abs(t), df)) };
  }
  // 相関係数と回帰直線（最小二乗）
  function correlation(a, b) {
    const ma = mean(a), mb = mean(b);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < a.length; i++) { const dx = a[i] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const r = sxy / Math.sqrt(sxx * syy);
    const slope = sxy / sxx;
    return { r, r2: r * r, slope, intercept: mb - slope * ma };
  }

  // =========================================================================
  // 工程能力指数（AIAG SPC マニュアルの定義）
  //   Cp / Cpk : 群内変動 σ_within（サブグループ n ≥ 2: R̄/d2、n = 1: MR̄/d2）
  //   Pp / Ppk : 全データの標準偏差 s
  //   片側規格では Cp・Pp は計算せず、Cpk・Ppk に CPU/CPL（PPU/PPL）を入れる
  // =========================================================================
  // 管理図係数（AIAG / ASTM E2587）。n: [A2, A3, D3, D4, B3, B4, c4, d2]
  const FACTORS = {
    2: [1.880, 2.659, 0.000, 3.267, 0.000, 3.267, 0.7979, 1.128],
    3: [1.023, 1.954, 0.000, 2.574, 0.000, 2.568, 0.8862, 1.693],
    4: [0.729, 1.628, 0.000, 2.282, 0.000, 2.266, 0.9213, 2.059],
    5: [0.577, 1.427, 0.000, 2.114, 0.000, 2.089, 0.9400, 2.326],
    6: [0.483, 1.287, 0.000, 2.004, 0.030, 1.970, 0.9515, 2.534],
    7: [0.419, 1.182, 0.076, 1.924, 0.118, 1.882, 0.9594, 2.704],
    8: [0.373, 1.099, 0.136, 1.864, 0.185, 1.815, 0.9650, 2.847],
    9: [0.337, 1.032, 0.184, 1.816, 0.239, 1.761, 0.9693, 2.970],
    10: [0.308, 0.975, 0.223, 1.777, 0.284, 1.716, 0.9727, 3.078],
  };
  const factor = (n, name) => FACTORS[n]['A2 A3 D3 D4 B3 B4 c4 d2'.split(' ').indexOf(name)];
  const RECOMMENDED_SUBGROUPS = 25;

  // ---- サブグループ ----
  // 連続する m 個ずつに区切る（端数は捨てる）
  function consecutiveGroups(x, m) {
    const k = Math.floor(x.length / m), groups = [];
    for (let g = 0; g < k; g++) groups.push(x.slice(g * m, (g + 1) * m));
    return { groups, left: x.length - k * m };
  }
  // サブグループから群内変動を推定する。サイズが揃っていれば R̄/d2、
  // 揃っていなければ各サブグループの R/d2(n) の平均（それぞれ σ の不偏推定なので平均も不偏）
  // 係数表のある 2〜10 個のサブグループだけを使う
  function sigmaFromGroups(groups) {
    const use = groups.filter(g => FACTORS[g.length]);
    const excluded = groups.length - use.length;
    if (use.length < 2) return { sigma: null, reason: `サイズ 2〜10 のサブグループが ${use.length} 組しかないため群内変動を推定できません（2組以上必要）`, k: use.length, excluded };
    let s = 0;
    for (const g of use) s += (Math.max(...g) - Math.min(...g)) / factor(g.length, 'd2');
    const sizes = use.map(g => g.length), lo = Math.min(...sizes), hi = Math.max(...sizes);
    return { sigma: s / use.length, method: lo === hi ? `R̄/d2（n=${lo}）` : `R/d2 の平均（n=${lo}〜${hi}）`, k: use.length, excluded };
  }
  function sigmaWithin(x, m) {
    if (m === 1) {
      if (x.length < 2) return { sigma: null, reason: 'データが2点未満のため移動範囲を計算できません', k: 0 };
      let s = 0;
      for (let i = 1; i < x.length; i++) s += Math.abs(x[i] - x[i - 1]);
      return { sigma: s / (x.length - 1) / factor(2, 'd2'), method: 'MR̄/d2（移動範囲 n=2）', k: x.length - 1 };
    }
    if (!FACTORS[m]) return { sigma: null, reason: `サブグループサイズ ${m} の係数がありません`, k: 0 };
    const { groups } = consecutiveGroups(x, m);
    if (groups.length < 2) return { sigma: null, reason: `完全なサブグループが ${groups.length} 組しかないため群内変動を推定できません（2組以上必要）`, k: groups.length };
    return sigmaFromGroups(groups);
  }
  function indices(mu, sigma, usl, lsl) {
    if (!(sigma > 0)) return [null, null, null, null];
    const up = usl != null ? (usl - mu) / (3 * sigma) : null;
    const lo = lsl != null ? (mu - lsl) / (3 * sigma) : null;
    if (usl != null && lsl != null) return [(usl - lsl) / (6 * sigma), Math.min(up, lo), up, lo];
    return [null, up != null ? up : lo, up, lo];
  }
  // Cp・Pp の信頼区間（カイ二乗、自由度 n-1）
  function cpCI(c, n, alpha = 0.05) {
    if (n < 2 || c == null) return [null, null];
    const df = n - 1;
    return [c * Math.sqrt(chi2Ppf(alpha / 2, df) / df), c * Math.sqrt(chi2Ppf(1 - alpha / 2, df) / df)];
  }
  // Cpk・Ppk の信頼区間（Bissell 1990 の近似）
  function cpkCI(c, n, alpha = 0.05) {
    if (n < 2 || c == null || c === 0) return [null, null];
    const z = normPpf(1 - alpha / 2);
    const se = Math.sqrt(1 / (9 * n * c * c) + 1 / (2 * (n - 1)));
    const a = c * (1 - z * se), b = c * (1 + z * se);
    return [Math.min(a, b), Math.max(a, b)];
  }
  // 必要なデータ数の目安：Ppk の推定値が c のとき、信頼区間（両側 1−alpha、Bissell の近似）の下限が
  // target 以上になる最小の n。c が target 以下なら、データを増やしても届かないので null
  function requiredN(c, target, alpha = 0.05, nMax = 1e6) {
    if (!(c > target) || !(c > 0)) return null;
    const lower = n => cpkCI(c, n, alpha)[0];
    if (lower(2) >= target) return 2;
    // 下限は n とともに単調に増えるので二分法で探す
    let lo = 2, hi = 4;
    while (lower(hi) < target) { lo = hi; hi *= 2; if (hi > nMax) return null; }
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (lower(mid) >= target) hi = mid; else lo = mid; }
    return hi;
  }
  // 規格外れの割合（ppm）。正規分布を仮定した推定値
  function expectedPpm(mu, sigma, usl, lsl) {
    if (!(sigma > 0)) return null;
    const upper = usl != null ? normSf((usl - mu) / sigma) * 1e6 : null;
    const lower = lsl != null ? normCdf((lsl - mu) / sigma) * 1e6 : null;
    return { upper, lower, total: (upper || 0) + (lower || 0) };
  }
  // 実際に規格を外れた個数と ppm
  function observedOut(x, usl, lsl) {
    const upper = usl != null ? x.filter(v => v > usl).length : null;
    const lower = lsl != null ? x.filter(v => v < lsl).length : null;
    return { upper, lower, total: (upper || 0) + (lower || 0), ppm: ((upper || 0) + (lower || 0)) / x.length * 1e6 };
  }
  // groups を渡すとそのサブグループで群内変動を推定する（列の値でサブグループを分けるとき）。x は全データ
  function capability(x, usl, lsl, m, ddof = 1, alpha = 0.05, groups = null) {
    const n = x.length, notes = [];
    const mu = mean(x), s = sd(x, ddof);
    const w = groups ? sigmaFromGroups(groups) : sigmaWithin(x, m);
    let sw = w.sigma;
    if (sw == null) notes.push(`Cp/Cpk を計算できません: ${w.reason}`);
    else {
      if (groups) {
        if (w.excluded) notes.push(`サイズが 2〜10 でないサブグループ ${w.excluded} 組は σ(群内) の推定から除外しました`);
        if (w.k < RECOMMENDED_SUBGROUPS) notes.push(`サブグループ数が ${w.k} 組です（工程能力の調査では ${RECOMMENDED_SUBGROUPS} 組程度が目安）`);
      } else if (m >= 2) {
        const left = n - w.k * m;
        if (left) notes.push(`サブグループに満たない末尾 ${left} 点は σ(群内) の推定から除外しました`);
        if (w.k < RECOMMENDED_SUBGROUPS) notes.push(`サブグループ数が ${w.k} 組です（工程能力の調査では ${RECOMMENDED_SUBGROUPS} 組程度が目安）`);
      } else if (n - 1 < RECOMMENDED_SUBGROUPS) notes.push(`移動範囲が ${n - 1} 個です（${RECOMMENDED_SUBGROUPS} 個程度が目安）`);
      if (sw === 0) { notes.push('σ(群内) が 0 のため Cp/Cpk を計算できません'); sw = null; }
    }
    const [Cp, Cpk, Cpu, Cpl] = indices(mu, sw, usl, lsl);
    const [Pp, Ppk, Ppu, Ppl] = indices(mu, s, usl, lsl);
    if (Cpk != null && Ppk != null && Ppk > 0 && Cpk / Ppk > 1.33)
      notes.push('Cpk が Ppk を大きく上回っています。サブグループ間の変動（平均のずれ・ドリフト）が大きく、工程が統計的管理状態にない可能性があります。管理図を確認してください');
    return {
      n, mean: mu, sigmaWithin: sw, sigmaWithinMethod: sw != null ? w.method : null, subgroups: w.k, sigmaOverall: s,
      Cp, Cpk, Cpu, Cpl, Pp, Ppk, Ppu, Ppl, PpCI: cpCI(Pp, n, alpha), PpkCI: cpkCI(Ppk, n, alpha),
      ppmWithin: expectedPpm(mu, sw, usl, lsl), ppmOverall: expectedPpm(mu, s, usl, lsl), observed: observedOut(x, usl, lsl), notes,
    };
  }

  // ---- 管理図 ----
  // 戻り値の各図は { points, start, cl, ucl, lcl, sigma }。cl・ucl・lcl・sigma は点ごとの配列（サイズが揃わないとき管理限界が点ごとに変わる）
  // sigma は打点する統計量の標準偏差（異常判定ルールの領域 A/B/C に使う）
  const fill = (n, v) => new Array(n).fill(v);
  function controlCharts(x, m, groupsIn = null) {
    if (!groupsIn && m === 1) {
      if (x.length < 2) return null;
      const mr = []; for (let i = 1; i < x.length; i++) mr.push(Math.abs(x[i] - x[i - 1]));
      const cl = mean(x), mrBar = mean(mr), sig = mrBar / factor(2, 'd2');
      return {
        type: 'I-MR',
        main: { points: x, start: 1, cl: fill(x.length, cl), ucl: fill(x.length, cl + 3 * sig), lcl: fill(x.length, cl - 3 * sig), sigma: fill(x.length, sig) },
        range: { points: mr, start: 2, cl: fill(mr.length, mrBar), ucl: fill(mr.length, mrBar * factor(2, 'D4')), lcl: fill(mr.length, 0) },
      };
    }
    const all = groupsIn || consecutiveGroups(x, m).groups;
    const idx = [], groups = [];
    all.forEach((g, i) => { if (FACTORS[g.length]) { groups.push(g); idx.push(i); } });
    if (!groups.length) return null;
    const ns = groups.map(g => g.length);
    const f = name => ns.map(n => factor(n, name));
    const d2 = f('d2'), c4 = f('c4');
    const ranges = groups.map(g => Math.max(...g) - Math.min(...g)), sds = groups.map(g => sd(g));
    // サイズが揃っていれば σR = R̄/d2、σS = s̄/c4 になり、通常の X̄-R・s 管理図と同じ管理限界になる
    const sigR = mean(ranges.map((r, i) => r / d2[i])), sigS = mean(sds.map((s, i) => s / c4[i]));
    const xbb = mean(groups.flat());
    const A2 = f('A2'), D3 = f('D3'), D4 = f('D4'), B3 = f('B3'), B4 = f('B4');
    return {
      type: 'Xbar-R', k: groups.length, groupIndex: idx, sizes: ns,
      main: { points: groups.map(mean), start: 1, cl: fill(groups.length, xbb), ucl: A2.map((a, i) => xbb + a * d2[i] * sigR), lcl: A2.map((a, i) => xbb - a * d2[i] * sigR), sigma: A2.map((a, i) => a * d2[i] * sigR / 3) },
      range: { points: ranges, start: 1, cl: d2.map(d => d * sigR), ucl: D4.map((v, i) => v * d2[i] * sigR), lcl: D3.map((v, i) => v * d2[i] * sigR) },
      s: { points: sds, start: 1, cl: c4.map(c => c * sigS), ucl: B4.map((v, i) => v * c4[i] * sigS), lcl: B3.map((v, i) => v * c4[i] * sigS) },
    };
  }

  // 管理図の異常判定ルール（JIS Z 9020-2 / ISO 7870-2 の 8 つのルール。Nelson のルールと同じ）
  // z = (点 − 中心線) / σ。領域 C: |z| < 1、B: 1〜2、A: 2〜3
  const RULES = {
    1: '管理限界の外（領域 A を超える）',
    2: '連続 9 点が中心線の片側',
    3: '連続 6 点が増加または減少',
    4: '連続 14 点が交互に増減',
    5: '連続 3 点中 2 点が領域 A 以上（同じ側）',
    6: '連続 5 点中 4 点が領域 B 以上（同じ側）',
    7: '連続 15 点が領域 C（中心線 ±1σ 以内）',
    8: '連続 8 点が領域 C の外（両側）',
  };
  // 戻り値: [{ rule, from, to, points: [番号...] }]（番号は 0 始まり。連続して当てはまる検出は 1 件にまとめる）
  function runRules(c, rules = [1, 2, 3, 4, 5, 6, 7, 8]) {
    const p = c.points, n = p.length;
    const z = p.map((v, i) => (v - c.cl[i]) / c.sigma[i]);
    const hits = {}; // rule -> Set(該当する点)
    const mark = (r, from, to) => { (hits[r] = hits[r] || []).push([from, to]); };
    const want = new Set(rules);
    for (let i = 0; i < n; i++) {
      if (want.has(1) && (p[i] > c.ucl[i] + 1e-12 || p[i] < c.lcl[i] - 1e-12)) mark(1, i, i);
      const win = (len, test) => i >= len - 1 && test(i - len + 1);
      if (want.has(2) && win(9, s => z.slice(s, i + 1).every(v => v > 0) || z.slice(s, i + 1).every(v => v < 0))) mark(2, i - 8, i);
      if (want.has(3) && win(6, s => { const d = []; for (let j = s + 1; j <= i; j++) d.push(p[j] - p[j - 1]); return d.every(v => v > 0) || d.every(v => v < 0); })) mark(3, i - 5, i);
      if (want.has(4) && win(14, s => { for (let j = s + 2; j <= i; j++) { const a = p[j - 1] - p[j - 2], b = p[j] - p[j - 1]; if (!(a * b < 0)) return false; } return true; })) mark(4, i - 13, i);
      if (want.has(5) && win(3, s => [1, -1].some(sg => z.slice(s, i + 1).filter(v => v * sg > 2).length >= 2))) mark(5, i - 2, i);
      if (want.has(6) && win(5, s => [1, -1].some(sg => z.slice(s, i + 1).filter(v => v * sg > 1).length >= 4))) mark(6, i - 4, i);
      if (want.has(7) && win(15, s => z.slice(s, i + 1).every(v => Math.abs(v) < 1))) mark(7, i - 14, i);
      if (want.has(8) && win(8, s => z.slice(s, i + 1).every(v => Math.abs(v) > 1))) mark(8, i - 7, i);
    }
    const out = [];
    for (const r of Object.keys(hits).map(Number).sort((a, b) => a - b)) {
      // 重なる検出をまとめる（ルール 1 は隣り合う点もまとめる）
      // ends はルールが成立した点（並びの最後の点）。図ではこの点に印を付ける
      const spans = hits[r].sort((a, b) => a[0] - b[0]), merged = [];
      for (const s of spans) { const last = merged[merged.length - 1]; if (last && s[0] <= last[1] + (r === 1 ? 1 : 0)) { last[1] = Math.max(last[1], s[1]); last[2].push(s[1]); } else merged.push([s[0], s[1], [s[1]]]); }
      for (const [from, to, ends] of merged) out.push({ rule: r, text: RULES[r], from, to, ends });
    }
    return out;
  }

  const api = {
    lgamma, ibeta, gammaP, gammaQ, erfc, normCdf, normSf, normPdf, normPpf, chi2Cdf, chi2Ppf,
    tCdf, tSf, tPdf, tPpf, fCdf, fSf, fPdf, fPpf,
    sum, mean, variance, sd, skewness, kurtosis, shapiro, fTest, tTest, correlation,
    FACTORS, factor, sigmaWithin, sigmaFromGroups, consecutiveGroups, capability, controlCharts, cpCI, cpkCI, requiredN, expectedPpm, observedOut, runRules, RULES, RECOMMENDED_SUBGROUPS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CpkStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
