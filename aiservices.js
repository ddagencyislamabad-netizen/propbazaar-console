/* PropBazaar console: AI tab (paid AI switches) and Growth tab (monetization checklist, peak times).
   AI switches and caps are enforced on the server (aiservices function + ai_reserve). Nothing here can spend money by itself. */
(function () {
  'use strict';
  window.PBAI = function (pages, h, clear, aiCall, liveRpc) {
    var CAT = { video: 'AI video (cheapest first)', writing: 'AI writing', voice: 'AI voice-over', image: 'AI images' };
    pages.ai = function (el) {
      var msg = '', busy = false, rows = null;
      function act(body) { if (busy) return; busy = true; aiCall(body).then(function (j) { rows = j.services; msg = ''; }).catch(function (e) {
        msg = e.code === 'no-key' ? 'Add the key first: Supabase, Edge Functions, Secrets, name ' + (e.secretName || '') + '.' : e.code === 'set-cap-first' ? 'Set a monthly cap above 0 first.' : 'Failed: ' + e.message; }).then(function () { busy = false; render(); }); }
      function render() {
        clear(el);
        el.appendChild(h('h1', { text: 'Paid AI services' }));
        el.appendChild(h('div', { class: 'status status-ok' }, h('span', { class: 'dot' }), h('span', { text: 'Everything is OFF by default. A service can only be switched on when its key is saved on the server and a monthly cap is set. The server stops spending at the cap.' })));
        if (msg) el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: msg })));
        if (!rows) { el.appendChild(h('p', { text: 'Loading...' })); return; }
        var last = '';
        rows.forEach(function (s) {
          if (s.category !== last) { last = s.category; el.appendChild(h('h2', { class: 'mt', text: CAT[s.category] || s.category })); }
          var capIn = h('input', { type: 'number', min: '0', step: '500', value: String(s.capPkr), 'aria-label': 'Monthly cap PKR' });
          var c = h('div', { class: 'card mt' });
          c.appendChild(h('div', { text: s.label }));
          c.appendChild(h('div', { class: 'muted', text: 'Approx. price (check before use): ' + s.estCost }));
          c.appendChild(h('div', { text: 'Status: ' + (s.enabled ? 'ON' : 'OFF') + '   Key on server: ' + (s.keyPresent ? 'yes' : 'no (' + s.secretName + ')') }));
          c.appendChild(h('div', { text: 'This month: PKR ' + Math.round(s.spentPkr) + ' of PKR ' + Math.round(s.capPkr) }));
          if (s.lastVerifyResult) c.appendChild(h('div', { class: 'muted', text: 'Last check: ' + s.lastVerifyResult }));
          c.appendChild(h('div', { class: 'mt' }, capIn, h('button', { text: 'Save cap', onclick: function () { act({ action: 'setCap', key: s.key, capPkr: Number(capIn.value) }); } })));
          c.appendChild(h('div', { class: 'mt' },
            h('button', { text: s.enabled ? 'Turn OFF' : 'Turn ON', onclick: function () { act({ action: 'toggle', key: s.key, enabled: !s.enabled }); } }),
            h('button', { text: 'Check key', onclick: function () { act({ action: 'verify', key: s.key }); } })));
          el.appendChild(c);
        });
        el.appendChild(h('p', { class: 'muted mt', text: '"Check key" only confirms the key is saved. It does not call the provider, so it cannot prove the key works.' }));
      }
      render(); act({ action: 'status' });
    };

    pages.webintel = function (el) {
      var busy = false;
      function draw(t, err) {
        clear(el); el.appendChild(h('h1', { text: 'Web Intelligence: trends' }));
        if (err) el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: err })));
        if (!t) { if (!err) el.appendChild(h('p', { text: 'Loading...' })); return; }
        el.appendChild(h('div', { class: 'status ' + (t.enabled ? 'status-ok' : 'status-warn') }, h('span', { text: t.enabled ? 'ON: collects headlines every night (about 2:30 am PKT)' : 'OFF: nothing is collected' })));
        var arm = false, btn = h('button', { text: t.enabled ? 'Turn OFF' : 'Turn ON' }), run = h('button', { text: 'Run now' });
        function go(body) { if (busy) return; busy = true; aiCall(body).then(function (j) { busy = false; draw(j.tr); }).catch(function (e) { busy = false; draw(t, e.message === 'wait-5-min' ? 'Wait 5 minutes between runs.' : 'Failed: ' + e.message); }); }
        btn.addEventListener('click', function () { if (!t.enabled && !arm) { arm = true; btn.textContent = 'Tap again to confirm: turn ON'; return; } go({ action: 'trSwitch', enabled: !t.enabled }); });
        run.addEventListener('click', function () { run.textContent = 'Running, about 1 minute...'; go({ action: 'trRun' }); });
        el.appendChild(h('div', { class: 'card mt' }, btn, run, h('div', { class: 'muted', text: 'Last run: ' + (t.lastRunAt ? new Date(t.lastRunAt).toLocaleString() + ' (' + t.lastRunResult + ')' : 'never') }),
          h('div', { class: 'muted', text: 'Reads headlines only from Google News search feeds for 17 property topics. No personal data, no social sites, no portals are read. Run now works only when ON.' })));
        el.appendChild(h('h2', { class: 'mt', text: 'Trending topics (this week vs last week)' }));
        t.topics.forEach(function (x) {
          var d = x.thisWeek - x.lastWeek, arrow = d > 0 ? ' up ' + d : d < 0 ? ' down ' + (-d) : ' flat';
          var c = h('div', { class: 'card mt' }, h('div', { class: 'strong', text: x.label + ': ' + x.thisWeek + ' headlines (' + arrow.trim() + ')' }));
          x.top.forEach(function (i) { c.appendChild(h('div', { class: 'muted', text: i.title + (i.publisher ? ' (' + i.publisher + ')' : '') })); });
          el.appendChild(c);
        });
        if (!t.topics.some(function (x) { return x.thisWeek > 0; })) el.appendChild(h('p', { class: 'muted', text: 'No headlines yet. Turn ON, then tap Run now.' }));
      }
      draw(null); aiCall({ action: 'trStatus' }).then(function (j) { draw(j.tr); }).catch(function (e) { draw(null, 'Could not load: ' + e.message); });
    };

    pages.videos = function (el) {
      var busy = false;
      function draw(m, err, note) {
        clear(el); el.appendChild(h('h1', { text: 'Marketing OS videos' }));
        if (err) el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: err })));
        if (!m) { if (!err) el.appendChild(h('p', { text: 'Loading...' })); return; }
        el.appendChild(h('div', { class: 'status ' + (m.enabled ? 'status-ok' : 'status-warn') }, h('span', { text: m.enabled ? 'ON: videos are made and launched at ' + m.launchTime + ' PKT, ' + m.perDay + ' per day' : 'OFF: no videos are made or launched' })));
        var tm = h('input', { type: 'time', value: m.launchTime, 'aria-label': 'Launch time PKT' }), cnt = h('select', { 'aria-label': 'Videos per day' });
        [1, 2, 3].forEach(function (n) { var o = h('option', { value: String(n), text: n + ' per day' }); if (n === m.perDay) o.selected = true; cnt.appendChild(o); });
        function save(body) { if (busy) return; busy = true; body.action = 'set'; body.fn = 'videos'; aiCall(body).then(function (j) { busy = false; draw(j.mo, '', 'Saved.'); }).catch(function (e) { busy = false; draw(m, 'Failed: ' + e.message); }); }
        var arm = false, btn = h('button', { text: m.enabled ? 'Turn OFF' : 'Turn ON' });
        btn.addEventListener('click', function () { if (!m.enabled && !arm) { arm = true; btn.textContent = 'Tap again to confirm: turn ON'; return; } save({ enabled: !m.enabled }); });
        el.appendChild(h('div', { class: 'card mt' }, btn));
        el.appendChild(h('div', { class: 'card mt' }, h('div', { class: 'strong', text: 'Launch time (Pakistan time)' }), tm, cnt, h('button', { text: 'Save time', onclick: function () { save({ launchTime: tm.value, perDay: Number(cnt.value) }); } }),
          h('div', { class: 'muted', text: 'Suggested start: 7 to 10 pm. Replace it with your own best hour from TikTok Studio and YouTube Studio.' })));
        if (note) el.appendChild(h('p', { class: 'muted', text: note }));
        el.appendChild(h('p', { class: 'muted mt', text: 'These are the settings the video maker follows. The automatic video maker is still being connected: until it is, turning ON saves your choice but nothing is rendered or posted by itself. Every video will still come to you on Telegram for approval first.' }));
      }
      draw(null); aiCall({ action: 'get', fn: 'videos' }).then(function (j) { draw(j.mo); }).catch(function (e) { draw(null, 'Could not load: ' + e.message); });
    };

    pages.agents = function (el) {
      var busy = false, lead = null;
      function go(body, ag) { if (busy) return; busy = true; body.fn = 'agents'; aiCall(body).then(function (j) { busy = false; draw(j.ag); }).catch(function (e) { busy = false; draw(ag, e.message === 'turn-on-first' ? 'Turn it ON first.' : e.message === 'wait-1-min' ? 'Wait a minute between runs.' : 'Failed: ' + e.message); }); }
      function sw(a, ag) { var arm = false, b = h('button', { text: a.enabled ? 'Turn OFF' : 'Turn ON' }); b.addEventListener('click', function () { if (!a.enabled && !arm) { arm = true; b.textContent = 'Tap again to confirm'; return; } go({ action: 'switch', key: a.key, enabled: !a.enabled }, ag); }); return b; }
      function draw(ag, err) {
        clear(el); el.appendChild(h('h1', { text: 'Agents' }));
        if (err) el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: err })));
        el.appendChild(h('p', { class: 'muted', text: 'Each agent has its own switch and is OFF until you turn it ON. They read listings and report to you. They never post, message or change anything by themselves.' }));
        // status of the others
        el.appendChild(h('h2', { class: 'mt', text: 'All agents' }));
        [['Trends', 'Collects property headlines nightly. Switch: Web Intel tab.'], ['Video maker', 'Switch and launch time: Videos tab. The server that renders is not rented yet.'], ['Social poster', 'Posts listings. Working for TikTok and YouTube; Meta is blocked.'], ['Outreach', 'Finds agents and sends introductions. Switch: Outreach tab.'], ['Monitor', 'Site uptime and alerts. Working.']].forEach(function (x) { el.appendChild(h('div', { class: 'card mt' }, h('div', { class: 'strong', text: x[0] }), h('div', { class: 'muted', text: x[1] }))); });
        // lead follow-up (live data, counts only)
        var lc = h('div', { class: 'card mt' }, h('div', { class: 'strong', text: 'Lead follow-up' }));
        if (lead && lead.err) lc.appendChild(h('div', { class: 'muted', text: 'Could not load: ' + lead.err }));
        else if (!lead) lc.appendChild(h('div', { class: 'muted', text: 'Loading...' }));
        else { lc.appendChild(h('div', { text: 'Unread enquiries: ' + lead.total_unread + '. Over 24 hours: ' + lead.unread_over_24h + '. Over 72 hours: ' + lead.unread_over_72h + '.' })); lc.appendChild(h('div', { class: 'muted', text: lead.total_unread > 0 ? 'Oldest unread enquiry waited ' + lead.oldest_unread_hours + ' hours. Open your leads to reply. Counts only: no buyer details shown here.' : 'Nothing waiting.' })); }
        el.appendChild(h('h2', { class: 'mt', text: 'Agents with switches' })); el.appendChild(lc);
        if (!ag) { el.appendChild(h('p', { text: 'Loading...' })); return; }
        ag.agents.forEach(function (a) {
          var c = h('div', { class: 'card mt' }, h('div', { class: 'strong', text: a.label + ': ' + (a.enabled ? 'ON' : 'OFF') }), h('div', { class: 'muted', text: 'Last run: ' + (a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() + ' (' + a.lastResult + ')' : 'never') + '. Runs by itself every night at 3 am PKT when ON.' }));
          c.appendChild(h('div', { class: 'mt' }, sw(a, ag), h('button', { text: 'Run now', onclick: function () { go({ action: 'runNow', key: a.key }, ag); } })));
          if (a.key === 'listing_quality') { var f = ag.findings.filter(function (x) { return true; }); if (!f.length) c.appendChild(h('div', { class: 'muted', text: 'No findings yet.' })); f.forEach(function (x) { c.appendChild(h('div', { class: x.severity === 'warn' ? 'err small' : 'muted small', text: (x.severity === 'warn' ? 'Fix: ' : 'Check: ') + x.note })); }); }
          if (a.key === 'seo_drafts') { if (!ag.drafts.length) c.appendChild(h('div', { class: 'muted', text: 'No drafts yet. A draft needs at least 3 similar listings in a city.' })); ag.drafts.forEach(function (d) { var body = h('pre', { class: 'small', text: d.body, hidden: 'hidden', style: 'white-space:pre-wrap' }); c.appendChild(h('div', { class: 'mt' }, h('button', { text: d.title, onclick: function () { body.hidden = !body.hidden; } }), body)); }); }
          el.appendChild(c);
        });
      }
      draw(null);
      liveRpc('cc_console_followup_counts').then(function (r) { lead = (r && r[0]) || (r && r.total_unread !== undefined ? r : { total_unread: 0, unread_over_24h: 0, unread_over_72h: 0, oldest_unread_hours: 0 }); }).catch(function (e) { lead = { err: e.message }; }).then(function () { aiCall({ action: 'status', fn: 'agents' }).then(function (j) { draw(j.ag); }).catch(function (e) { draw(null, 'Could not load: ' + e.message); }); });
    };

    // ---------- Growth ----------
    var GK = 'pb_growth_v1';
    function gload() { try { return JSON.parse(localStorage.getItem(GK) || '{}') || {}; } catch (e) { return {}; } }
    function gsave(d) { try { localStorage.setItem(GK, JSON.stringify(d)); } catch (e) {} }
    // Thresholds are the ones I could source; each carries a "verify" note. Edit here if a platform changes them.
    var CHECKS = [
      { k: 'yt_subs', label: 'YouTube subscribers', target: 1000, note: 'Standard YouTube Partner Program: about 1,000 subscribers plus 4,000 public watch hours in 12 months, or 10 million Shorts views in 90 days. A lower early tier may exist. Verify in YouTube Studio, Earn tab.' },
      { k: 'yt_hours', label: 'YouTube watch hours (12 months)', target: 4000, note: 'Same rule as above.' },
      { k: 'yt_shorts', label: 'YouTube Shorts views (90 days)', target: 10000000, note: 'Alternative route to the same programme.' },
      { k: 'fb_views', label: 'Facebook page views (28 days)', target: 300000, note: 'One news report (ARY, unconfirmed, test phase) says 300,000 views in 28 days may qualify. Verify in Meta Business Suite, Monetization.' },
      { k: 'ig_followers', label: 'Instagram followers', target: 1000, note: 'Instagram payout programmes for Pakistan are not confirmed. Keep growing; check the Professional dashboard for any offer.' }
    ];
    pages.growth = function (el) {
      var d = gload();
      function render() {
        clear(el);
        el.appendChild(h('h1', { text: 'Growth' }));
        el.appendChild(h('div', { class: 'status status-warn' }, h('span', { text: 'No income is guaranteed. Type your real numbers from each platform. Targets are the ones I found; confirm them in each platform before relying on them.' })));
        el.appendChild(h('h2', { class: 'mt', text: 'Monetization progress' }));
        CHECKS.forEach(function (c) {
          var v = Number(d[c.k] || 0), pct = Math.min(100, Math.round(v / c.target * 100));
          var inp = h('input', { type: 'number', min: '0', value: String(v), 'aria-label': c.label });
          inp.addEventListener('change', function () { d[c.k] = Math.max(0, Number(inp.value) || 0); gsave(d); render(); });
          el.appendChild(h('div', { class: 'card mt' }, h('div', { text: c.label + ': ' + v.toLocaleString() + ' of ' + c.target.toLocaleString() + ' (' + pct + '%)' }), inp, h('div', { class: 'muted', text: c.note })));
        });
        el.appendChild(h('h2', { class: 'mt', text: 'Peak posting times (Pakistan, PKT)' }));
        el.appendChild(h('div', { class: 'card' },
          h('div', { text: 'Starting point: 7:00 to 10:00 pm daily, best tested on Saturday and Sunday.' }),
          h('div', { class: 'muted', text: 'This is a general evening window, not Pakistan-specific data. Replace it with your own: TikTok Studio (Followers, Activity), YouTube Studio (Audience), Page Insights. Test a second slot one hour earlier.' }),
          h('div', { text: 'Gulf (UAE, Qatar, Saudi): 7:00 to 10:00 pm local time. UK: 6:00 to 9:00 pm local time.' })));
      }
      render();
    };
  };
})();
