/* Bizzle's Burner Hub v4.20: UI, router, settings, extras. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = () => Store.s;

  /* ---------------- Toast / confirm / copy ---------------- */
  let toastT;
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); t.hidden = true; }, ms); }
  function confirmDlg(title, msg, okLabel = 'Do it') {
    return new Promise(resolve => {
      const d = $('#confirmDlg'); $('#confirmTitle').textContent = title; $('#confirmMsg').textContent = msg; $('#confirmOk').textContent = okLabel;
      const done = () => { d.removeEventListener('close', done); resolve(d.returnValue === 'ok'); };
      d.returnValue = ''; d.addEventListener('close', done); d.showModal(); $('#confirmCancel').focus();
    });
  }
  async function copyText(text, label = 'Copied') {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
    toast('📋 ' + label + '!');
  }
  window.__bbh = { toast, copyText };

  /* ---------------- Themes ---------------- */
  const THEMES = [
    { id: 'alien', name: 'Neon Alien Green', sw: ['#000', '#39ff14'] },
    { id: 'haze', name: 'Purple Haze', sw: ['#12051f', '#c77dff'] },
    { id: 'cyber', name: 'Cyber Orange', sw: ['#0b0b0b', '#ff7a00'] },
    { id: 'midnight', name: 'Midnight', sw: ['#060b1a', '#4cc9f0'] },
    { id: 'light', name: 'Light', sw: ['#f6f8f4', '#1a7f00'] }
  ];
  function applyTheme(id) {
    if (!THEMES.find(t => t.id === id)) id = 'alien';
    document.documentElement.dataset.theme = id;
    const tc = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000';
    $('meta[name="theme-color"]').setAttribute('content', tc);
    $$('#themeGrid [role="radio"]').forEach(b => { const on = b.dataset.theme === id; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  }
  function buildThemes() {
    $('#themeGrid').innerHTML = THEMES.map(t => `<button type="button" role="radio" class="theme-card" data-theme="${t.id}" aria-checked="false"><span class="sw" style="background:${t.sw[0]};border-color:${t.sw[1]}"><span style="background:${t.sw[1]}"></span></span>${esc(t.name)}</button>`).join('');
    $('#themeGrid').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (b) { Store.set('theme', b.dataset.theme); applyTheme(b.dataset.theme); toast('🎨 Theme: ' + b.textContent.trim()); } });
    $('#themeGrid').addEventListener('keydown', e => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault(); const i = THEMES.findIndex(t => t.id === S().theme); const n = THEMES[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : THEMES.length - 1)) % THEMES.length];
      Store.set('theme', n.id); applyTheme(n.id); $(`#themeGrid [data-theme="${n.id}"]`).focus();
    });
  }

  /* ---------------- Router (hash) ---------------- */
  let navDepth = +(sessionStorage.getItem('bbh.navDepth') || 0);
  let currentRoute = '';
  function parseHash() { const h = (location.hash || '#/').replace(/^#\/?/, ''); const parts = h.split('/').filter(Boolean).map(decodeURIComponent); return { name: parts[0] || 'home', parts }; }
  function goBack() { if (navDepth > 0 && history.length > 1) history.back(); else { location.hash = parseHash().name === 'mail' && parseHash().parts[1] === 'msg' ? '#/mail' : '#/'; } }
  function route() {
    const r = parseHash();
    const valid = ['home', 'mail', 'bot', 'settings', 'status'];
    const name = valid.includes(r.name) ? r.name : 'home';
    $$('.view').forEach(v => { v.hidden = v.dataset.route !== name; });
    document.body.dataset.route = name;
    if (name === 'bot') mountChat('page'); else mountChat('panel');
    if (name === 'mail') onMailRoute(r.parts);
    if (name === 'settings') renderSettings();
    if (name === 'status') runStatus();
    const titles = { home: '', mail: 'Temp Email Hub · ', bot: 'Bizzy Bot · ', settings: 'Settings · ', status: 'Status · ' };
    baseTitle = titles[name] + "Bizzle's Burner Hub v4.20"; updateTitle();
    if (currentRoute && currentRoute !== location.hash) { const h = $('#view-' + name + ' h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
    currentRoute = location.hash;
  }
  window.addEventListener('hashchange', () => { navDepth++; sessionStorage.setItem('bbh.navDepth', navDepth); route(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-back]')) { e.preventDefault(); goBack(); } });

  /* ---------------- Title badge ---------------- */
  let baseTitle = document.title, unread = 0;
  function updateTitle() { document.title = (unread ? '(' + unread + ') ' : '') + baseTitle; const b = $('#tileMailBadge'); b.hidden = !unread; b.textContent = unread + ' new'; try { if (navigator.setAppBadge) unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge(); } catch (e) {} }

  /* ================= TEMP MAIL ================= */
  let addresses = Store.read('addresses', []);
  let activeId = Store.read('activeAddress', null);
  let messages = []; let seen = Store.read('seen', {}); let openMsg = null; let showImages = false;
  let refreshTimer = null, countdownTimer = null, nextRefreshAt = 0, refreshing = false;
  const saveAddrs = () => { Store.write('addresses', addresses); Store.write('activeAddress', activeId); };
  const active = () => addresses.find(a => a.id === activeId) || null;
  function notice(html, kind = 'info') { const n = $('#mailNotice'); if (!html) { n.hidden = true; n.innerHTML = ''; return; } n.className = 'notice ' + kind; n.innerHTML = html; n.hidden = false; }

  function fillProviderSelects() {
    const opts = Mail.PROVIDERS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('#newProvider').innerHTML = '<option value="auto">Auto (with fallback)</option>' + opts;
    $('#mailProviderPref').innerHTML = '<option value="auto">Auto: Guerrilla → Maildrop → SpamOK</option>' + opts;
    $('#newProvider').value = S().mailProvider;
    fillNewDomains();
  }
  function fillNewDomains() {
    const pid = $('#newProvider').value === 'auto' ? Mail.PROVIDERS[0].id : $('#newProvider').value;
    $('#newDomain').innerHTML = Mail.byId(pid).domains.map(d => `<option>${esc(d)}</option>`).join('');
  }

  async function createAddress(pref, user, domain) {
    const order = pref === 'auto' ? Mail.PROVIDERS.slice() : [Mail.byId(pref)].concat(Mail.PROVIDERS.filter(p => p.id !== pref));
    const fails = [];
    for (const p of order) {
      try {
        const a = await p.create(user, p.domains.includes(domain) ? domain : p.domains[0]);
        if (fails.length) notice('⚠️ ' + fails.map(f => esc(f)).join('<br>') + `<br>➡️ Fell back to <b>${esc(p.name)}</b>.`, 'warn'); else notice('');
        return a;
      } catch (e) { fails.push(p.name + ' failed: ' + e.message); if (pref !== 'auto' && fails.length === 1) toast('⚠️ ' + p.name + ' failed, trying fallback…'); }
    }
    throw new Error(fails.join(' · '));
  }

  async function onGenerate(e) {
    if (e) e.preventDefault();
    const btn = $('#genBtn'); btn.disabled = true; btn.textContent = '⏳ Beaming up…';
    try {
      const u = $('#newUser').value.trim();
      if (u && !/^[a-zA-Z0-9._-]{1,40}$/.test(u)) throw new Error('Name can only use letters, numbers, dot, dash, underscore.');
      const a = await createAddress($('#newProvider').value, u, $('#newDomain').value);
      addresses.unshift(a); activeId = a.id; saveAddrs(); $('#newUser').value = '';
      messages = []; seen[a.id] = seen[a.id] || [];
      renderMail(); toast('✨ New address: ' + a.address);
      if (location.hash !== '#/mail') location.hash = '#/mail';
      await refreshInbox(true);
    } catch (err) {
      notice('❌ Could not create an address on any provider: ' + esc(err.message) + '<br>Check your connection or open <a href="#/status">Provider status</a>.', 'error');
    } finally { btn.disabled = false; btn.innerHTML = '✨ Generate address <kbd>N</kbd>'; }
  }

  function renderQR(text) {
    try { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); $('#qrSvg').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true, alt: 'QR code for ' + text }); }
    catch (e) { $('#qrSvg').textContent = 'QR failed: ' + e.message; }
  }

  function renderMail() {
    const a = active();
    $('#addrEmpty').hidden = !!a; $('#addrActive').hidden = !a;
    $('#refreshBtn').disabled = !a; $('#delAddrBtn').disabled = !a;
    if (a) {
      const p = Mail.byId(a.provider);
      $('#addrText').textContent = a.address;
      $('#addrProvider').textContent = p ? p.name : a.provider;
      $('#domainSelect').innerHTML = p.domains.map(d => `<option ${d === a.domain ? 'selected' : ''}>${esc(d)}</option>`).join('');
      $('#domainSelect').disabled = p.domains.length < 2;
      $('#aliasWrap').hidden = !a.alias;
      $('#addrPrivacy').textContent = p.note;
      if (!$('#qrBox').hidden) renderQR(a.address);
    }
    $('#addrCount').textContent = addresses.length ? '(' + addresses.length + ')' : '';
    $('#addrList').innerHTML = addresses.length ? addresses.map(x => `<li class="${x.id === activeId ? 'on' : ''}">
        <button type="button" class="addr-pick" data-pick="${x.id}" aria-pressed="${x.id === activeId}"><span class="prov-dot ${x.provider}" aria-hidden="true"></span><span class="addr-pick-text">${esc(x.address)}</span><span class="small">${esc(Mail.byId(x.provider) ? Mail.byId(x.provider).name : x.provider)}</span></button>
        <button type="button" class="btn btn-xs btn-ghost" data-copyaddr="${x.id}" aria-label="Copy ${esc(x.address)}">📋</button>
        <button type="button" class="btn btn-xs btn-ghost btn-danger" data-deladdr="${x.id}" aria-label="Delete ${esc(x.address)}">🗑️</button></li>`).join('') : '<li class="small empty">No saved addresses yet.</li>';
    renderMsgList();
  }
  function fmtTime(ms) { const d = new Date(ms); const now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function renderMsgList() {
    const a = active();
    $('#msgCount').textContent = messages.length ? '(' + messages.length + ')' : '';
    $('#msgEmpty').hidden = !!messages.length;
    $('#msgEmpty').textContent = a ? 'Waiting for mail… it shows up here automatically.' : 'Generate an address to start receiving mail.';
    const read = new Set(Store.read('readMsgs', []));
    $('#msgList').innerHTML = messages.map(m => `<li><a class="msg ${openMsg && openMsg.id === m.id ? 'on' : ''} ${read.has(a.id + ':' + m.id) ? '' : 'unread'}" href="#/mail/msg/${encodeURIComponent(m.id)}">
      <span class="msg-from">${esc(m.from)}</span><span class="msg-time small">${esc(fmtTime(m.date))}</span>
      <span class="msg-subj">${m.hasAtt ? '📎 ' : ''}${esc(m.subject)}</span>${m.excerpt ? `<span class="msg-ex small">${esc(m.excerpt.slice(0, 120))}</span>` : ''}</a></li>`).join('');
  }

  async function refreshInbox(manual) {
    const a = active(); if (!a || refreshing) return;
    if (!navigator.onLine) { $('#lastChecked').textContent = 'Offline: refresh paused'; return; }
    const p = Mail.byId(a.provider); refreshing = true; $('#refreshBtn').classList.add('spin');
    try {
      const list = await p.list(a); saveAddrs();
      list.sort((x, y) => y.date - x.date);
      const prevSeen = new Set(seen[a.id] || []);
      const fresh = list.filter(m => !prevSeen.has(m.id));
      if (Array.isArray(seen[a.id]) && fresh.length) newMailAlert(a, fresh);
      seen[a.id] = list.map(m => m.id); Store.write('seen', seen);
      messages = list; renderMsgList();
      $('#lastChecked').textContent = 'Checked ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      if ($('#mailNotice').classList.contains('error')) notice('');
      if (manual) toast('🔄 Inbox refreshed');
    } catch (e) {
      notice(`⚠️ ${esc(p.name)} is not responding (${esc(e.message)}). Your address is saved; we'll keep retrying. You can also <button type="button" class="btn btn-xs" data-fallback>make a new address on another provider</button>.`, 'error');
    } finally { refreshing = false; $('#refreshBtn').classList.remove('spin'); scheduleRefresh(); }
  }
  function newMailAlert(a, fresh) {
    if (document.hidden || parseHash().name !== 'mail') { unread += fresh.length; updateTitle(); }
    toast('📨 ' + fresh.length + ' new email' + (fresh.length > 1 ? 's' : '') + ': ' + fresh[0].subject, 3500);
    if (S().sound) beep();
    if (S().notify && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification('📨 New mail for ' + a.address, { body: fresh[0].from + ': ' + fresh[0].subject, icon: 'icons/icon-192.png', tag: 'bbh-' + a.id }); n.onclick = () => { window.focus(); location.hash = '#/mail/msg/' + encodeURIComponent(fresh[0].id); }; } catch (e) {}
    }
  }
  function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 660; g.gain.value = 0.05; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.18); } catch (e) {} }
  function scheduleRefresh() {
    clearTimeout(refreshTimer); clearInterval(countdownTimer);
    const sec = +S().refreshSec; const a = active();
    if (!a || !sec) { $('#refreshLine').textContent = a ? 'Auto-refresh is off (Settings).' : ''; return; }
    nextRefreshAt = Date.now() + sec * 1000;
    refreshTimer = setTimeout(() => refreshInbox(false), sec * 1000);
    const tick = () => { const left = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000)); $('#refreshLine').textContent = '⏱ Auto-refresh every ' + sec + ' s · next in ' + left + ' s'; };
    tick(); countdownTimer = setInterval(tick, 1000);
  }

  function buildSrcdoc(html, text, allowImages) {
    let body;
    if (html) {
      body = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'base', 'meta', 'link'], FORBID_ATTR: ['onerror', 'onload', 'onclick'], ADD_ATTR: ['target'] });
    } else body = '<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.5 system-ui,sans-serif">' + esc(text || '') + '</pre>';
    const csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: cid:" + (allowImages ? ' https: http:' : '') + ';';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>body{margin:12px;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#0645ad}</style></head><body>${body}</body></html>`;
  }
  DOMPurify.addHook('afterSanitizeAttributes', node => { if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); } });

  async function openMessage(id) {
    const a = active(); if (!a) { location.hash = '#/mail'; return; }
    const p = Mail.byId(a.provider);
    $('#reader').hidden = false; $('#readerSubject').textContent = 'Loading…'; $('#readerFrom').textContent = ''; $('#readerAtts').innerHTML = '';
    $('#readerFrame').srcdoc = buildSrcdoc('', 'Loading…', false);
    document.body.classList.add('reading');
    try {
      const m = await p.read(a, id); openMsg = m; showImages = !!S().remoteImages;
      const read = new Set(Store.read('readMsgs', [])); read.add(a.id + ':' + m.id); Store.write('readMsgs', Array.from(read).slice(-500));
      $('#readerSubject').textContent = m.subject;
      $('#readerFrom').textContent = 'From: ' + m.from + ' · ' + new Date(m.date).toLocaleString();
      $('#readerAtts').innerHTML = m.attachments.length ? '<b>Attachments:</b> ' + m.attachments.map(x => `<a class="btn btn-xs" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" ${x.external ? '' : 'download'}>📎 ${esc(x.name)}${x.size ? ' (' + Math.ceil(x.size / 1024) + ' KB)' : ''}${x.external ? ' ↗ on ' + esc(p.name) : ''}</a>`).join(' ') : '';
      renderBody(); renderMsgList();
    } catch (e) { $('#readerSubject').textContent = 'Could not open message'; $('#readerFrom').textContent = e.message; }
  }
  function renderBody() {
    if (!openMsg) return;
    $('#readerFrame').srcdoc = buildSrcdoc(openMsg.html, openMsg.text, showImages);
    $('#imgToggleBtn').textContent = showImages ? '🚫 Block images' : '🖼️ Load images';
    $('#imgToggleBtn').hidden = !openMsg.html;
  }
  function closeReader() { $('#reader').hidden = true; openMsg = null; document.body.classList.remove('reading'); }
  function onMailRoute(parts) {
    unread = 0; updateTitle();
    renderMail();
    if (parts[1] === 'msg' && parts[2]) openMessage(parts[2]); else closeReader();
    if (active() && !messages.length) refreshInbox(false); else scheduleRefresh();
  }
  async function deleteAddress(id) {
    const a = addresses.find(x => x.id === id); if (!a) return;
    if (!await confirmDlg('Delete this address?', a.address + ' will be removed from this device' + (a.provider === 'guerrilla' ? ' and its Guerrilla session forgotten.' : '. (Public inboxes keep existing on the provider until they expire.)'), 'Delete')) return;
    const p = Mail.byId(a.provider); if (p) p.forget(a);
    addresses = addresses.filter(x => x.id !== id); delete seen[id]; Store.write('seen', seen);
    if (activeId === id) { activeId = addresses[0] ? addresses[0].id : null; messages = []; closeReader(); }
    saveAddrs(); renderMail(); toast('🗑️ Address deleted'); if (activeId) refreshInbox(false); else scheduleRefresh();
    if (parseHash().parts[1] === 'msg') location.hash = '#/mail';
  }
  function bindMail() {
    fillProviderSelects();
    $('#newProvider').addEventListener('change', fillNewDomains);
    $('#newAddrForm').addEventListener('submit', onGenerate);
    $('#refreshBtn').addEventListener('click', () => refreshInbox(true));
    $('#delAddrBtn').addEventListener('click', () => active() && deleteAddress(activeId));
    $('#copyAddrBtn').addEventListener('click', () => active() && copyText(active().address, 'Address copied'));
    $('#copyAliasBtn').addEventListener('click', () => active() && copyText(active().alias, 'Scrambled alias copied'));
    $('#qrBtn').addEventListener('click', () => { const box = $('#qrBox'); box.hidden = !box.hidden; $('#qrBtn').setAttribute('aria-expanded', !box.hidden); if (!box.hidden && active()) renderQR(active().address); });
    $('#domainSelect').addEventListener('change', e => { const a = active(); if (!a) return; a.domain = e.target.value; a.address = a.user + '@' + a.domain; if (a.alias) a.alias = a.alias.split('@')[0] + '@' + a.domain; saveAddrs(); renderMail(); toast('🌐 Domain switched: ' + a.address); });
    $('#addrList').addEventListener('click', e => {
      const pick = e.target.closest('[data-pick]'), cp = e.target.closest('[data-copyaddr]'), del = e.target.closest('[data-deladdr]');
      if (pick) { activeId = pick.dataset.pick; saveAddrs(); messages = []; closeReader(); if (parseHash().parts[1] === 'msg') location.hash = '#/mail'; renderMail(); refreshInbox(false); }
      if (cp) { const a = addresses.find(x => x.id === cp.dataset.copyaddr); if (a) copyText(a.address, 'Address copied'); }
      if (del) deleteAddress(del.dataset.deladdr);
    });
    $('#mailNotice').addEventListener('click', e => { if (e.target.closest('[data-fallback]')) { const cur = active(); const next = Mail.PROVIDERS.find(p => !cur || p.id !== cur.provider); $('#newProvider').value = next.id; fillNewDomains(); onGenerate(); } });
    $('#copyMsgBtn').addEventListener('click', () => { if (!openMsg) return; const tmp = document.createElement('div'); tmp.innerHTML = DOMPurify.sanitize(openMsg.html || ''); copyText(openMsg.subject + '\n' + openMsg.from + '\n\n' + (openMsg.text || tmp.textContent || '').trim(), 'Message text copied'); });
    $('#imgToggleBtn').addEventListener('click', () => { showImages = !showImages; renderBody(); });
    $('#delMsgBtn').addEventListener('click', async () => {
      const a = active(); if (!a || !openMsg) return;
      if (!await confirmDlg('Delete this email?', '"' + openMsg.subject + '" will be deleted from the provider.', 'Delete')) return;
      try { await Mail.byId(a.provider).del(a, openMsg.id); messages = messages.filter(m => m.id !== openMsg.id); toast('🗑️ Email deleted'); location.hash = '#/mail'; renderMsgList(); }
      catch (e) { toast('❌ Delete failed: ' + e.message, 3500); }
    });
  }

  /* ================= STATUS ================= */
  async function runStatus() {
    const body = $('#statusBody');
    body.innerHTML = Mail.PROVIDERS.map(p => `<tr><th scope="row"><a href="${p.site}" target="_blank" rel="noopener">${esc(p.name)}</a></th><td data-st="${p.id}">⏳ checking…</td><td class="small">${esc(p.note)}</td></tr>`).join('');
    $('#deadList').innerHTML = Mail.DEAD.map(d => `<li><b>${esc(d.name)}</b>: ${esc(d.why)}</li>`).join('');
    $('#aiStatusBody').innerHTML = Object.entries(Bot.BACKENDS).map(([k, b]) => `<tr><th scope="row">${esc(b.label)}</th><td>✅ Yes, CORS verified Oct 5, 2026</td><td><a href="${b.keyUrl}" target="_blank" rel="noopener">${esc(b.keyUrl.replace('https://', ''))}</a></td></tr>`).join('');
    await Promise.all(Mail.PROVIDERS.map(async p => {
      const cell = $(`[data-st="${p.id}"]`); const t0 = performance.now();
      try { await p.ping(); cell.innerHTML = '<span class="ok">✅ Online</span> <span class="small">' + Math.round(performance.now() - t0) + ' ms</span>'; }
      catch (e) { cell.innerHTML = '<span class="bad">❌ ' + esc(e.message) + '</span>'; }
    }));
  }

  /* ================= BIZZY BOT CHAT ================= */
  let chat = S().memory ? Store.read('chat', []) : [];
  let pendingImage = null, sending = false;
  const saveChat = () => { if (S().memory) Store.write('chat', chat.slice(-60).map(m => ({ role: m.role, text: m.text, ts: m.ts, err: m.err, hadImage: !!m.image }))); else Store.remove('chat'); };
  function mdRender(t) { try { return DOMPurify.sanitize(marked.parse(String(t || ''), { breaks: true, gfm: true })); } catch (e) { return esc(t); } }
  function renderChat() {
    const log = $('#chatLog');
    const intro = `<div class="msgb bot intro"><img src="img/bizzy-128.webp" alt="" class="mav" width="28" height="28"><div class="bubble"><div class="md"><p>Yo, I'm <b>Bizzy Bot</b> 👽✌️ your chill alien helper. Ask me anything, or drop a screenshot and I'll take a look.</p>${S().keys[S().aiBackend] ? '' : '<p class="small">Heads up: add a free AI key in <a href="#/settings">Advanced AI Settings</a> first.</p>'}</div></div></div>`;
    log.innerHTML = intro + chat.map((m, i) => m.role === 'user'
      ? `<div class="msgb user"><div class="bubble">${m.image ? `<img class="chat-img" src="${esc(m.image)}" alt="Image you attached">` : (m.hadImage ? '<span class="small">[image]</span><br>' : '')}${esc(m.text).replace(/\n/g, '<br>')}</div></div>`
      : `<div class="msgb bot ${m.err ? 'err' : ''}"><img src="img/bizzy-128.webp" alt="" class="mav" width="28" height="28"><div class="bubble"><div class="md">${mdRender(m.text)}</div><button type="button" class="copy-msg btn btn-xs btn-ghost" data-copymsg="${i}" aria-label="Copy this message">📋 Copy</button></div></div>`).join('') +
      (sending ? '<div class="msgb bot typing"><img src="img/bizzy-128.webp" alt="" class="mav" width="28" height="28"><div class="bubble"><span class="dots" aria-label="Bizzy is thinking"><i></i><i></i><i></i></span></div></div>' : '');
    log.scrollTop = log.scrollHeight;
    const b = S().aiBackend; $('#chatStatus').textContent = Bot.BACKENDS[b].label + ' · ' + Bot.currentModel() + (S().memory ? ' · memory on' : ' · memory off');
  }
  async function sendChat(e) {
    if (e) e.preventDefault();
    const inp = $('#chatInput'); const text = inp.value.trim();
    if ((!text && !pendingImage) || sending) return;
    chat.push({ role: 'user', text, image: pendingImage, ts: Date.now() });
    inp.value = ''; autosize(); clearAttach();
    sending = true; renderChat(); saveChat();
    const ctx = chat.filter(m => !m.err).slice(-20).map(m => ({ role: m.role, text: m.text, image: m.image }));
    try { const reply = await Bot.send(ctx); chat.push({ role: 'bot', text: reply, ts: Date.now() }); }
    catch (err) { chat.push({ role: 'bot', text: '⚠️ ' + err.message + (err.detail ? '\n\n<small>Provider said: ' + esc(String(err.detail).slice(0, 300)) + '</small>' : ''), err: err.kind || 'error', ts: Date.now() }); }
    finally { sending = false; renderChat(); saveChat(); }
  }
  function clearAttach() { pendingImage = null; $('#chatAttach').hidden = true; $('#chatAttachImg').removeAttribute('src'); $('#chatFile').value = ''; }
  function loadImage(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Only images, please 🙏'); return; }
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const max = 1280; let { width: w, height: h } = img; const k = Math.min(1, max / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); pendingImage = c.toDataURL('image/jpeg', 0.85); URL.revokeObjectURL(url);
      $('#chatAttachImg').src = pendingImage; $('#chatAttach').hidden = false; toast('🖼️ Image attached'); };
    img.onerror = () => toast('Could not read that image'); img.src = url;
  }
  function autosize() { const t = $('#chatInput'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; }
  function mountChat(where) {
    const chatEl = $('#chat');
    if (where === 'page') { $('#botPageSlot').appendChild(chatEl); $('#botPanel').hidden = true; $('#botFab').hidden = true; chatEl.classList.add('full'); }
    else { $('#botPanel').appendChild(chatEl); $('#botFab').hidden = false; chatEl.classList.remove('full'); }
    renderChat();
  }
  function togglePanel(open) {
    const p = $('#botPanel'); const want = open == null ? p.hidden : open;
    p.hidden = !want; $('#botFab').setAttribute('aria-expanded', want); document.body.classList.toggle('chat-open', want);
    if (want) { renderChat(); setTimeout(() => $('#chatInput').focus(), 30); } else $('#botFab').focus();
  }
  function bindChat() {
    $('#botFab').addEventListener('click', () => togglePanel());
    $('#chatClose').addEventListener('click', () => { if (parseHash().name === 'bot') goBack(); else togglePanel(false); });
    $('#chatExpand').addEventListener('click', () => { $('#botPanel').hidden = true; document.body.classList.remove('chat-open'); });
    $('#chatClear').addEventListener('click', async () => { if (!chat.length) return; if (await confirmDlg('Clear this chat?', 'All messages in this conversation will be deleted.', 'Clear')) { chat = []; saveChat(); renderChat(); toast('🧽 Chat cleared'); } });
    $('#chatForm').addEventListener('submit', sendChat);
    $('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); } });
    $('#chatInput').addEventListener('input', autosize);
    $('#chatInput').addEventListener('paste', e => { const it = Array.from(e.clipboardData && e.clipboardData.items || []).find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); loadImage(it.getAsFile()); } });
    $('#chatFile').addEventListener('change', e => loadImage(e.target.files[0]));
    $('#chatAttachRm').addEventListener('click', clearAttach);
    $('#chatLog').addEventListener('click', e => { const b = e.target.closest('[data-copymsg]'); if (b) { const m = chat[+b.dataset.copymsg]; if (m) copyText(m.text, 'Bizzy\'s message copied'); } });
    const log = $('#chatLog');
    log.addEventListener('dragover', e => e.preventDefault());
    log.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadImage(f); });
  }

  /* ================= SETTINGS ================= */
  function fillModels() {
    const b = S().aiBackend; const live = Store.read('liveModels', {})[b];
    const list = (live && live.length ? live : Bot.BACKENDS[b].models);
    const cur = S().models[b];
    const opts = list.map(m => `<option value="${esc(m.id)}">${esc(m.label || m.id)}${m.vision ? ' 👁' : ''}</option>`);
    if (cur && !list.find(m => m.id === cur)) opts.unshift(`<option value="${esc(cur)}">${esc(cur)}</option>`);
    $('#aiModel').innerHTML = opts.join('');
    $('#aiModel').value = cur || list[0].id;
    $('#aiCustomModel').value = S().customModel[b] || '';
    $('#aiBackendNote').innerHTML = esc(Bot.BACKENDS[b].note) + (live && live.length ? ' <b>Showing live list (' + live.length + ').</b>' : ' Showing built-in list (verified Oct 5, 2026).') + ' 👁 = can see images.';
  }
  function renderKeys() { ['gemini', 'groq', 'openrouter'].forEach(k => { const v = S().keys[k]; $(`[data-saved="${k}"]`).textContent = v ? '✅ Saved: ' + Store.mask(v) : 'No key saved'; $('#key-' + k).value = ''; $('#key-' + k).placeholder = v ? Store.mask(v) + ' (saved, type to replace)' : ({ gemini: 'AIza…', groq: 'gsk_…', openrouter: 'sk-or-…' })[k]; }); }
  function renderSettings() {
    applyTheme(S().theme);
    $('#aiBackend').value = S().aiBackend; fillModels(); renderKeys();
    $('#memToggle').checked = !!S().memory; $('#aboutMe').value = S().aboutMe || '';
    $('#mailProviderPref').value = S().mailProvider; $('#refreshRate').value = String(S().refreshSec);
    $('#notifyToggle').checked = !!S().notify; $('#remoteImgToggle').checked = !!S().remoteImages; $('#soundToggle').checked = !!S().sound;
    $('#notifyState').textContent = !('Notification' in window) ? 'This browser does not support notifications.' : 'Permission: ' + Notification.permission + (Notification.permission === 'denied' ? ' (unblock it in your browser site settings)' : '');
  }
  function bindSettings() {
    $('#aiBackend').addEventListener('change', e => { Store.set('aiBackend', e.target.value); fillModels(); renderChat(); toast('🤖 Backend: ' + Bot.BACKENDS[e.target.value].label); });
    $('#aiModel').addEventListener('change', e => { Store.set('models.' + S().aiBackend, e.target.value); renderChat(); toast('🧠 Model: ' + e.target.value); });
    $('#aiCustomModel').addEventListener('change', e => { Store.set('customModel.' + S().aiBackend, e.target.value.trim()); renderChat(); toast(e.target.value.trim() ? '🧠 Custom model set' : 'Custom model cleared'); });
    $('#loadModelsBtn').addEventListener('click', async () => {
      const b = S().aiBackend, btn = $('#loadModelsBtn'); btn.disabled = true; btn.textContent = '⏳ Loading…';
      try { const list = await Bot.listModels(b); if (!list.length) throw new Error('No models returned'); const lm = Store.read('liveModels', {}); lm[b] = list; Store.write('liveModels', lm); if (!list.find(m => m.id === S().models[b])) Store.set('models.' + b, list[0].id); fillModels(); toast('✅ Loaded ' + list.length + ' live models'); }
      catch (e) { $('#keyTestResult').textContent = '❌ ' + e.message; toast('❌ ' + e.message, 3500); }
      finally { btn.disabled = false; btn.textContent = '🔃 Load live model list'; }
    });
    $$('[data-reveal]').forEach(b => b.addEventListener('click', () => { const i = $('#' + b.dataset.reveal); i.type = i.type === 'password' ? 'text' : 'password'; }));
    $('#saveKeysBtn').addEventListener('click', () => { let n = 0; ['gemini', 'groq', 'openrouter'].forEach(k => { const v = $('#key-' + k).value.trim(); if (v) { Store.set('keys.' + k, v); n++; } }); renderKeys(); renderChat(); toast(n ? '💾 Saved ' + n + ' key' + (n > 1 ? 's' : '') + ' locally' : 'Nothing new to save'); });
    $('#wipeKeysBtn').addEventListener('click', async () => { if (await confirmDlg('Wipe all API keys?', 'Removes your Gemini, Groq and OpenRouter keys from this browser.', 'Wipe keys')) { Store.set('keys', { gemini: '', groq: '', openrouter: '' }); renderKeys(); renderChat(); toast('🧹 Keys wiped'); } });
    $('#testKeyBtn').addEventListener('click', async () => {
      const r = $('#keyTestResult'); r.textContent = '⏳ Testing ' + Bot.BACKENDS[S().aiBackend].label + ' / ' + Bot.currentModel() + '…';
      try { const out = await Bot.testKey(); r.textContent = '✅ Works! Reply: ' + out.slice(0, 120); } catch (e) { r.textContent = '❌ ' + e.message.replace(/\*\*/g, ''); }
    });
    $('#memToggle').addEventListener('change', e => { Store.set('memory', e.target.checked); saveChat(); renderChat(); toast(e.target.checked ? '🧠 Memory on' : '🧠 Memory off: chat won\'t be saved'); });
    $('#aboutMe').addEventListener('change', e => { Store.set('aboutMe', e.target.value.trim()); toast('📝 Notes saved'); });
    $('#clearMemBtn').addEventListener('click', async () => { if (await confirmDlg('Clear memory?', 'Deletes saved chat history and your notes for Bizzy.', 'Clear')) { chat = []; Store.remove('chat'); Store.set('aboutMe', ''); $('#aboutMe').value = ''; renderChat(); toast('🧽 Memory cleared'); } });
    $('#mailProviderPref').addEventListener('change', e => { Store.set('mailProvider', e.target.value); $('#newProvider').value = e.target.value; fillNewDomains(); toast('📬 Preferred provider saved'); });
    $('#refreshRate').addEventListener('change', e => { Store.set('refreshSec', +e.target.value); scheduleRefresh(); toast(+e.target.value ? '⏱ Auto-refresh every ' + e.target.value + ' s' : '⏱ Auto-refresh off'); });
    $('#notifyToggle').addEventListener('change', async e => {
      if (e.target.checked) {
        if (!('Notification' in window)) { e.target.checked = false; toast('Notifications not supported here'); return; }
        let perm = Notification.permission; if (perm === 'default') perm = await Notification.requestPermission();
        if (perm !== 'granted') { e.target.checked = false; Store.set('notify', false); toast('🔕 Notification permission ' + perm); renderSettings(); return; }
      }
      Store.set('notify', e.target.checked); renderSettings(); toast(e.target.checked ? '🔔 Notifications on' : '🔕 Notifications off');
    });
    $('#remoteImgToggle').addEventListener('change', e => { Store.set('remoteImages', e.target.checked); toast(e.target.checked ? '🖼️ Remote images load by default' : '🚫 Remote images blocked by default'); });
    $('#soundToggle').addEventListener('change', e => { Store.set('sound', e.target.checked); if (e.target.checked) beep(); toast(e.target.checked ? '🔊 Beep on' : '🔇 Beep off'); });
    $('#exportBtn').addEventListener('click', () => {
      const data = Store.exportAll($('#exportKeys').checked);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'burner-hub-settings-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('⬇️ Settings exported' + (data.includesSecrets ? ' (with keys: keep it private!)' : ''));
    });
    $('#importFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const data = JSON.parse(await f.text()); Store.importAll(data); addresses = Store.read('addresses', []); activeId = Store.read('activeAddress', null); chat = S().memory ? Store.read('chat', []) : []; applyTheme(S().theme); renderSettings(); fillProviderSelects(); renderMail(); renderChat(); toast('⬆️ Settings imported'); }
      catch (err) { toast('❌ Import failed: ' + err.message, 3500); }
      e.target.value = '';
    });
    $('#privacyWipeBtn').addEventListener('click', async () => {
      if (!await confirmDlg('☢️ Privacy wipe?', 'This deletes ALL addresses, inbox tokens, API keys, chats, memory, settings and offline caches from this browser. There is no undo.', 'Wipe everything')) return;
      for (const a of addresses) { const p = Mail.byId(a.provider); if (p) await p.forget(a); }
      await Store.wipeEverything(); toast('☢️ Everything wiped. Reloading…'); setTimeout(() => { location.hash = '#/'; location.reload(); }, 900);
    });
  }

  /* ================= EXTRAS: shortcuts, offline, share, install ================= */
  const SHORTCUTS = [['?', 'Show shortcuts'], ['H', 'Home'], ['M', 'Temp Email Hub'], ['B', 'Bizzy Bot full page'], ['C', 'Toggle chat bubble'], ['S', 'Settings'], ['N', 'New temp address'], ['R', 'Refresh inbox'], ['Y', 'Copy current address'], ['/', 'Focus chat box'], ['Esc', 'Close chat / dialogs'], ['Backspace', 'Back']];
  function renderShortcuts() { const html = '<table class="sc-table"><tbody>' + SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('') + '</tbody></table>'; $('#shortcutsTable').innerHTML = html; $('#shortcutsDlgBody').innerHTML = html; }
  function bindShortcuts() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!$('#botPanel').hidden) { togglePanel(false); e.preventDefault(); } return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const act = {
        '?': () => $('#shortcutsDlg').showModal(), h: () => (location.hash = '#/'), m: () => (location.hash = '#/mail'), b: () => (location.hash = '#/bot'),
        s: () => (location.hash = '#/settings'), c: () => { if (parseHash().name !== 'bot') togglePanel(); },
        n: () => { if (parseHash().name !== 'mail') location.hash = '#/mail'; onGenerate(); }, r: () => refreshInbox(true),
        y: () => active() && copyText(active().address, 'Address copied'),
        '/': () => { if (parseHash().name !== 'bot' && $('#botPanel').hidden) togglePanel(true); else $('#chatInput').focus(); },
        Backspace: () => { if (parseHash().name !== 'home') goBack(); }
      }[k];
      if (act) { e.preventDefault(); act(); }
    });
    document.addEventListener('click', e => { if (e.target.closest('[data-action="shortcuts"]')) $('#shortcutsDlg').showModal(); });
  }
  function bindOffline() {
    const upd = (announce) => { $('#offlinePill').hidden = navigator.onLine; if (announce) toast(navigator.onLine ? '🛰️ Back online' : '⚠️ You are offline: inbox refresh and Bizzy are paused'); if (navigator.onLine && announce) refreshInbox(false); };
    window.addEventListener('online', () => upd(true)); window.addEventListener('offline', () => upd(true)); upd(false);
  }
  function bindShare() {
    $('#shareBtn').addEventListener('click', async () => {
      const data = { title: "Bizzle's Burner Hub v4.20", text: 'Free real temp email + Bizzy Bot AI helper 👽', url: 'https://leehizzbt.github.io/bizzles-burner-hub/' };
      if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
      copyText(data.url, 'App link copied');
    });
  }
  let deferredPrompt = null;
  function bindInstall() {
    const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
    if (isIOS && !isStandalone) $('#installBtn').hidden = false;
    $('#installBtn').addEventListener('click', async () => {
      if (deferredPrompt) { deferredPrompt.prompt(); const r = await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; toast(r.outcome === 'accepted' ? '🚀 Installed!' : 'Install dismissed'); }
      else if (isIOS) $('#iosDlg').showModal();
    });
    window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('🚀 App installed'); });
  }
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e));
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && parseHash().name === 'mail') { unread = 0; updateTitle(); } });

  /* ---------------- Boot ---------------- */
  buildThemes(); applyTheme(S().theme); renderShortcuts();
  bindMail(); bindChat(); bindSettings(); bindShortcuts(); bindOffline(); bindShare(); bindInstall(); registerSW();
  route();
  if (active() && parseHash().name !== 'mail') refreshInbox(false);
})();
