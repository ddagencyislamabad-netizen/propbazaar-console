/* PropBazaar Command Centre console (CC-5 + outreach import): owner actions behind confirmation; Health page shows the background checks.
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
             'cc_console_inbox', 'cc_console_inbox_counts', 'cc_console_export', 'cc_console_approvals', 'cc_console_collectors', 'cc_console_integrations', 'cc_console_automations'];
  var WRITE = ['cc_console_decide', 'cc_console_notification_set', 'cc_console_stop_engage', 'cc_console_stop_release', 'cc_console_integration_request', 'cc_console_automation_request', 'cc_console_integration_set', 'cc_console_automation_set'];
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

  // ---------- outreach: ONE fixed address, a fixed list of actions, owner login token only ----------
  var BOX = { Islamabad: [33.45, 72.80, 33.85, 73.30], Rawalpindi: [33.45, 72.90, 33.80, 73.20], Lahore: [31.30, 74.15, 31.70, 74.55], Karachi: [24.75, 66.85, 25.20, 67.40], Peshawar: [33.90, 71.40, 34.10, 71.65], Faisalabad: [31.30, 72.95, 31.55, 73.25], Multan: [30.10, 71.35, 30.30, 71.60], Quetta: [30.10, 66.90, 30.30, 67.10], Gujranwala: [32.10, 74.10, 32.25, 74.25], Sialkot: [32.45, 74.45, 32.60, 74.60], Hyderabad: [25.30, 68.30, 25.50, 68.45],
    Dubai: [24.95, 54.95, 25.35, 55.55], 'Abu Dhabi': [24.30, 54.30, 24.55, 54.70], Sharjah: [25.28, 55.35, 25.40, 55.55], Doha: [25.20, 51.40, 25.45, 51.60], Riyadh: [24.50, 46.50, 24.95, 46.95], Jeddah: [21.35, 39.10, 21.75, 39.30], Dammam: [26.35, 49.95, 26.55, 50.20],
    London: [51.40, -0.40, 51.60, 0.10], Birmingham: [52.40, -2.05, 52.55, -1.80], Manchester: [53.40, -2.35, 53.55, -2.15], Bradford: [53.75, -1.85, 53.85, -1.70] };
  var COUNTRIES = [['Pakistan', ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Peshawar', 'Faisalabad', 'Multan', 'Quetta', 'Gujranwala', 'Sialkot', 'Hyderabad']], ['UAE', ['Dubai', 'Abu Dhabi', 'Sharjah']], ['Qatar', ['Doha']], ['Saudi Arabia', ['Riyadh', 'Jeddah', 'Dammam']], ['UK', ['London', 'Birmingham', 'Manchester', 'Bradford']]];
  function countryOf(city) { for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i][1].indexOf(city) !== -1) return COUNTRIES[i][0]; return ''; }
  // big cities are searched in 4 smaller map areas (lighter for the free servers, and the 800-result cap is not hit); a city counts as answered if at least one area answers
  function tiles(b) { if ((b[2] - b[0]) * (b[3] - b[1]) <= 0.05) return [b]; var m1 = (b[0] + b[2]) / 2, m2 = (b[1] + b[3]) / 2; return [[b[0], b[1], m1, m2], [b[0], m2, m1, b[3]], [m1, b[1], b[2], m2], [m1, m2, b[2], b[3]]]; }
  // The map lookup runs in THIS browser (your phone's own connection): the public map servers refuse requests from cloud servers. Public business data only; the agencies' own sites are still read by the server, which obeys robots.txt.
  async function mapLookup(city) {
    if (!BOX[city]) throw new Error('unknown city');
    var EP = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    var parts = tiles(BOX[city]), els = [], answered = 0, tried = [];
    for (var pi = 0; pi < parts.length; pi++) {
      var q = '[out:json][timeout:25];nwr["office"="estate_agent"](' + parts[pi].join(',') + ');out tags 800;', j = null, why = [];
      // the free map servers are often busy (502/503/504/429): go round the list up to 3 times, with a short pause between rounds
      for (var round = 0; round < 3 && !j; round++) {
        if (round) await new Promise(function (r) { setTimeout(r, 5000); });
        for (var i = 0; i < EP.length && !j; i++) {
          var host = EP[i].split('/')[2], ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, 20000);
          try { var r = await fetch(EP[i] + '?data=' + encodeURIComponent(q), { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); if (r.ok) j = await r.json(); else if (round === 2) why.push(host + ': HTTP ' + r.status); }
          catch (e) { if (round === 2) why.push(host + ': ' + (e && e.name === 'AbortError' ? 'timed out' : 'blocked or offline')); } finally { clearTimeout(tm); }
        }
      }
      if (j) { answered++; els = els.concat(j.elements || []); } else if (!tried.length) tried = why;
    }
    if (!answered) throw new Error(tried.join('; '));
    var seen = {}, out = [];
    els.forEach(function (el) {
      var t = el.tags || {}, site = String(t.website || t['contact:website'] || t.url || '').slice(0, 300), mail = String(t.email || t['contact:email'] || '').split(/[;,\s]+/)[0].toLowerCase().slice(0, 120);
      if (!/^https?:\/\//i.test(site)) site = site ? 'https://' + site : '';
      if (!site && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return;
      var key = (site ? site.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase() : '') || mail; if (seen[key]) return; seen[key] = 1;
      out.push({ name: String(t.name || t['name:en'] || key).slice(0, 80), website: site, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail) ? mail : '', city: city });
    });
    return { agencies: out, total: els.length, areas: parts.length, answered: answered };
  }
  var OUT = ['status','switch','setCap', 'importPreview', 'importCommit', 'exportLeads', 'findAgencies', 'findCrawl', 'importBatches', 'importUndo', 'createIntro', 'createIntroDesigned', 'sendTest', 'approveCampaign', 'stopCampaign', 'campaignText', 'saveText', 'deleteCampaign'];
  function outreach(body, retried) {
    if (!S) return Promise.reject(new Error('Signed out'));
    if (!body || OUT.indexOf(body.action) === -1) return Promise.reject(new Error('blocked: outreach action'));
    return fetch(C.outreachUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.access }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit' })
      .then(function (r) { return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.status === 401 && !retried) return refresh().then(function () { return outreach(body, true); });
        if (!r.ok || !j || j.ok === false) { var e = new Error((j && j.error) ? friendly(j.error) + (j.detail ? ' (' + j.detail + ')' : '') : ('HTTP ' + r.status + (r.status === 401 ? ' (not signed in as owner with second factor)' : ''))); e.status = r.status; throw e; }
        return j;
      }); });
  }
  function friendly(c) { return ({ BAD_EMAIL: 'That e-mail address does not look right.', TEST_LIMIT: 'Five tests have been sent today. Try again tomorrow.', ATTESTATION_REQUIRED: 'Tick the confirmation box first.', CHUNK_TOO_LARGE: 'Internal: chunk too large.', BAD_BATCH: 'Bad batch id.', CLAIM_WORD: 'Text contains a blocked claim word.', UNSUB_MISSING: 'Text needs the unsubscribe link.', NOT_FOUND: 'Not found.' })[c] || c; }

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

  pages.outreach = function (el) {
    var CH = 500, picked = null, previewDone = null, running = false;
    var summary = h('div', { class: 'card' }), exportBox = h('div', { class: 'card' }), importBox = h('div', { class: 'card' }), findBox = h('div', { class: 'card' }), batchBox = h('div'), campBox = h('div');
    el.appendChild(h('h1', { text: 'Outreach' }));
    el.appendChild(h('p', { class: 'muted small', text: 'Agents you choose yourself. Sending needs an approved campaign AND the engine switched ON below (typed confirmation, owner login with second factor, every switch is audit-logged). Sending is capped per day, so a big list is simply worked through slowly.' }));
    el.appendChild(summary); el.appendChild(h('h2', { text: 'Import agent e-mails' })); el.appendChild(importBox); el.appendChild(h('h2', { text: 'Find agents automatically' })); el.appendChild(findBox); el.appendChild(h('h2', { text: 'Download contacts' })); el.appendChild(exportBox); el.appendChild(h('h2', { text: 'Imports so far' })); el.appendChild(batchBox); el.appendChild(h('h2', { text: 'Introduction campaign' })); el.appendChild(campBox);

    function kv(pairs) { var dl = h('dl', { class: 'kv wide' }); pairs.forEach(function (p) { dl.appendChild(h('dt', { text: p[0] })); dl.appendChild(h('dd', { text: String(p[1]) })); }); return dl; }
    function loadSummary() {
      loading(summary);
      return outreach({ action: 'status' }).then(function (r) {
        var s = r.status, l = s.leads || {}; clear(summary);
        summary.appendChild(h('div', { class: 'row between' }, h('strong', { text: 'Engine' }), h('span', { class: 'chip ' + (s.paused ? 'chip-bad' : s.enabled ? 'chip-ok' : 'chip-low'), text: s.paused ? 'PAUSED' : s.enabled ? 'ON' : 'OFF' })));
        summary.appendChild(kv([['Waiting to be introduced', l.imported || 0], ['Already introduced', l.contacted || 0], ['Signed up / enquired', (l.confirmed || 0) + (l.enquirer || 0)], ['Unsubscribed or blocked', l.suppressed || 0],
          ['Sent in last 24 h', s.sent24h], ['Daily cap / window', s.dailyCap + ' / ' + s.window], ['Audit chain', s.audit && s.audit.ok ? 'intact (' + s.audit.events + ' events)' : 'PROBLEM']]));
        if (s.pauseReason) summary.appendChild(h('p', { class: 'err', text: 'Paused: ' + s.pauseReason }));
        var sw = h('div', { class: 'row mt' }), swHost = h('div');
        function doSwitch(body) { return outreach(Object.assign({ action: 'switch' }, body)).then(loadSummary); }
        if (s.enabled && !s.paused) {
          var off = h('button', { class: 'btn btn-danger', type: 'button', text: '\u23F9 Turn engine OFF', 'aria-label': 'Turn engine off' });
          off.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(swHost, { text: 'Turn the sending engine OFF? Nothing more will be sent until you turn it on again.', label: 'Yes, turn OFF', danger: true, run: function () { return doSwitch({ enabled: false }); } }); });
          sw.appendChild(off);
        } else {
          var on = h('button', { class: 'btn btn-ok', type: 'button', text: '\u25B6 Turn engine ON', 'aria-label': 'Turn engine on' });
          on.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(swHost, { text: 'Turn the sending engine ON? Approved campaigns will start e-mailing real people, up to ' + s.dailyCap + ' a day inside the sending window' + (s.paused ? '. It was auto-paused (' + (s.pauseReason || 'see above') + '): this also clears the pause.' : '.'), label: 'Yes, start sending', typed: 'START', run: function () { return doSwitch(s.paused ? { enabled: true, paused: false } : { enabled: true }); } }); });
          sw.appendChild(on);
        }
        summary.appendChild(sw); summary.appendChild(swHost);
        var h7 = s.health7d || { sent: 0, bounces: 0, complaints: 0, bounceRate: 0 };
        summary.appendChild(h('p', { class: 'muted small', text: 'Last 7 days: ' + h7.sent + ' sent, ' + h7.bounces + ' bounced (' + (h7.bounceRate * 100).toFixed(1) + '%), ' + h7.complaints + ' spam complaints. Safe to raise the cap only while bounces stay under 2% and there are no complaints.' }));
        var capBtn = h('button', { class: 'btn btn-light btn-icon', type: 'button', text: '\u270E Daily cap: ' + s.dailyCap, title: 'Change the daily sending cap', 'aria-label': 'Change daily cap' }), capHost = h('div');
        capBtn.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(capHost, { text: 'Set the daily sending cap (now ' + s.dailyCap + ', highest allowed ' + (s.maxCap || 500) + '). Suggested ramp: days 1-3 = 20, days 4-7 = 50, days 8-14 = 100, week 3 on = 200, then higher only if bounces stay under 2% and there are no complaints.', label: 'Yes, set cap', typed: 'CAP', reason: { label: 'New daily cap (whole number)', min: 1, max: 3 }, run: function (v) { var n = Number(v); if (!/^\d{1,3}$/.test(v) || n < 1 || n > (s.maxCap || 500)) return Promise.reject(new Error('Enter a whole number from 1 to ' + (s.maxCap || 500))); return outreach({ action: 'setCap', cap: n }).then(loadSummary); } }); });
        summary.appendChild(h('div', { class: 'row mt' }, capBtn)); summary.appendChild(capHost);
        return s;
      }).catch(function (e) { failure(summary, e); });
    }

    // ----- import -----
    var file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt,.tsv', 'aria-label': 'Contact file' });
    var skipRole = h('input', { type: 'checkbox', id: 'skiprole' });
    var attest = h('input', { type: 'checkbox', id: 'attest' });
    var checkBtn = h('button', { class: 'btn btn-light', type: 'button', text: 'Step 1: Check the file (dry run)', disabled: 'disabled' });
    var goBtn = h('button', { class: 'btn btn-ok', type: 'button', text: 'Step 2: Import', disabled: 'disabled' });
    var prog = h('p', { class: 'small muted' }), result = h('div');
    importBox.appendChild(h('p', { class: 'small', text: 'Choose an Excel (.xlsx) or CSV file. It needs a column headed "Email" (a "Name" column is optional). There is no size limit: the file is read piece by piece on this phone and only the e-mail and name go to the server.' }));
    importBox.appendChild(file);
    importBox.appendChild(h('div', { class: 'row mt' }, h('label', null, skipRole, ' Skip general addresses like info@ and sales@')));
    importBox.appendChild(h('div', { class: 'row mt' }, checkBtn)); importBox.appendChild(prog); importBox.appendChild(result);
    importBox.appendChild(h('div', { class: 'panel mt' }, h('label', { class: 'strong' }, attest, ' I confirm these are business e-mail addresses of property agents or agencies, and that I may send each of them one introduction to PropBazaar. Every e-mail carries an unsubscribe link and unsubscribed people are never e-mailed again.'), h('div', { class: 'row mt' }, goBtn)));

    function setBusy(b) { running = b; file.disabled = b; checkBtn.disabled = b || !picked; refreshGo(); }
    function refreshGo() { goBtn.disabled = running || !previewDone || !attest.checked || previewDone.counts.new === 0; }
    file.addEventListener('change', function () { picked = file.files && file.files[0] || null; previewDone = null; clear(result); prog.textContent = picked ? picked.name + ' (' + (picked.size / 1048576).toFixed(1) + ' MB)' : ''; checkBtn.disabled = !picked; refreshGo(); });
    attest.addEventListener('change', refreshGo);
    function blank() { return { received: 0, invalid: 0, duplicateInFile: 0, alreadyKnown: 0, suppressed: 0, role: 0, skippedRole: 0, freeMail: 0, new: 0 }; }
    function add(t, c) { Object.keys(t).forEach(function (k) { t[k] += c[k] || 0; }); }
    // streams the file, removes repeats across the WHOLE file, sends chunks of CH rows; mode = 'importPreview' | 'importCommit'
    function pump(mode, batch) {
      var tot = blank(), seen = new Set(), chunk = [], n = 0, fileDup = 0, rows = 0;
      function send(rowsArr) {
        var body = { action: mode, rows: rowsArr, skipRole: skipRole.checked }; if (mode === 'importCommit') { body.batch = batch; body.fileName = picked.name; body.attested = attest.checked; }
        function attempt(k) { return outreach(body).catch(function (e) { if (k < 3 && (!e.status || e.status >= 500)) return new Promise(function (r) { setTimeout(r, 1500 * (k + 1)); }).then(function () { return attempt(k + 1); }); throw e; }); }
        return attempt(0).then(function (r) { add(tot, r.counts); });
      }
      return (async function () {
        for await (var c of PBImport.contacts(picked)) {
          rows++; var key = String(c.email).trim().toLowerCase();
          if (seen.has(key)) { fileDup++; continue; } seen.add(key); chunk.push({ email: c.email, name: c.name });
          if (chunk.length >= CH) { var cc = chunk; chunk = []; await send(cc); n += cc.length; prog.textContent = (mode === 'importPreview' ? 'Checked ' : 'Imported ') + rows.toLocaleString() + ' rows…'; }
        }
        if (chunk.length) await send(chunk);
        tot.duplicateInFile += fileDup; tot.received += fileDup; return { counts: tot, rows: rows };
      })();
    }
    function table(c, title) {
      clear(result); result.appendChild(h('h3', { text: title }));
      result.appendChild(kv([['Rows read', c.received], ['New contacts', c.new], ['Already in the system', c.alreadyKnown], ['Repeated in the file', c.duplicateInFile], ['Unsubscribed / blocked before', c.suppressed],
        ['Not a valid e-mail', c.invalid], ['General addresses (info@ etc.)', c.role + (c.skippedRole ? ' (' + c.skippedRole + ' skipped)' : '')], ['Gmail/Yahoo/Hotmail style', c.freeMail]]));
    }
    checkBtn.addEventListener('click', function (ev) {
      if (!ev.isTrusted || !picked || running) return; setBusy(true); previewDone = null; clear(result); prog.textContent = 'Reading the file…'; say('');
      pump('importPreview').then(function (r) { previewDone = r; prog.textContent = 'Dry run finished. Nothing was saved.'; table(r.counts, 'Dry run result (nothing saved)'); })
        .catch(function (e) { prog.textContent = ''; result.appendChild(h('p', { class: 'err', text: e.user ? e.message : 'Could not check: ' + e.message })); }).then(function () { setBusy(false); });
    });
    goBtn.addEventListener('click', function (ev) {
      if (!ev.isTrusted || !picked || running || !previewDone || !attest.checked) return;
      var batch = 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); setBusy(true); prog.textContent = 'Importing…'; say('');
      pump('importCommit', batch).then(function (r) { previewDone = null; prog.textContent = 'Done.'; table(r.counts, 'Imported (batch ' + batch + ')'); attest.checked = false; return Promise.all([loadSummary(), loadBatches()]); })
        .catch(function (e) { prog.textContent = ''; result.appendChild(h('p', { class: 'err', text: 'Stopped: ' + e.message + '. Nothing is lost: choose the same file again, run the check, and import again; people already added are skipped.' })); loadSummary(); loadBatches(); })
        .then(function () { setBusy(false); });
    });

    // ----- agent finder: public listings + each agency's own published business e-mail; you review, then import -----
    (function finder() {
      var CITY_LIST = [].concat.apply([], COUNTRIES.map(function (c) { return c[1]; })), FREE = /@(gmail|yahoo|hotmail|outlook|live|icloud|ymail)\./i, ROLEX = /^(info|admin|sales|contact|office|support|hello|enquiries|inquiries|marketing|accounts|noreply|no-reply|webmaster|mail|team)@/i;
      var boxes = {}, running = false, stop = false, found = new Map(), picks = new Map(), attest2 = h('input', { type: 'checkbox', id: 'attest2' });
      var cityRow = h('div', { class: 'mt' });
      COUNTRIES.forEach(function (co) {
        var all = h('input', { type: 'checkbox', 'aria-label': 'All cities in ' + co[0] }), row = h('div', { class: 'row' });
        co[1].forEach(function (c) { var b = h('input', { type: 'checkbox', 'aria-label': 'City ' + c }); if (c === 'Islamabad' || c === 'Rawalpindi') b.checked = true; boxes[c] = b; row.appendChild(h('label', { class: 'small' }, b, ' ' + c + '  ')); });
        all.addEventListener('change', function () { co[1].forEach(function (c) { boxes[c].checked = all.checked; }); });
        cityRow.appendChild(h('div', { class: 'mt' }, h('label', { class: 'small strong' }, all, ' ' + co[0] + (co[0] === 'Pakistan' ? '' : ' (Pakistanis living abroad)') + ' · select all'), row));
      });
      var go = h('button', { class: 'btn btn-ok', type: 'button', text: '🔎 Find agents', 'aria-label': 'Find agents' }), halt = h('button', { class: 'btn btn-light', type: 'button', text: '⏹ Stop', 'aria-label': 'Stop searching', hidden: 'hidden' });
      var prog = h('p', { class: 'small muted' }), list = h('div'), outcome = h('div');
      findBox.appendChild(h('p', { class: 'small', text: 'Looks up real-estate agencies in the cities you tick from public map listings, then reads each agency\'s own website for the business e-mail it publishes. It obeys each site\'s robots.txt, reads at most 3 pages per site and never signs in anywhere. Nothing is saved or sent here: you review the list, untick anything you do not want, and only then import it.' }));
      findBox.appendChild(cityRow); findBox.appendChild(h('div', { class: 'row mt' }, go, halt)); findBox.appendChild(prog); findBox.appendChild(list); findBox.appendChild(outcome);
      function add(r, city) { (r.found || []).forEach(function (f) { var em = String(f.email || '').toLowerCase(); if (!em || found.has(em)) return; found.set(em, { email: em, name: r.name || '', city: r.city || city, source: f.source || '', own: !!f.own }); }); }
      function render() {
        clear(list); var rows = Array.from(found.values()); if (!rows.length) return;
        rows.sort(function (a, b) { return (b.own - a.own) || a.email.localeCompare(b.email); });
        list.appendChild(h('h3', { text: rows.length + ' addresses found. Tick the ones to import.' }));
        var count = h('p', { class: 'small strong' }), goImp = h('button', { class: 'btn btn-ok', type: 'button', text: 'Import selected', disabled: 'disabled' });
        function refresh() { var n = 0; picks.forEach(function (v) { if (v) n++; }); count.textContent = n + ' selected'; goImp.disabled = running || !n || !attest2.checked; }
        rows.slice(0, 3000).forEach(function (r) {
          var free = FREE.test(r.email), role = ROLEX.test(r.email); if (!picks.has(r.email)) picks.set(r.email, r.own && !free && !role);
          var cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + r.email }); cb.checked = picks.get(r.email); cb.addEventListener('change', function () { picks.set(r.email, cb.checked); refresh(); });
          var tags = [r.city + (countryOf(r.city) && countryOf(r.city) !== 'Pakistan' ? ' (' + countryOf(r.city) + ')' : ''), r.own ? 'own website address' : 'not on agency domain', free ? 'Gmail/Yahoo style' : '', role ? 'general address' : ''].filter(Boolean).join(' · ');
          var line = h('div', { class: 'small' }, h('label', null, cb, ' ', h('strong', { text: r.email }), ' ', r.name ? '(' + r.name + ')' : ''), ' '); if (/^https?:\/\//.test(r.source)) line.appendChild(h('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer', text: '[source]' })); line.appendChild(h('div', { class: 'muted', text: tags })); list.appendChild(line);
        });
        if (rows.length > 3000) list.appendChild(h('p', { class: 'muted small', text: 'Showing the first 3000. Run the search again later for more.' }));
        list.appendChild(count);
        list.appendChild(h('div', { class: 'panel mt' }, h('label', { class: 'strong' }, attest2, ' I have looked at this list. These are business e-mail addresses that agents or agencies publish themselves, and I may send each of them one introduction with an unsubscribe link.'), h('div', { class: 'row mt' }, goImp)));
        attest2.addEventListener('change', refresh); refresh();
        goImp.addEventListener('click', function (ev) {
          if (!ev.isTrusted || running || !attest2.checked) return; var sel = rows.filter(function (r) { return picks.get(r.email); }).map(function (r) { return { email: r.email, name: r.name, country: countryOf(r.city) }; }); if (!sel.length) return;
          var batch = 'find-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), tot = { received: 0, new: 0, alreadyKnown: 0, suppressed: 0 }; running = true; goImp.disabled = true; prog.textContent = 'Importing…';
          (async function () { for (var i = 0; i < sel.length; i += 500) { var r = await outreach({ action: 'importCommit', batch: batch, fileName: 'Agent finder: ' + Array.from(new Set(sel.map(function (x) { return x.country; }).filter(Boolean))).join(', '), rows: sel.slice(i, i + 500).map(function (x) { return { email: x.email, name: x.name }; }), attested: true, skipRole: false }); ['received', 'new', 'alreadyKnown', 'suppressed'].forEach(function (k) { tot[k] += r.counts[k] || 0; }); } })()
            .then(function () { prog.textContent = 'Done.'; clear(outcome); outcome.appendChild(h('p', { class: 'strong', text: 'Imported (batch ' + batch + '): ' + tot.new + ' new, ' + tot.alreadyKnown + ' already known, ' + tot.suppressed + ' blocked before.' })); found.clear(); picks.clear(); attest2.checked = false; clear(list); return Promise.all([loadSummary(), loadBatches()]); })
            .catch(function (e) { prog.textContent = ''; outcome.appendChild(h('p', { class: 'err', text: 'Stopped: ' + e.message + '. People already added are skipped if you import again.' })); }).then(function () { running = false; refresh(); });
        });
      }
      go.addEventListener('click', function (ev) {
        if (!ev.isTrusted || running) return; var cities = CITY_LIST.filter(function (c) { return boxes[c].checked; }); if (!cities.length) { prog.textContent = 'Tick at least one city.'; return; }
        running = true; stop = false; go.disabled = true; halt.hidden = false; found.clear(); picks.clear(); clear(list); clear(outcome); var notes = [];
        (async function () {
          for (var ci = 0; ci < cities.length && !stop; ci++) {
            var city = cities[ci], agencies; prog.textContent = city + ': looking up agencies…';
            var before = found.size; try { var la = await mapLookup(city); agencies = la.agencies || []; notes.push(city + ': ' + (la.total || 0) + ' agencies on the map, ' + agencies.length + ' with a website or e-mail' + (la.answered < la.areas ? ' (only ' + la.answered + ' of ' + la.areas + ' map areas answered: run this city again later for the rest)' : '')); } catch (e) { outcome.appendChild(h('p', { class: 'err', text: city + ': the public map source did not answer (' + e.message + '). Try again in a few minutes.' })); continue; }
            for (var i = 0; i < agencies.length && !stop; i += 6) {
              prog.textContent = city + ': read ' + Math.min(i, agencies.length) + ' of ' + agencies.length + ' agencies · ' + found.size + ' addresses found so far';
              try { var r = await outreach({ action: 'findCrawl', sites: agencies.slice(i, i + 6) }); (r.results || []).forEach(function (x) { add(x, city); }); } catch (e) { /* skip this group, carry on */ }
            }
            notes[notes.length - 1] += ', ' + (found.size - before) + ' new addresses';
          }
        })().then(function () { prog.textContent = (stop ? 'Stopped. ' : 'Finished. ') + found.size + ' addresses found. Nothing has been saved or sent.'; notes.forEach(function (n) { outcome.appendChild(h('p', { class: 'small muted', text: n })); }); render(); }).catch(function (e) { prog.textContent = 'Stopped: ' + e.message; render(); }).then(function () { running = false; go.disabled = false; halt.hidden = true; });
      });
      halt.addEventListener('click', function (ev) { if (ev.isTrusted) stop = true; });
    })();

    // ----- download contacts (CSV or Excel) for your own follow-up lists -----
    (function exporter() {
      var LIVE_COLS = { agents: ['group', 'name', 'email', 'phone', 'agency', 'city', 'plan', 'status', 'joined'], sellers: ['group', 'name', 'email', 'phone', 'agency', 'city', 'account', 'listings', 'for_sale_or_rent', 'first_listing'], enquiries: ['group', 'name', 'email', 'phone', 'city', 'listing', 'for_sale_or_rent', 'message', 'when'], signups: ['group', 'name', 'email', 'phone', 'city', 'source', 'when'] };
      LIVE_COLS.buyers = LIVE_COLS.agents;
      var L9 = ['group', 'name', 'email', 'status', 'can_use_for_campaign', 'source', 'consent_date'];
      var SETS = [
        { id: 'l9-all', label: 'Everyone in the outreach list (all groups)', l9: /./ }, { id: 'l9-agents', label: 'Agents (imported or signed up)', l9: /^agent/ }, { id: 'l9-owners', label: 'Property owners who signed up on the landing page', l9: /^property owner/ },
        { id: 'l9-seekers', label: 'Buyers / seekers who signed up on the landing page', l9: /^buyer/ }, { id: 'l9-optins', label: 'Website opt-ins (confirmed e-mail updates)', l9: /^website opt-in/ }, { id: 'l9-enq', label: 'Listing enquirers (outreach list)', l9: /^enquirer/ },
        { id: 'v-agents', label: 'Site: registered agents', kind: 'agents' }, { id: 'v-buyers', label: 'Site: registered buyers', kind: 'buyers' }, { id: 'v-sellers', label: 'Site: sellers / people who posted a listing', kind: 'sellers' },
        { id: 'v-enq', label: 'Site: buyer enquiries on listings', kind: 'enquiries' }, { id: 'v-signups', label: 'Site: sign-up contacts (visitors who left details)', kind: 'signups' }];
      var sel = h('select', { 'aria-label': 'What to download' }); SETS.forEach(function (x) { sel.appendChild(h('option', { value: x.id, text: x.label })); });
      var fmt = h('select', { 'aria-label': 'File type' }); fmt.appendChild(h('option', { value: 'csv', text: 'CSV (opens in Excel, Sheets, WPS)' })); fmt.appendChild(h('option', { value: 'xlsx', text: 'Excel (.xlsx)' }));
      var go = h('button', { class: 'btn btn-ok', type: 'button', text: '⬇ Download', 'aria-label': 'Download contacts' }), prog = h('p', { class: 'small muted' }), host = h('div');
      exportBox.appendChild(h('p', { class: 'small', text: 'Download a list to your phone for your own follow-up. Choose a group and a file type. Only people who gave PropBazaar their details are in these lists: visitors who only browsed leave nothing behind. The "can_use_for_campaign" column says which people may be e-mailed by the outreach engine; site users and buyers are NOT automatically campaign contacts. These files hold personal data: keep them private, and delete them when finished.' }));
      exportBox.appendChild(h('div', { class: 'row mt' }, sel)); exportBox.appendChild(h('div', { class: 'row mt' }, fmt)); exportBox.appendChild(h('div', { class: 'row mt' }, go)); exportBox.appendChild(prog); exportBox.appendChild(host);
      async function collect(set) {
        var rows = [], off = 0;
        if (set.kind) { for (;;) { var page = await rpc('cc_console_export', { p_kind: set.kind, p_offset: off, p_limit: 1000 }); rows = rows.concat(page || []); prog.textContent = rows.length + ' rows…'; if (!page || page.length < 1000) break; off += 1000; } return { rows: rows, cols: LIVE_COLS[set.kind] }; }
        for (;;) { var r = await outreach({ action: 'exportLeads', offset: off, limit: 1000 }); r.rows.forEach(function (x) { if (set.l9.test(x.group)) rows.push(x); }); prog.textContent = rows.length + ' rows…'; if (r.next == null) break; off = r.next; }
        return { rows: rows, cols: L9 };
      }
      go.addEventListener('click', function (ev) {
        if (!ev.isTrusted) return; var set = SETS.filter(function (x) { return x.id === sel.value; })[0];
        confirmPanel(host, { text: 'Download "' + set.label + '" as ' + (fmt.value === 'csv' ? 'CSV' : 'Excel') + '? The file contains personal contact details. This download is written to the audit log.', label: 'Yes, download', typed: 'EXPORT', run: function () {
          prog.textContent = 'Preparing…'; go.disabled = true;
          return collect(set).then(function (d) {
            if (!d.rows.length) { prog.textContent = 'Nothing to download in that group yet.'; return; }
            var cols = d.cols.map(function (k) { return { key: k, title: k.replace(/_/g, ' ') }; }), stamp = new Date().toISOString().slice(0, 10), name = 'propbazaar-' + set.id + '-' + stamp + '.' + fmt.value;
            PBExport.download(fmt.value === 'csv' ? PBExport.csv(cols, d.rows) : PBExport.xlsx(cols, d.rows, set.label), name); prog.textContent = 'Downloaded ' + d.rows.length + ' rows as ' + name + '. Check your phone\'s Downloads folder.'; var p = host.querySelector('.panel'); if (p) p.remove();
          }).catch(function (e) { prog.textContent = ''; throw new Error(/cc_console_export|PGRST202|Could not find/i.test(e.message) ? 'The live-site export is not installed yet. The outreach-list downloads work; the "Site:" ones need the export function added first.' : e.message); })
            .then(function (v) { go.disabled = false; return v; }, function (e) { go.disabled = false; throw e; });
        } });
      });
    })();

    // ----- batches (undo only removes people who have not been e-mailed yet) -----
    function loadBatches() {
      loading(batchBox);
      return outreach({ action: 'importBatches' }).then(function (r) {
        clear(batchBox); if (!r.batches.length) return batchBox.appendChild(h('p', { class: 'muted', text: 'No imports yet.' }));
        r.batches.forEach(function (b) {
          var item = h('div', { class: 'item' }, h('div', { class: 'row between' }, h('strong', { text: short(b.file || b.id, 40) }), h('span', { class: 'chip ' + (b.undone ? 'chip-low' : 'chip-blue'), text: b.undone ? 'undone' : 'added ' + b.added })),
            h('div', { class: 'small muted', text: when(b.at) + ' · ' + b.id + (b.undone ? '' : ' · still waiting: ' + b.waiting) }));
          if (!b.undone && b.waiting > 0) {
            var u = h('button', { class: 'btn btn-light btn-sm btn-icon', type: 'button', text: '\u21A9', title: 'Undo: remove those still waiting', 'aria-label': 'Undo: remove those still waiting' });
            u.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(item, { text: 'Remove the ' + b.waiting + ' contacts from this import who have not been e-mailed yet? People already e-mailed stay (so they can be kept off future lists).', label: 'Yes, remove', danger: true,
              run: function () { return outreach({ action: 'importUndo', batch: b.id }).then(function () { return Promise.all([loadSummary(), loadBatches()]); }); } }); });
            item.appendChild(h('div', { class: 'row mt' }, u));
          }
          batchBox.appendChild(item);
        });
      }).catch(function (e) { failure(batchBox, e); });
    }

    // ----- introduction campaign -----
    function loadCamps() {
      loading(campBox);
      return outreach({ action: 'status' }).then(function (r) {
        clear(campBox); var camps = r.status.campaigns.filter(function (c) { return c.audience === 'introduction'; });
        var mk = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: camps.length ? 'Create another copy of the English + Urdu text' : 'Create the English + Urdu introduction text' });
        mk.addEventListener('click', function (ev) { if (!ev.isTrusted) return; mk.disabled = true; outreach({ action: 'createIntro' }).then(loadCamps).catch(function (e) { say('Not done: ' + e.message); mk.disabled = false; }); });
        var mkd = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Create the designed e-mail (picture + button, English + Urdu)' });
        mkd.addEventListener('click', function (ev) { if (!ev.isTrusted) return; mkd.disabled = true; outreach({ action: 'createIntroDesigned' }).then(loadCamps).catch(function (e) { say('Not done: ' + e.message); mkd.disabled = false; }); });
        campBox.appendChild(h('div', { class: 'row' }, mk)); campBox.appendChild(h('div', { class: 'row mt' }, mkd));
        camps.forEach(function (c) {
          var live = c.active && c.approved;
          var subj = h('input', { type: 'text', maxlength: '120', 'aria-label': 'Subject', dir: 'auto', disabled: 'disabled' });
          var body = h('textarea', { rows: '16', maxlength: '3000', 'aria-label': 'Text', dir: 'auto', class: 'ta', disabled: 'disabled' });
          var designed = false, title = h('span', { class: 'row' }, h('strong', { text: c.name }), ' ');
          var item = h('div', { class: 'item' }, h('div', { class: 'row between' }, title, h('span', { class: 'chip ' + (live ? 'chip-ok' : 'chip-warn'), text: live ? 'approved, active' : 'not approved' })),
            h('label', { text: 'Subject' }), subj, h('label', { text: 'Text (keep {name}, {listingUrl}, {senderName} and {unsubscribeUrl} exactly as written)' }), body,
            h('p', { class: 'small muted', text: '\uD83D\uDCBE save as new text   \u2714 approve   \uD83D\uDDD1 delete   \u23F9 stop.  A footer with the postal address and unsubscribe link is added to every e-mail. Changing the text makes a NEW copy that you approve separately. An approved text cannot be edited; stop it first.' }));
          outreach({ action: 'campaignText', id: c.id }).then(function (t) { var s0 = t.campaign.steps[0]; designed = !!s0.html; if (designed) title.appendChild(h('span', { class: 'chip chip-blue', text: 'designed e-mail' })); subj.value = s0.subject; body.value = s0.body; if (!live) { subj.disabled = false; body.disabled = false; } }).catch(function (e) { body.value = e.message; });
          var row = h('div', { class: 'row mt' });
          if (!live) {
            var sv = h('button', { class: 'btn btn-light btn-sm btn-icon', type: 'button', text: '\uD83D\uDCBE', title: 'Save my changes as a new text', 'aria-label': 'Save my changes as a new text' });
            sv.addEventListener('click', function (ev) { if (!ev.isTrusted) return; sv.disabled = true; outreach({ action: 'saveText', subject: subj.value, body: body.value, designed: designed }).then(function () { say('Saved as a new text below. Read it, then approve it.'); return loadCamps(); }).catch(function (e) { say('Not saved: ' + e.message); sv.disabled = false; }); });
            var a = h('button', { class: 'btn btn-ok btn-sm btn-icon', type: 'button', text: '\u2714', title: 'Approve this text', 'aria-label': 'Approve this text' }); a.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(item, { text: 'Approve exactly this saved text for sending? (If you changed the boxes, save them first.) Nothing is sent until you also switch the engine ON at the top of this page.', label: 'Yes, approve', run: function () { return outreach({ action: 'approveCampaign', id: c.id }).then(loadCamps); } }); });
            var d = h('button', { class: 'btn btn-danger btn-sm btn-icon', type: 'button', text: '\uD83D\uDDD1', title: 'Delete this text', 'aria-label': 'Delete this text' }); d.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(item, { text: 'Delete this unapproved text?', label: 'Yes, delete', danger: true, run: function () { return outreach({ action: 'deleteCampaign', id: c.id }).then(loadCamps); } }); });
            row.appendChild(sv); row.appendChild(a); row.appendChild(d);
          } else { var st = h('button', { class: 'btn btn-danger btn-sm btn-icon', type: 'button', text: '\u23F9', title: 'Stop this campaign', 'aria-label': 'Stop this campaign' }); st.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(item, { text: 'Stop this campaign?', label: 'Yes, stop', danger: true, run: function () { return outreach({ action: 'stopCampaign', id: c.id }).then(loadCamps); } }); }); row.appendChild(st); }
          var tTo = h('input', { type: 'email', maxlength: '254', placeholder: 'your e-mail address', 'aria-label': 'Send a test to this address', autocomplete: 'email', inputmode: 'email' });
          var tBtn = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: '\u2709 Send me a test' });
          tBtn.addEventListener('click', function (ev) { if (!ev.isTrusted) return; var to = String(tTo.value || '').trim(); if (!to) { say('Type your own e-mail address first.'); return; }
            confirmPanel(item, { text: 'Send ONE test e-mail of this text to ' + to + '? It goes to no one else, does not use the daily cap and does not start anything.', label: 'Yes, send the test', run: function () { return outreach({ action: 'sendTest', id: c.id, to: to }).then(function () { say('Test sent to ' + to + '. Check the inbox and the spam folder in a minute.'); }); } }); });
          item.appendChild(h('div', { class: 'row mt' }, h('label', { text: 'Test e-mail (to yourself only)' }))); item.appendChild(h('div', { class: 'row' }, tTo, tBtn));
          item.appendChild(row); campBox.appendChild(item);
        });
      }).catch(function (e) { failure(campBox, e); });
    }
    loadSummary(); loadBatches(); loadCamps();
  };

  pages.health = function (el) {
    var box = h('div');
    el.appendChild(h('h1', { text: 'Health' })); el.appendChild(h('p', { class: 'muted', text: 'Background checks report here. "No recent report" means the check has gone quiet: treat it as unknown, not as fine.' })); el.appendChild(box);
    var NAMES = { collectors: 'Background checks', uptime: 'Website check', backup: 'Backups' };
    var LOOK = { ok: ['chip-ok', 'Healthy'], up: ['chip-ok', 'Healthy'], stale: ['chip-warn', 'No recent report'], down: ['chip-bad', 'Not answering'], fail: ['chip-bad', 'Failed'], error: ['chip-bad', 'Problem'], never: ['chip-low', 'Not set up yet'] };
    loading(box);
    rpc('cc_console_collectors').then(function (rows) {
      clear(box);
      rows.forEach(function (r) {
        var look = LOOK[r.status] || ['chip-low', r.status];
        box.appendChild(h('div', { class: 'item' },
          h('div', { class: 'row between' }, h('strong', { text: NAMES[r.name] || r.name }), h('span', { class: 'chip ' + look[0], text: look[1] })),
          h('div', null, short(r.detail || '', 120)),
          h('div', { class: 'small muted', text: r.last_at ? 'Last report: ' + when(r.last_at) : 'No report yet' })));
      });
    }).catch(function (e) { failure(box, e); });
    connections(el);
  };

  // ---------- integrations and automation chains (CC-6): a switch here only RECORDS your approved state; nothing is connected, sent or run by it ----------
  function connections(el) {
    var iBox = h('div'), aBox = h('div'), flash = h('p', { class: 'small strong', hidden: 'hidden' });
    var SL = { off: ['chip-low', 'OFF'], approved: ['chip-warn', 'APPROVED'], active: ['chip-ok', 'ACTIVE'], suspended: ['chip-bad', 'PAUSED'] };
    var MAT = { exists: 'exists', partial: 'partly built', missing: 'not built', decision: 'your decision pending' };
    function nice(e) { var m = String(e && e.message || e); return /APPROVAL_REQUIRED/.test(m) ? 'There is no approved request for this yet (or it is older than 7 days). Ask for approval, then approve it in the Approvals tab.' : /EMERGENCY_STOP_ACTIVE/.test(m) ? 'The emergency stop is on. Release it first.' : /APPROVE_FIRST/.test(m) ? 'Allow it first, then make it active.' : m; }
    function call(n, a) { return rpc(n, a).catch(function (e) { e.message = nice(e); throw e; }); }
    function note(t) { flash.textContent = t; flash.hidden = !t; }
    el.appendChild(h('h2', { text: 'Integrations' }));
    el.appendChild(h('p', { class: 'muted small', text: 'The services PropBazaar can connect to. Everything starts OFF. A switch here only records what you approved: it does not yet connect, send or run anything. To allow something: Ask for approval, approve it in the Approvals tab, then come back and allow it.' }));
    el.appendChild(flash); el.appendChild(iBox);
    el.appendChild(h('h2', { text: 'Automations' }));
    el.appendChild(h('p', { class: 'muted small', text: 'Example chains of steps. Both are OFF and nothing runs them yet. Steps marked "waits for you" always need your approval first.' }));
    el.appendChild(aBox);
    function find(rows, action, key) { var best = null; (rows || []).forEach(function (r) { if (r.action === action && r.target === key && r.status === 'approved' && (!best || r.id > best.id)) best = r; }); return best && (Date.now() - new Date(best.decided_at).getTime() < 7 * 864e5) ? best : null; }
    function ask(host, fn, key, what) { return function (ev) { if (!ev.isTrusted) return; confirmPanel(host, { text: 'Ask for approval to switch on "' + what + '"? This only creates a request for you to approve in the Approvals tab. Nothing is switched on.', label: 'Yes, ask', run: function () { return call(fn, { p_key: key }).then(function (id) { note('Request sent (approval #' + id + '). Open the Approvals tab, approve it, then come back here.'); }); } }); }; }
    function load() {
      loading(iBox); loading(aBox);
      Promise.all([call('cc_console_integrations'), call('cc_console_automations'), call('cc_console_approvals', { p_status: 'approved', p_limit: 100 })]).then(function (res) {
        var ints = res[0], autos = res[1], appr = res[2]; clear(iBox); clear(aBox);
        ints.forEach(function (r) {
          var sl = SL[r.state] || ['chip-low', r.state], host = h('div'), acts = h('div', { class: 'row mt' }), ok = find(appr, 'integration.enable', r.key);
          function setState(state, label, typed, danger) { var b = h('button', { class: 'btn btn-sm ' + (danger ? 'btn-light' : 'btn-ok'), type: 'button', text: label });
            b.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(host, { text: label + ': "' + r.name + '"? This records your decision only.', label: 'Yes', typed: typed || null, danger: false, run: function () { return call('cc_console_integration_set', { p_key: r.key, p_state: state, p_approval_id: (state === 'approved' || state === 'active') ? (ok ? ok.id : (r.approval_id || null)) : null }).then(function () { note(''); return load(); }); } }); }); acts.appendChild(b); }
          if (r.state === 'off' || r.state === 'suspended') { var bAsk = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Ask for approval' }); bAsk.addEventListener('click', ask(host, 'cc_console_integration_request', r.key, r.name)); acts.appendChild(bAsk); if (ok) setState('approved', 'Allow (approved #' + ok.id + ')', 'ON'); }
          if (r.state === 'approved') setState('active', 'Make active', 'ON');
          if (r.state === 'approved' || r.state === 'active') { setState('suspended', 'Pause', null, true); setState('off', 'Switch off', null, true); }
          if (r.state === 'suspended') setState('off', 'Switch off', null, true);
          iBox.appendChild(h('div', { class: 'item' },
            h('div', { class: 'row between' }, h('strong', { text: r.name }), h('span', { class: 'chip ' + sl[0], text: sl[1] })),
            h('div', { class: 'small muted', text: r.category + ' · ' + (MAT[r.maturity] || r.maturity) }), h('div', { text: r.today }), acts, host));
        });
        autos.forEach(function (a) {
          var host = h('div'), acts = h('div', { class: 'row mt' }), ok = find(appr, 'automation.enable', a.key), steps = h('ol', { class: 'small' });
          (a.steps || []).forEach(function (st) { steps.appendChild(h('li', { text: st.do + (st.sensitive ? ' (waits for you)' : '') })); });
          if (a.enabled) { var bOff = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Switch off' }); bOff.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(host, { text: 'Switch off "' + a.name + '"?', label: 'Yes, switch off', run: function () { return call('cc_console_automation_set', { p_key: a.key, p_enabled: false, p_approval_id: null }).then(function () { return load(); }); } }); }); acts.appendChild(bOff); }
          else {
            var bAsk = h('button', { class: 'btn btn-light btn-sm', type: 'button', text: 'Ask for approval' }); bAsk.addEventListener('click', ask(host, 'cc_console_automation_request', a.key, a.name)); acts.appendChild(bAsk);
            if (ok) { var bOn = h('button', { class: 'btn btn-ok btn-sm', type: 'button', text: 'Allow (approved #' + ok.id + ')' }); bOn.addEventListener('click', function (ev) { if (!ev.isTrusted) return; confirmPanel(host, { text: 'Allow "' + a.name + '"? This records your decision only. Nothing runs it yet.', label: 'Yes, allow', typed: 'ON', run: function () { return call('cc_console_automation_set', { p_key: a.key, p_enabled: true, p_approval_id: ok.id }).then(function () { return load(); }); } }); }); acts.appendChild(bOn); }
          }
          aBox.appendChild(h('div', { class: 'item' },
            h('div', { class: 'row between' }, h('strong', { text: a.name }), h('span', { class: 'chip ' + (a.enabled ? 'chip-ok' : 'chip-low'), text: a.enabled ? 'ALLOWED' : 'OFF' })),
            h('div', { class: 'small muted', text: 'Starts when: ' + a.trigger_event + ' · version ' + a.version + ' · ' + a.runs + ' runs' }), steps, acts, host));
        });
      }).catch(function (e) { failure(iBox, e); clear(aBox); });
    }
    load();
  }

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
