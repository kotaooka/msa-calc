// 第三者が公開している認証値との照合テスト（node tests/published.js）。不一致が1件でもあれば終了コード 1
// tests/test.js が「別の方法で自分で計算した参照値」との照合なのに対し、ここでは答えが公開されているものだけを使う。
// 使うのは NIST StRD（Statistical Reference Datasets）。米国政府の著作物で自由に使え、
// 統計ソフトの計算精度を確かめるために作られたデータと、その認証値（15 桁）が公開されている。
// データファイルは tests/published/ に原本のまま置いている
'use strict';
const fs = require('fs');
const path = require('path');
const M = require('../js/msa.js');

let n = 0; const fails = [];
// 一致桁数（LRE: log relative error）。NIST StRD の評価に使う指標で、15 前後なら倍精度の限界まで一致
const lre = (got, exp) => {
  if (got === exp) return Infinity;
  return exp === 0 ? -Math.log10(Math.abs(got)) : -Math.log10(Math.abs(got - exp) / Math.abs(exp));
};
function digits(name, got, exp, min) {
  n++;
  const d = lre(got, exp);
  if (!(d >= min)) fails.push(`${name}: 計算 ${got} / 認証値 ${exp}（一致 ${d.toFixed(1)} 桁、必要 ${min} 桁）`);
  return d;
}
function read(file) {
  const txt = fs.readFileSync(path.join(__dirname, 'published', file), 'utf8');
  const m = txt.match(/Data\s*[:(]\s*lines\s+(\d+)\s+to\s+(\d+)/);
  const lines = txt.split(/\r?\n/).slice(+m[1] - 1, +m[2]).map(s => s.trim()).filter(Boolean);
  return { txt, rows: lines.map(s => s.split(/\s+/).map(Number)) };
}
const fmt = d => d === Infinity ? '完全一致' : d.toFixed(1);

// ---- ゲージR&R（ANOVA 法）：NIST StRD の分散分析データ 11 組 ----
// StRD の分散分析は一元配置（処理 × 繰り返し）。これを「部品 × 回」とみなし、同じ値を測定者 2 人分として入れると、
// 二元配置の平方和は測定者・交互作用が 0 になり、部品と繰り返しの平方和がちょうど一元配置の 2 倍になる。
// 繰り返しの平均平方は一元配置の群内平均平方と同じになるので、EV（繰り返し性）= 認証値の残差標準偏差になる。
// （交互作用はプールせずに残す設定で計算する。プールすると自由度が変わり、この対応が崩れる）
// 必要桁数は NIST の難易度と、入力の値を倍精度で読んだ時点で失われる桁を踏まえて決めた。
// SmLs07〜09 は 1000000000000.4 のように 13 桁が共通で、読み込んだ時点の丸め誤差だけで一致桁が約 4.3 桁に限られる
// （読み込んだ値を有理数で厳密に計算して確かめた上限）
const ANOVA = [
  // [ファイル, 難易度, 必要桁]
  ['SiRstv.dat', 'lower', 12],
  ['SmLs01.dat', 'lower', 12],
  ['SmLs02.dat', 'lower', 12],
  ['SmLs03.dat', 'lower', 11],
  ['AtmWtAg.dat', 'average', 9],
  ['SmLs04.dat', 'average', 9],
  ['SmLs05.dat', 'average', 9],
  ['SmLs06.dat', 'average', 9],
  ['SmLs07.dat', 'higher', 3.5],
  ['SmLs08.dat', 'higher', 3.5],
  ['SmLs09.dat', 'higher', 3.5],
];
const anovaReport = [];
for (const [file, level, min] of ANOVA) {
  const { txt, rows } = read(file);
  const B = txt.match(/Between \w+\s+(\d+)\s+(\S+)\s+(\S+)/), W = txt.match(/Within \w+\s+(\d+)\s+(\S+)\s+(\S+)/);
  const rsd = Number(txt.match(/Standard Deviation\s+(\S+)/)[1]);
  const groups = new Map();
  for (const [t, v] of rows) { if (!groups.has(t)) groups.set(t, []); groups.get(t).push(v); }
  const parts = [...groups.keys()].sort((a, b) => a - b).map(k => groups.get(k));
  const r = parts[0].length;
  const op = Array.from({ length: r }, (_, t) => parts.map(p => p[t]));   // [回][部品]
  const a = M.grrAnova([op, op.map(row => row.slice())], { keepInteraction: true });
  const ss = Object.fromEntries(a.table.map(row => [row.source, row]));
  const name = file.replace('.dat', '');
  const dSSB = digits(`${name} 部品の平方和 ÷ 2（= 処理間の平方和）`, ss['部品'].ss / 2, Number(B[2]), min);
  const dSSW = digits(`${name} 繰り返しの平方和 ÷ 2（= 処理内の平方和）`, ss['繰り返し（誤差）'].ss / 2, Number(W[2]), min);
  digits(`${name} 繰り返しの平均平方（= 処理内の平均平方）`, ss['繰り返し（誤差）'].ms, Number(W[3]), min);
  const dEV = digits(`${name} EV（= 残差標準偏差）`, a.EV, rsd, min);
  n++;
  if (ss['部品'].df !== Number(B[1]) || ss['繰り返し（誤差）'].df !== 2 * Number(W[1])) fails.push(`${name}: 自由度が合わない`);
  anovaReport.push({ name, level, N: rows.length, ssb: dSSB, ssw: dSSW, ev: dEV });
}

// ---- 直線性：NIST StRD の線形回帰データ Norris ----
// 直線性は「偏り（測定値 − 基準値）」を基準値に回帰する。Norris の x を基準値、y を測定値とすると、
// 偏りの回帰の傾き = 認証値の傾き − 1、切片 = 認証値の切片、残差標準偏差 = 認証値の残差標準偏差 になる
let linReport;
{
  const { txt, rows } = read('Norris.dat');
  const b0 = Number(txt.match(/^\s*B0\s+(\S+)\s+\S+\s*$/m)[1]), b1 = Number(txt.match(/^\s*B1\s+(\S+)\s+\S+\s*$/m)[1]);
  const rsd = Number(txt.match(/Residual\s+Standard Deviation\s+(\S+)/)[1]);
  const lin = M.linearity(rows.map(([y, x]) => ({ ref: x, x: [y] })));
  linReport = {
    slope: digits('Norris 偏りの傾き（= 認証値の傾き − 1）', lin.slope, b1 - 1, 10),
    intercept: digits('Norris 切片', lin.intercept, b0, 12),
    s: digits('Norris 残差標準偏差', lin.s, rsd, 12),
  };
}

// ---- 偏り：NIST StRD の一変量データ ----
// 偏りの計算に使う平均と繰り返しの標準偏差 σr を、認証値（平均・標準偏差）と照合する。
// 基準値は認証値の平均にそろえ、偏りが 0（t = 0）になることも確かめる
const BIAS = [['PiDigits.dat', 13, 13], ['Mavro.dat', 13, 12], ['Michelso.dat', 13, 12], ['NumAcc1.dat', 13, 13],
  ['NumAcc2.dat', 13, 13], ['NumAcc3.dat', 13, 9], ['NumAcc4.dat', 13, 8]];
const biasReport = [];
for (const [file, minMean, minSd] of BIAS) {
  const { txt, rows } = read(file);
  const x = rows.map(r => r[0]);
  const mean = Number(txt.match(/ybar:\s*(\S+)/)[1]), sd = Number(txt.match(/\bs:\s*(\S+)/)[1]);
  const b = M.bias(x, mean);
  const name = file.replace('.dat', '');
  biasReport.push({ name, n: x.length, mean: digits(`${name} 平均`, b.mean, mean, minMean), sd: digits(`${name} σr`, b.sigmaR, sd, minSd) });
}

// ---- 結果 ----
console.log('ゲージR&R（ANOVA）と NIST StRD 分散分析データ（一致桁数。15 前後が倍精度の限界）');
for (const r of anovaReport) console.log(`  ${r.name.padEnd(8)} N=${String(r.N).padStart(5)} 難易度 ${r.level.padEnd(7)} 処理間 SS ${fmt(r.ssb)}  処理内 SS ${fmt(r.ssw)}  EV ${fmt(r.ev)}`);
console.log(`直線性と Norris: 傾き ${fmt(linReport.slope)}  切片 ${fmt(linReport.intercept)}  残差標準偏差 ${fmt(linReport.s)}`);
console.log('偏りと NIST StRD 一変量データ');
for (const r of biasReport) console.log(`  ${r.name.padEnd(9)} n=${String(r.n).padStart(4)} 平均 ${fmt(r.mean)}  σr ${fmt(r.sd)}`);
if (fails.length) {
  console.log(`\n${n} 項目中 ${fails.length} 項目不一致`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`\n${n} 項目すべて認証値と一致`);
