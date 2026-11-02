/* PropBazaar contact-file reader. Runs in the browser, nothing is uploaded except the e-mail/name columns, in small chunks.
   Reads .csv/.txt and .xlsx as a STREAM, so file size is not limited by memory (no size or row cap). No third-party code.
   Exposes PBImport.contacts(file, onProgress) -> async iterator of {email, name}. Also loadable in Node for tests. */
(function (root) {
  'use strict';
  var EMAIL = /[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}/;
  function fail(m) { var e = new Error(m); e.user = true; return e; }

  // ----- CSV / text: streaming parser (quotes, "" escapes, , ; tab or | separators, BOM, CR/LF) -----
  async function* csvRows(file) {
    var dec = new TextDecoder('utf-8'), reader = file.stream().getReader(), sep = null, row = [], cell = '', q = false, pendingQuote = false, first = true, prevCR = false;
    function endRow() { row.push(cell); cell = ''; var r = row; row = []; return r; }
    for (;;) {
      var r = await reader.read(); var text = r.done ? dec.decode() : dec.decode(r.value, { stream: true });
      if (first && text) { if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); var line = text.split(/\r|\n/)[0]; var best = ',', n = -1; [',', ';', '\t', '|'].forEach(function (c) { var k = line.split(c).length; if (k > n) { n = k; best = c; } }); sep = best; first = false; }
      var out = [];
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (prevCR) { prevCR = false; if (ch === '\n') continue; }
        if (pendingQuote) { pendingQuote = false; if (ch === '"') { cell += '"'; continue; } q = false; }
        if (q) { if (ch === '"') pendingQuote = true; else cell += ch; continue; }
        if (ch === '"' && cell === '') { q = true; continue; }
        if (ch === sep) { row.push(cell); cell = ''; continue; }
        if (ch === '\n' || ch === '\r') { if (ch === '\r') prevCR = true; out.push(endRow()); continue; }
        cell += ch;
      }
      for (var k = 0; k < out.length; k++) yield out[k];
      if (r.done) { if (pendingQuote) q = false; if (cell !== '' || row.length) yield endRow(); return; }
    }
  }

  // ----- XLSX: minimal zip reader + streaming XML scan -----
  async function readBytes(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); }
  var u16 = function (d, o) { return d[o] | (d[o + 1] << 8); }, u32 = function (d, o) { return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0; };
  async function zipEntries(file) {
    var size = file.size, tailLen = Math.min(size, 65557), tail = await readBytes(file, size - tailLen, size), p = -1;
    for (var i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { p = i; break; }
    if (p < 0) throw fail('This does not look like a valid .xlsx file. Save it again as .xlsx or CSV.');
    var count = u16(tail, p + 10), cdSize = u32(tail, p + 12), cdOff = u32(tail, p + 16);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw fail('This Excel file is over 4 GB. Please save it as CSV (CSV has no limit).');
    var cd = await readBytes(file, cdOff, cdOff + cdSize), o = 0, map = {}, td = new TextDecoder();
    for (var n = 0; n < count && o + 46 <= cd.length; n++) {
      var nl = u16(cd, o + 28), el = u16(cd, o + 30), cl = u16(cd, o + 32);
      var name = td.decode(cd.subarray(o + 46, o + 46 + nl));
      map[name] = { method: u16(cd, o + 10), csize: u32(cd, o + 20), usize: u32(cd, o + 24), off: u32(cd, o + 42) };
      if (map[name].csize === 0xFFFFFFFF || map[name].off === 0xFFFFFFFF) throw fail('This Excel file uses a very large format. Please save it as CSV.');
      o += 46 + nl + el + cl;
    }
    return map;
  }
  async function entryStream(file, e) {
    var lh = await readBytes(file, e.off, e.off + 30); if (u32(lh, 0) !== 0x04034b50) throw fail('Damaged .xlsx file.');
    var start = e.off + 30 + u16(lh, 26) + u16(lh, 28), blob = file.slice(start, start + e.csize);
    if (e.method === 0) return blob.stream();
    if (e.method !== 8) throw fail('Unsupported compression inside the .xlsx file. Save as CSV.');
    if (typeof DecompressionStream === 'undefined') throw fail('This browser cannot open .xlsx files. Save as CSV, or use a newer Chrome.');
    return blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  }
  async function* xmlText(stream) { var dec = new TextDecoder('utf-8'), rd = stream.getReader(); for (;;) { var r = await rd.read(); if (r.done) { var t = dec.decode(); if (t) yield t; return; } yield dec.decode(r.value, { stream: true }); } }
  function unent(s) { return s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, g) { g = g.toLowerCase(); if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'"; var c = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(c); } catch (e) { return ''; } }); }
  function textOf(xml) { var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m; while ((m = re.exec(xml))) out += m[1]; return unent(out); }
  async function* chunksBetween(stream, tag) { // yields each <tag ...>...</tag> (or self-closing) element as a string
    var buf = '', open = new RegExp('<' + tag + '(?=[\\s>/])'), closeTag = '</' + tag + '>';
    for await (var t of xmlText(stream)) {
      buf += t;
      for (;;) {
        var m = open.exec(buf); if (!m) { buf = buf.slice(Math.max(0, buf.length - tag.length - 2)); break; }
        var s = m.index, gt = buf.indexOf('>', s); if (gt < 0) { buf = buf.slice(s); break; }
        if (buf[gt - 1] === '/') { yield buf.slice(s, gt + 1); buf = buf.slice(gt + 1); continue; }
        var e = buf.indexOf(closeTag, gt); if (e < 0) { buf = buf.slice(s); break; }
        yield buf.slice(s, e + closeTag.length); buf = buf.slice(e + closeTag.length);
      }
    }
  }
  function colIndex(ref) { var m = /^([A-Z]+)/.exec(ref || ''), n = 0; if (!m) return -1; for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64); return n - 1; }
  async function* xlsxRows(file) {
    var z = await zipEntries(file), wb = z['xl/workbook.xml']; if (!wb) throw fail('This .xlsx file has no workbook.');
    var wbXml = ''; for await (var t of xmlText(await entryStream(file, wb))) wbXml += t;
    var sheetM = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(wbXml), target = null;
    if (sheetM && z['xl/_rels/workbook.xml.rels']) { var rels = ''; for await (var t2 of xmlText(await entryStream(file, z['xl/_rels/workbook.xml.rels']))) rels += t2; var re = new RegExp('<Relationship\\b[^>]*?Id="' + sheetM[1] + '"[^>]*?>'), rm = re.exec(rels); if (rm) { var tm = /Target="([^"]+)"/.exec(rm[0]); if (tm) target = tm[1].replace(/^\/?(xl\/)?/, 'xl/'); } }
    if (!target || !z[target]) target = z['xl/worksheets/sheet1.xml'] ? 'xl/worksheets/sheet1.xml' : Object.keys(z).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); }).sort()[0];
    if (!target) throw fail('No sheet found in this .xlsx file.');
    var shared = []; if (z['xl/sharedStrings.xml']) for await (var si of chunksBetween(await entryStream(file, z['xl/sharedStrings.xml']), 'si')) shared.push(textOf(si));
    for await (var rowXml of chunksBetween(await entryStream(file, z[target]), 'row')) {
      var cells = [], cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, m, seq = 0;
      while ((m = cre.exec(rowXml))) {
        var attrs = m[1], body = m[2] || '', rm2 = /\br="([A-Z]+\d+)"/.exec(attrs), tm2 = /\bt="(\w+)"/.exec(attrs), ci = rm2 ? colIndex(rm2[1]) : seq; seq = ci + 1; var type = tm2 ? tm2[1] : 'n', v = '';
        if (type === 's') { var vm = /<v>([\s\S]*?)<\/v>/.exec(body); v = vm ? (shared[parseInt(vm[1], 10)] || '') : ''; }
        else if (type === 'inlineStr') v = textOf(body); else { var vm2 = /<v>([\s\S]*?)<\/v>/.exec(body); v = vm2 ? unent(vm2[1]) : ''; }
        while (cells.length < ci) cells.push(''); cells[ci] = v;
      }
      yield cells;
    }
  }

  // ----- choose reader, find the e-mail (and name) columns -----
  async function rowsOf(file) {
    var head = await readBytes(file, 0, 8);
    if (head[0] === 0x50 && head[1] === 0x4B) return xlsxRows(file);
    if (head[0] === 0xD0 && head[1] === 0xCF) throw fail('This is an old .xls file. Open it in Excel and use Save As .xlsx (or CSV), then try again.');
    return csvRows(file);
  }
  async function* contacts(file, onProgress) {
    var src = await rowsOf(file), it = src[Symbol.asyncIterator]();
    var sample = [], done = false;
    while (sample.length < 50) { var r = await it.next(); if (r.done) { done = true; break; } if (r.value.some(function (c) { return String(c).trim() !== ''; })) sample.push(r.value); }
    var emailCol = -1, nameCol = -1, start = 0, i, j;
    for (i = 0; i < Math.min(sample.length, 20) && emailCol < 0; i++) for (j = 0; j < sample[i].length; j++) if (/^\s*(e-?mail|email address|e-?mail id)\s*$/i.test(sample[i][j])) { emailCol = j; start = i + 1; break; }
    if (emailCol >= 0) { var hdr = sample[start - 1]; for (j = 0; j < hdr.length; j++) if (j !== emailCol && /^\s*(name|full ?name|agent( name)?|contact( name)?|person)\s*$/i.test(hdr[j])) { nameCol = j; break; } if (nameCol < 0) for (j = 0; j < hdr.length; j++) if (j !== emailCol && /name/i.test(hdr[j]) && !/(company|agency|office|business|father)/i.test(hdr[j])) { nameCol = j; break; } }
    else { var hits = {}; sample.forEach(function (rw) { rw.forEach(function (c, k) { if (EMAIL.test(String(c))) hits[k] = (hits[k] || 0) + 1; }); }); var bestK = -1, bestN = 0; Object.keys(hits).forEach(function (k) { if (hits[k] > bestN) { bestN = hits[k]; bestK = +k; } }); if (bestK < 0) throw fail('I could not find an e-mail column. Put the e-mails in one column with a heading called "Email".'); emailCol = bestK; start = 0; }
    var total = 0; function toContact(rw) { var m = EMAIL.exec(String(rw[emailCol] == null ? '' : rw[emailCol])); total++; if (onProgress && total % 2000 === 0) onProgress(total); return { email: m ? m[0] : String(rw[emailCol] == null ? '' : rw[emailCol]).trim(), name: nameCol >= 0 ? String(rw[nameCol] == null ? '' : rw[nameCol]).trim() : '' }; }
    for (i = start; i < sample.length; i++) yield toContact(sample[i]);
    while (!done) { var n = await it.next(); if (n.done) break; var rw = n.value; if (!rw.some(function (c) { return String(c).trim() !== ''; })) continue; yield toContact(rw); }
    if (onProgress) onProgress(total);
  }
  var api = { contacts: contacts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PBImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
