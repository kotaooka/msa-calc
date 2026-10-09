# 参照値 tests/reference.json を作る。js/msa.js とは別の方法（scipy の数値積分、statsmodels の分散分析、
# scikit-learn の κ など）で計算し直し、tests/test.js で照合する
# 実行: python tests/make_reference.py   （numpy・scipy・pandas・statsmodels・scikit-learn が必要）
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import integrate, stats
from sklearn.metrics import cohen_kappa_score
import statsmodels.formula.api as smf
from statsmodels.stats.anova import anova_lm

OUT = Path(__file__).with_name('reference.json')
rng = np.random.default_rng(20261010)


# ---- 範囲の分布の係数 ----
# E[W] は ∫(1 − Φ^m − (1−Φ)^m) dx、E[W²] は範囲の確率密度 f(w) = m(m−1)∫φ(x)φ(x+w)[Φ(x+w)−Φ(x)]^(m−2) dx から求める
# （js/msa.js は分布関数 P(W ≤ w) を使うので、式の経路が異なる）
def range_moments(m):
    ew = integrate.quad(lambda x: 1 - stats.norm.cdf(x) ** m - stats.norm.sf(x) ** m, -12, 12, limit=200)[0]

    def f(w):
        g = lambda x: stats.norm.pdf(x) * stats.norm.pdf(x + w) * (stats.norm.cdf(x + w) - stats.norm.cdf(x)) ** (m - 2)
        return m * (m - 1) * integrate.quad(g, -12, 12, limit=200)[0]

    ew2 = integrate.quad(lambda w: w * w * f(w), 0, 20, limit=200)[0]
    return {'m': m, 'd2': ew, 'd3': math.sqrt(ew2 - ew * ew), 'd2star1': math.sqrt(ew2)}


consts = [range_moments(m) for m in [2, 3, 4, 5, 6, 8, 10, 15, 20]]
COEF = {c["m"]: c for c in consts}


def coef(m):
    return COEF[m] if m in COEF else range_moments(m)


# ---- GRR のデータ ----
def make_grr(k, r, n, part_sd=1.0, op_sd=0.15, ia_sd=0.0, ev_sd=0.2, digits=3):
    parts = rng.normal(10, part_sd, n)
    ops = rng.normal(0, op_sd, k)
    ia = rng.normal(0, ia_sd, (k, n)) if ia_sd else np.zeros((k, n))
    y = np.empty((k, r, n))
    for a in range(k):
        for t in range(r):
            y[a, t] = parts + ops[a] + ia[a] + rng.normal(0, ev_sd, n)
    return np.round(y, digits)


def grr_avg_range(y, tol):
    k, r, n = y.shape
    R = y.max(axis=1) - y.min(axis=1)             # 測定者 × 部品
    Rbb = R.mean(axis=1).mean()
    xbar = y.mean(axis=(1, 2))
    xdiff = xbar.max() - xbar.min()
    pm = y.mean(axis=(0, 1))
    Rp = pm.max() - pm.min()
    EV = Rbb / coef(r)['d2']
    av2 = (xdiff / coef(k)['d2star1']) ** 2 - EV ** 2 / (n * r)
    AV = math.sqrt(av2) if av2 > 0 else 0.0
    PV = Rp / coef(n)['d2star1']
    GRR = math.hypot(EV, AV)
    TV = math.hypot(GRR, PV)
    D4 = 1 + 3 * coef(r)['d3'] / coef(r)['d2']
    return {'EV': EV, 'AV': AV, 'GRR': GRR, 'PV': PV, 'TV': TV, 'pctGRR': 100 * GRR / TV, 'pctTolGRR': 600 * GRR / tol,
            'ndc': max(1, math.floor(1.41 * PV / GRR)), 'uclR': D4 * Rbb, 'Rbb': Rbb, 'Xdiff': xdiff, 'Rp': Rp}


def grr_anova(y, tol, alpha=0.05, keep=False):
    k, r, n = y.shape
    rows = [{'y': y[a, t, p], 'op': a, 'part': p} for a in range(k) for t in range(r) for p in range(n)]
    df = pd.DataFrame(rows)
    fit = smf.ols('y ~ C(part) + C(op) + C(part):C(op)', data=df).fit()
    tab = anova_lm(fit, typ=2)
    SSP, SSA, SSAP, SSE = (tab.loc[s, 'sum_sq'] for s in ['C(part)', 'C(op)', 'C(part):C(op)', 'Residual'])
    dfP, dfA, dfAP, dfE = (tab.loc[s, 'df'] for s in ['C(part)', 'C(op)', 'C(part):C(op)', 'Residual'])
    MSP, MSA, MSAP, MSE = SSP / dfP, SSA / dfA, SSAP / dfAP, SSE / dfE
    pAP = stats.f.sf(MSAP / MSE, dfAP, dfE)
    pooled = (not keep) and pAP > alpha
    if pooled:
        MSp = (SSAP + SSE) / (dfAP + dfE)
        EV2, IA2 = MSp, None
        AV2 = max(0.0, (MSA - MSp) / (n * r))
        PV2 = max(0.0, (MSP - MSp) / (k * r))
        pP = stats.f.sf(MSP / MSp, dfP, dfAP + dfE)
        pA = stats.f.sf(MSA / MSp, dfA, dfAP + dfE)
    else:
        EV2 = MSE
        IA2 = max(0.0, (MSAP - MSE) / r)
        AV2 = max(0.0, (MSA - MSAP) / (n * r))
        PV2 = max(0.0, (MSP - MSAP) / (k * r))
        pP = stats.f.sf(MSP / MSAP, dfP, dfAP)
        pA = stats.f.sf(MSA / MSAP, dfA, dfAP)
    GRR = math.sqrt(EV2 + AV2 + (IA2 or 0))
    PV = math.sqrt(PV2)
    TV = math.hypot(GRR, PV)
    return {'SSP': SSP, 'SSA': SSA, 'SSAP': SSAP, 'SSE': SSE, 'pInteraction': pAP, 'pooled': bool(pooled), 'pPart': pP, 'pOp': pA,
            'EV': math.sqrt(EV2), 'AV': math.sqrt(AV2), 'IA': None if IA2 is None else math.sqrt(IA2), 'GRR': GRR, 'PV': PV, 'TV': TV,
            'pctGRR': 100 * GRR / TV, 'pctTolGRR': 600 * GRR / tol, 'ndc': max(1, math.floor(1.41 * PV / GRR))}


grr_cases = []
for name, (k, r, n, kw, tol) in {
    '2人2回5部品': (2, 2, 5, {}, 6.0),
    '3人3回10部品': (3, 3, 10, {}, 5.0),
    '3人2回10部品・交互作用あり': (3, 2, 10, {'ia_sd': 0.4, 'ev_sd': 0.1}, 4.0),
    '4人3回12部品・測定者差大': (4, 3, 12, {'op_sd': 0.6}, 8.0),
    '2人3回8部品・部品差小': (2, 3, 8, {'part_sd': 0.1, 'ev_sd': 0.2}, 2.0),
}.items():
    y = make_grr(k, r, n, **kw)
    grr_cases.append({'name': name, 'data': y.tolist(), 'tol': tol,
                      'avgRange': grr_avg_range(y, tol),
                      'anova': grr_anova(y, tol),
                      'anovaKeep': grr_anova(y, tol, keep=True)})

# ---- 偏り ----
bias_cases = []
for i, (n, mu, ref, s) in enumerate([(15, 6.01, 6.0, 0.2), (10, 25.05, 25.0, 0.03), (30, 1.002, 1.0, 0.004)]):
    x = np.round(rng.normal(mu, s, n), 4)
    t = stats.ttest_1samp(x, ref)
    se = x.std(ddof=1) / math.sqrt(n)
    tc = stats.t.ppf(0.975, n - 1)
    b = x.mean() - ref
    bias_cases.append({'x': x.tolist(), 'ref': ref, 'bias': b, 'sigmaR': x.std(ddof=1), 't': t.statistic, 'p': t.pvalue,
                       'ci': [b - tc * se, b + tc * se]})

# ---- 直線性 ----
lin_cases = []
for g, m, slope, inter in [(5, 12, -0.13, 0.7), (6, 10, 0.0, 0.0), (5, 10, 0.004, -0.01)]:
    refs = np.linspace(2, 10, g)
    parts = []
    xs, ys = [], []
    for ref in refs:
        x = np.round(ref + inter + slope * ref + rng.normal(0, 0.2 if slope else 0.05, m), 3)
        parts.append({'ref': float(ref), 'x': x.tolist()})
        xs += [ref] * m
        ys += list(x - ref)
    xs, ys = np.array(xs), np.array(ys)
    lr = stats.linregress(xs, ys)
    N = len(xs)
    resid = ys - (lr.intercept + lr.slope * xs)
    s = math.sqrt((resid ** 2).sum() / (N - 2))
    tc = stats.t.ppf(0.975, N - 2)
    Sxx = ((xs - xs.mean()) ** 2).sum()
    grid = np.linspace(refs.min(), refs.max(), 2001)
    half = tc * s * np.sqrt(1 / N + (grid - xs.mean()) ** 2 / Sxx)
    fit = lr.intercept + lr.slope * grid
    inside = bool(np.all((fit - half <= 0) & (fit + half >= 0)))
    lin_cases.append({'parts': parts, 'slope': lr.slope, 'intercept': lr.intercept, 'R2': lr.rvalue ** 2, 's': s,
                      'tSlope': abs(lr.slope) / lr.stderr, 'tIntercept': abs(lr.intercept) / lr.intercept_stderr,
                      'pSlope': lr.pvalue, 'zeroInside': inside,
                      'bandAt': [[float(v), float(f - h), float(f + h)] for v, f, h in zip(grid[::500], fit[::500], half[::500])]})

# ---- 安定性 ----
stab_cases = []
for m in [1, 3, 5]:
    x = np.round(rng.normal(20, 0.01, 25 * m), 4)
    if m == 1:
        mr = np.abs(np.diff(x))
        cl, ucl = x.mean(), x.mean() + 3 * mr.mean() / coef(2)['d2']
        rUcl = mr.mean() * (1 + 3 * coef(2)['d3'] / coef(2)['d2'])
    else:
        g = x.reshape(-1, m)
        R = g.max(axis=1) - g.min(axis=1)
        cl = g.mean()
        ucl = cl + 3 * R.mean() / (coef(m)['d2'] * math.sqrt(m))
        rUcl = R.mean() * (1 + 3 * coef(m)['d3'] / coef(m)['d2'])
    stab_cases.append({'x': x.tolist(), 'm': m, 'ref': 20.0, 'cl': cl, 'ucl': ucl, 'rUcl': rUcl, 'bias': x.mean() - 20.0})

# ---- Type-1 ----
t1_cases = []
for n, mu, s, ref, tol, K, L in [(50, 10.002, 0.003, 10.0, 0.2, 0.2, 6), (25, 5.0, 0.01, 5.01, 0.3, 0.2, 4), (30, 1.0, 0.0005, 1.0, 0.02, 0.15, 6)]:
    x = np.round(rng.normal(mu, s, n), 5)
    sd = x.std(ddof=1)
    b = x.mean() - ref
    t1_cases.append({'x': x.tolist(), 'ref': ref, 'tol': tol, 'K': K, 'L': L,
                     'Cg': K * tol / (L * sd), 'Cgk': (K / 2 * tol - abs(b)) / (L / 2 * sd),
                     'p': stats.ttest_1samp(x, ref).pvalue})

# ---- 計数値 ----
def clopper(x, n, a=0.05):
    lo = 0.0 if x == 0 else stats.beta.ppf(a / 2, x, n - x + 1)
    hi = 1.0 if x == n else stats.beta.ppf(1 - a / 2, x + 1, n - x)
    return [lo, hi]


attr_cases = []
for k, r, n, err in [(3, 3, 50, [0.05, 0.03, 0.10]), (2, 2, 30, [0.1, 0.2])]:
    ref = rng.random(n) < 0.32       # True が不良
    judg = np.empty((k, r, n), dtype=object)
    for a in range(k):
        for t in range(r):
            flip = rng.random(n) < err[a]
            bad = ref ^ flip
            judg[a, t] = np.where(bad, 'NG', 'OK')
    refl = np.where(ref, 'NG', 'OK')
    flat = lambda a: judg[a].reshape(-1)  # 回ごとに部品を並べる
    pairs = [{'a': a, 'b': b, 'kappa': cohen_kappa_score(flat(a), flat(b))} for a in range(k) for b in range(a + 1, k)]
    vsref = [cohen_kappa_score(flat(a), np.tile(refl, r)) for a in range(k)]
    per = []
    for a in range(k):
        eff = int(np.sum(np.all(judg[a] == refl, axis=0)))
        within = int(np.sum(np.all(judg[a] == judg[a][0], axis=0)))
        miss = int(np.sum((judg[a] == 'OK') & (refl == 'NG')))
        fa = int(np.sum((judg[a] == 'NG') & (refl == 'OK')))
        per.append({'effective': eff, 'effCI': clopper(eff, n), 'within': within, 'withinCI': clopper(within, n),
                    'missRate': miss / (r * int(ref.sum())), 'faRate': fa / (r * int((~ref).sum()))})
    allag = np.all(judg == judg[0, 0], axis=(0, 1))
    sys_eff = int(np.sum(allag & (judg[0, 0] == refl)))
    attr_cases.append({'judg': judg.tolist(), 'ref': refl.tolist(), 'pairs': pairs, 'vsRef': vsref, 'per': per,
                       'sysWithin': int(allag.sum()), 'sysEffective': sys_eff, 'sysEffCI': clopper(sys_eff, n)})

ref = {'consts': consts, 'grr': grr_cases, 'bias': bias_cases, 'linearity': lin_cases, 'stability': stab_cases,
       'type1': t1_cases, 'attribute': attr_cases}
OUT.write_text(json.dumps(ref, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o)), encoding='utf-8')
print(f'{OUT} を書き出しました')
