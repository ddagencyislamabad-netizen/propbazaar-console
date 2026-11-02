(function () {
  'use strict';
  var ENDPOINT = 'https://atuizzwyslyscrpiixem.supabase.co/functions/v1/outreach/optin';
  var f = document.getElementById('f'), msg = document.getElementById('msg'), go = document.getElementById('go');
  function say(t, c) { msg.textContent = t; msg.className = c || ''; }
  var ref = ''; try { ref = (new URLSearchParams(location.search).get('ref') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 20); } catch (e) { ref = ''; }
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = document.getElementById('email').value.trim(), who = (f.querySelector('input[name=who]:checked') || {}).value || 'owner';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('Please enter a valid e-mail address. / درست ای میل درج کریں۔', 'err'); return; }
    if (!document.getElementById('consent').checked || !document.getElementById('adult').checked) { say('Please tick both boxes to continue. / براہ کرم دونوں خانوں پر نشان لگائیں۔', 'err'); return; }
    go.disabled = true; say('Sending…');
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email, name: document.getElementById('name').value.trim(), consent: true, adult: true, website: document.getElementById('website').value, source: ('landing-' + who + (ref ? ':' + ref : '')).slice(0, 60) }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { if (x.ok) { f.reset(); go.disabled = false; say('Thank you. We have sent you an e-mail: please open it and confirm your address. / شکریہ۔ ہم نے آپ کو ای میل بھیجی ہے، براہ کرم اسے کھول کر تصدیق کریں۔', 'ok'); } else { say(x.j && x.j.error === 'bad-email' ? 'That e-mail address does not look right. / ای میل درست نہیں لگ رہی۔' : 'Something went wrong. Please try again. / کچھ گڑبڑ ہو گئی، دوبارہ کوشش کریں۔', 'err'); go.disabled = false; } })
      .catch(function () { say('Could not reach the server. Please try again. / سرور سے رابطہ نہیں ہو سکا۔', 'err'); go.disabled = false; });
  });
})();
