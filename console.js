/* PropBazaar Command Centre console (CC-4): owner actions behind confirmation.
   - No innerHTML anywhere: everything is built with textContent, so data can never become markup.
   - The only network calls are the sign-in/second-factor calls, seven whitelisted READ functions and four whitelisted ACTION functions
     (WRITE below). Actions run only from a confirm button the owner taps; viewing a page never writes anything.
   - Every action is checked again in the database (owner + second factor) and recorded there; this page is only the front door. */
(function () {
  'use strict';
  var C = window.PB_CONSOLE;
  var app = document.getElementById('app');
  if (window.top !== window.self) { app.textContent = 'This page cannot be shown inside another page.'; return; }

  // ---------- allow-list: the console can ONLY make these calls ----------
  var RPC = ['cc_console_verify', 'cc_console_audit', 'cc_console_anchors', 'cc_console_stop',
             'cc_console_inbox', 'cc_console_inbox_counts', 'cc_console_approvals'];
  var WRITE = ['cc_console_decide', 'cc_console_notification_set', 'cc_console_stop_engage', 'cc_console_stop_release'];
  var AUTH = [
    ['POST', /^\/auth\/v1\/token\?grant_type=(password|refresh_token)$/],
    ['GET',  /^\/auth\/v1\/user$/],
    ['POST', /^\/auth\/v1\/factors$/],
    ['POST', /^\/auth\/v1\/factors\/[0-9a-f-]{36}\/(challenge|verify)$/],
    ['POST', /^\/auth\/v1\/logout$/]
  ];
  function allowed(method, path) {
    var m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path);
    if (m) return method === 'POST' && (RPC.indexOf(m[1]) !== -1 || WRITE.indexOf(m[1]) !== -1);
    return AUTH.some(function (a) { return a[0] === method && a[1].test(path); });
  }

  // ---------- session (access token in memory; refresh token in sessionStorage, gone when the tab closes) ----------
  var S = null;                 // { access, refresh, email }
  var RT_KEY = 'pbc.rt';
  function saveRefresh(t) { try { if (t) sessionStorage.setItem(RT_KEY, t); else sessionStorage.removeItem(RT_KEY); } catch (e) {} }
  function loadRefresh() { try { return sessionStorage.getItem(RT_KEY); } catch (e) { return null; } }

  function request(method, path, body, token) {
    if (!allowed(method, path)) return Promise.reject(new Error('blocked: ' + method + ' ' + path));
    var headers = { apikey: C.key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;   // never send the publishable key as a Bearer token (it is not a JWT)
    return fetch(C.url + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var e = new Error((j && (j.message || j.msg || j.error_description || j.error)) || ('HTTP ' + r.status));
            e.status = r.status; throw e;
          }
          return j;
        });
      });
  }
  function setSession(j, email) {
    S = { access: j.access_token, refresh: j.refresh_token, email: email || (j.user && j.user.email) || (S && S.email) || '' };
    saveRefresh(S.refresh);
  }
  function refresh() {
    var rt = S ? S.refresh : loadRefresh();
    if (!rt) return Promise.reject(new Error('no session'));
    return request('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: rt }).then(function (j) { setSession(j); });
  }
  function rpc(name, args, retried) {
    if (!S) return Promise.reject(new Error('Signed out'));
    if (WRITE.indexOf(name) !== -1 && !args) return Promise.reject(new Error('blocked: action without arguments'));
    return request('POST', '/rest/v1/rpc/' + name, args || {}, S.access).catch(function (e) {
      if ((e.status === 401 || /JWT expired/i.test(e.message)) && !retried) return refresh().then(function () { return rpc(name, args, true); });
      if (/MFA_REQUIRED/.test(e.message)) { signOut('Second factor needed. Please sign in again.'); }
      if (/OWNER_ONLY/.test(e.message)) { signOut('This account is not the owner account.'); }
      throw e;
    });
  }

  // ---------- tiny DOM helper (text only) ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]; if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  var fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function when(iso) { return iso ? fmt.format(new Date(iso)) + ' PKT' : '—'; }
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  var banner = document.getElementById('banner');
  function say(msg) { if (msg) { banner.textContent = msg; banner.hidden = false; } else { banner.hidden = true; banner.textContent = ''; } }
  function pri(p) { return h('span', { class: 'chip ' + ({ critical: 'chip-bad', high: 'chip-warn', normal: 'chip-blue', low: 'chip-low' }[p] || 'chip-low'), text: p }); }
  function loading(el) { clear(el); el.appendChild(h('p', { class: 'muted', text: 'Loading…' })); }
  function failure(el, e) { clear(el); el.appendChild(h('p', { class: 'err', text: 'Could not load: ' + e.message })); }

  // ---------- sign in (password, then second factor) ----------
  var tabs = document.getElementById('tabs'), signoutBtn = document.getElementById('signout'), stopChip = document.getElementById('stop-chip');
  function signOut(msg) {
    var tok = S && S.access; S = null; saveRefresh(null);
    if (tok) request('POST', '/auth/v1/logout', {}, tok).catch(function () {});
    tabs.hidden = true; signoutBtn.hidden = true; stopChip.hidden = true; stopTimer(false);
    showLogin(); say(msg || '');
  }
  signoutBtn.addEventListener('click', function () { signOut(''); });

  function showLogin() {
    clear(app);
    var email = h('input', { type: 'email', autocomplete: 'username', required: 'required', id: 'email' });
    var pw = h('input', { type: 'password', autocomplete: 'current-password', required: 'required', id: 'pw' });
    var err = h('p', { class: 'err', hidden: 'hidden' });
    var btn = h('button', { class: 'btn', type: 'submit', text: 'Sign in' });
    var form = h('form', { class: 'card login', novalidate: 'novalidate' },
      h('h1', { text: 'Owner sign in' }), h('p', { class: 'muted small', text: 'Owner console. A second-factor code is required after your password.' }),
      h('label', { for: 'email', text: 'Email' }), email, h('label', { for: 'pw', text: 'Password' }), pw, err, h('div', { class: 'row mt' }, btn));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.hidden = true;
      if (!email.value.trim() || !pw.value) { err.textContent = 'Type your email and password.'; err.hidden = false; return; }
      btn.disabled = true; var step = 'password sign-in';
      request('POST', '/auth/v1/token?grant_type=password', { email: email.value.trim(), password: pw.value })
        .then(function (j) { pw.value = ''; setSession(j, email.value.trim()); saveRefresh(null); step = 'second-factor setup'; return secondFactor(); })
        .catch(function (e) { err.textContent = /Invalid login/i.test(e.message) ? 'Email or password is wrong.' : e.message + ' [' + step + ']'; err.hidden = false; btn.disabled = false; });
    });
    app.appendChild(form);
  }

  function hint() { var a = S && S.access; return a ? ('token ' + (/^eyJ/.test(a) ? 'jwt' : 'other') + ' len ' + a.length) : 'no token'; }
  function secondFactor() {
    if (!S || !S.access) return Promise.reject(new Error('sign-in gave no access token'));
    return request('GET', '/auth/v1/user', null, S.access).catch(function (e) { e.message += ' (user lookup, ' + hint() + ')'; throw e; }).then(function (u) {
      var f = (u.factors || []).filter(function (x) { return x.factor_type === 'totp' && x.status === 'verified'; })[0];
      if (f) return askCode(f.id, null);
      return request('POST', '/auth/v1/factors', { factor_type: 'totp', friendly_name: 'console-' + Date.now(), issuer: 'PropBazaar Console' }, S.access)
        .then(function (en) { return askCode(en.id, en.totp); }, function (e) { e.message += ' (factor enrol, ' + hint() + ')'; throw e; });
    });
  }

  function askCode(factorId, enrol) {
    clear(app);
    var code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', pattern: '[0-9]{6}', id: 'code' });
    var err = h('p', { class: 'err', hidden: 'hidden' });
    var btn = h('button', { class: 'btn', type: 'submit', text: 'Verify' });
    var card = h('form', { class: 'card login', novalidate: 'novalidate' }, h('h1', { text: enrol ? 'Set up your second factor' : 'Enter your code' }));
    if (enrol) {
      card.appendChild(h('p', { class: 'muted small', text: 'First time only. Add this key to an authenticator app (Google Authenticator, Authy, Aegis…), then type the 6-digit code it shows.' }));
      if (enrol.qr_code && /^data:image\/svg\+xml/.test(enrol.qr_code)) card.appendChild(h('img', { class: 'qr', src: enrol.qr_code, alt: 'QR code for the authenticator app' }));
      card.appendChild(h('p', { class: 'small', text: 'Setup key (type it into the app if you cannot scan):' }));
      card.appendChild(h('p', { class: 'mono', id: 'secret', text: enrol.secret || '' }));
      if (enrol.uri && /^otpauth:\/\/totp\//.test(enrol.uri)) card.appendChild(h('p', null, h('a', { href: enrol.uri, text: 'Open in authenticator app on this phone' })));
    } else card.appendChild(h('p', { class: 'muted small', text: 'Open your authenticator app and type the current 6-digit code.' }));
    card.appendChild(h('label', { for: 'code', text: '6-digit code' })); card.appendChild(code); card.appendChild(err);
    card.appendChild(h('div', { class: 'row mt' }, btn));
    card.addEventListener('submit', function (ev) {
      ev.preventDefault(); err.hidden = true; var v = code.value.replace(/\s/g, '');
      if (!/^[0-9]{6}$/.test(v)) { err.textContent = 'Type the 6 digits.'; err.hidden = false; return; }
      btn.disabled = true;
      request('POST', '/auth/v1/factors/' + factorId + '/challenge', {}, S.access)
        .then(function (ch) { return request('POST', '/auth/v1/factors/' + factorId + '/verify', { challenge_id: ch.id, code: v }, S.access); })
        .then(function (j) { setSession(j); enter(); })
        .catch(function (e) { err.textContent = /invalid/i.test(e.message) ? 'That code is not right. Try the next one.' : e.message; err.hidden = false; btn.disabled = false; });
    });
    app.appendChild(card); code.focus();
    return Promise.resolve();
  }

  // ---------- idle logout ----------
  var idleT = null;
  function bump() { if (!S) return; clearTimeout(idleT); idleT = setTimeout(function () { signOut('Signed out after ' + C.idleMinutes + ' minutes without activity.'); }, C.idleMinutes * 60000); }
  ['click', 'keydown', 'touchstart'].forEach(function (n) { document.addEventListener(n, bump, { passive: true }); });

  // ---------- stop-state chip (all pages) ----------
  var stopInt = null;
  function stopTimer(on) { clearInterval(stopInt); stopInt = null; if (on) stopInt = setInterval(function () { if (!document.hidden) refreshStopChip(); }, 60000); }
  function refreshStopChip() {
    return rpc('cc_console_stop').then(function (r) {
      var s = r && r[0]; stopChip.hidden = false;
      if (!s) { stopChip.className = 'chip chip-warn'; stopChip.textContent = 'Stop: unknown'; return s; }
      stopChip.className = 'chip ' + (s.engaged ? 'chip-bad' : 'chip-ok'); stopChip.textContent = s.engaged ? 'STOPPED' : 'Running';
      return s;
    }).catch(function () { stopChip.hidden = false; stopChip.className = 'chip chip-warn'; stopChip.textContent = 'Stop: unknown'; });
  }

  // ---------- pages ----------
  var pages = {};

  pages.audit = function (el) {
    var verifyBox = h('div', { class: 'card' }), listBox = h('div'), more = h('button', { class: 'btn btn-light', type: 'button', text: 'Load older' });
    var filter = h('input', { type: 'search', placeholder: 'Filter by action, e.g. login', 'aria-label': 'Filter by action' });
    var oldest = null, rows = [];
    el.appendChild(h('h1', { text: 'Audit log' })); el.appendChild(verifyBox);
    el.appendChild(h('div', { class: 'card' }, filter)); el.appendChild(listBox); el.appendChild(h('div', { class: 'row center' }, more));

    function status(cls, title, lines) {
      clear(verifyBox);
      verifyBox.appendChild(h('div', { class: 'status ' + cls }, h('span', { class: 'dot' }), h('span', { class: 'big', text: title })));
      (lines || []).forEach(function (l) { verifyBox.appendChild(h('p', { class: l[1] || 'small', text: l[0] })); });
      verifyBox.appendChild(h('button', { class: 'btn btn-light', type: 'button', text: 'Check again', onclick: check }));
    }
    function check() {
      clear(verifyBox); verifyBox.appendChild(h('p', { class: 'muted', text: 'Checking the chain…' }));
      Promise.all([rpc('cc_console_verify'), rpc('cc_console_anchors', { p_limit: 1 })]).then(function (res) {
        var v = res[0][0], a = res[1][0];
        if (!v) return status('status-warn', 'No answer', []);
        if (!v.ok) return status('status-bad', 'CHAIN BROKEN at entry #' + v.broken_seq, [['History was changed or damaged. Do not delete anything. Restore from backup and investigate.']]);
        var lines = [[v.row_count + ' entries, chain intact.'], ['Head hash: ' + v.head_hash, 'mono']];
        if (!a) { lines.push(['No saved anchor yet.']); return status('status-warn', 'Chain intact (no anchor to compare)', lines); }
        // exact check: the entry at the anchor's position must carry the anchored hash
        return rpc('cc_console_audit', { p_limit: 1, p_before_seq: Number(a.row_count) + 1 }).then(function (p) {
          var at = p && p[0], match = at && Number(at.seq) === Number(a.row_count) && at.hash === a.head_hash;
          var newer = Number(v.row_count) - Number(a.row_count);
          lines.push(['Latest anchor #' + a.id + ' (' + when(a.at) + '): ' + a.row_count + ' entries.']);
          if (match) { lines.push(['Matches the log: nothing up to that point has been rewritten. ' + newer + ' new entr' + (newer === 1 ? 'y' : 'ies') + ' since.']); return status('status-ok', 'Chain intact, anchor matches', lines); }
          lines.push(['The anchor does NOT match the log at entry ' + a.row_count + '. Compare with your off-platform copy of the anchor.']); return status('status-bad', 'ANCHOR MISMATCH', lines);
        });
      }).catch(function (e) { clear(verifyBox); verifyBox.appendChild(h('p', { class: 'err', text: 'Could not check: ' + e.message })); });
    }
    function draw() {
      clear(listBox); var q = filter.value.trim().toLowerCase(); var shown = rows.filter(function (r) { return !q || r.action.toLowerCase().indexOf(q) !== -1; });
      if (!shown.length) listBox.appendChild(h('p', { class: 'muted', text: rows.length ? 'Nothing matches the filter in the loaded entries.' : 'No entries.' }));
      shown.forEach(function (r) {
        var meta = r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata, null, 2) : '(no details)';
        listBox.appendChild(h('details', { class: 'item' },
          h('summary', null, h('div', { class: 'row between' }, h('strong', { text: r.action }), h('span', { class: 'small muted', text: '#' + r.seq })),
            h('div', { class: 'small muted', text: when(r.created_at) + ' · ' + r.actor_role + ' · ' + r.resource_type })),
          h('dl', { class: 'kv' }, h('dt', { text: 'Actor' }), h('dd', { class: 'mono', text: r.actor_ref || '(deleted account)' }),
            h('dt', { text: 'Resource' }), h('dd', { class: 'mono', text: r.resource_id || '—' }), h('dt', { text: 'Hash' }), h('dd', { class: 'mono', text: r.hash })),
          h('pre', { text: meta })));
      });
    }
    function load() {
      more.disabled = true;
      var args = { p_limit: 50 }; if (oldest != null) args.p_before_seq = oldest;
      rpc('cc_console_audit', args).then(function (page) {
        rows = rows.concat(page); if (page.length) oldest = page[page.length - 1].seq; draw();
        more.disabled = false; more.hidden = page.length < 50;
      }).catch(function (e) { failure(listBox, e); more.disabled = false; });
    }
    filter.addEventListener('input', draw); more.addEventListener('click', load);
    check(); loading(listBox); load();
  };

  // ---------- confirmation panel (used by every action that matters) ----------
  // opts: { text, label (confirm button), danger, reason: {label, min, max, optional}, typed (word to type), run(reason) -> promise }
  function confirmPanel(host, opts) {
    var old = host.querySelector('.panel'); if (old) { old.remove(); return; }       // tapping the same button again closes it
    var inp = null, typed = null, msg = h('p', { class: 'err', hidden: 'hidden' });
    var ok = h('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-ok'), type: 'button', text: opts.label, disabled: 'disabled' });
    var no = h('button', { class: 'btn btn-light', type: 'button', text: 'Cancel' });
    var panel = h('div', { class: 'panel' }, h('p', { class: 'strong', text: opts.text }));
    if (opts.reason) { inp = h('input', { type: 'text', maxlength: String(opts.reason.max || 300), 'aria-label': opts.reason.label, placeholder: opts.reason.label }); panel.appendChild(h('label', { text: opts.reason.label })); panel.appendChild(inp); }
    if (opts.typed) { typed = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Type ' + opts.typed, placeholder: 'Type ' + opts.typed }); panel.appendChild(h('label', { text: 'Type ' + opts.typed + ' to confirm' })); panel.appendChild(typed); }
    panel.appendChild(msg); panel.appendChild(h('div', { class: 'row mt' }, ok, no));
    function valid() {
      var okReason = !opts.reason || opts.reason.optional || (inp.value.trim().length >= (opts.reason.min || 1));
      var okTyped = !opts.typed || typed.value.trim() === opts.typed;
      ok.disabled = !(okReason && okTyped);
    }
    if (inp) inp.addEventListener('input', valid); if (typed) typed.addEventListener('input', valid); valid();
    no.addEventListener('click', function () { panel.remove(); });
    ok.addEventListener('click', function (ev) {
      if (!ev.isTrusted || ok.disabled) return;          // only a real tap, only when the checks above pass
      ok.disabled = true; no.disabled = true; msg.hidden = true;
      var v = inp ? inp.value.trim() : '';
      opts.run(v).catch(function (e) {
        msg.textContent = 'Not done: ' + e.message; msg.hidden = false; no.disabled = false; ok.disabled = false;
      });
    });
    host.appendChild(panel); if (inp) inp.focus();
  }

  pages.inbox = function (el) {
    var counts = h('div', { class: 'counts' }), listBox = h('div');
    var sel = h('select', { 'aria-label': 'Show' }, h('option', { value: 'unread', text: 'Unread' }), h('option', { value: '', text: 'Everything' }));
    el.appendChild(h('h1', { text: 'Notifications' })); el.appendChild(counts);
    el.appendChild(h('div', { class: 'card' }, sel)); el.appendChild(listBox);
    function mark(id, status, btn) {
      btn.disabled = true;
      rpc('cc_console_notification_set', { p_id: id, p_status: status }).then(load).catch(function (e) { btn.disabled = false; say('Not done: ' + e.message); });
    }
    function load() {
      loading(listBox); say('');
      rpc('cc_console_inbox_counts').then(function (c) {
        clear(counts); if (!c.length) counts.appendChild(h('span', { class: 'chip chip-ok', text: 'Nothing unread' }));
        c.forEach(function (x) { counts.appendChild(h('span', { class: 'chip ' + ({ critical: 'chip-bad', high: 'chip-warn', normal: 'chip-blue', low: 'chip-low' }[x.priority] || 'chip-low'), text: x.priority + ': ' + x.unread })); });
      }).catch(function () {});
      rpc('cc_console_inbox', { p_status: sel.value || null, p_limit: 100 }).then(function (rows) {
        clear(listBox); if (!rows.length) return listBox.appendChild(h('p', { class: 'muted', text: 'Nothing here.' }));
        rows.forEach(function (r) {
          var acts = h('div', { class: 'row mt' });
          if (r.status === 'unread') { var b1 = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Mark read' }); b1.addEventListener('click', function (ev) { if (ev.isTrusted) mark(r.id, 'read', b1); }); acts.appendChild(b1); }
          if (r.status === 'unread' || r.status === 'read') { var b2 = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Dismiss' }); b2.addEventListener('click', function (ev) { if (ev.isTrusted) mark(r.id, 'dismissed', b2); }); acts.appendChild(b2); }
          listBox.appendChild(h('div', { class: 'item' },
            h('div', { class: 'row between' }, h('div', { class: 'row' }, pri(r.priority), h('strong', { text: r.type })), h('span', { class: 'small muted', text: r.status })),
            h('div', null, short(r.subject || '', 120)),
            h('div', { class: 'small muted', text: when(r.occurred_at) + ' · ' + r.source + (r.action_required ? ' · action: ' + r.action_required : '') }),
            acts.childNodes.length ? acts : null));
        });
      }).catch(function (e) { failure(listBox, e); });
    }
    sel.addEventListener('change', load); load();
  };

  pages.approvals = function (el) {
    var listBox = h('div');
    var sel = h('select', { 'aria-label': 'Show' }, h('option', { value: 'pending', text: 'Waiting for you' }), h('option', { value: '', text: 'All (newest first)' }));
    el.appendChild(h('h1', { text: 'Approvals' })); el.appendChild(h('div', { class: 'card' }, sel)); el.appendChild(listBox);
    el.appendChild(h('p', { class: 'muted small', text: 'Approve or Reject records your decision, nothing more. No automatic step carries out an approved request yet.' }));
    function decide(r, decision, host) {
      var yes = decision === 'approved';
      confirmPanel(host, {
        text: (yes ? 'Approve' : 'Reject') + ' this request? “' + short(r.summary, 100) + '” (' + r.action + ' on ' + short(r.target, 60) + '). This only records your decision.',
        label: yes ? 'Yes, approve' : 'Yes, reject', danger: !yes, reason: { label: 'Note (optional)', max: 300, optional: true },
        run: function (note) {
          return rpc('cc_console_decide', { p_id: r.id, p_decision: decision, p_note: note || null }).then(function (res) {
            if (res === 'expired') say('That request had already expired, so it was NOT ' + (yes ? 'approved' : 'rejected') + '.'); else say('');
            return load();
          });
        }
      });
    }
    function load() {
      loading(listBox);
      return rpc('cc_console_approvals', { p_status: sel.value || null, p_limit: 100 }).then(function (rows) {
        clear(listBox); if (!rows.length) return listBox.appendChild(h('p', { class: 'muted', text: 'No approvals waiting.' }));
        rows.forEach(function (r) {
          var cls = { pending: 'chip-warn', approved: 'chip-ok', rejected: 'chip-bad' }[r.status] || 'chip-low';
          var item = h('div', { class: 'item' },
            h('div', { class: 'row between' }, h('strong', { text: r.action }), h('span', { class: 'chip ' + cls, text: r.status })),
            h('div', { text: r.summary }),
            h('dl', { class: 'kv' }, h('dt', { text: 'Requested by' }), h('dd', { text: r.requester }), h('dt', { text: 'Target' }), h('dd', { class: 'mono', text: r.target }),
              h('dt', { text: 'Asked' }), h('dd', { text: when(r.requested_at) }), h('dt', { text: 'Expires' }), h('dd', { text: when(r.expires_at) }),
              r.decided_at ? h('dt', { text: 'Decided' }) : null, r.decided_at ? h('dd', { text: when(r.decided_at) + ' by ' + short(r.decided_by, 40) }) : null,
              r.note ? h('dt', { text: 'Note' }) : null, r.note ? h('dd', { text: r.note }) : null));
          if (r.status === 'pending') {
            var bA = h('button', { class: 'btn btn-ok btn-sm', type: 'button', text: 'Approve' }), bR = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Reject' });
            bA.addEventListener('click', function (ev) { if (ev.isTrusted) decide(r, 'approved', item); });
            bR.addEventListener('click', function (ev) { if (ev.isTrusted) decide(r, 'rejected', item); });
            item.appendChild(h('div', { class: 'row mt' }, bA, bR));
          }
          listBox.appendChild(item);
        });
      }).catch(function (e) { failure(listBox, e); });
    }
    sel.addEventListener('change', load); load();
  };

  pages.stop = function (el) {
    var box = h('div');
    el.appendChild(h('h1', { text: 'Emergency stop' })); el.appendChild(box);
    el.appendChild(h('p', { class: 'muted small', text: 'The stop is a flag that automation must obey. Today it is enforced for agent approval requests (refused while stopped); pieces built later read the same flag. Every engage and release is written to the audit log with your reason.' }));
    loading(box);
    refreshStopChip().then(function (s) {
      clear(box);
      if (!s) return box.appendChild(h('div', { class: 'status status-warn' }, h('span', { class: 'dot' }), h('span', { class: 'big', text: 'Status unknown' })));
      box.appendChild(h('div', { class: 'status ' + (s.engaged ? 'status-bad' : 'status-ok') }, h('span', { class: 'dot' }),
        h('span', { class: 'big', text: s.engaged ? 'STOPPED: automation is paused' : 'Running normally' })));
      var card = h('div', { class: 'card mt' }, h('dl', { class: 'kv' },
        h('dt', { text: 'Last change' }), h('dd', { text: when(s.changed_at) }), h('dt', { text: 'Reason' }), h('dd', { text: s.reason || '—' })));
      var btn = h('button', { class: 'btn ' + (s.engaged ? 'btn-ok' : 'btn-danger'), type: 'button', text: s.engaged ? 'Release the stop' : 'Engage emergency stop' });
      btn.addEventListener('click', function (ev) {
        if (!ev.isTrusted) return;
        confirmPanel(card, s.engaged
          ? { text: 'Release the stop? Automation may resume.', label: 'Release', reason: { label: 'Reason (at least 5 characters)', min: 5, max: 300 }, typed: 'RELEASE',
              run: function (why) { return rpc('cc_console_stop_release', { p_reason: why }).then(function () { return route(); }); } }
          : { text: 'Engage the emergency stop now? Agents will be refused until you release it.', label: 'Engage stop', danger: true, reason: { label: 'Reason (at least 5 characters)', min: 5, max: 300 },
              run: function (why) { return rpc('cc_console_stop_engage', { p_reason: why }).then(function () { return route(); }); } });
      });
      card.appendChild(h('div', { class: 'row mt' }, btn)); box.appendChild(card);
    });
  };

  // ---------- routing ----------
  function route() {
    if (!S) return;
    var name = (location.hash || '#audit').slice(1); if (!pages[name]) name = 'audit';
    Array.prototype.forEach.call(tabs.querySelectorAll('a'), function (a) { a.className = a.getAttribute('data-tab') === name ? 'on' : ''; });
    clear(app); say(''); pages[name](app);
  }
  window.addEventListener('hashchange', route);

  function enter() {
    tabs.hidden = false; signoutBtn.hidden = false; stopTimer(true); bump();
    refreshStopChip(); route();
  }

  // ---------- start ----------
  if (loadRefresh()) {
    refresh().then(function () { enter(); }).catch(function () { saveRefresh(null); showLogin(); });
  } else showLogin();
})();
