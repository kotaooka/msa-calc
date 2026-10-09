// 画面処理：入力表、各解析の計算と結果の表示、保存・印刷
(function () {
  'use strict';
  const M = window.MsaCalc, X = window.CpkXlsx, C = window.CpkCharts, T = window.MsaTable, I = window.MsaImport, S = window.CpkStats;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = T.toNum;

  // ---------- 共通 ----------
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2800);
  }
  // 有効数字 n 桁（指数表記にしない）
  const sig = (v, n = 4) => v == null || !Number.isFinite(v) ? '―' : (Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(n))));
  const fix = (v, d = 2) => v == null || !Number.isFinite(v) ? '―' : v.toFixed(d);
  const pct = (v, d = 2) => v == null || !Number.isFinite(v) ? '―' : v.toFixed(d) + '%';
  const pval = p => p == null || !Number.isFinite(p) ? '―' : p < 0.0001 ? '< 0.0001' : p.toFixed(4);
  const LEVEL = { ok: '合格', cond: '条件付き', ng: '不合格' };
  const tag = (lv, text) => lv ? `<span class="tag ${lv}">${esc(text || LEVEL[lv])}</span>` : '';
  const worst = lvs => lvs.includes('ng') ? 'ng' : lvs.includes('cond') ? 'cond' : lvs.includes('ok') ? 'ok' : null;
  function download(data, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const stamp = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('shift_jis').decode(buf); }
  }
  // ファイル（.xlsx・CSV）を読み、最初の空でないシートを 2 次元配列で返す
  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const wb = /\.(csv|tsv|txt)$/i.test(file.name) ? X.readCsv(decodeText(buf)) : await X.readXlsx(buf);
    const sh = wb.sheets.find(s => s.cells.length);
    if (!sh) throw new Error('データのあるシートがありません');
    return sh.cells.map(r => (r || []).map(v => v == null ? '' : String(v)));
  }
  const resize = (a, n, fill) => { const b = (a || []).slice(0, n); while (b.length < n) b.push(typeof fill === 'function' ? fill(b.length) : fill); return b; };
  const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  const letter = i => String.fromCharCode(65 + i);
  const SER = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', '#c0398b', '#8a7a00', '#2a9bb0', '#7c5a3a', '#5a6b7d', '#b05a2a'];

  // ---------- 状態と保存 ----------
  const KEY = 'msa-calc-v1';
  const blankRows = (r, c) => Array.from({ length: r }, () => new Array(c).fill(''));
  function defaults() {
    return {
      tab: 'grr',
      grr: { k: 3, r: 3, n: 10, names: ['A', 'B', 'C'], cells: blankRows(9, 10), tol: '', sigP: '', method: 'anova', basis: 'tv', alpha: 0.05, keepIA: false, tableK: false },
      bias: { ref: '', tol: '', tv: '', alpha: 0.05, vals: new Array(20).fill('') },
      lin: { g: 5, m: 12, cells: blankRows(13, 5), tv: '', alpha: 0.05 },
      stab: { m: 1, ref: '', vals: new Array(30).fill('') },
      t1: { ref: '', tol: '', K: 20, L: 6, limit: 1.33, vals: new Array(30).fill('') },
      attr: { k: 3, r: 3, n: 20, names: ['A', 'B', 'C'], bad: '', ref: new Array(20).fill(''), cells: blankRows(20, 9) },
    };
  }
  let st = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) for (const k of Object.keys(st)) if (saved[k] != null) st[k] = typeof st[k] === 'object' ? Object.assign(st[k], saved[k]) : saved[k];
  } catch (e) { /* 保存できない環境・壊れた保存データは既定値で始める */ }
  let saveTimer = null;
  function save(tab) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(st)); const el = $(`[data-saved="${tab}"]`); if (el) el.textContent = 'この端末に保存しました'; } catch (e) { /* 無視 */ }
    }, 400);
  }

  // ---------- グラフ ----------
  const charts = []; // 再描画用 [{ el, render }]
  function chartHtml(id, name) {
    return `<div class="chart" id="${id}"><button class="btn small save no-print" type="button" data-png="${id}" data-name="${esc(name)}">画像を保存</button></div>`;
  }
  function mount(id, render) {
    const el = document.getElementById(id); if (!el) return;
    const draw = () => { const btn = el.querySelector('.save'); el.innerHTML = render(); if (btn) el.appendChild(btn); };
    draw();
    charts.push({ el, render: draw });
  }
  function redrawCharts() {
    for (let i = charts.length - 1; i >= 0; i--) { if (!document.body.contains(charts[i].el)) charts.splice(i, 1); else charts[i].render(); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-png]'); if (!b) return;
    const svg = document.getElementById(b.dataset.png).querySelector('svg');
    if (svg) C.svgToPng(svg, `${stamp()}_${b.dataset.name}.png`);
  });
  // 項目ごとの棒グラフ（系列を横に並べる）
  function barChart({ title, cats, series, yLabel, hlines = [], yMax }) {
    const W = 640, H = 360, L = 58, R = 16, Tp = 34, B = 46;
    let top = Math.max(1, ...series.flatMap(s => s.values.filter(Number.isFinite)), ...hlines.map(h => h.y));
    if (yMax) top = Math.max(top, yMax);
    const { t, step } = C.ticks(0, top * 1.08, 5), y1 = t[t.length - 1] >= top * 1.08 ? t[t.length - 1] : top * 1.08;
    const Y = v => H - B - v / y1 * (H - Tp - B);
    const cw = (W - L - R) / cats.length, bw = Math.min(28, cw * 0.8 / series.length);
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="var(--f-ui)" role="img" aria-label="${esc(title)}"><rect width="${W}" height="${H}" fill="var(--surface)"/>`;
    s += `<text x="${L}" y="20" font-size="14" font-weight="700" fill="var(--ink)">${esc(title)}</text>`;
    const dig = step < 1 ? (String(step).split('.')[1] || '').length : 0;
    for (const v of t) if (v <= y1) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--f-num)">${v.toFixed(dig)}</text>`;
    if (yLabel) s += `<text transform="translate(14 ${(Tp + H - B) / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(yLabel)}</text>`;
    cats.forEach((c, i) => {
      const x0 = L + i * cw + (cw - bw * series.length) / 2;
      series.forEach((se, j) => {
        const v = se.values[i]; if (!Number.isFinite(v)) return;
        s += `<rect x="${x0 + j * bw + 1}" y="${Y(Math.max(0, v))}" width="${bw - 2}" height="${Math.max(0, Y(0) - Y(Math.max(0, v)))}" fill="${se.color}" fill-opacity=".8"/>`;
      });
      s += `<text x="${L + i * cw + cw / 2}" y="${H - B + 18}" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(c)}</text>`;
    });
    for (const h of hlines) s += `<line x1="${L}" x2="${W - R}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - R - 4}" y="${Y(h.y) - 4}" font-size="11" text-anchor="end" fill="${h.color}" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${esc(h.text)}</text>`;
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/>`;
    let lx = W - R;
    for (const se of [...series].reverse()) {
      const w = 22 + [...se.label].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 11.5 : 6.5), 0) + 12;
      lx -= w;
      s += `<rect x="${lx}" y="10" width="14" height="10" fill="${se.color}" fill-opacity=".8"/><text x="${lx + 18}" y="19" font-size="11" fill="var(--ink2)">${esc(se.label)}</text>`;
    }
    return C.resolveVars(s + '</svg>');
  }
  // ヒストグラムの棒（Sturges）
  function histBars(x) {
    const lo = Math.min(...x), hi = Math.max(...x);
    const k = Math.max(5, Math.ceil(Math.log2(x.length) + 1));
    const w = (hi - lo) / k || Math.abs(lo) * 0.01 || 1;
    const bars = Array.from({ length: k }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, h: 0 }));
    for (const v of x) bars[Math.min(k - 1, Math.floor((v - lo) / w))].h++;
    return bars;
  }

  // ---------- 結果の部品 ----------
  const banner = (lv, big, sub) => `<div class="banner ${lv || 'none'}"><span class="big">${esc(big)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const kv = items => `<dl class="kv">${items.map(([k, v, s]) => `<div><dt>${esc(k)}</dt><dd class="num">${v}${s ? ` <small>${s}</small>` : ''}</dd></div>`).join('')}</dl>`;
  function table(head, rows, opt = {}) {
    return `<div class="tbl-wrap"><table><thead><tr>${head.map((h, i) => `<th class="${i === 0 ? 'l' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => { const o = typeof c === 'object' && c !== null ? c : { v: c }; return `<td class="${i === 0 ? 'l' : 'num'} ${o.cls || ''}">${o.v}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const notes = list => list.length ? `<ul class="log">${list.map(([k, s]) => `<li class="${k}">${esc(s)}</li>`).join('')}</ul>` : '';
  // %GRR のメーター（0〜10% 合格、10〜30% 条件付き、30% 超 不合格）
  function meter(v, caption) {
    const max = 50, p = x => Math.min(100, Math.max(0, x / max * 100));
    return `<div class="meter"><div class="cap">${esc(caption)}</div><div class="bar"><span style="width:${p(10)}%;background:var(--ok)"></span><span style="width:${p(30) - p(10)}%;background:var(--warn)"></span><span style="width:${100 - p(30)}%;background:var(--ng)"></span></div>`
      + `<div class="needle"><i style="left:${p(v)}%"></i><b style="left:${Math.min(94, Math.max(6, p(v)))}%">${pct(v, 1)}</b></div>`
      + `<div class="scale">${[0, 10, 20, 30, 40, 50].map(t => `<span style="left:${p(t)}%">${t}${t === 50 ? '%+' : '%'}</span>`).join('')}</div></div>`;
  }
  const tools = tab => `<div class="tools no-print"><button class="btn" type="button" data-print="${tab}">印刷・PDF</button><button class="btn" type="button" data-xlsx="${tab}">結果を Excel で保存</button></div>`;
  const results = {}; // タブごとの最新の結果（Excel 保存用）

  // ---------- テーマ ----------
  const THEMES = ['auto', 'light', 'dark'], THEME_LABEL = { auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク' };
  let theme = 'auto';
  try { theme = localStorage.getItem('msa-calc-theme') || 'auto'; } catch (e) { /* 保存できない環境 */ }
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
    $('#themeBtn').textContent = THEME_LABEL[t];
    redrawCharts();
  }
  $('#themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % 3];
    try { localStorage.setItem('msa-calc-theme', theme); } catch (e) { /* 無視 */ }
    applyTheme(theme);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') redrawCharts(); });

  // ---------- タブ ----------
  const TAB_NAME = { grr: 'ゲージR&R', bias: '偏り', lin: '直線性', stab: '安定性', t1: 'Type-1', attr: '計数値', explain: '解説' };
  function showTab(tab) {
    if (!TAB_NAME[tab]) tab = 'grr';
    $$('nav.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === tab)));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
    st.tab = tab; save(tab);
    redrawCharts();
  }
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); window.scrollTo({ top: 0 }); }));

  // 入力欄と状態を結ぶ
  function bindNum(id, obj, key, onChange) {
    const el = $(id);
    el.value = obj[key] ?? '';
    el.addEventListener('input', () => { obj[key] = el.value; onChange(); });
  }
  function bindSeg(id, obj, key, onChange) {
    const seg = $(id);
    const sync = () => seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === obj[key])));
    seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; obj[key] = b.dataset.v; sync(); onChange(); });
    sync();
  }
  function bindChk(id, obj, key, onChange) {
    const el = $(id); el.checked = !!obj[key];
    el.addEventListener('change', () => { obj[key] = el.checked; onChange(); });
  }
  const debounce = (f, ms = 250) => { let h; return () => { clearTimeout(h); h = setTimeout(f, ms); }; };
  function fileInput(id, onRows) {
    $(id).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { onRows(await readFile(f)); toast(`${f.name} を読み込みました`); } catch (err) { toast('読み込めませんでした：' + err.message); console.error(err); }
      e.target.value = '';
    });
  }
  // 名前の入力欄（測定者）
  function nameInputs(box, obj, onChange) {
    box.innerHTML = '<span class="lbl">測定者の名前</span>' + obj.names.map((n, i) => `<input type="text" data-i="${i}" value="${esc(n)}" aria-label="測定者${i + 1}の名前">`).join('');
    box.oninput = e => { const i = e.target.dataset.i; if (i == null) return; obj.names[+i] = e.target.value; onChange(); };
  }

  // ---------- サンプルデータ（乱数の種を固定） ----------
  function rng(seed) {
    let s = seed >>> 0;
    const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
    return { u, n: () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
  }
  const round = (v, d) => String(Number(v.toFixed(d)));

  // ============ ゲージR&R ============
  const G = st.grr;
  function grrFixShape() {
    G.k = clampInt(G.k, 2, 10, 3); G.r = clampInt(G.r, 2, 10, 3); G.n = clampInt(G.n, 2, 50, 10);
    G.names = resize(G.names, G.k, i => letter(i));
    G.cells = resize(G.cells, G.k * G.r, () => []).map(row => resize(row, G.n, ''));
  }
  grrFixShape();
  // 測定者・回数を変えたとき、測定者ごとの行を保ったまま並べ直す
  function grrReshape(k, r, n) {
    const old = G.cells, oR = G.r;
    const cells = [];
    for (let a = 0; a < k; a++) for (let t = 0; t < r; t++) cells.push(resize(a < G.k && t < oR ? old[a * oR + t] : [], n, ''));
    G.k = k; G.r = r; G.n = n; G.cells = cells; G.names = resize(G.names, k, i => letter(i));
  }
  const grrTable = T.create($('#grrGrid'), {
    rows: () => G.k * G.r, cols: () => G.n,
    get: (r, c) => G.cells[r][c], set: (r, c, v) => { G.cells[r][c] = v; },
    rowHead: r => `${esc(G.names[Math.floor(r / G.r)] || letter(Math.floor(r / G.r)))}-${(r % G.r) + 1}`,
    colHead: c => `部品${c + 1}`,
    rowClass: r => r % G.r === 0 && r > 0 ? 'sep' : '',
    grow: (rows, cols) => {
      // 行が増えるときは回数を増やす（測定者の人数はそのまま）
      const r = Math.min(10, Math.max(G.r, Math.ceil(rows / G.k)));
      grrReshape(G.k, r, Math.min(50, cols));
      grrSyncInputs();
    },
    onPaste: (block, r0, c0) => {
      // 見出し（数値でない）を含む表や縦長の表は、表全体として読み取る
      const hasText = block.some(row => row.some(v => v.trim() !== '' && num(v) == null));
      if (!hasText) return false;
      try { grrApply(I.grr(block, G)); toast('表を読み取りました'); } catch (e) { toast('読み取れませんでした：' + e.message); }
      return true;
    },
    onChange: () => grrChanged(),
  });
  function grrApply(d) {
    G.k = d.k; G.r = d.r; G.n = d.n; G.cells = d.cells;
    G.names = d.names ? d.names.slice() : resize(G.names, d.k, i => letter(i));
    grrFixShape(); grrSyncInputs(); grrTable.render(); grrChanged();
  }
  function grrSyncInputs() {
    $('#grrK').value = G.k; $('#grrR').value = G.r; $('#grrN').value = G.n;
    nameInputs($('#grrNames'), G, () => { grrTable.render(); grrChanged(); });
  }
  ['#grrK', '#grrR', '#grrN'].forEach(id => $(id).addEventListener('change', () => {
    grrReshape(clampInt($('#grrK').value, 2, 10, G.k), clampInt($('#grrR').value, 2, 10, G.r), clampInt($('#grrN').value, 2, 50, G.n));
    grrSyncInputs(); grrTable.render(); grrChanged();
  }));
  grrSyncInputs();
  const grrChangedNow = () => { save('grr'); grrCompute(); };
  const grrChanged = debounce(grrChangedNow);
  bindNum('#grrTol', G, 'tol', grrChanged);
  bindNum('#grrSigP', G, 'sigP', grrChanged);
  bindNum('#grrAlpha', G, 'alpha', grrChanged);
  bindChk('#grrKeepIA', G, 'keepIA', grrChanged);
  bindChk('#grrTableK', G, 'tableK', grrChanged);
  const grrOptsVis = () => { $('#grrAnovaOpts').hidden = G.method !== 'anova'; $('#grrArOpts').hidden = G.method !== 'avgRange'; };
  bindSeg('#grrMethod', G, 'method', () => { grrOptsVis(); grrChanged(); });
  bindSeg('#grrBasis', G, 'basis', grrChanged);
  grrOptsVis();
  fileInput('#grrFile', rows => grrApply(I.grr(rows, G)));

  function grrData() {
    const data = [], miss = [];
    for (let a = 0; a < G.k; a++) {
      const at = [];
      for (let t = 0; t < G.r; t++) at.push(G.cells[a * G.r + t].map((v, p) => { const x = num(v); if (x == null) miss.push(`${G.names[a]}-${t + 1}・部品${p + 1}`); return x; }));
      data.push(at);
    }
    return { data, miss };
  }
  function grrCompute() {
    const out = $('#grrOut');
    const { data, miss } = grrData();
    const total = G.k * G.r * G.n;
    if (miss.length === total) { out.innerHTML = '<h2><span class="step">3</span>結果</h2><p class="empty">測定値を入力するか、「サンプルデータで試す」を押してください。</p>'; results.grr = null; return; }
    if (miss.length) { out.innerHTML = `<h2><span class="step">3</span>結果</h2><p class="empty">未入力・数値でないセルが ${miss.length} 個あります（${esc(miss.slice(0, 5).join('、'))}${miss.length > 5 ? ' ほか' : ''}）。全セルの入力が必要です。</p>`; results.grr = null; return; }
    const tol = num(G.tol), sigP = num(G.sigP);
    const opt = { tol: tol > 0 ? tol : null, sigmaProcess: sigP > 0 ? sigP : null, alphaInteraction: num(G.alpha) ?? 0.05, keepInteraction: G.keepIA, tableK: G.tableK };
    let R, other;
    try {
      R = G.method === 'anova' ? M.grrAnova(data, opt) : M.grrAvgRange(data, opt);
      other = G.method === 'anova' ? M.grrAvgRange(data, opt) : M.grrAnova(data, opt);
    } catch (e) { out.innerHTML = `<h2><span class="step">3</span>結果</h2><p class="err-msg">${esc(e.message)}</p>`; results.grr = null; return; }
    results.grr = { R, other, opt };
    const useTol = G.basis === 'tol' && R.pctTolGRR != null;
    const main = useTol ? R.pctTolGRR : R.pctGRR;
    const lvPct = M.judgePct(main), lvNdc = R.ndc >= 5 ? 'ok' : 'ng';
    const lv = worst([lvPct, lvNdc]);
    const notesList = [];
    if (G.basis === 'tol' && R.pctTolGRR == null) notesList.push(['warn', '公差幅が未入力のため、全変動（%TV）で判定しました']);
    for (const s of R.notes) notesList.push([/有意です|超えた|望ましく|負/.test(s) ? 'warn' : 'info', s]);
    if (R.tvSource === 'process') notesList.push(['info', '全変動（TV）に入力した工程の標準偏差を使いました']);
    const basisLabel = useTol ? '%GRR（公差に対する割合）' : (R.tvSource === 'process' ? '%GRR（工程変動に対する割合）' : '%GRR（全変動に対する割合）');
    const sub = `${basisLabel} ${pct(main)} ${tag(lvPct)} ／ 区別できる区分の数 ndc = ${R.ndc} ${tag(lvNdc, R.ndc >= 5 ? '5 以上' : '5 未満')}`;
    const big = lv === 'ok' ? '測定システムは合格' : lv === 'cond' ? '条件付きで合格（用途・費用を考えて判断）' : '測定システムは不合格（改善が必要）';
    const hasIA = R.IA != null;
    const rows = R.rows.map(x => [
      { EV: '繰り返し性（EV）', AV: '再現性（AV）', IA: '交互作用（IA）', GRR: 'ゲージR&R（GRR）', PV: '部品変動（PV）', TV: '全変動（TV）' }[x.name],
      sig(x.sd), sig(x.sv), pct(x.pctContrib), x.name === 'GRR' ? { v: pct(x.pctTV), cls: M.judgePct(x.pctTV) } : pct(x.pctTV), x.pctTol == null ? '―' : x.name === 'GRR' ? { v: pct(x.pctTol), cls: M.judgePct(x.pctTol) } : pct(x.pctTol),
    ]);
    let h = `<h2><span class="step">3</span>結果</h2>` + banner(lv, big, sub) + meter(main, basisLabel + '　10% 未満 合格／10〜30% 条件付き／30% 超 不合格');
    h += kv([
      ['方式', G.method === 'anova' ? 'ANOVA 法' : '平均・範囲法'],
      ['測定者 × 回 × 部品', `${R.k} × ${R.r} × ${R.n}`],
      ['GRR（σ）', sig(R.GRR)], ['%GRR（対 TV）', pct(R.pctGRR)], ['%GRR（対公差）', pct(R.pctTolGRR)],
      ['ndc', String(R.ndc), `1.41 × PV/GRR = ${sig(R.ndcRaw, 3)}`],
      [G.method === 'anova' ? '平均・範囲法では' : 'ANOVA 法では', pct(useTol ? other.pctTolGRR : other.pctGRR), `ndc ${other.ndc}`],
    ]);
    h += `<h3 class="sec">変動の内訳</h3>` + table(['要因', '標準偏差 σ', '6σ', '%寄与（分散）', '%TV', '%公差'], rows);
    if (G.method === 'anova') {
      h += `<h3 class="sec">分散分析表</h3>` + table(['要因', '自由度', '平方和', '平均平方', 'F', 'p 値'], R.table.map(t => [t.source, String(t.df), sig(t.ss, 5), t.ms == null ? '' : sig(t.ms, 5), t.F == null ? '' : fix(t.F, 3), t.p == null ? '' : pval(t.p)]));
    } else {
      h += `<h3 class="sec">計算の途中</h3>` + table(['測定者', '範囲の平均 R̄', '平均 X̄'], R.Rbar.map((rb, a) => [esc(G.names[a]), sig(rb), sig(R.Xbar[a])]))
        + kv([['R̿', sig(R.Rbb)], ['X̄diff', sig(R.Xdiff)], ['Rp（部品平均の範囲）', sig(R.Rp)], ['K1', sig(R.K1)], ['K2', sig(R.K2)], ['K3', sig(R.K3)], ['UCL(R) = D4 × R̿', sig(R.rChart.ucl)]]);
    }
    h += notes(notesList.length ? notesList : []);
    h += `<h3 class="sec">グラフ</h3><div class="charts">${chartHtml('gc1', 'GRR_内訳')}${chartHtml('gc2', 'GRR_範囲')}${chartHtml('gc3', 'GRR_平均')}${chartHtml('gc4', 'GRR_部品ごと')}${chartHtml('gc5', 'GRR_測定者ごと')}${chartHtml('gc6', 'GRR_交互作用')}</div>`;
    h += tools('grr');
    out.innerHTML = h;
    // 内訳
    const comp = ['GRR', 'EV', 'AV'].concat(hasIA ? ['IA'] : [], ['PV']);
    const get = (name, key) => (R.rows.find(x => x.name === name) || {})[key];
    const series = [{ label: '%寄与', color: 'var(--s1)', values: comp.map(c => get(c, 'pctContrib')) }, { label: '%TV', color: 'var(--s2)', values: comp.map(c => get(c, 'pctTV')) }];
    if (R.pctTolGRR != null) series.push({ label: '%公差', color: 'var(--s3)', values: comp.map(c => get(c, 'pctTol')) });
    mount('gc1', () => barChart({ title: '変動の内訳', cats: comp, series, yLabel: '%', hlines: [{ y: 10, text: '10%', color: 'var(--ok)' }, { y: 30, text: '30%', color: 'var(--ng)' }] }));
    // 範囲と平均の管理図（測定者ごとに区切る）
    const ar = G.method === 'avgRange' ? R : other;
    const blocks = (vals, title, lines, yLabel) => () => {
      const layers = [];
      vals.forEach((vs, a) => {
        const pts = vs.map((v, p) => [a * G.n + p + 1, v]);
        layers.push({ type: 'line', data: pts, color: SER[a % SER.length], width: 1.5 }, { type: 'points', data: pts, color: SER[a % SER.length], r: 3.5, label: G.names[a] });
        if (a > 0) layers.push({ type: 'vline', x: a * G.n + 0.5, color: 'var(--line)', width: 1 });
      });
      for (const l of lines) layers.push({ type: 'hline', y: l.y, color: l.color, dash: l.dash, text: l.text });
      return C.plot({ title, xLabel: '測定者ごとの部品', yLabel, x: [0.5, G.k * G.n + 0.5], layers });
    };
    mount('gc2', blocks(ar.ranges, '範囲の管理図（測定者ごと）', [{ y: ar.rChart.ucl, color: 'var(--ng)', dash: '6 4', text: `UCL ${sig(ar.rChart.ucl)}` }, { y: ar.rChart.cl, color: 'var(--ink2)', text: `R̿ ${sig(ar.rChart.cl)}` }], '範囲'));
    mount('gc3', blocks(ar.cellMean, '平均の管理図（測定者ごと）', [{ y: ar.xChart.ucl, color: 'var(--ng)', dash: '6 4', text: 'UCL' }, { y: ar.xChart.cl, color: 'var(--ink2)', text: 'X̿' }, { y: ar.xChart.lcl, color: 'var(--ng)', dash: '6 4', text: 'LCL' }], '平均'));
    // 部品ごとの測定値
    mount('gc4', () => {
      const layers = [];
      data.forEach((at, a) => {
        const off = (a - (G.k - 1) / 2) * Math.min(0.12, 0.6 / G.k);
        layers.push({ type: 'points', data: at.flatMap(tr => tr.map((v, p) => [p + 1 + off, v])), color: SER[a % SER.length], r: 3, label: G.names[a] });
      });
      layers.push({ type: 'line', data: ar.partMean.map((v, p) => [p + 1, v]), color: 'var(--ink)', width: 1.5, label: '部品の平均' });
      return C.plot({ title: '部品ごとの測定値', xLabel: '部品', yLabel: '測定値', x: [0.5, G.n + 0.5], layers });
    });
    // 測定者ごとの測定値
    mount('gc5', () => {
      const layers = [];
      const r = rng(7);
      data.forEach((at, a) => layers.push({ type: 'points', data: at.flat().map(v => [a + 1 + (r.u() - 0.5) * 0.3, v]), color: SER[a % SER.length], r: 3, label: G.names[a] }));
      layers.push({ type: 'line', data: ar.Xbar.map((v, a) => [a + 1, v]), color: 'var(--ink)', width: 2, label: '平均' });
      return C.plot({ title: '測定者ごとの測定値', xLabel: '測定者', yLabel: '測定値', x: [0.4, G.k + 0.6], layers });
    });
    // 交互作用（部品 × 測定者の平均）
    mount('gc6', () => C.plot({
      title: '部品 × 測定者の平均（線が平行なら交互作用なし）', xLabel: '部品', yLabel: '平均', x: [0.5, G.n + 0.5],
      layers: ar.cellMean.flatMap((vs, a) => [{ type: 'line', data: vs.map((v, p) => [p + 1, v]), color: SER[a % SER.length], width: 1.8, label: G.names[a] }, { type: 'points', data: vs.map((v, p) => [p + 1, v]), color: SER[a % SER.length], r: 3 }]),
    }));
  }
  function grrSample() {
    const r = rng(20261010);
    const parts = Array.from({ length: 10 }, () => 10 + r.n() * 0.9), ops = [0.03, -0.12, 0.09];
    grrApply({
      k: 3, r: 3, n: 10, names: ['田中', '鈴木', '佐藤'],
      cells: ops.flatMap((o, a) => [0, 1, 2].map(() => parts.map(p => round(p + o + r.n() * 0.18, 2)))),
    });
    G.tol = '6'; $('#grrTol').value = '6'; grrChangedNow();
  }

  // ============ 偏り ============
  const B = st.bias;
  const listTable = (el, obj, label, onChange) => T.create(el, {
    rows: () => obj.vals.length, cols: () => 1, autoRows: true,
    get: r => obj.vals[r], set: (r, c, v) => { obj.vals[r] = v; },
    rowHead: r => String(r + 1), colHead: () => label,
    grow: rows => { obj.vals = resize(obj.vals, Math.min(2000, rows), ''); },
    onPaste: (block, r0) => {
      // 複数列の表なら数値の列を探す。1 列ならその位置から埋める
      let vals;
      if (block.some(row => row.length > 1) || block.some(row => row.some(v => v.trim() !== '' && num(v) == null))) {
        try { vals = I.column(block); } catch (e) { toast(e.message); return true; }
        r0 = 0; obj.vals = [];
      } else vals = block.map(row => row[0].trim());
      obj.vals = resize(obj.vals, Math.max(obj.vals.length, r0 + vals.length + 1), '');
      vals.forEach((v, i) => { obj.vals[r0 + i] = v; });
      onChange(true);
      return true;
    },
    onChange: () => onChange(false),
  });
  const values = obj => obj.vals.map(num).filter(v => v != null);
  const badCount = obj => obj.vals.filter(v => String(v).trim() !== '' && num(v) == null).length;
  const biasTable = listTable($('#biasGrid'), B, '測定値', re => { if (re) biasTable.render(); biasChanged(); });
  const biasChangedNow = () => { save('bias'); biasCompute(); };
  const biasChanged = debounce(biasChangedNow);
  bindNum('#biasRef', B, 'ref', biasChanged);
  bindNum('#biasTol', B, 'tol', biasChanged);
  bindNum('#biasTV', B, 'tv', biasChanged);
  bindNum('#biasAlpha', B, 'alpha', biasChanged);
  fileInput('#biasFile', rows => { B.vals = I.column(rows).concat(['']); biasTable.render(); biasChangedNow(); });
  function biasCompute() {
    const out = $('#biasOut'), x = values(B), ref = num(B.ref);
    const head = '<h2><span class="step">2</span>結果</h2>';
    if (x.length < 2) { out.innerHTML = head + '<p class="empty">測定値を 2 個以上入力してください（10 回以上を推奨）。</p>'; results.bias = null; return; }
    if (ref == null) { out.innerHTML = head + '<p class="empty">基準値を入力してください。</p>'; results.bias = null; return; }
    let R;
    try { R = M.bias(x, ref, { alpha: num(B.alpha) ?? 0.05, tol: num(B.tol), tv: num(B.tv) }); } catch (e) { out.innerHTML = head + `<p class="err-msg">${esc(e.message)}</p>`; return; }
    results.bias = R;
    const lv = R.acceptable ? 'ok' : 'ng';
    const conf = Math.round((1 - R.alpha) * 1000) / 10;
    const n = [];
    if (badCount(B)) n.push(['warn', `数値でないセル ${badCount(B)} 個は除きました`]);
    R.notes.forEach(s => n.push(['warn', s]));
    let h = head + banner(lv, R.acceptable ? '偏りは 0 と見なせる（許容できる）' : '偏りがある（0 と見なせない）', `偏り ${sig(R.bias)} ／ ${conf}% 信頼区間 ${sig(R.ci[0])} 〜 ${sig(R.ci[1])}（0 を${R.acceptable ? '含む' : '含まない'}）`);
    h += kv([
      ['測定回数 n', String(R.n)], ['平均', sig(R.mean, 6)], ['基準値', sig(R.ref, 6)], ['偏り', sig(R.bias)],
      ['繰り返し性 σr', sig(R.sigmaR)], ['偏りの標準誤差 σb', sig(R.sigmaB)], ['t 値', fix(R.t, 3), `自由度 ${R.df}、臨界値 ${fix(R.tCrit, 3)}`], ['p 値', pval(R.p)],
      ['偏り／公差', pct(R.pctBiasTol)], ['偏り／全変動（6σ）', pct(R.pctBiasTV)], ['6σr／公差', pct(R.pctEVTol)],
    ]);
    h += notes(n);
    h += `<div class="charts">${chartHtml('bc1', '偏り_ヒストグラム')}${chartHtml('bc2', '偏り_測定順')}</div>` + tools('bias');
    out.innerHTML = h;
    mount('bc1', () => C.plot({
      title: '測定値の分布', xLabel: '測定値', yLabel: '度数', yZero: true,
      layers: [{ type: 'bars', data: histBars(x), color: 'var(--s1)', label: '度数' },
        { type: 'vline', x: R.ref, color: 'var(--ink)', width: 2, text: '基準値' },
        { type: 'vline', x: R.mean, color: 'var(--s2)', width: 2, text: '平均' },
        { type: 'vline', x: R.ref + R.ci[0], color: 'var(--s2)', dash: '5 4', text: '' },
        { type: 'vline', x: R.ref + R.ci[1], color: 'var(--s2)', dash: '5 4', text: `基準値＋偏りの${conf}%区間` }],
    }));
    mount('bc2', () => C.plot({
      title: '測定順の値', xLabel: '測定順', yLabel: '測定値',
      layers: [{ type: 'line', data: x.map((v, i) => [i + 1, v]), color: 'var(--s1)', width: 1.5 }, { type: 'points', data: x.map((v, i) => [i + 1, v]), color: 'var(--s1)' },
        { type: 'hline', y: R.ref, color: 'var(--ink)', text: '基準値' }, { type: 'hline', y: R.mean, color: 'var(--s2)', dash: '5 4', text: '平均' }],
    }));
  }
  function biasSample() {
    const r = rng(15);
    B.ref = '6.00'; $('#biasRef').value = B.ref; B.tol = '2'; $('#biasTol').value = B.tol;
    B.vals = Array.from({ length: 15 }, () => round(6.02 + r.n() * 0.2, 2)).concat(['']);
    biasTable.render(); biasChangedNow();
  }

  // ============ 直線性 ============
  const Lr = st.lin;
  function linFix() {
    Lr.g = clampInt(Lr.g, 2, 30, 5); Lr.m = clampInt(Lr.m, 1, 100, 12);
    Lr.cells = resize(Lr.cells, Lr.m + 1, () => []).map(row => resize(row, Lr.g, ''));
  }
  linFix();
  const linTable = T.create($('#linGrid'), {
    rows: () => Lr.m + 1, cols: () => Lr.g,
    get: (r, c) => Lr.cells[r][c], set: (r, c, v) => { Lr.cells[r][c] = v; },
    rowHead: r => r === 0 ? '基準値' : `${r}回目`, colHead: c => `部品${c + 1}`,
    rowClass: r => r === 0 ? 'refrow' : r === 1 ? 'sep' : '',
    grow: (rows, cols) => { Lr.m = Math.min(100, rows - 1); Lr.g = Math.min(30, cols); linFix(); linSync(); },
    onPaste: block => {
      if (!block.some(row => row.some(v => v.trim() !== '' && num(v) == null))) return false;
      try { linApply(I.linearity(block)); toast('表を読み取りました'); } catch (e) { toast('読み取れませんでした：' + e.message); }
      return true;
    },
    onChange: () => linChanged(),
  });
  function linApply(d) {
    Lr.g = d.refs.length; Lr.m = Math.max(...d.cols.map(c => c.length));
    Lr.cells = [d.refs.slice()].concat(Array.from({ length: Lr.m }, (_, i) => d.cols.map(c => c[i] ?? '')));
    linFix(); linSync(); linTable.render(); linChangedNow();
  }
  function linSync() { $('#linG').value = Lr.g; $('#linM').value = Lr.m; }
  ['#linG', '#linM'].forEach(id => $(id).addEventListener('change', () => { Lr.g = $('#linG').value; Lr.m = $('#linM').value; linFix(); linSync(); linTable.render(); linChanged(); }));
  linSync();
  const linChangedNow = () => { save('lin'); linCompute(); };
  const linChanged = debounce(linChangedNow);
  bindNum('#linTV', Lr, 'tv', linChanged);
  bindNum('#linAlpha', Lr, 'alpha', linChanged);
  fileInput('#linFile', rows => linApply(I.linearity(rows)));
  function linCompute() {
    const out = $('#linOut'), head = '<h2><span class="step">2</span>結果</h2>';
    const parts = [];
    for (let c = 0; c < Lr.g; c++) {
      const ref = num(Lr.cells[0][c]);
      const x = Lr.cells.slice(1).map(row => num(row[c])).filter(v => v != null);
      if (ref != null && x.length) parts.push({ ref, x });
    }
    if (parts.length < 2) { out.innerHTML = head + '<p class="empty">基準値（1 行目）と測定値のある部品を 2 個以上入力してください（5 個以上を推奨）。</p>'; results.lin = null; return; }
    let R;
    try { R = M.linearity(parts, { alpha: num(Lr.alpha) ?? 0.05, tv: num(Lr.tv) }); } catch (e) { out.innerHTML = head + `<p class="err-msg">${esc(e.message)}</p>`; results.lin = null; return; }
    results.lin = R;
    const lv = R.acceptable ? 'ok' : 'ng';
    const n = R.notes.map(s => ['warn', s]);
    const skipped = Lr.g - parts.length;
    if (skipped) n.push(['info', `基準値か測定値のない部品 ${skipped} 個は除きました`]);
    if (!R.slopeOk) n.push(['warn', `傾きが 0 でない（|t| = ${fix(R.tSlope, 3)} > ${fix(R.tCrit, 3)}）。測定範囲の位置によって偏りが変わります`]);
    if (!R.interceptOk) n.push(['warn', `切片が 0 でない（|t| = ${fix(R.tIntercept, 3)} > ${fix(R.tCrit, 3)}）`]);
    let h = head + banner(lv, R.acceptable ? '直線性は許容できる' : '直線性に問題がある', `「偏り = 0」の線が回帰直線の ${Math.round((1 - (num(Lr.alpha) ?? 0.05)) * 1000) / 10}% 信頼帯の${R.acceptable ? '中に収まる' : '外に出る'}`);
    h += kv([
      ['部品数 g', String(R.g)], ['測定値の数', String(R.N)], ['傾き a', sig(R.slope)], ['切片 b', sig(R.intercept)], ['決定係数 R²', fix(R.R2, 4)], ['残差の標準偏差 s', sig(R.s)],
      ['傾きの t', fix(R.tSlope, 3), `p ${pval(R.pSlope)}`], ['切片の t', fix(R.tIntercept, 3), `p ${pval(R.pIntercept)}`], ['t の臨界値', fix(R.tCrit, 3), `自由度 ${R.df}`],
      ['%直線性（|a| × 100）', pct(R.pctLinearity), R.linearity != null ? `直線性 ${sig(R.linearity)}` : '全変動 σ を入れると表示'],
    ]);
    h += `<h3 class="sec">部品ごとの偏り</h3>` + table(['基準値', '回数', '偏りの平均', '標準偏差', 't', 'p 値'], R.perPart.map(p => [sig(p.ref, 6), String(p.n), sig(p.bias), sig(p.sd), fix(p.t, 3), pval(p.p)]));
    h += notes(n);
    h += `<div class="charts">${chartHtml('lc1', '直線性')}</div>` + tools('lin');
    out.innerHTML = h;
    mount('lc1', () => {
      const [lo, hi] = R.range, xs = Array.from({ length: 61 }, (_, i) => lo + (hi - lo) * i / 60);
      return C.plot({
        title: '偏りと基準値（回帰直線と信頼帯）', xLabel: '基準値', yLabel: '偏り',
        layers: [
          { type: 'points', data: R.points, color: 'var(--s1)', r: 2.5, label: '偏り' },
          { type: 'points', data: R.perPart.map(p => [p.ref, p.bias]), color: 'var(--s2)', r: 5, label: '部品ごとの平均' },
          { type: 'line', data: xs.map(x => [x, R.intercept + R.slope * x]), color: 'var(--ink)', width: 2, label: '回帰直線' },
          { type: 'line', data: xs.map(x => [x, R.band(x)[0]]), color: 'var(--s4)', dash: '6 4', label: '信頼帯' },
          { type: 'line', data: xs.map(x => [x, R.band(x)[1]]), color: 'var(--s4)', dash: '6 4' },
          { type: 'hline', y: 0, color: R.acceptable ? 'var(--ok)' : 'var(--ng)', width: 2, text: '偏り = 0' },
        ],
      });
    });
  }
  function linSample() {
    const r = rng(5);
    const refs = [2, 4, 6, 8, 10];
    linApply({ refs: refs.map(String), cols: refs.map(v => Array.from({ length: 12 }, () => round(v + 0.6 - 0.11 * v + r.n() * 0.2, 2))) });
  }

  // ============ 安定性 ============
  const Sb = st.stab;
  const stabTable = listTable($('#stabGrid'), Sb, '測定値（測定順）', re => { if (re) stabTable.render(); stabChanged(); });
  const stabChangedNow = () => { save('stab'); stabCompute(); };
  const stabChanged = debounce(stabChangedNow);
  bindNum('#stabM', Sb, 'm', stabChanged);
  bindNum('#stabRef', Sb, 'ref', stabChanged);
  fileInput('#stabFile', rows => { Sb.vals = I.column(rows).concat(['']); stabTable.render(); stabChangedNow(); });
  function stabCompute() {
    const out = $('#stabOut'), head = '<h2><span class="step">2</span>結果</h2>';
    const x = values(Sb), m = clampInt(Sb.m, 1, 10, 1), ref = num(Sb.ref);
    if (x.length < Math.max(2, 2 * m)) { out.innerHTML = head + '<p class="empty">測定値を入力してください（サブグループ 20〜25 組程度が目安）。</p>'; results.stab = null; return; }
    let R;
    try { R = M.stability(x, m, ref); } catch (e) { out.innerHTML = head + `<p class="err-msg">${esc(e.message)}</p>`; results.stab = null; return; }
    results.stab = R;
    const c = R.chart, isI = m === 1;
    const lv = R.stable ? 'ok' : 'ng';
    const n = R.notes.map(s => ['warn', s]);
    if (badCount(Sb)) n.push(['warn', `数値でないセル ${badCount(Sb)} 個は除きました`]);
    for (const hit of R.mainHits) n.push(['err', `${isI ? 'I' : 'X̄'} 管理図：${hit.text}（${hit.from + 1}〜${hit.to + 1} 番目）`]);
    if (R.rangeOut.length) n.push(['err', `${isI ? '移動範囲' : '範囲'}の管理図：管理限界の外 ${R.rangeOut.map(i => i + c.range.start).join('、')} 番目`]);
    let h = head + banner(lv, R.stable ? '安定している（異常の兆候なし）' : '不安定（管理図に異常の兆候あり）', `${isI ? 'I-MR' : 'X̄-R'} 管理図、JIS Z 9020-2 の 8 ルールで判定`);
    h += kv([
      ['測定値の数', String(x.length)], [isI ? '測定点' : 'サブグループ', String(c.main.points.length)], ['平均', sig(R.mean, 6)], ['偏り（平均 − 基準値）', sig(R.bias)],
      ['繰り返し性 σ（群内）', sig(R.sigma)], ['中心線', sig(c.main.cl[0], 6)], ['UCL', sig(c.main.ucl[0], 6)], ['LCL', sig(c.main.lcl[0], 6)],
    ]);
    h += notes(n);
    h += `<div class="charts">${chartHtml('sc1', '安定性_平均')}${chartHtml('sc2', '安定性_範囲')}</div>` + tools('stab');
    out.innerHTML = h;
    const hitIdx = new Set(R.mainHits.flatMap(hh => hh.ends));
    const ctl = (part, title, yLabel, out2, refLine) => () => {
      const pts = part.points.map((v, i) => [i + part.start, v]);
      const layers = [{ type: 'line', data: pts, color: 'var(--s1)', width: 1.5 }, { type: 'points', data: pts, colors: pts.map((_, i) => out2(i) ? 'var(--ng)' : 'var(--s1)'), r: 3.5 },
        { type: 'hline', y: part.ucl[0], color: 'var(--ng)', dash: '6 4', text: 'UCL' }, { type: 'hline', y: part.cl[0], color: 'var(--ink2)', text: 'CL' }];
      if (part.lcl[0] > 0 || part === c.main) layers.push({ type: 'hline', y: part.lcl[0], color: 'var(--ng)', dash: '6 4', text: 'LCL' });
      if (refLine != null) layers.push({ type: 'hline', y: refLine, color: 'var(--s3)', dash: '2 3', text: '基準値' });
      return C.plot({ title, xLabel: isI ? '測定順' : 'サブグループ', yLabel, layers });
    };
    mount('sc1', ctl(c.main, isI ? '個々の値（I）の管理図' : '平均（X̄）の管理図', '測定値', i => hitIdx.has(i), ref));
    mount('sc2', ctl(c.range, isI ? '移動範囲（MR）の管理図' : '範囲（R）の管理図', '範囲', i => R.rangeOut.includes(i), null));
  }
  function stabSample() {
    const r = rng(25);
    Sb.m = '3'; $('#stabM').value = '3'; Sb.ref = '20.000'; $('#stabRef').value = Sb.ref;
    Sb.vals = Array.from({ length: 75 }, () => round(20.002 + r.n() * 0.004, 4)).concat(['']);
    stabTable.render(); stabChangedNow();
  }

  // ============ Type-1 ============
  const T1 = st.t1;
  const t1Table = listTable($('#t1Grid'), T1, '測定値', re => { if (re) t1Table.render(); t1Changed(); });
  const t1ChangedNow = () => { save('t1'); t1Compute(); };
  const t1Changed = debounce(t1ChangedNow);
  ['Ref', 'Tol', 'K', 'L', 'Limit'].forEach(k => bindNum('#t1' + k, T1, k === 'Ref' ? 'ref' : k === 'Tol' ? 'tol' : k === 'Limit' ? 'limit' : k, t1Changed));
  fileInput('#t1File', rows => { T1.vals = I.column(rows).concat(['']); t1Table.render(); t1ChangedNow(); });
  function t1Compute() {
    const out = $('#t1Out'), head = '<h2><span class="step">2</span>結果</h2>';
    const x = values(T1), ref = num(T1.ref), tol = num(T1.tol);
    if (x.length < 2) { out.innerHTML = head + '<p class="empty">測定値を入力してください（25〜50 回が一般的）。</p>'; results.t1 = null; return; }
    if (ref == null || !(tol > 0)) { out.innerHTML = head + '<p class="empty">基準値と公差幅を入力してください。</p>'; results.t1 = null; return; }
    let R;
    try { R = M.type1(x, ref, tol, { K: (num(T1.K) ?? 20) / 100, L: num(T1.L) ?? 6, limit: num(T1.limit) ?? 1.33 }); } catch (e) { out.innerHTML = head + `<p class="err-msg">${esc(e.message)}</p>`; results.t1 = null; return; }
    results.t1 = R;
    const lv = R.okCg && R.okCgk ? 'ok' : 'ng';
    const n = R.notes.map(s => ['warn', s]);
    n.push(['info', `Cg = (${sig(R.K * 100)}% × 公差) / (${sig(R.L)} × s)、Cgk = (${sig(R.K * 50)}% × 公差 − |偏り|) / (${sig(R.L / 2)} × s)。AIAG MSA 第4版の評価ではありません`]);
    if (badCount(T1)) n.push(['warn', `数値でないセル ${badCount(T1)} 個は除きました`]);
    let h = head + banner(lv, lv === 'ok' ? '測定器は使用できる（Cg・Cgk とも基準以上）' : '測定器は基準を満たさない', `Cg ${fix(R.Cg, 2)} ${tag(R.okCg ? 'ok' : 'ng', R.okCg ? `${R.limit} 以上` : `${R.limit} 未満`)} ／ Cgk ${fix(R.Cgk, 2)} ${tag(R.okCgk ? 'ok' : 'ng', R.okCgk ? `${R.limit} 以上` : `${R.limit} 未満`)}`);
    h += kv([
      ['測定回数 n', String(R.n)], ['平均', sig(R.mean, 6)], ['標準偏差 s', sig(R.sd)], ['偏り', sig(R.bias)],
      ['Cg', fix(R.Cg, 3)], ['Cgk', fix(R.Cgk, 3)], ['偏りの t 検定', `p ${pval(R.p)}`, R.p != null && R.p < 0.05 ? '偏りは有意' : '偏りは有意でない'],
      ['L·s／公差', pct(R.pctEV)], ['|偏り|／公差', pct(R.pctBias)],
    ]);
    h += notes(n);
    h += `<div class="charts">${chartHtml('tc1', 'Type1_測定順')}${chartHtml('tc2', 'Type1_ヒストグラム')}</div>` + tools('t1');
    out.innerHTML = h;
    const half = R.K / 2 * R.tol;
    mount('tc1', () => C.plot({
      title: '測定順の値と基準値 ± K/2 × 公差', xLabel: '測定順', yLabel: '測定値',
      layers: [{ type: 'line', data: x.map((v, i) => [i + 1, v]), color: 'var(--s1)', width: 1.5 }, { type: 'points', data: x.map((v, i) => [i + 1, v]), color: 'var(--s1)' },
        { type: 'hline', y: R.ref, color: 'var(--ink)', width: 2, text: '基準値' }, { type: 'hline', y: R.ref + half, color: 'var(--ng)', dash: '6 4', text: `+${sig(R.K * 50)}%` }, { type: 'hline', y: R.ref - half, color: 'var(--ng)', dash: '6 4', text: `−${sig(R.K * 50)}%` },
        { type: 'hline', y: R.mean, color: 'var(--s2)', dash: '4 3', text: '平均' }],
    }));
    mount('tc2', () => C.plot({
      title: '測定値の分布', xLabel: '測定値', yLabel: '度数', yZero: true,
      x: [Math.min(R.ref - half, ...x) - half * 0.1, Math.max(R.ref + half, ...x) + half * 0.1],
      layers: [{ type: 'bars', data: histBars(x), color: 'var(--s1)', label: '度数' }, { type: 'vline', x: R.ref, color: 'var(--ink)', width: 2, text: '基準値' },
        { type: 'vline', x: R.ref - half, color: 'var(--ng)', dash: '6 4', text: '' }, { type: 'vline', x: R.ref + half, color: 'var(--ng)', dash: '6 4', text: '基準値 ± K/2·公差' }],
    }));
  }
  function t1Sample() {
    const r = rng(50);
    T1.ref = '10.000'; $('#t1Ref').value = T1.ref; T1.tol = '0.2'; $('#t1Tol').value = T1.tol;
    T1.vals = Array.from({ length: 50 }, () => round(10.001 + r.n() * 0.0022, 4)).concat(['']);
    t1Table.render(); t1ChangedNow();
  }

  // ============ 計数値 ============
  const A = st.attr;
  function attrFix() {
    A.k = clampInt(A.k, 1, 10, 3); A.r = clampInt(A.r, 1, 10, 3); A.n = clampInt(A.n, 2, 500, 20);
    A.names = resize(A.names, A.k, i => letter(i));
    A.ref = resize(A.ref, A.n, '');
    A.cells = resize(A.cells, A.n, () => []).map(row => resize(row, A.k * A.r, ''));
  }
  attrFix();
  function attrReshape(k, r, n) {
    const old = A.cells, oR = A.r, oK = A.k;
    A.cells = resize(old, n, () => []).map(row => { const nr = []; for (let a = 0; a < k; a++) for (let t = 0; t < r; t++) nr.push(a < oK && t < oR ? row[a * oR + t] ?? '' : ''); return nr; });
    A.k = k; A.r = r; A.n = n; attrFix();
  }
  const attrTable = T.create($('#attrGrid'), {
    kind: 'text',
    rows: () => A.n, cols: () => 1 + A.k * A.r,
    get: (r, c) => c === 0 ? A.ref[r] : A.cells[r][c - 1], set: (r, c, v) => { if (c === 0) A.ref[r] = v; else A.cells[r][c - 1] = v; },
    rowHead: r => `部品${r + 1}`, colHead: c => c === 0 ? '基準' : `${esc(A.names[Math.floor((c - 1) / A.r)])}-${((c - 1) % A.r) + 1}`,
    colClass: c => c === 1 || (c > 1 && (c - 1) % A.r === 0) ? 'sep' : '',
    grow: (rows, cols) => { attrReshape(A.k, Math.min(10, Math.max(A.r, Math.ceil((cols - 1) / A.k))), Math.min(500, rows)); attrSync(); },
    onPaste: (block, r0, c0) => {
      // 見出し行のある表は表全体として読み取る
      const h = block[0].map(v => v.trim());
      if (!(r0 === 0 && c0 === 0 && h.some(v => /基準|ref|部品|part|no/i.test(v) || /\D[-_ ]?\d+$/.test(v)))) return false;
      try { attrApply(I.attribute(block, A)); toast('表を読み取りました'); } catch (e) { toast('読み取れませんでした：' + e.message); }
      return true;
    },
    onChange: () => attrChanged(),
  });
  function attrApply(d) {
    A.k = d.k; A.r = d.r; A.n = d.n; A.ref = d.ref; A.cells = d.cells;
    A.names = d.names ? d.names.slice() : resize(A.names, d.k, i => letter(i));
    attrFix(); attrSync(); attrTable.render(); attrChangedNow();
  }
  function attrSync() {
    $('#attrK').value = A.k; $('#attrR').value = A.r; $('#attrN').value = A.n;
    nameInputs($('#attrNames'), A, () => { attrTable.render(); attrChanged(); });
  }
  ['#attrK', '#attrR', '#attrN'].forEach(id => $(id).addEventListener('change', () => {
    attrReshape(clampInt($('#attrK').value, 1, 10, A.k), clampInt($('#attrR').value, 1, 10, A.r), clampInt($('#attrN').value, 2, 500, A.n));
    attrSync(); attrTable.render(); attrChanged();
  }));
  attrSync();
  $('#attrBad').addEventListener('change', e => { A.bad = e.target.value; attrChanged(); });
  const attrChangedNow = () => { save('attr'); attrCompute(); };
  const attrChanged = debounce(attrChangedNow);
  fileInput('#attrFile', rows => attrApply(I.attribute(rows, A)));
  function attrCompute() {
    const out = $('#attrOut'), head = '<h2><span class="step">2</span>結果</h2>';
    const clean = v => String(v ?? '').trim();
    const judg = Array.from({ length: A.k }, (_, a) => Array.from({ length: A.r }, (_, t) => A.cells.map(row => clean(row[a * A.r + t]))));
    const ref = A.ref.map(clean);
    const cats = [...new Set(judg.flat(2).concat(ref).filter(v => v !== ''))].sort();
    // 不合格を表す値の選択肢
    const sel = $('#attrBad');
    sel.innerHTML = `<option value="">自動（NG・0・不合格 など）</option>` + cats.map(c => `<option value="${esc(c)}"${c === A.bad ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const filled = judg.flat(2).filter(v => v !== '').length;
    if (!filled) { out.innerHTML = head + '<p class="empty">判定を入力するか、「サンプルデータで試す」を押してください。</p>'; results.attr = null; return; }
    const blank = judg.flat(2).length - filled;
    if (blank) { out.innerHTML = head + `<p class="empty">判定が未入力のセルが ${blank} 個あります。全セルの入力が必要です。</p>`; results.attr = null; return; }
    const refPart = ref.filter(v => v !== '').length;
    let R;
    try { R = M.attribute(judg, refPart === A.n ? ref : null, { bad: A.bad || undefined }); } catch (e) { out.innerHTML = head + `<p class="err-msg">${esc(e.message)}</p>`; results.attr = null; return; }
    results.attr = R;
    const nm = a => esc(A.names[a]);
    const lvs = [];
    if (R.hasRef) R.per.forEach(p => lvs.push(M.judgeEff(p.effectiveness), M.judgeMiss(p.missRate), M.judgeFa(p.faRate)));
    else R.pairs.forEach(p => lvs.push(M.judgeKappa(p.kappa)));
    const lv = worst(lvs.filter(Boolean));
    const n = R.notes.map(s => ['info', s]);
    if (refPart > 0 && refPart < A.n) n.unshift(['warn', `基準の判定が ${A.n - refPart} 部品で未入力のため、基準を使わずに計算しました`]);
    const big = lv === 'ok' ? '測定システムは合格' : lv === 'cond' ? '条件付きで合格' : lv === 'ng' ? '測定システムは不合格（改善が必要）' : '判定できません';
    const sub = R.hasRef ? '測定者ごとの有効性・ミス率・誤警報率のうち最も悪い区分' : '基準がないため、測定者どうしの κ で判定';
    let h = head + banner(lv, big, sub);
    if (R.hasRef) {
      h += `<h3 class="sec">測定者ごとの評価</h3>` + table(
        ['測定者', '有効性', `${Math.round((1 - R.alpha) * 100)}% 信頼区間`, 'ミス率', '誤警報率', '自己一致', 'κ（対 基準）'],
        R.per.map((p, a) => [nm(a), { v: `${pct(100 * p.effectiveness, 1)}（${p.effective}/${R.n}）`, cls: M.judgeEff(p.effectiveness) }, `${pct(100 * p.effCI[0], 1)} 〜 ${pct(100 * p.effCI[1], 1)}`,
          p.missRate == null ? '―' : { v: `${pct(100 * p.missRate, 1)}（${p.miss}/${p.missOpp}）`, cls: M.judgeMiss(p.missRate) },
          p.faRate == null ? '―' : { v: `${pct(100 * p.faRate, 1)}（${p.fa}/${p.faOpp}）`, cls: M.judgeFa(p.faRate) },
          `${pct(100 * p.withinRate, 1)}（${p.within}/${R.n}）`, { v: fix(R.vsRef[a].kappa, 3), cls: M.judgeKappa(R.vsRef[a].kappa) }])
          .concat([['システム全体', `${pct(100 * R.sys.effectiveness, 1)}（${R.sys.effective}/${R.n}）`, `${pct(100 * R.sys.effCI[0], 1)} 〜 ${pct(100 * R.sys.effCI[1], 1)}`, '', '', `${pct(100 * R.sys.withinRate, 1)}（${R.sys.within}/${R.n}）`, '']]));
      h += `<p class="hint">有効性：全回とも基準と一致した部品の割合（90% 以上 合格、80〜90% 条件付き）。ミス率：不合格品を合格と判定した割合（2% 以下 合格、2〜5% 条件付き）。誤警報率：合格品を不合格と判定した割合（5% 以下 合格、5〜10% 条件付き）。${R.bad != null ? `不合格は「${esc(R.bad)}」として計算。` : ''}</p>`;
    } else {
      h += `<h3 class="sec">測定者ごとの自己一致</h3>` + table(['測定者', '自己一致', '信頼区間'], R.per.map((p, a) => [nm(a), `${pct(100 * p.withinRate, 1)}（${p.within}/${R.n}）`, `${pct(100 * p.withinCI[0], 1)} 〜 ${pct(100 * p.withinCI[1], 1)}`]));
    }
    if (R.pairs.length) h += `<h3 class="sec">測定者どうしの κ（クロス表法）</h3>` + table(['組み合わせ', 'κ', '一致率', '偶然の一致率'], R.pairs.map(p => [`${nm(p.a)} × ${nm(p.b)}`, { v: fix(p.kappa, 3), cls: M.judgeKappa(p.kappa) }, pct(100 * p.po, 1), pct(100 * p.pe, 1)]))
      + '<p class="hint">κ が 0.75 を超えれば良い一致、0.40 未満は一致が悪い（AIAG の目安）。</p>';
    h += notes(n);
    if (R.hasRef) h += `<div class="charts">${chartHtml('ac1', '計数値_有効性')}</div>`;
    h += tools('attr');
    out.innerHTML = h;
    if (R.hasRef) mount('ac1', () => {
      const items = R.per.map((p, a) => ({ name: A.names[a], v: p.effectiveness, ci: p.effCI })).concat([{ name: '全体', v: R.sys.effectiveness, ci: R.sys.effCI }]);
      const layers = [];
      items.forEach((it, i) => {
        const col = i === items.length - 1 ? 'var(--ink)' : SER[i % SER.length];
        layers.push({ type: 'line', data: [[i + 1, 100 * it.ci[0]], [i + 1, 100 * it.ci[1]]], color: col, width: 2 }, { type: 'points', data: [[i + 1, 100 * it.v]], color: col, r: 5, label: it.name });
      });
      layers.push({ type: 'hline', y: 90, color: 'var(--ok)', dash: '5 4', text: '90%' }, { type: 'hline', y: 80, color: 'var(--ng)', dash: '5 4', text: '80%' });
      return C.plot({ title: '有効性と信頼区間', xLabel: '測定者（右端は全体）', yLabel: '%', x: [0.5, items.length + 0.5], y: [Math.max(0, Math.min(70, ...items.map(it => 100 * it.ci[0])) - 5), 101], layers });
    });
  }
  function attrSample() {
    const r = rng(33);
    const n = 50, ref = Array.from({ length: n }, () => r.u() < 0.32 ? 'NG' : 'OK');
    const err = [0.04, 0.03, 0.09];
    const cells = ref.map(() => []);
    for (let a = 0; a < 3; a++) for (let t = 0; t < 3; t++) ref.forEach((v, p) => { cells[p].push(r.u() < err[a] ? (v === 'OK' ? 'NG' : 'OK') : v); });
    A.bad = '';
    attrApply({ k: 3, r: 3, n, names: ['田中', '鈴木', '佐藤'], ref, cells });
  }

  // ---------- サンプル・クリア ----------
  const SAMPLE = { grr: grrSample, bias: biasSample, lin: linSample, stab: stabSample, t1: t1Sample, attr: attrSample };
  $$('[data-sample]').forEach(b => b.addEventListener('click', () => { SAMPLE[b.dataset.sample](); toast('サンプルデータを入れました'); }));
  $$('[data-clear]').forEach(b => b.addEventListener('click', () => {
    const tab = b.dataset.clear;
    if (!confirm(`${TAB_NAME[tab]}の入力をすべて消去しますか？`)) return;
    const d = defaults()[tab];
    if (tab === 'grr') { Object.assign(G, { cells: blankRows(G.k * G.r, G.n), tol: '', sigP: '' }); $('#grrTol').value = ''; $('#grrSigP').value = ''; grrTable.render(); grrChangedNow(); }
    if (tab === 'bias') { B.vals = d.vals; ['ref', 'tol', 'tv'].forEach(k => { B[k] = ''; }); $('#biasRef').value = $('#biasTol').value = $('#biasTV').value = ''; biasTable.render(); biasChangedNow(); }
    if (tab === 'lin') { Lr.cells = blankRows(Lr.m + 1, Lr.g); linTable.render(); linChangedNow(); }
    if (tab === 'stab') { Sb.vals = d.vals; Sb.ref = ''; $('#stabRef').value = ''; stabTable.render(); stabChangedNow(); }
    if (tab === 't1') { T1.vals = d.vals; T1.ref = T1.tol = ''; $('#t1Ref').value = $('#t1Tol').value = ''; t1Table.render(); t1ChangedNow(); }
    if (tab === 'attr') { A.cells = blankRows(A.n, A.k * A.r); A.ref = new Array(A.n).fill(''); attrTable.render(); attrChangedNow(); }
  }));

  // ---------- Excel 保存 ----------
  function kvRows(o) { return Object.entries(o).map(([k, v]) => [k, v == null || (typeof v === 'number' && !Number.isFinite(v)) ? null : v]); }
  const EXPORT = {
    grr: () => {
      const { R } = results.grr;
      const data = [['測定者', '回'].concat(Array.from({ length: G.n }, (_, p) => `部品${p + 1}`))].concat(G.cells.map((row, i) => [G.names[Math.floor(i / G.r)], (i % G.r) + 1].concat(row.map(v => num(v)))));
      const sheets = [
        { name: '結果', rows: [['要因', '標準偏差', '6σ', '%寄与', '%TV', '%公差']].concat(R.rows.map(x => [x.name, x.sd, x.sv, x.pctContrib, x.pctTV, x.pctTol])).concat([[], ['ndc', R.ndc], ['方式', G.method === 'anova' ? 'ANOVA 法' : '平均・範囲法'], ['公差幅', num(G.tol)], ['工程の標準偏差', num(G.sigP)]]) },
      ];
      if (R.table) sheets.push({ name: '分散分析表', rows: [['要因', '自由度', '平方和', '平均平方', 'F', 'p 値']].concat(R.table.map(t => [t.source, t.df, t.ss, t.ms, t.F, t.p])) });
      sheets.push({ name: '測定値', rows: data });
      return sheets;
    },
    bias: () => [{ name: '偏り', rows: kvRows({ 測定回数: results.bias.n, 平均: results.bias.mean, 基準値: results.bias.ref, 偏り: results.bias.bias, '繰り返し性 σr': results.bias.sigmaR, 'σb': results.bias.sigmaB, t: results.bias.t, p: results.bias.p, '信頼区間 下限': results.bias.ci[0], '信頼区間 上限': results.bias.ci[1], 判定: results.bias.acceptable ? '許容できる' : '偏りあり' }) }, { name: '測定値', rows: [['測定値']].concat(values(B).map(v => [v])) }],
    lin: () => [{ name: '直線性', rows: kvRows({ 傾き: results.lin.slope, 切片: results.lin.intercept, R2: results.lin.R2, s: results.lin.s, '傾きの t': results.lin.tSlope, '切片の t': results.lin.tIntercept, 't 臨界値': results.lin.tCrit, '%直線性': results.lin.pctLinearity, 判定: results.lin.acceptable ? '許容できる' : '問題あり' }) },
      { name: '部品ごと', rows: [['基準値', '回数', '偏りの平均', '標準偏差', 't', 'p']].concat(results.lin.perPart.map(p => [p.ref, p.n, p.bias, p.sd, p.t, p.p])) }],
    stab: () => [{ name: '安定性', rows: kvRows({ 平均: results.stab.mean, 偏り: results.stab.bias, σ: results.stab.sigma, 中心線: results.stab.chart.main.cl[0], UCL: results.stab.chart.main.ucl[0], LCL: results.stab.chart.main.lcl[0], 判定: results.stab.stable ? '安定' : '不安定' }).concat([[]], results.stab.mainHits.map(hh => ['異常', `${hh.text}（${hh.from + 1}〜${hh.to + 1}）`])) }],
    t1: () => [{ name: 'Type-1', rows: kvRows({ 測定回数: results.t1.n, 平均: results.t1.mean, 標準偏差: results.t1.sd, 基準値: results.t1.ref, 公差幅: results.t1.tol, K: results.t1.K, L: results.t1.L, 偏り: results.t1.bias, Cg: results.t1.Cg, Cgk: results.t1.Cgk, 'p（偏り）': results.t1.p }) }, { name: '測定値', rows: [['測定値']].concat(values(T1).map(v => [v])) }],
    attr: () => {
      const R = results.attr;
      const rows = [['測定者', '有効性', '信頼区間 下限', '信頼区間 上限', 'ミス率', '誤警報率', '自己一致', 'κ（対 基準）']].concat(R.per.map((p, a) => [A.names[a], p.effectiveness ?? null, p.effCI ? p.effCI[0] : null, p.effCI ? p.effCI[1] : null, p.missRate ?? null, p.faRate ?? null, p.withinRate, R.vsRef ? R.vsRef[a].kappa : null]));
      return [{ name: '測定者ごと', rows }, { name: 'κ', rows: [['測定者1', '測定者2', 'κ', '一致率']].concat(R.pairs.map(p => [A.names[p.a], A.names[p.b], p.kappa, p.po])) }];
    },
  };
  document.addEventListener('click', e => {
    const x = e.target.closest('[data-xlsx]');
    if (x) { const tab = x.dataset.xlsx; if (!results[tab]) return; download(X.writeXlsx(EXPORT[tab]()), `${stamp()}_MSA_${TAB_NAME[tab]}.xlsx`, XLSX_TYPE); return; }
    const p = e.target.closest('[data-print]');
    if (p) { $('#printTitle').textContent = `測定システム解析：${TAB_NAME[p.dataset.print]}`; $('#printDate').textContent = new Date().toLocaleString('ja-JP'); window.print(); }
  });
  // 印刷は常にライト表示にする（グラフの色も描き直す）
  let themeBeforePrint = null;
  window.addEventListener('beforeprint', () => { themeBeforePrint = document.documentElement.getAttribute('data-theme'); document.documentElement.dataset.theme = 'light'; redrawCharts(); });
  window.addEventListener('afterprint', () => { if (themeBeforePrint == null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = themeBeforePrint; redrawCharts(); });

  // ---------- 開始 ----------
  applyTheme(theme);
  grrCompute(); biasCompute(); linCompute(); stabCompute(); t1Compute(); attrCompute();
  showTab(location.hash.slice(1) || st.tab);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
