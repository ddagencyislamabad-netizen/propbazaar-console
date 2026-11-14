/* PropBazaar console: AI tab (paid AI switches) and Growth tab (monetization checklist, peak times).
   AI switches and caps are enforced on the server (aiservices function + ai_reserve). Nothing here can spend money by itself. */
(function () {
  'use strict';
  window.PBAI = function (pages, h, clear, aiCall) {
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
