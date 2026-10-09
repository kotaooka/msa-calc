// SVG グラフ（外部ライブラリなし）。色は CSS 変数で指定し、画像保存時に実際の色へ置き換える
(function (root) {
  'use strict';
  const W = 640, H = 360, M = { l: 62, r: 18, t: 34, b: 46 };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // 見やすい目盛り（1, 2, 5 × 10^k 刻み）
  function ticks(lo, hi, count = 6) {
    if (!(hi > lo)) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => (hi - lo) / s <= count) || 10 * mag;
    const t = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) t.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { t, step };
  }
  // 目盛りの刻みに合わせた桁数で表示
  function fmtTick(v, step) {
    // 刻み幅を表すのに必要な小数桁（0.25 なら 2 桁）
    let d = 0;
    while (d < 10 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6 * 10 ** d) d++;
    return v.toFixed(d);
  }

  // 汎用の平面グラフ
  // opt: { title, xLabel, yLabel, x: [lo, hi], y: [lo, hi], yZero, layers: [...], legend: true }
  // layer: { type: 'bars'|'line'|'points'|'vline'|'hline'|'area', color, dash, label, data, x, y, text, width, r, colors }
  function plot(opt) {
    let xs = [], ys = [];
    for (const L of opt.layers) {
      if (L.type === 'vline') xs.push(L.x);
      else if (L.type === 'hline') ys.push(L.y);
      else if (L.type === 'bars') for (const b of L.data) { xs.push(b.x0, b.x1); ys.push(b.h); }
      else for (const p of L.data) { xs.push(p[0]); ys.push(p[1]); }
    }
    xs = xs.filter(Number.isFinite); ys = ys.filter(Number.isFinite);
    let [x0, x1] = opt.x || [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = opt.y || [Math.min(...ys), Math.max(...ys)];
    if (opt.yZero) y0 = Math.min(0, y0);
    if (!opt.x) { const pad = (x1 - x0) * 0.04 || 1; x0 -= pad; x1 += pad; }
    if (!opt.y) { const pad = (y1 - y0) * 0.08 || 1; y1 += pad; if (!opt.yZero || y0 < 0) y0 -= pad; }
    const X = v => M.l + (v - x0) / (x1 - x0) * (W - M.l - M.r);
    const Y = v => H - M.b - (v - y0) / (y1 - y0) * (H - M.t - M.b);
    const tx = ticks(x0, x1, 7), ty = ticks(y0, y1, 5);
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="var(--f-ui)" role="img" aria-label="${esc(opt.title || '')}">`;
    s += `<rect width="${W}" height="${H}" fill="var(--surface)"/>`;
    if (opt.title) s += `<text x="${M.l}" y="20" font-size="14" font-weight="700" fill="var(--ink)">${esc(opt.title)}</text>`;
    // 格子
    for (const v of ty.t) if (v >= y0 && v <= y1) s += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${M.l - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--f-num)">${fmtTick(v, ty.step)}</text>`;
    for (const v of tx.t) if (v >= x0 && v <= x1) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--grid)"/><text x="${X(v)}" y="${H - M.b + 16}" font-size="11" text-anchor="middle" fill="var(--muted)" font-family="var(--f-num)">${fmtTick(v, tx.step)}</text>`;
    s += `<rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="none" stroke="var(--line)"/>`;
    if (opt.xLabel) s += `<text x="${(M.l + W - M.r) / 2}" y="${H - 8}" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(opt.xLabel)}</text>`;
    if (opt.yLabel) s += `<text transform="translate(14 ${(M.t + H - M.b) / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="var(--ink2)">${esc(opt.yLabel)}</text>`;
    s += `<clipPath id="c${plot.n = (plot.n || 0) + 1}"><rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}"/></clipPath><g clip-path="url(#c${plot.n})">`;
    const legend = [];
    const vlabels = [];
    for (const L of opt.layers) {
      const col = L.color || 'var(--s1)', dash = L.dash ? ` stroke-dasharray="${L.dash}"` : '';
      if (L.label && L.type !== 'vline' && L.type !== 'hline') legend.push([L.label, col, L.type, L.dash]);
      if (L.type === 'bars') {
        for (const b of L.data) s += `<rect x="${X(b.x0) + 0.5}" y="${Y(b.h)}" width="${Math.max(0, X(b.x1) - X(b.x0) - 1)}" height="${Math.max(0, Y(y0 > 0 ? y0 : 0) - Y(b.h))}" fill="${col}" fill-opacity=".55" stroke="${col}"/>`;
      } else if (L.type === 'line' || L.type === 'area') {
        const d = L.data.filter(p => Number.isFinite(p[1])).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
        if (L.type === 'area') s += `<path d="${d}L${X(L.data[L.data.length - 1][0])},${Y(0)}L${X(L.data[0][0])},${Y(0)}Z" fill="${col}" fill-opacity=".12"/>`;
        s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${L.width || 2}"${dash}/>`;
      } else if (L.type === 'points') {
        L.data.forEach((p, i) => { const c = L.colors ? L.colors[i] : col; s += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${L.r || 3}" fill="${c}"/>`; });
      } else if (L.type === 'vline' && Number.isFinite(L.x)) {
        s += `<line x1="${X(L.x)}" x2="${X(L.x)}" y1="${M.t}" y2="${H - M.b}" stroke="${col}" stroke-width="${L.width || 1.5}"${dash}/>`;
        if (L.text) vlabels.push({ x: X(L.x), text: L.text, col });
      } else if (L.type === 'hline' && Number.isFinite(L.y)) {
        s += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(L.y)}" y2="${Y(L.y)}" stroke="${col}" stroke-width="${L.width || 1.5}"${dash}/>`;
        if (L.text) s += `<text x="${W - M.r - 4}" y="${Y(L.y) - 4}" font-size="11" text-anchor="end" fill="${col}" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${esc(L.text)}</text>`;
      }
    }
    s += '</g>';
    // 縦線のラベル：左から順に、前のラベルと重ならない段に置く。右端に近いものは線の左側に書く
    const rowsEnd = [];
    for (const v of vlabels.sort((a, b) => a.x - b.x)) {
      const w = v.text.length * 7 + 8, right = v.x + w > W - M.r;
      const x0 = right ? v.x - w : v.x;
      let row = rowsEnd.findIndex(e => e < x0);
      if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); }
      rowsEnd[row] = x0 + w;
      s += `<text x="${right ? v.x - 4 : v.x + 4}" y="${M.t + 13 + row * 14}" font-size="11" text-anchor="${right ? 'end' : 'start'}" fill="${v.col}" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${esc(v.text)}</text>`;
    }
    // 凡例：入るならタイトルの行の右側に横並びで（グラフ内の線やラベルと重ならない）。入らなければ右上に枠つきで
    const textW = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 11.5 : 6.5), 0);
    if (opt.legend !== false && legend.length) {
      const items0 = legend.map(([t, c, ty, dash]) => ({ t, c, ty, dash, w: 24 + textW(t) + 12 }));
      const total = items0.reduce((a, i) => a + i.w, 0), titleW = opt.title ? textW(opt.title) * 14 / 11.5 + 20 : 0;
      if (M.l + titleW + total <= W - M.r) {
        let x = W - M.r - total;
        for (const it of items0) {
          s += it.ty === 'points' ? `<circle cx="${x + 9}" cy="16" r="3.5" fill="${it.c}"/>` : `<line x1="${x + 1}" x2="${x + 17}" y1="16" y2="16" stroke="${it.c}" stroke-width="${it.ty === 'bars' ? 8 : 2.5}"${it.ty === 'bars' ? ' stroke-opacity=".55"' : ''}${it.dash ? ` stroke-dasharray="${it.dash}"` : ''}/>`;
          s += `<text x="${x + 22}" y="20" font-size="11" fill="var(--ink2)">${esc(it.t)}</text>`;
          x += it.w;
        }
        return resolveVars(s + '</svg>');
      }
      let lx = W - M.r - 8, ly = M.t + 8;
      const items = legend.map(([t, c, ty, dash]) => ({ t, c, ty, dash, w: 26 + textW(t) }));
      const bw = Math.max(...items.map(i => i.w)) + 8;
      s += `<rect x="${lx - bw}" y="${ly - 4}" width="${bw}" height="${items.length * 17 + 6}" fill="var(--surface)" fill-opacity=".85" stroke="var(--line)" rx="4"/>`;
      items.forEach((it, i) => {
        const yy = ly + 9 + i * 17;
        s += it.ty === 'points' ? `<circle cx="${lx - bw + 14}" cy="${yy}" r="3.5" fill="${it.c}"/>` : `<line x1="${lx - bw + 6}" x2="${lx - bw + 22}" y1="${yy}" y2="${yy}" stroke="${it.c}" stroke-width="${it.ty === 'bars' ? 8 : 2.5}"${it.ty === 'bars' ? ' stroke-opacity=".55"' : ''}${it.dash ? ` stroke-dasharray="${it.dash}"` : ''}/>`;
        s += `<text x="${lx - bw + 28}" y="${yy + 4}" font-size="11" fill="var(--ink2)">${esc(it.t)}</text>`;
      });
    }
    return resolveVars(s + '</svg>');
  }

  // CSS 変数を今のテーマの実際の色に置き換える（SVG の属性では var() が効かないブラウザがあるため）
  function resolveVars(s) {
    if (typeof document === 'undefined') return s;
    const css = getComputedStyle(document.documentElement);
    // フォント名の二重引用符は属性値を壊すので一重引用符にする
    return s.replace(/var\((--[\w-]+)\)/g, (m, v) => (css.getPropertyValue(v).trim() || '#000').replace(/"/g, "'"));
  }

  // SVG を PNG にして保存する（CSS 変数を今の色に置き換える）
  function svgToPng(svgEl, filename, scale = 2) {
    let src = new XMLSerializer().serializeToString(svgEl);
    if (!/xmlns=/.test(src)) src = src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const vb = svgEl.viewBox.baseVal;
    const img = new Image();
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = vb.width * scale; c.height = vb.height * scale;
        const g = c.getContext('2d');
        g.scale(scale, scale); g.drawImage(img, 0, 0);
        c.toBlob(b => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b); a.download = filename; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000); resolve();
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    });
  }

  const api = { plot, ticks, svgToPng, resolveVars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CpkCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);
