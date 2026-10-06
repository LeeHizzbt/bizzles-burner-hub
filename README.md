# Bizzle's Burner Hub v4.20 👽

Live: **https://leehizzbt.github.io/bizzles-burner-hub/**

A free, installable PWA (static site, GitHub Pages) with:

- **📬 Temp Email Hub**: real disposable inboxes created live in your browser on providers that allow cross-origin (CORS) access from a static site, with automatic fallback:
  1. **Guerrilla Mail** (primary: 11 domains, attachments, scrambled alias, mail kept 1 hour)
  2. **Maildrop** (fallback: public inbox, no attachments via API)
  3. **SpamOK** (fallback: public inbox)

  Includes multiple saved addresses (localStorage), copy, local QR code, configurable auto-refresh, sandboxed email rendering (DOMPurify + sandboxed iframe with no scripts, remote images blocked by default), attachment download, delete message/address, provider status and notifications.
- **🤖 Bizzy Bot**: a chill stoner-alien AI helper. You bring your own free key (Gemini, Groq or OpenRouter `:free`), called straight from the browser. Chat bubble on every page plus a full-page view, image/screenshot upload, Markdown, copy buttons, local memory toggle.
- Settings: themes (Neon Alien Green, Purple Haze, Cyber Orange, Midnight, Light), keys (masked, local only), memory, mail provider, refresh rate, notifications, export/import, privacy wipe.
- Extras: offline indicator, keyboard shortcuts (`?`), share button, install prompt, unread badge.

## Honesty notes (checked Oct 5, 2026)
- mail.tm only grants CORS to `https://mail.tm`, so it can't be used from other websites. mail.gw was down (502). 1secmail returns 403. tempmail.lol, inboxes.com/getnada, temp-mail.io, tempmail.plus and harakirimail block other origins. dropmail requires a registered token.
- Temp inboxes are **not private**: anyone who knows the name can read them. Don't use them for accounts you care about.
- Gemini, Groq and OpenRouter all allow direct browser calls. Keys stay in your browser's localStorage.

No build step. Vendored libs: DOMPurify 3.4.16 (Apache-2.0/MPL-2.0), marked 15.0.12 (MIT), qrcode-generator 1.5.2 (MIT). Font: Orbitron (SIL OFL 1.1).
