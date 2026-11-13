/* PropBazaar console: Marketing tab. Runs only in this browser. No network calls, no auto-posting.
   Contacts stay on THIS phone (localStorage). Sending is assisted: you tap Send, WhatsApp opens with the message ready, you press send. */
(function () {
  'use strict';
  var KEY = 'pb_mkt_v1', MAXCAP = 50;
  var DEF_EN = 'Assalam o Alaikum {name}, I am Zafar from PropBazaar.pk, a free platform where property agents list properties and get buyer enquiries. Would you like details? Reply STOP and I will not message you again.';
  var DEF_UR = 'السلام علیکم {name}، میں ظفر علی، PropBazaar.pk سے ہوں۔ یہ پراپرٹی ایجنٹس کے لیے مفت پلیٹ فارم ہے جہاں آپ پراپرٹی لسٹ کر کے خریداروں کی انکوائری حاصل کر سکتے ہیں۔ تفصیل چاہیے؟ پیغام بند کرنے کے لیے STOP لکھیں۔';
  function load() { try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.contacts) return d; } catch (e) {} return { contacts: [], cap: 50, lang: 'ur', en: DEF_EN, ur: DEF_UR, channel: '', day: '', sentToday: 0 }; }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()); }
  function norm(raw) { // -> international digits or ''
    var s = String(raw || '').trim(), plus = /^\+/.test(s) || /^00/.test(s), d = s.replace(/\D/g, '');
    if (/^00/.test(d)) d = d.slice(2);
    if (/^0\d{10}$/.test(d)) return '92' + d.slice(1);
    if (/^92\d{10}$/.test(d)) return d;
    if (/^3\d{9}$/.test(d)) return '92' + d;
    if (plus && d.length >= 8 && d.length <= 15) return d;
    return '';
  }
  function splitLine(l) { var out = [], cur = '', q = false; for (var i = 0; i < l.length; i++) { var c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if ((c === ',' || c === ';' || c === '\t') && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map(function (x) { return x.trim(); }); }
  function parseRows(rows, d) {
    var res = { added: 0, dup: 0, bad: 0 }, rs = rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
    if (!rs.length) return res;
    var head = rs[0].map(function (x) { return String(x).toLowerCase(); }), ni = -1, pi = -1;
    head.forEach(function (x, i) { if (/name/.test(x) && !/(company|agency|office|father)/.test(x) && ni < 0) ni = i; if (/(phone|mobile|whats|number|cell|contact|mob)/.test(x) && !/name/.test(x) && pi < 0) pi = i; });
    var hasHead = pi >= 0; if (hasHead) rs.shift();
    var seen = {}; d.contacts.forEach(function (c) { seen[c.p] = 1; });
    rs.forEach(function (f) {
      f = f.map(function (x) { return x == null ? '' : String(x).trim(); });
      var p = '', n = '';
      if (hasHead) { p = norm(f[pi]); n = ni >= 0 ? f[ni] : ''; }
      else { f.forEach(function (x) { if (!p) { var t = norm(x); if (t) p = t; else if (!n && /[^\d+\s-]/.test(x)) n = x; } }); }
      if (!p) { res.bad++; return; }
      if (seen[p]) { res.dup++; return; }
      seen[p] = 1; d.contacts.push({ p: p, n: (n || '').slice(0, 60), s: 'new', t: '' }); res.added++;
    });
    return res;
  }
  function parse(text, d) { return parseRows(String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); }).map(splitLine), d); }
  async function parseFile(file, d) {
    if (!window.PBImport || !window.PBImport.rows || /\.(csv|txt)$/i.test(file.name)) return parse(await file.text(), d);
    var it = (await window.PBImport.rows(file))[Symbol.asyncIterator](), rows = [], r;
    while (!(r = await it.next()).done) { rows.push(r.value); if (rows.length > 20000) break; }
    return parseRows(rows, d);
  }
  function msgFor(d, c) { var t = d[d.lang] || ''; var nm = c.n ? c.n.split(/\s+/)[0] : (d.lang === 'ur' ? 'صاحب' : 'Sir/Madam'); t = t.replace(/\{name\}/g, nm); if (d.channel) t += (d.lang === 'ur' ? '\nمفت اپڈیٹس: ' : '\nFree updates: ') + d.channel; return t; }
  function count(d, s) { return d.contacts.filter(function (c) { return c.s === s; }).length; }
  function rollDay(d) { var t = today(); if (d.day !== t) { d.day = t; d.sentToday = 0; save(d); } }

  window.PBMarketing = function (pages, h, clear) {
    pages.marketing = function (el) {
      var d = load(); rollDay(d);
      function render() {
        clear(el); rollDay(d);
        var left = Math.max(0, d.cap - d.sentToday), waiting = count(d, 'new');
        el.appendChild(h('h1', { text: 'Marketing' }));
        el.appendChild(h('div', { class: 'status status-ok' }, h('span', { class: 'dot' }), h('span', { text: 'Assisted mode: nothing is sent or posted automatically. You press send each time.' })));

        // --- assisted WhatsApp queue ---
        var q = h('div', { class: 'card mt' });
        q.appendChild(h('h2', { text: 'WhatsApp: today ' + d.sentToday + ' / ' + d.cap }));
        q.appendChild(h('p', { class: 'small muted', text: 'Waiting: ' + waiting + ' · Replied: ' + count(d, 'replied') + ' · Stopped: ' + count(d, 'stop') + ' · Total: ' + d.contacts.length }));
        var capIn = h('input', { type: 'number', min: '5', max: String(MAXCAP), value: String(d.cap), 'aria-label': 'Daily limit' });
        capIn.addEventListener('change', function () { var v = Math.max(5, Math.min(MAXCAP, parseInt(capIn.value, 10) || 50)); d.cap = v; save(d); setTimeout(render, 0); });
        q.appendChild(h('label', { text: 'Daily limit (5 to ' + MAXCAP + ')' })); q.appendChild(capIn);
        var lang = h('select', { 'aria-label': 'Message language' }, h('option', { value: 'ur', text: 'Urdu' }), h('option', { value: 'en', text: 'English' })); lang.value = d.lang;
        lang.addEventListener('change', function () { d.lang = lang.value; save(d); setTimeout(render, 0); });
        q.appendChild(h('label', { text: 'Message language' })); q.appendChild(lang);
        if (left === 0) q.appendChild(h('p', { class: 'err', text: 'Daily limit reached. Come back tomorrow (resets at midnight Pakistan time).' }));
        var next = d.contacts.filter(function (c) { return c.s === 'new'; }).slice(0, left);
        var ul = h('ul', { class: 'list mt' });
        next.forEach(function (c) {
          var a = h('a', { class: 'btn btn-ok btn-sm', href: 'https://wa.me/' + c.p + '?text=' + encodeURIComponent(msgFor(d, c)), target: '_blank', rel: 'noopener noreferrer', text: 'Send' });
          a.addEventListener('click', function () { if (d.sentToday >= d.cap) return; c.s = 'sent'; c.t = new Date().toISOString(); d.sentToday++; save(d); setTimeout(render, 400); });
          ul.appendChild(h('li', { class: 'item' }, h('div', { class: 'row between' }, h('div', { class: 'grow' }, h('strong', { text: c.n || '(no name)' }), h('div', { class: 'small muted mono', text: '+' + c.p })), a)));
        });
        if (!next.length && left > 0) ul.appendChild(h('li', { class: 'muted small', text: waiting ? '' : 'No waiting contacts. Import some below.' }));
        q.appendChild(ul);
        var sent = d.contacts.filter(function (c) { return c.s === 'sent'; }).slice(-30).reverse();
        if (sent.length) {
          q.appendChild(h('h3', { text: 'Sent (mark replies or stops)' }));
          sent.forEach(function (c) {
            var rep = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Replied' }), stp = h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Said STOP' });
            rep.addEventListener('click', function () { c.s = 'replied'; save(d); render(); });
            stp.addEventListener('click', function () { c.s = 'stop'; save(d); render(); });
            q.appendChild(h('div', { class: 'item' }, h('div', { class: 'row between' }, h('div', { class: 'grow small' }, (c.n || '') + ' +' + c.p), rep, stp)));
          });
        }
        el.appendChild(q);

        // --- import ---
        var im = h('div', { class: 'card' });
        im.appendChild(h('h2', { text: 'Add contacts' }));
        im.appendChild(h('p', { class: 'small muted', text: 'Paste one per line (name, number) or choose a CSV file with a "Name" and "Phone" column. Pakistani numbers like 0300… are fixed automatically. Duplicates are skipped. Contacts stay on this phone only. Excel files (.xls, .xlsx) work too.' }));
        var ta = h('textarea', { rows: '5', placeholder: 'Ali Khan, 0300 1234567', 'aria-label': 'Contacts' }), file = h('input', { type: 'file', accept: '.xls,.xlsx,.csv,.txt,text/csv,text/plain' }), out = h('p', { class: 'small' });
        function showRes(r) { save(d); out.textContent = 'Added ' + r.added + ', already had ' + r.dup + ', not a valid number ' + r.bad + '.'; var s = el.querySelector('.card h2'); if (s) { /* refresh counts */ } setTimeout(render, 900); }
        function doImport(text) { showRes(parse(text, d)); }
        var go = h('button', { class: 'btn btn-sm', type: 'button', text: 'Add pasted contacts' }); go.addEventListener('click', function () { doImport(ta.value); });
        file.addEventListener('change', function () { var f = file.files && file.files[0]; if (!f) return; out.textContent = 'Reading file…'; parseFile(f, d).then(showRes).catch(function (e) { out.textContent = 'Could not read this file: ' + (e && e.message || e) + '. Try saving it as CSV.'; }); });
        im.appendChild(ta); im.appendChild(h('div', { class: 'row mt' }, go)); im.appendChild(file); im.appendChild(out);
        el.appendChild(im);

        // --- messages & channel ---
        var ms = h('div', { class: 'card' });
        ms.appendChild(h('h2', { text: 'Messages' }));
        ms.appendChild(h('p', { class: 'small muted', text: 'Use {name} for the contact name. Keep the STOP line. Check the Urdu yourself before sending.' }));
        ['ur', 'en'].forEach(function (k) {
          var t = h('textarea', { rows: '5', 'aria-label': k === 'ur' ? 'Urdu message' : 'English message' }); t.value = d[k]; if (k === 'ur') t.setAttribute('dir', 'rtl');
          t.addEventListener('change', function () { d[k] = t.value.slice(0, 900); save(d); });
          ms.appendChild(h('label', { text: k === 'ur' ? 'Urdu' : 'English' })); ms.appendChild(t);
        });
        var ch = h('input', { type: 'url', placeholder: 'https://t.me/… or WhatsApp channel link (optional)', value: d.channel || '' });
        ch.addEventListener('change', function () { var v = ch.value.trim(); d.channel = /^https:\/\/(t\.me|chat\.whatsapp\.com|whatsapp\.com)\//.test(v) ? v : ''; if (v && !d.channel) ch.value = ''; save(d); });
        ms.appendChild(h('label', { text: 'Channel or group link added to each message (Telegram or WhatsApp)' })); ms.appendChild(ch);
        el.appendChild(ms);

        // --- post limit checker ---
        var pc = h('div', { class: 'card' });
        pc.appendChild(h('h2', { text: 'Post checker' }));
        var plat = h('select', { 'aria-label': 'Platform' }, h('option', { value: 'tiktok', text: 'TikTok (max 5 hashtags)' }), h('option', { value: 'youtube', text: 'YouTube (title max 100)' }), h('option', { value: 'x', text: 'X (max 280)' }), h('option', { value: 'linkedin', text: 'LinkedIn (max 3000)' }));
        var pt = h('textarea', { rows: '4', 'aria-label': 'Post text' }), res = h('p', { class: 'small' });
        function chk() {
          var t = pt.value, p = plat.value, issues = [], tags = (t.match(/#\S+/g) || []).length, len = t.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
          if (p === 'tiktok' && tags > 5) issues.push(tags + ' hashtags (max 5)');
          if (p === 'youtube' && t.length > 100) issues.push('title is ' + t.length + ' characters (max 100)');
          if (p === 'x' && len > 280) issues.push(len + ' characters (max 280)');
          if (p === 'linkedin' && t.length > 3000) issues.push('too long (max 3000)');
          if (/guarantee|100%\s*profit|risk[- ]?free|double your money/i.test(t)) issues.push('risky claim wording');
          if (/(\+?92|0)3\d{2}[\s-]?\d{7}/.test(t) && p !== 'linkedin') issues.push('contains a phone number: check you want it public');
          res.className = 'small ' + (issues.length ? 'err' : ''); res.textContent = t ? (issues.length ? 'Fix: ' + issues.join('; ') : 'OK for this platform (' + t.length + ' characters, ' + tags + ' hashtags).') : '';
        }
        pt.addEventListener('input', chk); plat.addEventListener('change', chk);
        pc.appendChild(plat); pc.appendChild(pt); pc.appendChild(res); el.appendChild(pc);

        // --- backup / wipe ---
        var bk = h('div', { class: 'card' });
        bk.appendChild(h('h2', { text: 'Your data' }));
        bk.appendChild(h('p', { class: 'small muted', text: 'Contacts live only in this browser. Clearing browser data erases them, so download a backup now and then. It holds personal data: keep it private.' }));
        var dl = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: '⬇ Download backup (CSV)' });
        dl.addEventListener('click', function () { if (!window.PBExport) return; window.PBExport.download(window.PBExport.csv(['name', 'phone', 'status', 'sent_at'], d.contacts.map(function (c) { return [c.n, c.p, c.s, c.t]; })), 'marketing-contacts-' + today() + '.csv'); });
        var wipe = h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Delete all contacts from this phone' });
        wipe.addEventListener('click', function () { if (wipe.getAttribute('data-arm') !== '1') { wipe.setAttribute('data-arm', '1'); wipe.textContent = 'Tap again to confirm delete'; return; } d.contacts = []; d.sentToday = 0; save(d); render(); });
        bk.appendChild(h('div', { class: 'row' }, dl, wipe)); el.appendChild(bk);
        if (!save(d)) el.insertBefore(h('p', { class: 'err', text: 'This browser would not save data (private mode?). Contacts will be lost when you close the page.' }), el.children[1]);
      }
      render();
    };
  };
})();
