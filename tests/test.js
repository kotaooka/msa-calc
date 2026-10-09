// js/msa.js の計算を tests/reference.json（scipy・statsmodels・scikit-learn で別に計算した値）と照合する
// 実行: node tests/test.js   （不一致があれば終了コード 1）
'use strict';
const path = require('path');
const fs = require('fs');
const M = require('../js/msa.js');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));

let fails = 0, checks = 0;
function close(name, got, want, rel = 1e-7, abs = 1e-10) {
  checks++;
  const ok = (got == null && want == null) || (Number.isFinite(got) && Number.isFinite(want) && Math.abs(got - want) <= Math.max(abs, rel * Math.abs(want)));
  if (!ok) { fails++; console.log(`✗ ${name}: ${got} ≠ ${want}`); }
}
function same(name, got, want) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
}
function throws(name, f) {
  checks++;
  try { f(); fails++; console.log(`✗ ${name}: 例外が出ない`); } catch (e) { /* 期待どおり */ }
}

// 範囲の分布の係数（数値積分の経路が違う 2 つの計算）
for (const c of ref.consts) {
  const m = M.rangeMoments(c.m);
  close(`d2(${c.m})`, m.d2, c.d2, 1e-8);
  close(`d3(${c.m})`, m.d3, c.d3, 1e-7);
  close(`d2*(${c.m}, g=1)`, m.d2star1, c.d2star1, 1e-8);
}
// マニュアルの係数表（4 桁）は正確な値を丸めたものと一致する
for (const [name, tab] of Object.entries(M.K_TABLE)) for (const [m, v] of Object.entries(tab)) close(`${name}(${m}) の表の値`, Number(M[name](Number(m)).toFixed(4)), v, 0, 1e-12);

// GRR
for (const c of ref.grr) {
  const ar = M.grrAvgRange(c.data, { tol: c.tol });
  for (const k of ['EV', 'AV', 'GRR', 'PV', 'TV', 'pctGRR', 'pctTolGRR', 'Rbb', 'Xdiff', 'Rp']) close(`${c.name} 平均範囲法 ${k}`, ar[k], c.avgRange[k]);
  same(`${c.name} 平均範囲法 ndc`, ar.ndc, c.avgRange.ndc);
  close(`${c.name} 平均範囲法 UCL(R)`, ar.rChart.ucl, c.avgRange.uclR);
  for (const [key, opt] of [['anova', {}], ['anovaKeep', { keepInteraction: true }]]) {
    const a = M.grrAnova(c.data, Object.assign({ tol: c.tol }, opt)), w = c[key];
    const ss = Object.fromEntries(a.table.map(r => [r.source, r]));
    close(`${c.name} ${key} SS部品`, ss['部品'].ss, w.SSP);
    close(`${c.name} ${key} SS測定者`, ss['測定者'].ss, w.SSA);
    close(`${c.name} ${key} p(交互作用)`, a.pInteraction, w.pInteraction, 1e-6, 1e-12);
    same(`${c.name} ${key} プール`, a.pooled, w.pooled);
    close(`${c.name} ${key} p(部品)`, ss['部品'].p, w.pPart, 1e-6, 1e-12);
    close(`${c.name} ${key} p(測定者)`, ss['測定者'].p, w.pOp, 1e-6, 1e-12);
    for (const k of ['EV', 'AV', 'IA', 'GRR', 'PV', 'TV', 'pctGRR', 'pctTolGRR']) close(`${c.name} ${key} ${k}`, a[k] == null ? null : a[k], w[k]);
    same(`${c.name} ${key} ndc`, a.ndc, w.ndc);
  }
}

// 偏り
ref.bias.forEach((c, i) => {
  const b = M.bias(c.x, c.ref);
  close(`偏り${i} 偏り`, b.bias, c.bias);
  close(`偏り${i} σr`, b.sigmaR, c.sigmaR);
  close(`偏り${i} t`, b.t, c.t);
  close(`偏り${i} p`, b.p, c.p, 1e-6);
  close(`偏り${i} 信頼区間下限`, b.ci[0], c.ci[0], 1e-6);
  close(`偏り${i} 信頼区間上限`, b.ci[1], c.ci[1], 1e-6);
});

// 直線性
ref.linearity.forEach((c, i) => {
  const L = M.linearity(c.parts);
  for (const k of ['slope', 'intercept', 'R2', 's', 'tSlope', 'tIntercept']) close(`直線性${i} ${k}`, L[k], c[k]);
  close(`直線性${i} p(傾き)`, L.pSlope, c.pSlope, 1e-6, 1e-14);
  same(`直線性${i} 0 の線が信頼帯の中`, L.zeroInside, c.zeroInside);
  for (const [x, lo, hi] of c.bandAt) { const [l, u] = L.band(x); close(`直線性${i} 信頼帯 x=${x} 下`, l, lo, 1e-6); close(`直線性${i} 信頼帯 x=${x} 上`, u, hi, 1e-6); }
});

// 安定性
ref.stability.forEach((c, i) => {
  const s = M.stability(c.x, c.m, c.ref);
  close(`安定性${i} 中心線`, s.chart.main.cl[0], c.cl);
  // 管理図の係数は表の値（3〜4 桁）を使うので、数値積分の値とは 1e-3 程度ずれる
  close(`安定性${i} UCL`, s.chart.main.ucl[0], c.ucl, 1e-4);
  close(`安定性${i} 範囲の UCL`, s.chart.range.ucl[0], c.rUcl, 2e-3);
  close(`安定性${i} 偏り`, s.bias, c.bias);
});

// Type-1
ref.type1.forEach((c, i) => {
  const t = M.type1(c.x, c.ref, c.tol, { K: c.K, L: c.L });
  close(`Type-1 ${i} Cg`, t.Cg, c.Cg);
  close(`Type-1 ${i} Cgk`, t.Cgk, c.Cgk);
  close(`Type-1 ${i} p`, t.p, c.p, 1e-6, 1e-14);
});

// 計数値
ref.attribute.forEach((c, i) => {
  const A = M.attribute(c.judg, c.ref);
  same(`計数値${i} 不合格の値`, A.bad, 'NG');
  c.pairs.forEach(p => close(`計数値${i} κ(${p.a},${p.b})`, A.pairs.find(q => q.a === p.a && q.b === p.b).kappa, p.kappa));
  c.vsRef.forEach((v, a) => close(`計数値${i} κ(${a},基準)`, A.vsRef[a].kappa, v));
  c.per.forEach((w, a) => {
    const g = A.per[a];
    same(`計数値${i} 測定者${a} 有効`, g.effective, w.effective);
    same(`計数値${i} 測定者${a} 自己一致`, g.within, w.within);
    close(`計数値${i} 測定者${a} 有効性 CI 下`, g.effCI[0], w.effCI[0], 1e-7);
    close(`計数値${i} 測定者${a} 有効性 CI 上`, g.effCI[1], w.effCI[1], 1e-7);
    close(`計数値${i} 測定者${a} 自己一致 CI 下`, g.withinCI[0], w.withinCI[0], 1e-7);
    close(`計数値${i} 測定者${a} ミス率`, g.missRate, w.missRate);
    close(`計数値${i} 測定者${a} 誤警報率`, g.faRate, w.faRate);
  });
  same(`計数値${i} 全員一致`, A.sys.within, c.sysWithin);
  same(`計数値${i} システム有効`, A.sys.effective, c.sysEffective);
  close(`計数値${i} システム有効性 CI 下`, A.sys.effCI[0], c.sysEffCI[0], 1e-7);
});

// 区間の端（0 件・全件）と κ の特殊な場合
same('二項 CI 0 件の下限', M.binomCI(0, 20)[0], 0);
same('二項 CI 全件の上限', M.binomCI(20, 20)[1], 1);
close('二項 CI 全件の下限', M.binomCI(20, 20)[0], Math.pow(0.025, 1 / 20), 1e-9);
same('κ：全員が同じ判定だけ（一致率 1）', M.cohenKappa(['OK', 'OK'], ['OK', 'OK']).kappa, 1);

// 判定区分の境界
same('%GRR 9.99', M.judgePct(9.99), 'ok');
same('%GRR 10', M.judgePct(10), 'cond');
same('%GRR 30', M.judgePct(30), 'cond');
same('%GRR 30.01', M.judgePct(30.01), 'ng');
same('κ 0.75', M.judgeKappa(0.75), 'cond');
same('κ 0.76', M.judgeKappa(0.76), 'ok');
same('有効性 0.9', M.judgeEff(0.9), 'ok');
same('ミス率 0.02', M.judgeMiss(0.02), 'ok');
same('誤警報率 0.1', M.judgeFa(0.1), 'cond');

// 係数表を使う指定：表にある組み合わせは 4 桁の値、表にないものは正確な値
{
  const c = ref.grr[1];
  const t = M.grrAvgRange(c.data, { tableK: true });
  close('係数表 K1', t.K1, 0.5908, 0, 1e-12);
  close('係数表 K3', t.K3, 0.3146, 0, 1e-12);
  const c4 = ref.grr[3]; // 4 人：K2 は表にない
  close('係数表にない K2', M.grrAvgRange(c4.data, { tableK: true }).K2, M.K2(4));
}

// 既知の工程変動を使う場合：TV = 工程の σ、PV = √(TV² − GRR²)
{
  const c = ref.grr[1];
  const a = M.grrAvgRange(c.data, { sigmaProcess: 2 });
  close('工程変動 TV', a.TV, 2);
  close('工程変動 PV', a.PV, Math.sqrt(4 - a.GRR ** 2));
  close('工程変動 %GRR', a.pctGRR, 100 * a.GRR / 2);
}

// 入力の不備
throws('測定者 1 人', () => M.grrAvgRange([[[1, 2], [1, 2]]]));
throws('欠測', () => M.grrAnova([[[1, 2], [1, NaN]], [[1, 2], [1, 2]]]));
throws('回数がそろわない', () => M.grrAvgRange([[[1, 2], [1, 2]], [[1, 2]]]));
throws('基準値なし', () => M.bias([1, 2, 3], NaN));
throws('基準値が 1 種類', () => M.linearity([{ ref: 1, x: [1, 2] }, { ref: 1, x: [1, 2] }]));
throws('公差なし', () => M.type1([1, 2, 3], 1, 0));

// 表の読み取り（Excel・CSV・貼り付け）
{
  const I = require('../js/importer.js');
  const tsv = t => t.trim().split('\n').map(l => l.split('\t'));
  const g1 = I.grr(tsv('\t1\t2\t3\nA-1\t0.1\t0.2\t0.3\nA-2\t0.11\t0.21\t0.31\nB-1\t0.12\t0.22\t0.32\nB-2\t0.13\t0.23\t0.33\n平均\t1\t1\t1'));
  same('読み取り GRR 見出しつき', [g1.k, g1.r, g1.n, g1.names, g1.cells[2]], [2, 2, 3, ['A', 'B'], ['0.12', '0.22', '0.32']]);
  const g2 = I.grr(tsv('測定者\t回\t1\t2\nA\t1\t0.1\t0.2\n\t2\t0.11\t0.21\nB\t1\t0.3\t0.4\n\t2\t0.31\t0.41'));
  same('読み取り GRR 結合セル', [g2.k, g2.r, g2.names, g2.cells[1]], [2, 2, ['A', 'B'], ['0.11', '0.21']]);
  const g3 = I.grr(tsv('部品\t測定者\t回\t測定値\n1\tA\t1\t5\n2\tA\t1\t6\n1\tB\t1\t5.1\n2\tB\t1\t6.1\n1\tA\t2\t5.2\n2\tA\t2\t6.2\n1\tB\t2\t5.3\n2\tB\t2\t6.3'));
  same('読み取り GRR 縦長', [g3.k, g3.r, g3.n, g3.cells], [2, 2, 2, [['5', '6'], ['5.2', '6.2'], ['5.1', '6.1'], ['5.3', '6.3']]]);
  const g4 = I.grr(tsv('0.1\t0.2\n0.11\t0.21\n0.3\t0.4\n0.31\t0.41'), { k: 2, r: 2 });
  same('読み取り GRR 数値だけ', [g4.k, g4.r, g4.names], [2, 2, null]);
  const g5 = I.grr(tsv('A-1\t1\t2\nB-1\t1.1\t2.1\nA-2\t1.2\t2.2\nB-2\t1.3\t2.3'));
  same('読み取り GRR 測定者が交互', g5.cells.map(r => r[0]), ['1', '1.2', '1.1', '1.3']);
  throws('読み取り GRR 回数がそろわない', () => I.grr(tsv('A-1\t1\t2\nA-2\t1\t2\nB-1\t1\t2')));
  const a1 = I.attribute(tsv('部品\t基準\tA-1\tA-2\tB-1\tB-2\n1\tOK\tOK\tOK\tOK\tNG\n2\tNG\tNG\tNG\tNG\tNG'));
  same('読み取り 計数値 見出しつき', [a1.k, a1.r, a1.n, a1.names, a1.ref, a1.cells[0]], [2, 2, 2, ['A', 'B'], ['OK', 'NG'], ['OK', 'OK', 'OK', 'NG']]);
  const a2 = I.attribute(tsv('1\t1\t1\t0\n2\t0\t0\t0\n3\t1\t1\t1'), { k: 1 });
  same('読み取り 計数値 通し番号つき', [a2.k, a2.r, a2.ref, a2.cells[0]], [1, 2, ['1', '0', '1'], ['1', '0']]);
  same('読み取り 直線性 見出しつき', I.linearity(tsv('部品\t1\t2\n基準値\t2\t4\n1\t2.1\t4.1\n2\t2.2\t3.9')), { refs: ['2', '4'], cols: [['2.1', '2.2'], ['4.1', '3.9']] });
  same('読み取り 直線性 数値だけ', I.linearity(tsv('2\t4\n2.1\t4.1')), { refs: ['2', '4'], cols: [['2.1'], ['4.1']] });
  same('読み取り 1 列（通し番号を飛ばす）', I.column(tsv('No\t値\n1\t5.01\n2\t5.02\n3\t4.99')), ['5.01', '5.02', '4.99']);
  same('見出しの分解', ['B（3回目）', 'A-1', '田中2', '田中'].map(I.splitLabel), [{ name: 'B', trial: 3 }, { name: 'A', trial: 1 }, { name: '田中', trial: 2 }, { name: '田中', trial: null }]);
  same('全角数字', require('../js/table.js').toNum('１２．５'), 12.5);
}

console.log(`${checks} 項目中 ${checks - fails} 項目一致`);
if (fails) process.exit(1);
