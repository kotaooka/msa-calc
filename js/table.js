// 入力用の表（キー操作・Excel からの複数セル貼り付け）
// MsaTable.create(container, opts)
//   opts.rows() / opts.cols()        行数・列数
//   opts.get(r, c) / opts.set(r, c, v)  セルの値（文字列）
//   opts.rowHead(r) / opts.colHead(c)   見出し（HTML）
//   opts.rowClass(r) / opts.colClass(c) 区切り線などのクラス
//   opts.kind                         'num'（数値）か 'text'（判定など）
//   opts.onPaste(block, r, c)         複数セルの貼り付け。true を返すと既定の処理（その位置から埋める）をしない
//   opts.grow(rows, cols)             貼り付けが表からはみ出すとき、必要な行数・列数を受け取って表を広げる
//   opts.autoRows                     最終行に入力したら行を足す（1 列の測定値など）
//   opts.onChange()                   値が変わったとき
(function (root) {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    const s = String(v).trim().replace(/,/g, '').replace(/[０-９．－＋]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/−/g, '-');
    return NUM_RE.test(s) ? Number(s) : null;
  }
  // クリップボードの文字列（タブ区切り）を 2 次元配列にする。末尾の空行は除く
  function parseClip(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.map(l => l.split('\t'));
  }

  function create(container, opts) {
    const kind = opts.kind || 'num';
    function render() {
      const R = opts.rows(), Cn = opts.cols();
      let h = '<table class="grid"><thead><tr><th class="rn"></th>';
      for (let c = 0; c < Cn; c++) h += `<th class="cl ${opts.colClass ? opts.colClass(c) : ''}">${opts.colHead(c)}</th>`;
      h += '</tr></thead><tbody>';
      for (let r = 0; r < R; r++) {
        h += `<tr class="${opts.rowClass ? opts.rowClass(r) : ''}"><td class="rn">${opts.rowHead(r)}</td>`;
        for (let c = 0; c < Cn; c++) {
          const v = opts.get(r, c) ?? '';
          const bad = kind === 'num' && v !== '' && toNum(v) == null;
          h += `<td class="${opts.colClass ? opts.colClass(c) : ''}"><input class="${kind === 'text' ? 'txt' : ''}${bad ? ' bad' : ''}" data-r="${r}" data-c="${c}" value="${esc(v)}" inputmode="${kind === 'num' ? 'decimal' : 'text'}" autocomplete="off" spellcheck="false" aria-label="${r + 1}行${c + 1}列"></td>`;
        }
        h += '</tr>';
      }
      container.innerHTML = h + '</tbody></table>';
    }
    const cell = (r, c) => container.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    function focusCell(r, c) { const el = cell(r, c); if (el) { el.focus(); el.select(); } }
    function maybeGrowRows(r) {
      if (opts.autoRows && r >= opts.rows() - 1) { opts.grow(opts.rows() + 10, opts.cols()); render(); return true; }
      return false;
    }
    container.addEventListener('input', e => {
      const el = e.target; if (!el.dataset.r) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      opts.set(r, c, el.value);
      el.classList.toggle('bad', kind === 'num' && el.value.trim() !== '' && toNum(el.value) == null);
      if (el.value !== '' && maybeGrowRows(r)) focusCell(r, c);
      opts.onChange && opts.onChange();
    });
    container.addEventListener('keydown', e => {
      const el = e.target; if (!el.dataset.r) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.isComposing)) { e.preventDefault(); if (r + 1 >= opts.rows()) maybeGrowRows(r); focusCell(r + 1, c); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
      else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, c + 1); }
      else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); focusCell(r, c - 1); }
    });
    container.addEventListener('paste', e => {
      const el = e.target; if (!el.dataset.r) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const block = parseClip(text);
      if (block.length <= 1 && (block[0] || []).length <= 1) return; // 1 セルは通常の貼り付け
      e.preventDefault();
      const r0 = +el.dataset.r, c0 = +el.dataset.c;
      if (opts.onPaste && opts.onPaste(block, r0, c0)) return;
      const needR = r0 + block.length, needC = c0 + Math.max(...block.map(b => b.length));
      if (needR > opts.rows() || needC > opts.cols()) opts.grow(Math.max(needR, opts.rows()), Math.max(needC, opts.cols()));
      block.forEach((row, i) => row.forEach((v, j) => { if (r0 + i < opts.rows() && c0 + j < opts.cols()) opts.set(r0 + i, c0 + j, v.trim()); }));
      render();
      opts.onChange && opts.onChange();
    });
    render();
    return { render, focusCell };
  }

  const api = { create, toNum, parseClip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MsaTable = api;
})(typeof window !== 'undefined' ? window : globalThis);
