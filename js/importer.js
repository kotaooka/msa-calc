// Excel・CSV・貼り付けた表（2 次元配列）から、各解析の入力を読み取る
// ブラウザでは window.MsaImport、Node では require('./importer.js')
(function (root) {
  'use strict';
  const T = typeof module !== 'undefined' && module.exports ? require('./table.js') : root.MsaTable;
  const toNum = T.toNum;
  const str = v => v == null ? '' : String(v).trim();
  const isNum = v => toNum(v) != null;
  // 空の行・列を除く
  function trim(rows) {
    rows = rows.map(r => r.map(str));
    rows = rows.filter(r => r.some(v => v !== ''));
    const w = Math.max(0, ...rows.map(r => r.length));
    const keep = [];
    for (let c = 0; c < w; c++) if (rows.some(r => (r[c] ?? '') !== '')) keep.push(c);
    return rows.map(r => keep.map(c => r[c] ?? ''));
  }
  // 「A-1」「A_2」「A1回目」「B（3回目）」などから測定者名と回を取り出す
  function splitLabel(s) {
    s = str(s);
    const m = s.match(/^(.*?)[\s\-_‐－・/（(#]*第?(\d+)\s*(?:回目?|trial)?\s*[)）]?$/i);
    if (m && m[1] !== '') return { name: m[1].replace(/[\s\-_‐－・/（(]+$/, ''), trial: Number(m[2]) };
    return { name: s, trial: null };
  }
  // 見出しの文字を判定
  const HEAD = {
    part: /^(部品|部品番号|部品no\.?|サンプル|試料|part|parts|sample|no\.?|番号|#)$/i,
    op: /^(測定者|評価者|作業者|operator|appraiser|op)$/i,
    trial: /^(回|回数|繰り返し|試行|trial|rep|repeat|replicate)$/i,
    value: /^(測定値|値|データ|value|measurement|meas|result|y)$/i,
    ref: /^(基準|基準値|基準判定|標準|正解|ref|reference|standard|std|attribute|expert)$/i,
  };

  // ---- ゲージR&R ----
  // 戻り値 { k, r, n, names, cells }。cells は (k×r) 行 × n 列の文字列。cur: 今の { k, r }（見出しがないとき使う）
  function grr(rowsIn, cur = {}) {
    const rows = trim(rowsIn);
    if (!rows.length) throw new Error('表が空です');
    // 縦長の表（部品・測定者・回・測定値）
    const h = rows[0].map(v => v.replace(/\s/g, ''));
    const ip = h.findIndex(v => HEAD.part.test(v)), io = h.findIndex(v => HEAD.op.test(v)), iv = h.findIndex(v => HEAD.value.test(v));
    if (ip >= 0 && io >= 0 && iv >= 0) return grrLong(rows.slice(1), ip, io, h.findIndex(v => HEAD.trial.test(v)), iv);
    // 横長（AIAG のデータシート）：行 = 測定者 × 回、列 = 部品
    let body = rows;
    // 先頭の見出し行（数値が 1 つもない行、または部品番号だけの行）を除く
    while (body.length && body[0].filter(isNum).length === 0) body = body.slice(1);
    if (body.length >= 2 && looksLikeHeader(body[0], body[1])) body = body.slice(1);
    if (!body.length) throw new Error('数値の行が見つかりません');
    // 先頭の列が見出し（数値でない）なら測定者名として使う
    let labels = null;
    const lead = [];
    for (let c = 0; c < body[0].length; c++) {
      if (body.every(r => !isNum(r[c]))) lead.push(c); else break;
    }
    if (lead.length) {
      labels = body.map(r => lead.map(c => r[c]));
      body = body.map(r => r.slice(lead.length));
    }
    // 「測定者」「回」の 2 列目が 1,2,3… の回番号のとき
    if (body[0].length > 2 && body.every(r => /^\d+$/.test(r[0])) && isTrialColumn(body.map(r => Number(r[0])))) {
      labels = body.map((r, i) => (labels ? labels[i] : []).concat(r[0]));
      body = body.map(r => r.slice(1));
    }
    // 平均・範囲の行（AIAG のシートの集計行）を除く
    if (labels) {
      const keepIdx = labels.map((l, i) => /平均|範囲|average|range|xbar|rbar|x̄|r̄/i.test(l.join('')) ? -1 : i).filter(i => i >= 0);
      body = keepIdx.map(i => body[i]); labels = keepIdx.map(i => labels[i]);
    }
    const n = Math.max(...body.map(r => r.length));
    let k, r, names;
    if (labels && labels[0].some(v => v !== '')) {
      // 測定者名でまとめる（空欄は直前の名前を引き継ぐ。Excel で結合したセル）
      const opNames = [];
      let last = '';
      for (const l of labels) {
        const ne = l.filter(v => v !== '');
        // 「A」「1」のように 2 列に分かれているか、「A-1」のように 1 列か。回だけの行（測定者名が結合セル）は直前の名前
        const nm = !ne.length ? '' : (l.length >= 2 && l[0] === '' && /^\d+$/.test(ne[0])) ? '' : l.length >= 2 ? ne[0] : splitLabel(ne[0]).name;
        const name = nm || last;
        last = name; opNames.push(name);
      }
      names = [...new Set(opNames)];
      k = names.length;
      if (body.length % k) throw new Error(`測定者 ${k} 人で行数 ${body.length} が割り切れません`);
      r = body.length / k;
      // 測定者ごとに連続していなければ並べ替える
      const order = [];
      names.forEach(nm => opNames.forEach((o, i) => { if (o === nm) order.push(i); }));
      body = order.map(i => body[i]);
      if (names.some(nm => opNames.filter(o => o === nm).length !== r)) throw new Error('測定者ごとの行数（回数）がそろっていません');
    } else {
      k = cur.k >= 2 && body.length % cur.k === 0 ? cur.k : cur.r >= 2 && body.length % cur.r === 0 ? body.length / cur.r : null;
      if (!k) throw new Error(`行数 ${body.length} を測定者の人数で割り切れません。測定者の人数・回数を先に設定してください`);
      r = body.length / k;
      names = null;
    }
    const cells = body.map(row => Array.from({ length: n }, (_, c) => row[c] ?? ''));
    return { k, r, n, names, cells };
  }
  function looksLikeHeader(a, b) {
    // 1 行目が 1,2,3,…（部品番号）で 2 行目が測定値らしいとき
    // 数値以外のセルは空欄か「部品」などの見出しだけ（「A-1」のような測定者名があればデータ行）
    if (!a.every(v => v === '' || isNum(v) || /部品|part|no|番号|測定者|回/i.test(v))) return false;
    const nums = a.filter(isNum).map(Number);
    return nums.length >= 2 && nums.every((v, i) => v === i + 1) && b.filter(isNum).some(v => !Number.isInteger(Number(v)));
  }
  function isTrialColumn(v) {
    // 1,2,…,r,1,2,…,r の繰り返し
    const r = Math.max(...v);
    return r >= 2 && v.length % r === 0 && v.every((x, i) => x === (i % r) + 1);
  }
  function grrLong(rows, ip, io, it, iv) {
    const parts = [], ops = [], recs = [];
    for (const row of rows) {
      const p = row[ip], o = row[io], y = row[iv];
      if (p === '' && o === '' && y === '') continue;
      if (!parts.includes(p)) parts.push(p);
      if (!ops.includes(o)) ops.push(o);
      recs.push({ p, o, t: it >= 0 ? row[it] : null, y });
    }
    const k = ops.length, n = parts.length;
    // 回の列がなければ、同じ測定者・部品の出現順を回とする
    const cnt = {};
    for (const rec of recs) { const key = rec.o + '\u0000' + rec.p; cnt[key] = (cnt[key] || 0) + 1; if (rec.t == null || rec.t === '') rec.t = cnt[key]; }
    const trials = [...new Set(recs.map(x => String(x.t)))];
    const r = trials.length;
    const cells = Array.from({ length: k * r }, () => new Array(n).fill(''));
    for (const rec of recs) cells[ops.indexOf(rec.o) * r + trials.indexOf(String(rec.t))][parts.indexOf(rec.p)] = rec.y;
    return { k, r, n, names: ops, cells };
  }

  // ---- 1 列の測定値（偏り・安定性・Type-1） ----
  // 数値が 2 個以上ある最初の列を返す（見出しや空欄は除く）
  function column(rowsIn) {
    const rows = trim(rowsIn);
    const w = Math.max(0, ...rows.map(r => r.length));
    for (let c = 0; c < w; c++) {
      const vals = rows.map(r => r[c]).filter(isNum);
      // 1,2,3,… の通し番号の列は飛ばす
      const nums = vals.map(Number);
      if (vals.length >= 2 && !(c + 1 < w && nums.every((v, i) => v === i + 1))) return vals;
    }
    throw new Error('数値が 2 個以上ある列が見つかりません');
  }

  // ---- 直線性 ----
  // 1 行目が基準値、2 行目以降が測定値。戻り値 { refs, cols }（cols[部品] = 測定値の配列、文字列）
  function linearity(rowsIn) {
    let rows = trim(rowsIn);
    // 「基準値」と書かれた行があれば、その行を基準値、以降を測定値とし、見出しの列を除く
    const refRow = rows.findIndex(r => /^(基準|基準値|ref|reference)/i.test(r[0] || ''));
    if (refRow >= 0) rows = rows.slice(refRow).map(r => r.slice(1));
    // 数値のない見出し行・見出し列を除く
    while (rows.length && rows[0].filter(isNum).length === 0) rows = rows.slice(1);
    while (rows.length && rows[0].length && rows.slice(1).every(r => !isNum(r[0]))) rows = rows.map(r => r.slice(1));
    if (rows.length < 2) throw new Error('基準値の行と測定値の行が必要です');
    const g = rows[0].length;
    const refs = rows[0];
    const cols = Array.from({ length: g }, (_, c) => rows.slice(1).map(r => r[c] ?? ''));
    return { refs, cols };
  }

  // ---- 計数値 ----
  // 戻り値 { k, r, n, names, ref, cells }。cells は n 行 × (k×r) 列、ref は n 個（なければ空文字）
  function attribute(rowsIn, cur = {}) {
    let rows = trim(rowsIn);
    if (!rows.length) throw new Error('表が空です');
    const head = rows[0].map(v => v.replace(/\s/g, ''));
    const hasHead = head.some(v => HEAD.ref.test(v) || HEAD.part.test(v)) || head.filter(v => splitLabel(v).trial != null && !isNum(v)).length >= 2;
    let refCol = -1, partCol = -1, names = null, k, r;
    if (hasHead) {
      refCol = head.findIndex(v => HEAD.ref.test(v));
      partCol = head.findIndex(v => HEAD.part.test(v));
      const judgeCols = head.map((_, c) => c).filter(c => c !== refCol && c !== partCol);
      const labs = judgeCols.map(c => splitLabel(head[c]));
      names = [];
      labs.forEach(l => { if (!names.includes(l.name)) names.push(l.name); });
      k = names.length;
      if (judgeCols.length % k) throw new Error('測定者ごとの列数（回数）がそろっていません');
      r = judgeCols.length / k;
      const order = [];
      names.forEach(nm => labs.forEach((l, i) => { if (l.name === nm) order.push(judgeCols[i]); }));
      rows = rows.slice(1);
      return {
        k, r, n: rows.length, names,
        ref: rows.map(row => refCol >= 0 ? row[refCol] : ''),
        cells: rows.map(row => order.map(c => row[c] ?? '')),
      };
    }
    // 見出しなし：1 列目が通し番号なら除く。残りの 1 列目を基準、それ以降を判定とする
    const w = rows[0].length;
    if (w >= 3 && rows.every((row, i) => Number(row[0]) === i + 1) && rows.length > 2) rows = rows.map(row => row.slice(1));
    const w2 = rows[0].length;
    const kk = cur.k || 1;
    let withRef;
    if ((w2 - 1) % kk === 0 && w2 > 1) withRef = true;
    else if (w2 % kk === 0) withRef = false;
    else throw new Error(`列数 ${w2} が測定者 ${kk} 人と合いません。測定者の人数を先に設定してください`);
    k = kk; r = (w2 - (withRef ? 1 : 0)) / k;
    return {
      k, r, n: rows.length, names: null,
      ref: rows.map(row => withRef ? row[0] : ''),
      cells: rows.map(row => row.slice(withRef ? 1 : 0)),
    };
  }

  const api = { trim, splitLabel, grr, column, linearity, attribute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MsaImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
