/* Local-only storage helpers. Everything lives in this browser's localStorage under the "bbh." prefix. */
(function () {
  'use strict';
  const P = 'bbh.';
  const DEFAULTS = {
    theme: 'alien',
    aiBackend: 'gemini',
    models: { gemini: 'gemini-3.8-flash', groq: 'openai/gpt-oss-120b', openrouter: 'google/gemma-4-31b-it:free' },
    customModel: { gemini: '', groq: '', openrouter: '' },
    keys: { gemini: '', groq: '', openrouter: '' },
    memory: true,
    aboutMe: '',
    mailProvider: 'auto',
    refreshSec: 10,
    notify: false,
    remoteImages: false,
    sound: false
  };
  function read(k, fallback) {
    try { const v = localStorage.getItem(P + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function write(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { console.warn('storage write failed', e); return false; }
  }
  function remove(k) { try { localStorage.removeItem(P + k); } catch (e) {} }
  function merge(base, extra) {
    const out = JSON.parse(JSON.stringify(base));
    if (!extra || typeof extra !== 'object') return out;
    for (const k of Object.keys(base)) {
      if (!(k in extra)) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = Object.assign({}, base[k], extra[k] || {});
      else out[k] = extra[k];
    }
    return out;
  }
  let settings = merge(DEFAULTS, read('settings', {}));
  const listeners = new Set();
  const Store = {
    DEFAULTS,
    get s() { return settings; },
    set(path, value) {
      const parts = path.split('.');
      let o = settings;
      for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = value;
      write('settings', settings);
      listeners.forEach(fn => { try { fn(path, value); } catch (e) { console.error(e); } });
    },
    onChange(fn) { listeners.add(fn); },
    read, write, remove,
    exportAll(includeSecrets) {
      const s = JSON.parse(JSON.stringify(settings));
      let addresses = read('addresses', []);
      if (!includeSecrets) {
        s.keys = { gemini: '', groq: '', openrouter: '' };
        addresses = addresses.map(a => Object.assign({}, a, { token: '' }));
      }
      return { app: 'bizzles-burner-hub', version: '4.20', exported: new Date().toISOString(), includesSecrets: !!includeSecrets,
        settings: s, addresses, activeAddress: read('activeAddress', null), chat: settings.memory ? read('chat', []) : [] };
    },
    importAll(data) {
      if (!data || data.app !== 'bizzles-burner-hub') throw new Error('Not a Burner Hub backup file.');
      const keep = settings.keys;
      settings = merge(DEFAULTS, data.settings || {});
      // never wipe existing keys with blanks from a key-less export
      for (const k of Object.keys(settings.keys)) if (!settings.keys[k] && keep[k]) settings.keys[k] = keep[k];
      write('settings', settings);
      if (Array.isArray(data.addresses)) write('addresses', data.addresses);
      if (data.activeAddress) write('activeAddress', data.activeAddress);
      if (Array.isArray(data.chat) && data.chat.length) write('chat', data.chat);
      listeners.forEach(fn => fn('*'));
    },
    async wipeEverything() {
      try { Object.keys(localStorage).forEach(k => { if (k.startsWith(P)) localStorage.removeItem(k); }); } catch (e) {}
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
      try { if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch (e) {}
      try { if (navigator.serviceWorker) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } } catch (e) {}
      settings = merge(DEFAULTS, {});
    },
    mask(key) { if (!key) return ''; return key.length <= 8 ? '••••' : key.slice(0, 4) + '••••••' + key.slice(-4); }
  };
  window.Store = Store;
})();
