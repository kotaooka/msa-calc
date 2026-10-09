// 測定システム解析（MSA）の計算。AIAG MSA 参照マニュアル第4版の手順に沿う（Type-1 は第4版の範囲外で、一般的な式）
// ブラウザでは window.MsaCalc、Node では require('./msa.js') で使う。分布関数は stats.js（CpkStats）を使う
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? require('./stats.js') : root.CpkStats;
  const { mean, sd, tPpf, tSf, fSf, ibeta, normPpf, controlCharts, runRules } = S;
  const sum = a => a.reduce((s, v) => s + v, 0);
  const sq = v => v * v;

  // ---- 範囲の分布から求める係数 ----
  // m 個の標準正規乱数の範囲 W について E[W]（= d2）と E[W²] を数値積分で求める。
  // d2* (サブグループ 1 組) = √E[W²] = √(d2² + d3²)。AIAG の K2・K3 は 1/d2*(g=1)、K1 は 1/d2
  const H = 0.02, X0 = -10, NX = 1000; // x は −10〜10 を 0.02 刻み（シンプソン則）
  let PHI = null, PDF = null;
  function grid() {
    if (PHI) return;
    // Φ は x+w が格子に乗るよう、−10〜+30 まで用意する
    const n = 2 * NX + 1;
    PHI = new Float64Array(n); PDF = new Float64Array(n);
    for (let i = 0; i < n; i++) { const x = X0 + i * H; PHI[i] = S.normCdf(x); PDF[i] = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }
  }
  const simpW = (i, n) => (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2);
  const rangeCache = {};
  function rangeMoments(m) {
    if (!(m >= 2 && Number.isInteger(m))) throw new Error('範囲の係数は 2 個以上で求めます');
    if (rangeCache[m]) return rangeCache[m];
    grid();
    // E[W] = ∫ 1 − Φ^m − (1−Φ)^m dx
    let ew = 0;
    for (let i = 0; i <= NX; i++) ew += simpW(i, NX) * (1 - PHI[i] ** m - (1 - PHI[i]) ** m);
    ew *= H / 3;
    // P(W ≤ w) = m ∫ φ(x) [Φ(x+w) − Φ(x)]^(m−1) dx、E[W²] = ∫ 2w (1 − P(W ≤ w)) dw（w は 0〜20）
    let ew2 = 0;
    const NW = NX;
    for (let j = 0; j <= NW; j++) {
      let F = 0;
      for (let i = 0; i <= NX; i++) F += simpW(i, NX) * PDF[i] * (PHI[i + j] - PHI[i]) ** (m - 1);
      F *= m * H / 3;
      ew2 += simpW(j, NW) * 2 * (j * H) * (1 - F);
    }
    ew2 *= H / 3;
    return (rangeCache[m] = { d2: ew, d3: Math.sqrt(ew2 - ew * ew), d2star1: Math.sqrt(ew2) });
  }
  const d2 = m => rangeMoments(m).d2;
  const d3 = m => rangeMoments(m).d3;
  const K1 = trials => 1 / d2(trials);
  const K2 = appraisers => 1 / rangeMoments(appraisers).d2star1;
  const K3 = parts => 1 / rangeMoments(parts).d2star1;
  // AIAG マニュアルの係数表（4 桁に丸めた値）。opt.tableK のとき、表にある組み合わせだけこの値を使う
  const K_TABLE = {
    K1: { 2: 0.8862, 3: 0.5908 },
    K2: { 2: 0.7071, 3: 0.5231 },
    K3: { 2: 0.7071, 3: 0.5231, 4: 0.4467, 5: 0.4030, 6: 0.3742, 7: 0.3534, 8: 0.3375, 9: 0.3249, 10: 0.3146 },
  };

  // ---- 入力の確認 ----
  // data[測定者][回][部品]。全セルに数値がある釣り合い型（クロス）の計画だけ扱う
  function shapeOf(data) {
    const k = data.length, r = k ? data[0].length : 0, n = r ? data[0][0].length : 0;
    if (k < 2) throw new Error('測定者は 2 人以上必要です');
    if (r < 2) throw new Error('繰り返し（回数）は 2 回以上必要です');
    if (n < 2) throw new Error('部品は 2 個以上必要です');
    for (let a = 0; a < k; a++) {
      if (data[a].length !== r) throw new Error('測定者ごとの回数がそろっていません');
      for (let t = 0; t < r; t++) {
        if (data[a][t].length !== n) throw new Error('部品数がそろっていません');
        for (let p = 0; p < n; p++) if (!Number.isFinite(data[a][t][p])) throw new Error(`測定者${a + 1}・${t + 1}回目・部品${p + 1} の値がありません（全セルの入力が必要です）`);
      }
    }
    return { k, r, n };
  }

  // ---- 変動の比率と ndc（両方式で共通） ----
  // comp: { EV, AV, IA, PV }（いずれも標準偏差）。opt.tol: 公差幅、opt.sigmaProcess: 既知の工程の標準偏差
  function ratios(comp, opt = {}) {
    const IA = comp.IA || 0;
    const GRR = Math.sqrt(sq(comp.EV) + sq(comp.AV) + sq(IA));
    let PV = comp.PV, TV = Math.sqrt(sq(GRR) + sq(PV)), tvSource = 'study';
    const notes = [];
    if (opt.sigmaProcess > 0) {
      // 既知の工程変動を全変動として使う（AIAG：TV = 工程の σ、PV = √(TV² − GRR²)）
      TV = opt.sigmaProcess; tvSource = 'process';
      if (GRR >= TV) { PV = 0; notes.push('GRR が入力した工程の標準偏差以上のため、部品変動を 0 としました'); }
      else PV = Math.sqrt(sq(TV) - sq(GRR));
    }
    const pct = v => TV > 0 ? 100 * v / TV : null;
    const tolPct = v => opt.tol > 0 ? 100 * 6 * v / opt.tol : null;
    const contrib = v => TV > 0 ? 100 * sq(v) / sq(TV) : null;
    const row = (name, v) => ({ name, sd: v, sv: 6 * v, pctTV: pct(v), pctTol: tolPct(v), pctContrib: contrib(v) });
    const rows = [row('EV', comp.EV), row('AV', comp.AV)];
    if (comp.IA != null) rows.push(row('IA', IA));
    rows.push(row('GRR', GRR), row('PV', PV), row('TV', TV));
    // ndc = 1.41 × PV / GRR を切り捨て（1 未満は 1）
    const ndcRaw = GRR > 0 ? 1.41 * PV / GRR : Infinity;
    const ndc = Number.isFinite(ndcRaw) ? Math.max(1, Math.floor(ndcRaw + 1e-9)) : null;
    return { EV: comp.EV, AV: comp.AV, IA: comp.IA, GRR, PV, TV, tvSource, rows, pctGRR: pct(GRR), pctTolGRR: tolPct(GRR), ndc, ndcRaw, notes };
  }

  // AIAG の判定区分：10% 未満は合格、10〜30% は条件付き、30% 超は不合格
  function judgePct(p) { if (p == null) return null; return p < 10 ? 'ok' : p <= 30 ? 'cond' : 'ng'; }

  // ---- 平均・範囲法 ----
  function grrAvgRange(data, opt = {}) {
    const { k, r, n } = shapeOf(data);
    const cell = (a, p) => data[a].map(tr => tr[p]);
    // 測定者ごとの各部品の範囲と平均
    const ranges = data.map((_, a) => Array.from({ length: n }, (_, p) => { const v = cell(a, p); return Math.max(...v) - Math.min(...v); }));
    const cellMean = data.map((_, a) => Array.from({ length: n }, (_, p) => mean(cell(a, p))));
    const Rbar = ranges.map(mean), Rbb = mean(Rbar);
    const Xbar = cellMean.map(mean);
    const Xdiff = Math.max(...Xbar) - Math.min(...Xbar);
    const partMean = Array.from({ length: n }, (_, p) => mean(cellMean.map(c => c[p])));
    const Rp = Math.max(...partMean) - Math.min(...partMean);
    const tk = (name, m, f) => opt.tableK && K_TABLE[name][m] != null ? K_TABLE[name][m] : f(m);
    const k1 = tk('K1', r, K1), k2 = tk('K2', k, K2), k3 = tk('K3', n, K3);
    const EV = Rbb * k1;
    const av2 = sq(Xdiff * k2) - sq(EV) / (n * r);
    const AV = av2 > 0 ? Math.sqrt(av2) : 0;
    const PV = Rp * k3;
    const res = ratios({ EV, AV, PV }, opt);
    // 範囲の管理図：UCL = D4 × R̿（D3 は回数 6 以下で 0）
    const D4 = 1 + 3 * d3(r) / d2(r), D3 = Math.max(0, 1 - 3 * d3(r) / d2(r));
    const uclR = D4 * Rbb, lclR = D3 * Rbb;
    const outR = [];
    ranges.forEach((rs, a) => rs.forEach((v, p) => { if (v > uclR + 1e-12) outR.push({ appraiser: a, part: p, value: v }); }));
    // 平均の管理図：X̿ ± A2 R̿（A2 = 3 / (d2 √r)）。部品のばらつきが分かるよう、限界の外に出る点が多いほどよい
    const Xbb = mean(Xbar), A2 = 3 / (d2(r) * Math.sqrt(r));
    const uclX = Xbb + A2 * Rbb, lclX = Xbb - A2 * Rbb;
    const outside = cellMean.flat().filter(v => v > uclX || v < lclX).length;
    if (av2 < 0) res.notes.push('AV の根号の中が負になったため AV = 0 としました');
    if (outR.length) res.notes.push(`範囲が管理限界（${fmt(uclR)}）を超えた点が ${outR.length} 個あります。その測定を見直すか、測り直してから解析してください`);
    const fracOut = outside / (k * n);
    if (fracOut < 0.5) res.notes.push(`平均の管理図で管理限界の外にある点が ${outside}/${k * n} 個（${Math.round(fracOut * 100)}%）です。半分以上が外にあるのが望ましく、部品のばらつきが小さすぎるか測定のばらつきが大きすぎる可能性があります`);
    return Object.assign(res, {
      method: 'avgRange', k, r, n, K1: k1, K2: k2, K3: k3, Rbar, Rbb, Xbar, Xdiff, Rp, partMean, cellMean, ranges,
      rChart: { ucl: uclR, lcl: lclR, cl: Rbb, out: outR, D4, D3 }, xChart: { cl: Xbb, ucl: uclX, lcl: lclX, outside, total: k * n, A2 },
    });
  }

  // ---- 分散分析（ANOVA）法 ----
  // 二元配置（部品 × 測定者、交互作用あり）。opt.alphaInteraction（既定 0.05）で交互作用が有意でなければ誤差にプールする。
  // opt.keepInteraction が true なら常に交互作用を残す
  function grrAnova(data, opt = {}) {
    const { k, r, n } = shapeOf(data);
    const N = k * r * n;
    const all = data.flat(2), gm = mean(all);
    const cellMean = data.map(at => Array.from({ length: n }, (_, p) => mean(at.map(tr => tr[p]))));
    const aMean = data.map(at => mean(at.flat()));
    const pMean = Array.from({ length: n }, (_, p) => mean(data.map(at => at.map(tr => tr[p])).flat()));
    const SSP = k * r * sum(pMean.map(v => sq(v - gm)));
    const SSA = n * r * sum(aMean.map(v => sq(v - gm)));
    let SSAP = 0;
    for (let a = 0; a < k; a++) for (let p = 0; p < n; p++) SSAP += sq(cellMean[a][p] - aMean[a] - pMean[p] + gm);
    SSAP *= r;
    let SSE = 0;
    for (let a = 0; a < k; a++) for (let t = 0; t < r; t++) for (let p = 0; p < n; p++) SSE += sq(data[a][t][p] - cellMean[a][p]);
    const SST = sum(all.map(v => sq(v - gm)));
    const dfP = n - 1, dfA = k - 1, dfAP = (n - 1) * (k - 1), dfE = n * k * (r - 1), dfT = N - 1;
    const MSP = SSP / dfP, MSA = SSA / dfA, MSAP = SSAP / dfAP, MSE = SSE / dfE;
    const alphaI = opt.alphaInteraction != null ? opt.alphaInteraction : 0.05;
    // MSE が 0（繰り返しの差がまったくない）ときは F を計算できない
    const FAP = MSE > 0 ? MSAP / MSE : (MSAP > 0 ? Infinity : null);
    const pAP = FAP == null ? null : FAP === Infinity ? 0 : fSf(FAP, dfAP, dfE);
    const pooled = !opt.keepInteraction && pAP != null && pAP > alphaI;
    const table = [];
    let EV2, AV2, IA2, PV2;
    if (!pooled) {
      const FP = MSAP > 0 ? MSP / MSAP : null, FA = MSAP > 0 ? MSA / MSAP : null;
      table.push({ source: '部品', df: dfP, ss: SSP, ms: MSP, F: FP, p: FP != null ? fSf(FP, dfP, dfAP) : null });
      table.push({ source: '測定者', df: dfA, ss: SSA, ms: MSA, F: FA, p: FA != null ? fSf(FA, dfA, dfAP) : null });
      table.push({ source: '部品×測定者', df: dfAP, ss: SSAP, ms: MSAP, F: FAP, p: pAP });
      table.push({ source: '繰り返し（誤差）', df: dfE, ss: SSE, ms: MSE, F: null, p: null });
      EV2 = MSE;
      IA2 = Math.max(0, (MSAP - MSE) / r);
      AV2 = Math.max(0, (MSA - MSAP) / (n * r));
      PV2 = Math.max(0, (MSP - MSAP) / (k * r));
    } else {
      const dfPool = dfAP + dfE, MSPool = (SSAP + SSE) / dfPool;
      const FP = MSPool > 0 ? MSP / MSPool : null, FA = MSPool > 0 ? MSA / MSPool : null;
      table.push({ source: '部品', df: dfP, ss: SSP, ms: MSP, F: FP, p: FP != null ? fSf(FP, dfP, dfPool) : null });
      table.push({ source: '測定者', df: dfA, ss: SSA, ms: MSA, F: FA, p: FA != null ? fSf(FA, dfA, dfPool) : null });
      table.push({ source: '繰り返し（交互作用をプール）', df: dfPool, ss: SSAP + SSE, ms: MSPool, F: null, p: null });
      EV2 = MSPool;
      IA2 = null;
      AV2 = Math.max(0, (MSA - MSPool) / (n * r));
      PV2 = Math.max(0, (MSP - MSPool) / (k * r));
    }
    table.push({ source: '合計', df: dfT, ss: SST, ms: null, F: null, p: null });
    const res = ratios({ EV: Math.sqrt(EV2), AV: Math.sqrt(AV2), IA: IA2 == null ? null : Math.sqrt(IA2), PV: Math.sqrt(PV2) }, opt);
    res.notes.push(pooled
      ? `部品×測定者の交互作用は有意でない（p = ${fmt(pAP, 3)} > ${alphaI}）ため、誤差にプールしました`
      : opt.keepInteraction ? '設定により交互作用を残して計算しました' : `部品×測定者の交互作用が有意です（p = ${fmt(pAP, 3)} ≤ ${alphaI}）。測定者によって部品ごとの測り方に差があります`);
    return Object.assign(res, {
      method: 'anova', k, r, n, table, pooled, pInteraction: pAP, alphaInteraction: alphaI,
      varComp: { EV: EV2, AV: AV2, IA: IA2, PV: PV2 }, cellMean, aMean, pMean, grandMean: gm,
    });
  }

  // ---- 偏り（独立サンプル法） ----
  // x: 基準部品を繰り返し測った値、ref: 基準値。opt.alpha（既定 0.05）、opt.tol、opt.tv（全変動の標準偏差、任意）
  function bias(x, ref, opt = {}) {
    const n = x.length;
    if (n < 2) throw new Error('測定値は 2 個以上必要です');
    if (!Number.isFinite(ref)) throw new Error('基準値を入力してください');
    const alpha = opt.alpha != null ? opt.alpha : 0.05;
    const xb = mean(x), b = xb - ref, sr = sd(x), sb = sr / Math.sqrt(n), df = n - 1;
    const t = sb > 0 ? b / sb : (b === 0 ? 0 : Infinity);
    const p = sb > 0 ? 2 * tSf(Math.abs(t), df) : (b === 0 ? 1 : 0);
    const tc = tPpf(1 - alpha / 2, df);
    const ci = [b - tc * sb, b + tc * sb];
    const acceptable = ci[0] <= 0 && 0 <= ci[1];
    const notes = [];
    if (n < 10) notes.push(`測定回数が ${n} 回です（10 回以上が推奨）`);
    return {
      n, mean: xb, ref, bias: b, sigmaR: sr, sigmaB: sb, t, df, p, alpha, tCrit: tc, ci, acceptable,
      pctBiasTol: opt.tol > 0 ? 100 * Math.abs(b) / opt.tol : null,
      pctBiasTV: opt.tv > 0 ? 100 * Math.abs(b) / (6 * opt.tv) : null,
      pctEVTol: opt.tol > 0 ? 100 * 6 * sr / opt.tol : null, notes,
    };
  }

  // ---- 直線性 ----
  // parts: [{ ref, x: [...] }]。偏り（測定値 − 基準値）を基準値に回帰し、回帰直線の信頼帯に「偏り = 0」の線が収まるかを見る
  function linearity(parts, opt = {}) {
    const g = parts.length;
    if (g < 2) throw new Error('基準値の異なる部品が 2 個以上必要です');
    const alpha = opt.alpha != null ? opt.alpha : 0.05;
    const xs = [], ys = [];
    for (const pt of parts) {
      if (!Number.isFinite(pt.ref)) throw new Error('基準値がない部品があります');
      for (const v of pt.x) { xs.push(pt.ref); ys.push(v - pt.ref); }
    }
    const N = xs.length;
    if (N < 3) throw new Error('測定値が少なすぎます');
    const xb = mean(xs), yb = mean(ys);
    const Sxx = sum(xs.map(v => sq(v - xb)));
    if (!(Sxx > 0)) throw new Error('基準値がすべて同じため回帰できません');
    const Sxy = sum(xs.map((v, i) => (v - xb) * (ys[i] - yb)));
    const a = Sxy / Sxx, b = yb - a * xb;
    const resid = ys.map((y, i) => y - (b + a * xs[i]));
    const df = N - 2, s = Math.sqrt(sum(resid.map(sq)) / df);
    const Syy = sum(ys.map(v => sq(v - yb)));
    const R2 = Syy > 0 ? 1 - sum(resid.map(sq)) / Syy : null;
    const tc = tPpf(1 - alpha / 2, df);
    const seA = s / Math.sqrt(Sxx), seB = s * Math.sqrt(1 / N + sq(xb) / Sxx);
    const tA = seA > 0 ? Math.abs(a) / seA : Infinity, tB = seB > 0 ? Math.abs(b) / seB : Infinity;
    const pA = seA > 0 ? 2 * tSf(tA, df) : 0, pB = seB > 0 ? 2 * tSf(tB, df) : 0;
    // 信頼帯：b + a x0 ± t × √(1/N + (x0 − x̄)²/Sxx) × s
    const band = x0 => { const c = b + a * x0, h = tc * Math.sqrt(1 / N + sq(x0 - xb) / Sxx) * s; return [c - h, c + h]; };
    const refs = parts.map(pt => pt.ref);
    const lo = Math.min(...refs), hi = Math.max(...refs);
    // 帯の上下は x0 の 2 次式の平方根なので、両端と中で確認すれば足りるが、念のため細かく調べる
    let zeroInside = true;
    for (let i = 0; i <= 200; i++) { const [l, u] = band(lo + (hi - lo) * i / 200); if (l > 0 || u < 0) { zeroInside = false; break; } }
    const perPart = parts.map(pt => {
      const bs = pt.x.map(v => v - pt.ref), bb = mean(bs);
      const sp = bs.length > 1 ? sd(bs) : null;
      const tp = sp > 0 ? bb / (sp / Math.sqrt(bs.length)) : null;
      return { ref: pt.ref, n: bs.length, bias: bb, sd: sp, t: tp, p: tp != null ? 2 * tSf(Math.abs(tp), bs.length - 1) : null };
    });
    const notes = [];
    if (g < 5) notes.push(`部品が ${g} 個です（5 個以上が推奨）`);
    if (parts.some(pt => pt.x.length < 10)) notes.push('測定回数が 10 回未満の部品があります（各 10 回以上が推奨）');
    return {
      g, N, slope: a, intercept: b, s, R2, df, tCrit: tc, seSlope: seA, seIntercept: seB, tSlope: tA, tIntercept: tB, pSlope: pA, pIntercept: pB,
      slopeOk: tA <= tc, interceptOk: tB <= tc, zeroInside, acceptable: zeroInside, band, range: [lo, hi], points: xs.map((x, i) => [x, ys[i]]), perPart,
      pctLinearity: opt.tv > 0 ? 100 * Math.abs(a) : null, linearity: opt.tv > 0 ? Math.abs(a) * 6 * opt.tv : null, notes,
    };
  }

  // ---- 安定性 ----
  // 基準部品を定期的に測った値の並び x を、サブグループサイズ m で管理図にする（m = 1 なら I-MR）
  function stability(x, m, ref, opt = {}) {
    if (x.length < 2) throw new Error('測定値は 2 個以上必要です');
    if (!(m >= 1 && m <= 10)) throw new Error('サブグループサイズは 1〜10 にしてください');
    const c = controlCharts(x, m);
    if (!c) throw new Error('管理図を作れません（データが少なすぎます）');
    const rules = opt.rules || [1, 2, 3, 4, 5, 6, 7, 8];
    const mainHits = runRules(c.main, rules);
    // 範囲（移動範囲）の図は管理限界の外だけを見る
    const rangeOut = [];
    c.range.points.forEach((v, i) => { if (v > c.range.ucl[i] + 1e-12 || v < c.range.lcl[i] - 1e-12) rangeOut.push(i); });
    const used = m === 1 ? x : x.slice(0, c.main.points.length * m);
    const sigma = m === 1 ? c.main.sigma[0] : c.range.cl[0] / d2(m);
    const notes = [];
    const nSub = c.main.points.length;
    if (nSub < 20) notes.push(`${m === 1 ? '測定点' : 'サブグループ'}が ${nSub} 個です（20〜25 個程度が目安）`);
    if (m > 1 && x.length % m) notes.push(`サブグループに満たない末尾 ${x.length % m} 点は除外しました`);
    const xb = mean(used);
    return {
      chart: c, m, mainHits, rangeOut, stable: mainHits.length === 0 && rangeOut.length === 0,
      mean: xb, bias: Number.isFinite(ref) ? xb - ref : null, sigma, notes,
    };
  }

  // ---- Type-1（Cg・Cgk） ----
  // AIAG MSA 第4版には含まれない。一般的な式：Cg = (K × T) / (L × s)、Cgk = (K/2 × T − |x̄ − 基準値|) / (L/2 × s)
  // 既定は K = 20%、L = 6（判定の目安は 1.33 以上）
  function type1(x, ref, tol, opt = {}) {
    const n = x.length;
    if (n < 2) throw new Error('測定値は 2 個以上必要です');
    if (!Number.isFinite(ref)) throw new Error('基準値を入力してください');
    if (!(tol > 0)) throw new Error('公差幅を入力してください');
    const K = opt.K != null ? opt.K : 0.2, L = opt.L != null ? opt.L : 6, limit = opt.limit != null ? opt.limit : 1.33;
    const xb = mean(x), s = sd(x), b = xb - ref;
    const Cg = s > 0 ? K * tol / (L * s) : null;
    const Cgk = s > 0 ? (K / 2 * tol - Math.abs(b)) / (L / 2 * s) : null;
    const t = s > 0 ? b / (s / Math.sqrt(n)) : null;
    const p = t != null ? 2 * tSf(Math.abs(t), n - 1) : null;
    const notes = [];
    if (n < 25) notes.push(`測定回数が ${n} 回です（25〜50 回が一般的）`);
    if (s === 0) notes.push('標準偏差が 0 です。測定器の分解能が足りない可能性があります');
    return {
      n, mean: xb, sd: s, ref, bias: b, tol, K, L, limit, Cg, Cgk, t, p,
      // Cg・Cgk に対応する繰り返し性と偏りの割合（公差に対する %）
      pctEV: 100 * L * s / tol, pctBias: 100 * Math.abs(b) / tol,
      okCg: Cg != null && Cg >= limit, okCgk: Cgk != null && Cgk >= limit, notes,
    };
  }

  // ---- 計数値（クロス表法） ----
  // judg[測定者][回][部品]：判定の文字列、ref[部品]：基準の判定（任意）。opt.bad：不合格を表す値
  function cohenKappa(x, y) {
    const n = x.length, cats = [...new Set([...x, ...y])].sort();
    if (!n) return null;
    const idx = new Map(cats.map((c, i) => [c, i])), K = cats.length;
    const tab = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let i = 0; i < n; i++) tab[idx.get(x[i])][idx.get(y[i])]++;
    const po = sum(cats.map((_, i) => tab[i][i])) / n;
    const rs = tab.map(row => sum(row)), cs = cats.map((_, j) => sum(tab.map(row => row[j])));
    const pe = sum(cats.map((_, i) => rs[i] * cs[i])) / (n * n);
    return { kappa: pe < 1 ? (po - pe) / (1 - pe) : (po === 1 ? 1 : null), po, pe, cats, table: tab, n };
  }
  // 二項分布の正確な信頼区間（Clopper-Pearson）
  function betaPpf(q, a, b) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (ibeta(mid, a, b) < q) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function binomCI(x, n, alpha = 0.05) {
    if (!n) return [null, null];
    return [x === 0 ? 0 : betaPpf(alpha / 2, x, n - x + 1), x === n ? 1 : betaPpf(1 - alpha / 2, x + 1, n - x)];
  }
  const BAD_RE = /^(0|ng|n\.g\.|不合格|不良|否|×|✕|x|bad|reject|fail|nok|no)$/i;
  function attribute(judg, ref, opt = {}) {
    const k = judg.length, r = k ? judg[0].length : 0, n = r ? judg[0][0].length : 0;
    if (k < 1 || r < 1 || n < 2) throw new Error('測定者 1 人以上・1 回以上・部品 2 個以上が必要です');
    for (const at of judg) { if (at.length !== r) throw new Error('測定者ごとの回数がそろっていません'); for (const tr of at) { if (tr.length !== n) throw new Error('部品数がそろっていません'); if (tr.some(v => v == null || v === '')) throw new Error('判定が入力されていないセルがあります'); } }
    const hasRef = Array.isArray(ref) && ref.length === n && ref.every(v => v != null && v !== '');
    const alpha = opt.alpha != null ? opt.alpha : 0.05;
    const cats = [...new Set([...judg.flat(2), ...(hasRef ? ref : [])])].sort();
    const binary = cats.length === 2;
    let bad = opt.bad;
    if (binary && (bad == null || !cats.includes(bad))) bad = cats.find(c => BAD_RE.test(String(c).trim())) ?? null;
    const good = binary && bad != null ? cats.find(c => c !== bad) : null;
    const flat = a => judg[a].flat(); // 回ごとに部品を並べる（回1の全部品、回2の全部品…）
    // 測定者どうし（同じ部品・同じ回の判定を組にする）
    const pairs = [];
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) pairs.push({ a, b, ...cohenKappa(flat(a), flat(b)) });
    // 測定者と基準
    const vsRef = hasRef ? judg.map((at, a) => ({ a, ...cohenKappa(at.flat(), at.flatMap(() => ref)) })) : null;
    // 有効性・ミス率・誤警報率
    const per = judg.map((at, a) => {
      const within = Array.from({ length: n }, (_, p) => at.every(tr => tr[p] === at[0][p])).filter(Boolean).length;
      const o = { a, within, withinRate: within / n, withinCI: binomCI(within, n, alpha) };
      if (hasRef) {
        const eff = Array.from({ length: n }, (_, p) => at.every(tr => tr[p] === ref[p])).filter(Boolean).length;
        Object.assign(o, { effective: eff, effectiveness: eff / n, effCI: binomCI(eff, n, alpha) });
        if (good != null) {
          let miss = 0, missOpp = 0, fa = 0, faOpp = 0;
          for (const tr of at) for (let p = 0; p < n; p++) {
            if (ref[p] === bad) { missOpp++; if (tr[p] === good) miss++; } else if (ref[p] === good) { faOpp++; if (tr[p] === bad) fa++; }
          }
          Object.assign(o, { miss, missOpp, missRate: missOpp ? miss / missOpp : null, fa, faOpp, faRate: faOpp ? fa / faOpp : null });
        }
      }
      return o;
    });
    // システム全体：全員の全回が一致した部品（と基準とも一致した部品）
    const allAgree = Array.from({ length: n }, (_, p) => { const v = judg[0][0][p]; return judg.every(at => at.every(tr => tr[p] === v)); });
    const sysWithin = allAgree.filter(Boolean).length;
    const sys = { within: sysWithin, withinRate: sysWithin / n, withinCI: binomCI(sysWithin, n, alpha) };
    if (hasRef) {
      const e = allAgree.filter((ok, p) => ok && judg[0][0][p] === ref[p]).length;
      Object.assign(sys, { effective: e, effectiveness: e / n, effCI: binomCI(e, n, alpha) });
    }
    const notes = [];
    if (!hasRef) notes.push('基準の判定がないため、有効性・ミス率・誤警報率と基準との κ は計算していません');
    if (hasRef && binary && bad == null) notes.push('どちらが不合格の判定か分からないため、ミス率・誤警報率は計算していません（不合格を表す値を選んでください）');
    if (!binary && hasRef) notes.push('判定が 3 区分以上あるため、ミス率・誤警報率は計算していません');
    if (n < 50) notes.push(`部品が ${n} 個です（AIAG の例では 50 個。少ないと信頼区間が広くなります）`);
    return { k, r, n, cats, binary, bad, good, hasRef, pairs, vsRef, per, sys, alpha, notes };
  }
  // κ の目安（AIAG）：0.75 を超えれば良い一致、0.40 未満は一致が悪い
  function judgeKappa(v) { if (v == null) return null; return v > 0.75 ? 'ok' : v >= 0.4 ? 'cond' : 'ng'; }
  // 有効性：90% 以上 合格、80〜90% 条件付き、80% 未満 不合格。ミス率：2% 以下・2〜5%・5% 超。誤警報率：5% 以下・5〜10%・10% 超
  function judgeEff(v) { if (v == null) return null; return v >= 0.9 ? 'ok' : v >= 0.8 ? 'cond' : 'ng'; }
  function judgeMiss(v) { if (v == null) return null; return v <= 0.02 ? 'ok' : v <= 0.05 ? 'cond' : 'ng'; }
  function judgeFa(v) { if (v == null) return null; return v <= 0.05 ? 'ok' : v <= 0.1 ? 'cond' : 'ng'; }

  function fmt(v, d = 4) { if (v == null || !Number.isFinite(v)) return '—'; return Number(v.toPrecision(d)).toString(); }

  const api = {
    rangeMoments, d2, d3, K1, K2, K3, K_TABLE, shapeOf, ratios, judgePct, grrAvgRange, grrAnova, bias, linearity, stability, type1,
    cohenKappa, binomCI, attribute, judgeKappa, judgeEff, judgeMiss, judgeFa, BAD_RE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MsaCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
