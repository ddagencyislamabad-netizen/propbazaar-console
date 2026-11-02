/* PropBazaar console: build downloadable files (CSV or Excel .xlsx) in the browser. No libraries, no network.
   Every cell that could be read as a spreadsheet formula (starts with = + - @ tab or CR) is stored as plain text, so a hostile name or e-mail cannot run anything when the file is opened. */
(function (root) {
  'use strict';
  function safe(v) { v = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }
  function csv(cols, rows) {
    var q = function (v) { v = safe(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var out = [cols.map(function (c) { return q(c.title); }).join(',')];
    rows.forEach(function (r) { out.push(cols.map(function (c) { return q(r[c.key]); }).join(',')); });
    return new Blob(['﻿' + out.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });   // BOM: Excel and Google Sheets read Urdu correctly
  }
  var T = null; function crcTable() { if (T) return T; T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } return T; }
  function crc32(b) { var t = crcTable(), c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(i) { var s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
  function xlsx(cols, rows, sheetName) {
    var enc = new TextEncoder(), parts = [];
    var sheet = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    function row(n, vals) { sheet.push('<row r="' + n + '">' + vals.map(function (v, i) { v = safe(v); return v === '' ? '' : '<c r="' + colName(i) + n + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>'; }).join('') + '</row>'); }
    row(1, cols.map(function (c) { return c.title; })); rows.forEach(function (r, i) { row(i + 2, cols.map(function (c) { return r[c.key]; })); }); sheet.push('</sheetData></worksheet>');
    var files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc((sheetName || 'Contacts').slice(0, 30)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheet.join('')]];
    var cd = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f[0]), data = enc.encode(f[1]), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
    });
    var cdLen = cd.reduce(function (n, p) { return n + p.length; }, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054B50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function download(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000); }
  root.PBExport = { csv: csv, xlsx: xlsx, download: download, safe: safe };
})(typeof window !== 'undefined' ? window : globalThis);
