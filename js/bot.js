/* Bizzy Bot: bring-your-own-key AI client. Calls the provider directly from the browser (all three allow CORS, verified Oct 5, 2026). */
(function () {
  'use strict';
  const PERSONA = "You are Bizzy Bot, the resident AI of Bizzle's Burner Hub v4.20: a chill, funny, good-vibes stoner alien in a tie-dye hoodie. " +
    "You talk laid-back and playful (light slang like 'dude', 'far out', 'cosmic', the occasional 👽✌️🌿), but you are genuinely smart and helpful with ANYTHING: coding, writing, tech support, life stuff, explaining screenshots. " +
    "Keep answers clear and useful first, jokes second; use Markdown for lists and code. Be honest when you don't know. " +
    "Inside this app, users can make real disposable email addresses (Guerrilla Mail, Maildrop, SpamOK) in the Temp Email Hub; remind them those inboxes are public-ish and not for banking/recovery accounts. " +
    "Never encourage anything illegal or harmful; safety and legality beat the bit.";

  const BACKENDS = {
    gemini: {
      label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', cors: true,
      models: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (newest stable)', vision: true },
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', vision: true },
        { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest)', vision: true },
        { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', vision: true },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (older projects only)', vision: true },
        { id: 'gemini-flash-latest', label: 'gemini-flash-latest (alias)', vision: true }
      ],
      note: 'Works directly in the browser (CORS OK). Free tier: limits are per project and shown in AI Studio; free-tier prompts may be used by Google to improve products.'
    },
    groq: {
      label: 'Groq', keyUrl: 'https://console.groq.com/keys', cors: true,
      models: [
        { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', vision: false },
        { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fast)', vision: false },
        { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (vision, preview)', vision: true },
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', vision: false },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', vision: false }
      ],
      note: 'Works directly in the browser (CORS OK). Free plan has per-model rate limits; see console.groq.com.'
    },
    openrouter: {
      label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', cors: true,
      models: [
        { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free, vision)', vision: true },
        { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B (free, vision)', vision: true },
        { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)', vision: false },
        { id: 'thinkingmachines/inkling:free', label: 'Inkling (free, vision)', vision: true },
        { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (free)', vision: false }
      ],
      note: 'Works directly in the browser (CORS OK). Only models ending in ":free" cost $0; the free list changes often, so use "Load live model list". Free models have daily request caps.'
    }
  };

  function currentModel() {
    const s = Store.s, b = s.aiBackend;
    return (s.customModel[b] || '').trim() || s.models[b] || BACKENDS[b].models[0].id;
  }
  function modelInfo(b, id) {
    const live = (Store.read('liveModels', {})[b] || []).find(m => m.id === id);
    return live || BACKENDS[b].models.find(m => m.id === id) || { id, vision: b === 'gemini' };
  }

  class BotError extends Error { constructor(kind, msg, detail) { super(msg); this.kind = kind; this.detail = detail; } }

  async function call(url, opts) {
    let res;
    try { res = await fetch(url, Object.assign({ credentials: 'omit', referrerPolicy: 'no-referrer' }, opts)); }
    catch (e) {
      if (!navigator.onLine) throw new BotError('offline', "You're offline, dude. Reconnect to the mothership (internet) and try again.");
      throw new BotError('network', 'Network error reaching the AI provider (connection dropped, blocked by an extension/firewall, or provider down). Try again in a bit.');
    }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const pmsg = (data && data.error && (data.error.message || data.error.status)) || (Array.isArray(data) && data[0] && data[0].error && data[0].error.message) || text.slice(0, 200);
      if (res.status === 429) throw new BotError('rate', 'Rate limit hit (HTTP 429): the free tier says chill for a minute. Wait a bit, or switch backend/model in Settings.', pmsg);
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key|API_KEY|invalid.*key/i.test(pmsg))) throw new BotError('badkey', 'That API key was rejected (HTTP ' + res.status + '). Double-check it in Advanced AI Settings, or make a fresh free key.', pmsg);
      if (res.status === 404) throw new BotError('model', 'Model not found (HTTP 404). Pick another model or hit "Load live model list" in Settings.', pmsg);
      if (res.status === 402) throw new BotError('credits', 'Provider says payment/credits required (HTTP 402). Use a ":free" model or another backend.', pmsg);
      throw new BotError('http', 'Provider error HTTP ' + res.status + '.', pmsg);
    }
    return data;
  }

  function toOpenAIMessages(history) {
    return history.map(m => {
      if (m.image && m.role === 'user') return { role: 'user', content: [{ type: 'text', text: m.text || 'What is in this image?' }, { type: 'image_url', image_url: { url: m.image } }] };
      return { role: m.role === 'bot' ? 'assistant' : 'user', content: m.text };
    });
  }

  async function send(history) {
    const s = Store.s, b = s.aiBackend, key = (s.keys[b] || '').trim(), model = currentModel();
    if (!key) throw new BotError('nokey', 'No ' + BACKENDS[b].label + ' API key yet, my dude. Open **[Advanced AI Settings](#/settings)** and paste a free key (get one at ' + BACKENDS[b].keyUrl + '). It stays only in your browser.');
    const sys = PERSONA + (s.memory && s.aboutMe ? '\n\nThings the user asked you to remember about them: ' + s.aboutMe : '') + '\nToday is ' + new Date().toDateString() + '.';
    const hasImg = history.some(m => m.image);
    if (hasImg && !modelInfo(b, model).vision) throw new BotError('novision', 'The model "' + model + '" can\'t see images. Switch to a vision model in Settings (e.g. Gemini Flash, Gemma 4 :free on OpenRouter, or Qwen 3.8 on Groq).');
    if (b === 'gemini') {
      const contents = history.map(m => {
        const parts = [];
        if (m.image && m.role === 'user') { const mm = /^data:([^;]+);base64,(.*)$/.exec(m.image); if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } }); }
        parts.push({ text: m.text || (m.image ? 'What is in this image?' : '') });
        return { role: m.role === 'bot' ? 'model' : 'user', parts };
      });
      const data = await call('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.9 } })
      });
      const c = data && data.candidates && data.candidates[0];
      const out = c && c.content && (c.content.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
      if (!out) throw new BotError('empty', 'Gemini returned no text' + (c && c.finishReason ? ' (finishReason: ' + c.finishReason + ')' : (data && data.promptFeedback ? ' (blocked: ' + (data.promptFeedback.blockReason || 'safety') + ')' : '')) + '.');
      return out;
    }
    const url = b === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (b === 'openrouter') { headers['HTTP-Referer'] = 'https://leehizzbt.github.io/bizzles-burner-hub/'; headers['X-Title'] = "Bizzle's Burner Hub"; }
    const data = await call(url, { method: 'POST', headers, body: JSON.stringify({ model, temperature: 0.9, messages: [{ role: 'system', content: sys }].concat(toOpenAIMessages(history)) }) });
    if (data && data.error) throw new BotError('http', data.error.message || 'Provider error');
    const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new BotError('empty', 'The model returned an empty reply. Try again or pick another model.');
    return Array.isArray(out) ? out.map(p => p.text || '').join('') : out;
  }

  async function listModels(b) {
    const key = (Store.s.keys[b] || '').trim();
    if (b === 'openrouter') {
      const d = await call('https://openrouter.ai/api/v1/models', {});
      return (d.data || []).filter(m => /:free$/.test(m.id)).map(m => ({ id: m.id, label: (m.name || m.id), vision: ((m.architecture && m.architecture.input_modalities) || []).includes('image') }));
    }
    if (!key) throw new BotError('nokey', 'Save a ' + BACKENDS[b].label + ' key first to load its live model list.');
    if (b === 'gemini') {
      const d = await call('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
      return (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini|gemma/.test(m.name) && !/tts|image|live|embedding|audio|transcribe/.test(m.name))
        .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name, vision: true }));
    }
    const d = await call('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    return (d.data || []).filter(m => m.active !== false && !/whisper|tts|orpheus|guard|playai/.test(m.id)).map(m => ({ id: m.id, label: m.id, vision: /vision|llama-4|qwen3\.8|scout|maverick/.test(m.id) }));
  }

  async function testKey() { return send([{ role: 'user', text: 'Reply with exactly: Bizzy online ✌️' }]); }

  window.Bot = { BACKENDS, PERSONA, send, listModels, testKey, currentModel, modelInfo, BotError };
})();
