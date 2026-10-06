/* Real temp-mail providers that allow direct browser (CORS) access from a static site.
   Verified live from https://leehizzbt.github.io on Oct 5, 2026. No mock data anywhere. */
(function () {
  'use strict';
  const TIMEOUT = 15000;
  async function fetchJSON(url, opts = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT);
    let res;
    try { res = await fetch(url, Object.assign({}, opts, { signal: ctl.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })); }
    catch (e) { const err = new Error(e.name === 'AbortError' ? 'Timed out' : 'Network/CORS error'); err.kind = 'network'; throw err; }
    finally { clearTimeout(t); }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.status = res.status; err.kind = 'http'; err.data = data; throw err; }
    return data;
  }
  const WORDS1 = ['chill', 'cosmic', 'hazy', 'lunar', 'neon', 'zen', 'mellow', 'groovy', 'astro', 'blazed', 'fuzzy', 'stellar', 'mystic', 'sleepy', 'lazy', 'nebula'];
  const WORDS2 = ['alien', 'comet', 'ufo', 'nugget', 'saucer', 'martian', 'orbit', 'pixel', 'llama', 'panda', 'cloud', 'rocket', 'quasar', 'gecko', 'mango', 'otter'];
  function rnd(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
  function randomUser() { return WORDS1[rnd(WORDS1.length)] + WORDS2[rnd(WORDS2.length)] + (1000 + rnd(9000)) + String.fromCharCode(97 + rnd(26)) + String.fromCharCode(97 + rnd(26)); }
  function cleanUser(u) { return String(u || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  /* ---------- Guerrilla Mail (https://www.guerrillamail.com/GuerrillaMailAPI.html) ---------- */
  const GM = 'https://api.guerrillamail.com/ajax.php';
  const gm = (params) => fetchJSON(GM + '?' + new URLSearchParams(params).toString());
  const Guerrilla = {
    id: 'guerrilla', name: 'Guerrilla Mail', site: 'https://www.guerrillamail.com/',
    domains: ['sharklasers.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'grr.la', 'guerrillamailblock.com', 'pokemail.net', 'spam4.me'],
    note: 'Mail auto-deletes after 1 hour. Every domain delivers to the same inbox. Anyone who guesses the name can open it; the scrambled alias hides it from senders.',
    attachments: true, canDelete: true,
    async create(user, domain) {
      user = cleanUser(user) || randomUser();
      const d = await gm({ f: 'set_email_user', email_user: user, lang: 'en' });
      if (!d || !d.sid_token || !d.email_addr) throw new Error('Guerrilla Mail did not return an address');
      const realUser = d.email_addr.split('@')[0];
      const dom = this.domains.includes(domain) ? domain : this.domains[0];
      return { id: uid(), provider: this.id, user: realUser, domain: dom, address: realUser + '@' + dom, token: d.sid_token, alias: d.alias ? d.alias + '@' + dom : '', created: Date.now(), tokenAt: Date.now() };
    },
    async reauth(a) {
      const d = await gm({ f: 'set_email_user', email_user: a.user, lang: 'en' });
      if (!d || !d.sid_token) throw new Error('Guerrilla session could not be restored');
      a.token = d.sid_token; a.tokenAt = Date.now(); if (d.alias) a.alias = d.alias + '@' + a.domain;
      return a;
    },
    async ensure(a) { if (!a.token || !a.tokenAt || Date.now() - a.tokenAt > 10 * 60 * 1000) await this.reauth(a); return a; },
    async list(a) {
      await this.ensure(a);
      let d = await gm({ f: 'get_email_list', offset: 0, sid_token: a.token });
      if (!d || !Array.isArray(d.list) || (d.email && d.email.split('@')[0] !== a.user)) { await this.reauth(a); d = await gm({ f: 'get_email_list', offset: 0, sid_token: a.token }); }
      if (!d || !Array.isArray(d.list)) throw new Error((d && d.error) || 'Unexpected Guerrilla response');
      return d.list.map(m => ({ id: String(m.mail_id), from: m.mail_from, subject: decodeEnt(m.mail_subject || '(no subject)'), date: m.mail_timestamp && +m.mail_timestamp > 0 ? (+m.mail_timestamp) * 1000 : a.created, excerpt: decodeEnt(m.mail_excerpt || ''), hasAtt: +m.att > 0, read: m.mail_read == 1 }));
    },
    async read(a, id) {
      await this.ensure(a);
      const m = await gm({ f: 'fetch_email', email_id: id, sid_token: a.token });
      if (!m || !m.mail_id) throw new Error('Message not found (it may have expired)');
      const isHtml = /html/i.test(m.content_type || '') || /<[a-z][\s\S]*>/i.test(m.mail_body || '');
      let html = m.mail_body || '';
      // Guerrilla proxies remote images through its own res.php: make those URLs absolute.
      html = html.replace(/(src|href)="\/res\.php/gi, '$1="https://www.guerrillamail.com/res.php');
      const atts = (m.att_info || []).map(x => ({ name: x.f, type: x.t, url: 'https://www.guerrillamail.com/inbox?get_att&lang=en&email_id=' + encodeURIComponent(m.mail_id) + '&part_id=' + encodeURIComponent(x.p) + '&sid_token=' + encodeURIComponent(a.token) }));
      return { id: String(m.mail_id), from: m.mail_from, subject: decodeEnt(m.mail_subject || '(no subject)'), date: +m.mail_timestamp > 0 ? (+m.mail_timestamp) * 1000 : Date.now(), html: isHtml ? html : '', text: isHtml ? '' : html, attachments: atts };
    },
    async del(a, id) { await this.ensure(a); await gm({ f: 'del_email', 'email_ids[]': id, sid_token: a.token }); },
    async forget(a) { try { if (a.token) await gm({ f: 'forget_me', email_addr: a.user + '@guerrillamailblock.com', sid_token: a.token }); } catch (e) {} },
    async ping() { const d = await gm({ f: 'check_email', seq: 0, sid_token: 'statusprobe' }); return !!d; }
  };

  /* ---------- Maildrop (https://maildrop.cc) GraphQL ---------- */
  const MD = 'https://api.maildrop.cc/graphql';
  async function md(query, variables) {
    const d = await fetchJSON(MD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (d && d.errors && d.errors.length) throw new Error(d.errors[0].message || 'Maildrop error');
    return d && d.data;
  }
  const Maildrop = {
    id: 'maildrop', name: 'Maildrop', site: 'https://maildrop.cc/',
    domains: ['maildrop.cc'],
    note: 'PUBLIC inbox: anyone who knows the name can read it. Maildrop\'s API does not expose attachments. Inboxes are cleared after inactivity.',
    attachments: false, canDelete: true,
    async create(user) {
      user = cleanUser(user) || randomUser();
      user = user.replace(/[^a-z0-9._-]/g, '');
      const d = await md('query($m:String!){ altinbox(mailbox:$m) }', { m: user });
      return { id: uid(), provider: this.id, user, domain: 'maildrop.cc', address: user + '@maildrop.cc', token: '', alias: d && d.altinbox ? d.altinbox + '@maildrop.cc' : '', created: Date.now() };
    },
    async list(a) {
      const d = await md('query($m:String!){ inbox(mailbox:$m){ id headerfrom subject date } }', { m: a.user });
      return (d.inbox || []).map(m => ({ id: m.id, from: m.headerfrom, subject: m.subject || '(no subject)', date: Date.parse(m.date) || Date.now(), excerpt: '', hasAtt: false }));
    },
    async read(a, id) {
      const d = await md('query($m:String!,$id:String!){ message(mailbox:$m, id:$id){ id headerfrom subject date html } }', { m: a.user, id });
      const m = d && d.message;
      if (!m) throw new Error('Message not found (it may have expired)');
      return { id: m.id, from: m.headerfrom, subject: m.subject || '(no subject)', date: Date.parse(m.date) || Date.now(), html: m.html || '', text: m.html ? '' : '(empty message body)', attachments: [] };
    },
    async del(a, id) { await md('mutation($m:String!,$id:String!){ delete(mailbox:$m, id:$id) }', { m: a.user, id }); },
    async forget() {},
    async ping() { const d = await md('query{ status }'); return !!(d && d.status); }
  };

  /* ---------- SpamOK (https://spamok.com) REST ---------- */
  const SO = 'https://api.spamok.com/v2';
  const SpamOK = {
    id: 'spamok', name: 'SpamOK', site: 'https://spamok.com/',
    domains: ['spamok.com'],
    note: 'PUBLIC inbox: anyone who knows the name can read it. Attachment files can be downloaded on spamok.com (link shown in the message).',
    attachments: false, canDelete: true,
    async create(user) {
      user = cleanUser(user) || randomUser();
      await fetchJSON(SO + '/EmailBox/' + encodeURIComponent(user));
      return { id: uid(), provider: this.id, user, domain: 'spamok.com', address: user + '@spamok.com', token: '', alias: '', created: Date.now() };
    },
    async list(a) {
      const d = await fetchJSON(SO + '/EmailBox/' + encodeURIComponent(a.user));
      return ((d && d.mails) || []).map(m => ({ id: String(m.id), from: (m.fromDisplay ? m.fromDisplay + ' ' : '') + '<' + m.fromLocal + '@' + m.fromDomain + '>', subject: m.subject || '(no subject)', date: Date.parse(m.date) || Date.now(), excerpt: m.messagePreview || '', hasAtt: false }));
    },
    async read(a, id) {
      const m = await fetchJSON(SO + '/Email/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(id));
      if (!m || !m.id) throw new Error('Message not found');
      const atts = (m.attachments || []).map(x => ({ name: x.filename, type: x.mimeType, size: x.filesize, url: 'https://spamok.com/' + encodeURIComponent(a.user), external: true }));
      return { id: String(m.id), from: (m.fromDisplay ? m.fromDisplay + ' ' : '') + '<' + m.fromLocal + '@' + m.fromDomain + '>', subject: m.subject || '(no subject)', date: Date.parse(m.date) || Date.now(), html: m.messageHtml || '', text: m.messageHtml ? '' : (m.messagePlain || ''), attachments: atts };
    },
    async del(a, id) { await fetchJSON(SO + '/Email/' + encodeURIComponent(a.user) + '/' + encodeURIComponent(id), { method: 'DELETE' }); },
    async forget() {},
    async ping() { const d = await fetchJSON(SO + '/EmailBox/statusprobe' + (1000 + rnd(9000))); return !!d; }
  };

  function decodeEnt(s) { const t = document.createElement('textarea'); t.innerHTML = String(s); return t.value; }

  const PROVIDERS = [Guerrilla, Maildrop, SpamOK];
  const DEAD = [
    { name: 'mail.tm', why: 'Works, but its API only grants CORS to https://mail.tm, so browsers block it on any other website.' },
    { name: 'mail.gw', why: 'API returned HTTP 502 (down) on Oct 5, 2026.' },
    { name: '1secmail', why: 'API returns HTTP 403 Forbidden (service closed its API).' },
    { name: 'tempmail.lol', why: 'CORS restricted to https://tempmail.lol only.' },
    { name: 'inboxes.com / getnada', why: 'No CORS permission for other websites.' },
    { name: 'temp-mail.io (internal API)', why: 'No CORS headers, browser blocks it.' },
    { name: 'tempmail.plus', why: 'No CORS headers, browser blocks it.' },
    { name: 'dropmail.me', why: 'GraphQL API now requires a paid/registered token ("legacy_token_disabled").' },
    { name: 'temp-mail.org', why: 'Official API is paid (RapidAPI key required).' },
    { name: 'Mailsac', why: 'Free public inboxes now require login/API key.' },
    { name: 'harakirimail, mailnesia', why: 'No CORS permission for other websites.' }
  ];
  const byId = id => PROVIDERS.find(p => p.id === id);
  window.Mail = { PROVIDERS, DEAD, byId, randomUser, cleanUser, fetchJSON };
})();
