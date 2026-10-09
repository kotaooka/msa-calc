// Excel（.xlsx）の読み書きと CSV の読み込み（ブラウザ・Node 共通、外部ライブラリなし）
//   読み込み：ZIP を展開し（ブラウザは DecompressionStream）、ワークシートの XML からセルの値を取り出す
//   書き出し：無圧縮の ZIP で最小構成の .xlsx を作る
//   旧形式の .xls（バイナリ）には対応しない
(function (root) {
  'use strict';

  // ---------- ZIP ----------
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  // ブラウザ標準の deflate-raw 展開
  async function inflateRawBrowser(data) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ZIP のファイル一覧を読む。戻り値 { 名前: async () => Uint8Array }
  function unzip(buf, inflateRaw) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Excel（.xlsx）ファイルとして読み込めません。旧形式の .xls の場合は、Excel で .xlsx に保存し直してください');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const files = {};
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (u32(b, p) !== 0x02014b50) throw new Error('ZIP の中央ディレクトリが壊れています');
      const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32);
      const local = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const raw = b.subarray(start, start + csize);
      files[name] = async () => {
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`未対応の圧縮方式です（${method}）`);
      };
    }
    return files;
  }

  // CRC-32（書き出し用）
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  // 無圧縮 ZIP を作る。entries: [{ name, data: Uint8Array }]
  function zipStore(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const w16 = (a, v) => a.push(v & 0xff, (v >>> 8) & 0xff);
    const w32 = (a, v) => a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    for (const e of entries) {
      const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
      const h = [];
      w32(h, 0x04034b50); w16(h, 20); w16(h, 0x0800); w16(h, 0); w16(h, 0); w16(h, 0x21);
      w32(h, crc); w32(h, size); w32(h, size); w16(h, name.length); w16(h, 0);
      parts.push(new Uint8Array(h), name, e.data);
      const c = [];
      w32(c, 0x02014b50); w16(c, 20); w16(c, 20); w16(c, 0x0800); w16(c, 0); w16(c, 0); w16(c, 0x21);
      w32(c, crc); w32(c, size); w32(c, size); w16(c, name.length); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, offset);
      central.push(new Uint8Array(c), name);
      offset += h.length + name.length + size;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = [];
    w32(end, 0x06054b50); w16(end, 0); w16(end, 0); w16(end, entries.length); w16(end, entries.length); w32(end, cdSize); w32(end, offset); w16(end, 0);
    const all = [...parts, ...central, new Uint8Array(end)];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
    return out;
  }

  // ---------- XML ----------
  function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) :
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e])
      // OOXML の _xHHHH_ エスケープ
      .replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const escapeXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    // XML 1.0 で使えない制御文字を除く
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const attr = (s, name) => { const m = s.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`)); return m ? unescapeXml(m[1]) : null; };
  // 文字列要素のテキスト。ふりがな（rPh）は除く
  function richText(xml) {
    const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += unescapeXml(m[1]);
    return s;
  }
  // 列文字 → 0 始まりの番号、番号 → 列文字
  function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
  function colName(i) { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

  // ---------- 読み込み ----------
  // 戻り値: { sheets: [{ name, cells: [[行, 列, 値]] }] }。値は数値か文字列。行・列は 0 始まり
  async function readXlsx(buf, inflateRaw) {
    const files = unzip(buf, inflateRaw || inflateRawBrowser);
    const dec = new TextDecoder('utf-8');
    const text = async name => { const f = files[name]; return f ? dec.decode(await f()) : null; };
    const wb = await text('xl/workbook.xml');
    if (!wb) throw new Error('Excel（.xlsx）ファイルとして読み込めません（xl/workbook.xml がありません）');
    const rels = (await text('xl/_rels/workbook.xml.rels')) || '';
    const target = {};
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) target[attr(m[1], 'Id')] = attr(m[1], 'Target');
    const ssXml = await text('xl/sharedStrings.xml');
    const shared = ssXml ? [...ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map(m => m[1] ? richText(m[1]) : '') : [];
    const sheets = [];
    for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = attr(m[1], 'name'), rid = attr(m[1], 'r:id');
      let path = target[rid];
      if (!path) continue;
      path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
      const xml = await text(path);
      if (xml == null) continue;
      sheets.push({ name, cells: parseSheet(xml, shared) });
    }
    if (!sheets.length) throw new Error('ワークシートが見つかりません');
    return { sheets };
  }
  function parseSheet(xml, shared) {
    const cells = [];
    const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
    if (!data) return cells;
    let rowNo = -1;
    for (const rm of data[1].matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = attr(rm[1], 'r');
      rowNo = r ? parseInt(r, 10) - 1 : rowNo + 1;
      if (!rm[2]) continue;
      let colNo = -1;
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r');
        if (ref) { const mm = ref.match(/^([A-Z]+)(\d+)$/); colNo = colIndex(mm[1]); } else colNo++;
        const t = attr(cm[1], 't') || 'n', body = cm[2] || '';
        const vm = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const v = vm ? unescapeXml(vm[1]) : null;
        let val = null;
        if (t === 's') val = v != null ? shared[parseInt(v, 10)] : null;
        else if (t === 'inlineStr') { const im = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/); val = im ? richText(im[1]) : null; }
        else if (t === 'str' || t === 'd') val = v;
        else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : null;
        else if (t === 'e') val = null;
        else if (v != null && v !== '') val = Number(v);
        if (val !== null && val !== '') cells.push([rowNo, colNo, val]);
      }
    }
    return cells;
  }

  // ---------- CSV ----------
  // RFC 4180 形式（引用符・改行を含むセルに対応）。区切りはカンマかタブを自動判定
  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0];
    const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
    const cells = [];
    let r = 0, c = 0, cur = '', q = false, any = false;
    const push = () => {
      const s = cur.trim();
      if (s !== '') { const num = Number(s); cells.push([r, c, s !== '' && isFinite(num) && /^[\s+\-.\d]/.test(s) ? num : cur]); }
      cur = ''; any = false;
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"' && !any) { q = true; any = true; }
      else if (ch === sep) { push(); c++; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); r++; c = 0; }
      else { cur += ch; if (ch.trim()) any = true; }
    }
    if (cur !== '' || c > 0) push();
    return { sheets: [{ name: 'CSV', cells }] };
  }

  // ---------- 書き出し ----------
  // sheets: [{ name, rows: [[値, ...], ...] }]。値は数値・文字列・null。戻り値 Uint8Array（.xlsx）
  function writeXlsx(sheets) {
    const enc = new TextEncoder();
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const entries = [];
    const add = (name, s) => entries.push({ name, data: enc.encode(head + s) });
    add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>');
    add('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    // シート名に使えない文字を置き換え、31 文字に切る
    const sheetName = (s, i) => (String(s || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, '_').slice(0, 31)) || `Sheet${i + 1}`;
    add('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>` +
      sheets.map((s, i) => `<sheet name="${escapeXml(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add('xl/styles.xml', `<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Yu Gothic"/></font><font><b/><sz val="11"/><name val="Yu Gothic"/></font></fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    sheets.forEach((s, i) => {
      // 1 行目（見出し）は太字
      const rows = s.rows.map((row, r) => `<row r="${r + 1}">` + row.map((v, c) => {
        const ref = colName(c) + (r + 1), st = r === 0 ? ' s="1"' : '';
        if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
        if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
      }).join('') + '</row>').join('');
      add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`);
    });
    return zipStore(entries);
  }

  const api = { readXlsx, readCsv, writeXlsx, unzip, crc32, colName, colIndex, parseSheet, richText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CpkXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis);
