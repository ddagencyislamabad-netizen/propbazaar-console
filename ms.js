/* PropBazaar console: Messages tab. Sends ONE email at a time through Brevo, from drafts. Master switch OFF by default; the server enforces the switch and a daily limit. */
(function () {
  'use strict';
  window.PBMsg = function (pages, h, clear, aiCall, liveRpc) {
    var ERR = { off: 'Sending is switched OFF. Turn it ON first.', 'no-key': 'The Brevo key is not saved on the server yet.', 'no-sender': 'The sender address is not saved on the server yet.', 'daily-limit': 'Daily limit reached.', 'sent-just-now': 'This message was already sent to this address a few minutes ago.', 'bad-email': 'This address does not look valid.', 'provider-failed': 'Brevo did not accept the message.' };
    var API = function (b) { return aiCall(Object.assign({ fn: 'messages' }, b)); };
    function dateStamp() { var d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
    pages.messages = function (el) {
      var st = null, accounts = null, sel = null, tpl = '', lang = 'en', vals = {}, previewText = '', msg = '', ok = '', armed = '', busy = false, invSeq = 1;
      function fail(e) { msg = e.code && ERR[e.code] ? ERR[e.code] + (e.code === 'no-key' || e.code === 'no-sender' ? ' (' + (e.secretName || '') + ')' : '') + (e.message && e.code === 'provider-failed' ? '' : '') : 'Failed: ' + e.message; ok = ''; }
      function load() { return Promise.all([API({ action: 'status' }), liveRpc('cc_console_recent_accounts', { p_limit: 40 }).catch(function () { return null; })]).then(function (r) { st = r[0].ms; accounts = r[1]; }).catch(fail); }
      function pick(a) { sel = a; vals = { name: a.full_name || '', plan: a.plan || 'Free', period: 'Free plan', amount_pkr: '0', invoice_no: 'INV-' + dateStamp() + '-' + ('00' + invSeq).slice(-3), expiry: a.plan_expiry ? String(a.plan_expiry).slice(0, 10) : '', days: '7' }; previewText = ''; armed = ''; }
      function fieldsOf() { var t = (st && st.templates || []).filter(function (x) { return x.key === tpl; })[0]; return t ? t.fields : []; }
      function varsNow() { var o = {}; fieldsOf().forEach(function (f) { o[f] = vals[f] || ''; }); return o; }
      function doPreview() { if (busy) return; busy = true; API({ action: 'preview', template: tpl, lang: lang, vars: varsNow() }).then(function (j) { previewText = j.mail.subject + '\n\n' + j.mail.text; msg = ''; }).catch(function (e) { previewText = ''; msg = e.message && /^missing:/.test(e.message) ? 'Fill in: ' + e.message.slice(8) : fail(e) || msg; }).then(function () { busy = false; render(); }); }
      function doSend() {
        if (busy || !sel || !sel.email) return; if (armed !== 'send') { armed = 'send'; render(); return; }
        busy = true; armed = ''; API({ action: 'send', template: tpl, lang: lang, to: sel.email, toName: sel.full_name || '', vars: varsNow() }).then(function (j) { st = j.ms; ok = 'Sent to ' + sel.email + '.'; msg = ''; invSeq++; }).catch(fail).then(function () { busy = false; render(); });
      }
      function doSwitch(on) { if (busy) return; if (armed !== 'sw') { armed = 'sw'; render(); return; } busy = true; armed = ''; API({ action: 'switch', enabled: on }).then(function (j) { st = j.ms; msg = ''; ok = ''; }).catch(fail).then(function () { busy = false; render(); }); }
      function render() {
        clear(el); el.appendChild(h('h1', { text: 'Messages (email through Brevo)' }));
        if (msg) el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: msg })));
        if (ok) el.appendChild(h('div', { class: 'status status-ok' }, h('span', { class: 'dot' }), h('span', { text: ok })));
        if (!st) { el.appendChild(h('p', { text: 'Loading...' })); return; }
        var card = h('div', { class: 'card' });
        card.appendChild(h('div', { class: 'strong', text: 'Sending is ' + (st.enabled ? 'ON' : 'OFF') }));
        card.appendChild(h('div', { class: 'small', text: 'Brevo key on server: ' + (st.keyPresent ? 'yes' : 'no (BREVO_API_KEY)') + '   Sender address on server: ' + (st.senderPresent ? 'yes' : 'no (BREVO_SENDER_EMAIL)') + '   Sent in the last 24 h: ' + st.sentToday + ' of ' + st.dailyLimit }));
        card.appendChild(h('button', { class: 'btn ' + (armed === 'sw' ? 'btn-ok' : 'btn-light'), type: 'button', text: armed === 'sw' ? 'Tap again to turn ' + (st.enabled ? 'OFF' : 'ON') : 'Turn ' + (st.enabled ? 'OFF' : 'ON'), onclick: function (ev) { if (ev.isTrusted) doSwitch(!st.enabled); } }));
        el.appendChild(card);
        el.appendChild(h('p', { class: 'small muted', text: 'One email at a time, only when you press Send. The Urdu drafts are a first version: read them before you use them. Invoices are drafts and carry no tax unless you add it.' }));
        el.appendChild(h('h2', { class: 'mt', text: '1. Choose the person' }));
        if (!accounts) el.appendChild(h('p', { class: 'small muted', text: 'The account list could not be loaded (sign in with the second factor).' }));
        (accounts || []).forEach(function (a) {
          var on = sel && sel.id === a.id;
          el.appendChild(h('div', { class: 'card' }, h('button', { class: 'btn ' + (on ? 'btn-ok' : 'btn-light'), type: 'button', text: (on ? '✔ ' : '') + (a.full_name || '(no name)') + ' · ' + a.role + ' · ' + a.status, onclick: function (ev) { if (ev.isTrusted) { pick(a); render(); } } }), h('div', { class: 'small muted', text: (a.email || 'no email') + (a.agency ? ' · ' + a.agency : '') + ' · plan ' + (a.plan || 'free') })));
        });
        if (!sel) return;
        el.appendChild(h('h2', { class: 'mt', text: '2. Choose the message' }));
        var s = h('select', { 'aria-label': 'Message type' }); s.appendChild(h('option', { value: '', text: 'Choose…' }));
        st.templates.forEach(function (t) { var o = h('option', { value: t.key, text: t.label }); if (t.key === tpl) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', function () { tpl = s.value; previewText = ''; armed = ''; render(); });
        var ls = h('select', { 'aria-label': 'Language' }); [['en', 'English'], ['ur', 'Urdu']].forEach(function (x) { var o = h('option', { value: x[0], text: x[1] }); if (x[0] === lang) o.selected = true; ls.appendChild(o); });
        ls.addEventListener('change', function () { lang = ls.value; previewText = ''; armed = ''; render(); });
        el.appendChild(h('div', { class: 'row' }, s, ls));
        if (tpl) {
          fieldsOf().forEach(function (f) {
            var inp = h('input', { type: 'text', 'aria-label': f, placeholder: f.replace('_', ' '), value: vals[f] || '' });
            inp.addEventListener('input', function () { vals[f] = inp.value; previewText = ''; armed = ''; });
            el.appendChild(h('div', { class: 'mt' }, h('label', { class: 'small strong', text: f.replace('_', ' ') }), inp));
          });
          el.appendChild(h('div', { class: 'row mt' }, h('button', { class: 'btn btn-light', type: 'button', text: 'Preview', onclick: function (ev) { if (ev.isTrusted) { doPreview(); } } }),
            h('button', { class: 'btn ' + (armed === 'send' ? 'btn-ok' : 'btn-light'), type: 'button', text: armed === 'send' ? 'Tap again to send to ' + sel.email : 'Send', onclick: function (ev) { if (ev.isTrusted) doSend(); } })));
          if (previewText) el.appendChild(h('pre', { class: 'small', text: previewText }));
        }
        el.appendChild(h('h2', { class: 'mt', text: 'Recent sends' }));
        if (!st.recent.length) el.appendChild(h('p', { class: 'small muted', text: 'Nothing sent yet.' }));
        st.recent.forEach(function (r) { el.appendChild(h('div', { class: 'small', text: String(r.created_at).slice(0, 16).replace('T', ' ') + ' · ' + r.status + ' · ' + r.template + ' · ' + r.to_email + (r.error ? ' · ' + r.error : '') })); });
      }
      render(); load().then(render);
    };
  };
})();
