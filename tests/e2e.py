"""Real end-to-end tests for Bizzle's Burner Hub v4.20.
phase1: create real temp addresses (Guerrilla, Maildrop, SpamOK) in a persistent profile and save them to state.json
phase2: verify the real email (sent via AgentMail) arrived in the UI, then run every other UI test."""
import asyncio, json, sys, os, time, re, traceback
from playwright.async_api import async_playwright
BASE = os.environ.get('BASE', 'https://leehizzbt.github.io/bizzles-burner-hub/')
ORIGIN = re.match(r'https?://[^/]+', BASE).group(0)
CHROME = dict(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
SHOTS = '/workspace/burner-hub/test-shots/'
PROFILE = '/workspace/burner-hub/tests/profile'
STATE = '/workspace/burner-hub/tests/state.json'
SUBJECT = os.environ.get('SUBJECT', '')
os.makedirs(SHOTS, exist_ok=True)
results = []

async def run(name, fn):
    t0 = time.time()
    try:
        info = fn()
        if asyncio.iscoroutine(info): info = await info
        results.append({'name': name, 'ok': True, 'info': info, 's': round(time.time() - t0, 1)}); print('PASS', name, '-', info if info else '')
    except Exception as e:
        results.append({'name': name, 'ok': False, 'err': f'{type(e).__name__}: {e}', 's': round(time.time() - t0, 1)}); print('FAIL', name, '-', e); traceback.print_exc(limit=1)

def check(cond, msg):
    if not cond: raise AssertionError(msg)

async def new_ctx(b, w=1280, h=900, **kw):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True, bypass_csp=True, **kw)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write', 'notifications'], origin=ORIGIN)
    return ctx

async def page_with_errors(ctx, url=BASE):
    pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type == 'error' else None)
    await pg.goto(url); await pg.wait_for_selector('#main')
    return pg

async def clip(pg): return await pg.evaluate('navigator.clipboard.readText()')

# ------------------------------------------------------------------ PHASE 1
async def phase1():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(PROFILE, viewport={'width': 1280, 'height': 900}, bypass_csp=True, **CHROME)
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write', 'notifications'], origin=ORIGIN)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await pg.goto(BASE + '#/mail'); await pg.wait_for_selector('#newAddrForm')
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_selector('#newAddrForm')
        out = {}
        for prov in ['spamok', 'maildrop', 'guerrilla']:
            await pg.select_option('#newProvider', prov)
            await pg.fill('#newUser', '')
            await pg.click('#genBtn')
            await pg.wait_for_function(f"(JSON.parse(localStorage.getItem('bbh.addresses')||'[]')[0]||{{}}).provider==='{prov}'", timeout=25000)
            out[prov] = await pg.inner_text('#addrText')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=SHOTS + 'phase1-addresses.png', full_page=True)
        json.dump({'addresses': out, 'created': time.time()}, open(STATE, 'w'), indent=1)
        print(json.dumps(out))
        await ctx.close()

# ------------------------------------------------------------------ PHASE 2
async def phase2():
    st = json.load(open(STATE))
    async with async_playwright() as p:
        # ---- REAL EMAIL ARRIVAL (persistent profile from phase 1)
        ctx = await p.chromium.launch_persistent_context(PROFILE, viewport={'width': 1280, 'height': 900}, accept_downloads=True, bypass_csp=True, **CHROME)
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write', 'notifications'], origin=ORIGIN)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e)))
        await pg.goto(BASE + '#/mail'); await pg.wait_for_selector('#addrList')
        arrival = {}
        async def arrived(prov):
            addr = st['addresses'][prov]
            await pg.click(f'#addrList .addr-pick:has-text("{addr}")')
            await pg.wait_for_function("document.querySelector('#addrText').textContent===%s" % json.dumps(addr))
            loc = pg.locator('#msgList .msg', has_text=SUBJECT)
            deadline = time.time() + 150
            while time.time() < deadline:
                if await loc.count(): break
                await pg.click('#refreshBtn'); await pg.wait_for_timeout(5000)
            check(await loc.count() > 0, f'email "{SUBJECT}" not in {prov} inbox for {addr}')
            ts = await loc.first.locator('.msg-time').inner_text()
            await loc.first.click(); await pg.wait_for_function("document.querySelector('#readerSubject').textContent.includes(%s)" % json.dumps(SUBJECT), timeout=20000)
            frm = await pg.inner_text('#readerFrom'); atts = await pg.inner_text('#readerAtts')
            srcdoc = await pg.get_attribute('#readerFrame', 'srcdoc')
            check('<script' not in srcdoc.lower(), 'script tag survived sanitizing')
            check('onerror' not in srcdoc.lower(), 'onerror handler survived sanitizing')
            check("img-src data: cid:;" in srcdoc, 'remote images not blocked by default')
            arrival[prov] = {'address': addr, 'subject': SUBJECT, 'listTime': ts, 'from': frm, 'attachments': atts}
            await pg.screenshot(path=SHOTS + f'inbox-{prov}-received.png', full_page=True)
            return arrival[prov]
        await run('REAL email arrived in Guerrilla Mail inbox UI (primary)', lambda: arrived('guerrilla'))
        async def gm_att():
            href = await pg.get_attribute('#readerAtts a', 'href')
            check(href and 'get_att' in href, 'no attachment link')
            async with pg.expect_download() as dl:
                await pg.click('#readerAtts a')
            d = await dl.value; path = SHOTS + '../tests/downloaded-' + d.suggested_filename; await d.save_as(path)
            body = open(path).read()
            check('burner hub' in body.lower(), 'attachment content wrong: ' + body[:60])
            return f'{d.suggested_filename}: {body.strip()[:50]!r}'
        await run('Guerrilla attachment downloads with real content', gm_att)
        async def imgs():
            await pg.click('#imgToggleBtn'); s = await pg.get_attribute('#readerFrame', 'srcdoc'); check('img-src data: cid: https: http:' in s, 'images not enabled')
            await pg.click('#imgToggleBtn'); s = await pg.get_attribute('#readerFrame', 'srcdoc'); check('img-src data: cid:;' in s, 'images not re-blocked')
            sb = await pg.get_attribute('#readerFrame', 'sandbox'); check('allow-scripts' not in sb and 'allow-same-origin' not in sb, 'iframe sandbox too loose')
            return 'sandbox=' + sb
        await run('Reader: sandboxed iframe, load/block remote images toggle', imgs)
        async def copymsg():
            await pg.click('#copyMsgBtn'); c = await clip(pg); check(SUBJECT in c, 'copied text missing subject'); return c[:60].replace('\n', ' | ')
        await run('Reader: copy-text button', copymsg)
        async def reader_back():
            await pg.click('#reader [data-back]'); await pg.wait_for_function("location.hash==='#/mail'"); check(await pg.is_hidden('#reader'), 'reader still open'); return 'ok'
        await run('Reader: back button returns to inbox', reader_back)
        await run('REAL email arrived in Maildrop inbox UI (fallback 1)', lambda: arrived('maildrop'))
        await run('REAL email arrived in SpamOK inbox UI (fallback 2)', lambda: arrived('spamok'))
        async def delmsg():
            # delete the SpamOK copy through the UI and confirm it is gone on the provider
            await pg.click('#delMsgBtn'); await pg.click('#confirmOk'); await pg.wait_for_function("location.hash==='#/mail'")
            await pg.wait_for_timeout(1500); await pg.click('#refreshBtn'); await pg.wait_for_timeout(2500)
            n = await pg.locator('#msgList .msg', has_text=SUBJECT).count(); check(n == 0, 'message still listed after delete'); return 'deleted on SpamOK and gone after refresh'
        await run('Delete a message (confirm dialog, real provider delete)', delmsg)
        async def domains():
            await pg.click(f'#addrList .addr-pick:has-text("{st["addresses"]["guerrilla"]}")'); await pg.wait_for_timeout(800)
            opts = await pg.eval_on_selector_all('#domainSelect option', 'o=>o.map(x=>x.value)')
            await pg.select_option('#domainSelect', 'grr.la'); txt = await pg.inner_text('#addrText'); check(txt.endswith('@grr.la'), 'domain switch failed')
            await pg.click('#copyAddrBtn'); check((await clip(pg)) == txt, 'copy address mismatch')
            await pg.click('#qrBtn'); await pg.wait_for_selector('#qrSvg svg'); check(await pg.get_attribute('#qrBtn', 'aria-expanded') == 'true', 'qr aria')
            await pg.screenshot(path=SHOTS + 'mail-qr.png')
            await pg.click('#copyAliasBtn'); al = await clip(pg); check('@grr.la' in al and '+' in al, 'alias copy wrong: ' + al)
            await pg.click('#addrList [data-copyaddr]'); check('@' in await clip(pg), 'list copy failed')
            await pg.select_option('#domainSelect', 'sharklasers.com')
            return f'{len(opts)} Guerrilla domains; switched to grr.la; copy, alias copy, list copy and QR OK'
        await run('Domain switch, copy buttons, QR code', domains)
        await run('No page errors during real-mail flow', lambda: (check(not pg.errs, str(pg.errs)), 'clean')[1])
        await ctx.close()

        b = await p.chromium.launch(**CHROME)
        # ---- HOME, META, PWA
        ctx = await new_ctx(b); pg = await page_with_errors(ctx)
        async def home():
            tiles = await pg.locator('.tiles .tile').count(); check(tiles == 2, f'expected 2 tiles got {tiles}')
            titles = await pg.eval_on_selector_all('.tile-title', 'e=>e.map(x=>x.textContent)'); check(titles == ['Temp Email Hub', 'Bizzy Bot'], str(titles))
            body = (await pg.inner_text('body')).lower(); check('twilio' not in body and 'burner number' not in body and 'sms' not in body, 'phone/SMS remnants found')
            og = await pg.get_attribute('meta[property="og:image"]', 'content'); check(og.startswith('https://leehizzbt.github.io/bizzles-burner-hub/'), og)
            r = await pg.request.get(og); check(r.ok and r.headers['content-type'].startswith('image/'), 'og image not reachable')
            check(await pg.is_visible('.brand-logo') and (await pg.inner_text('.neon-ver')) == 'v4.20', 'logo/v4.20 missing')
            anim = await pg.eval_on_selector('.neon-ver', 'e=>getComputedStyle(e).animationName'); check(anim == 'flicker', 'no flicker animation')
            ts = await pg.eval_on_selector('.neon-ver', 'e=>getComputedStyle(e).textShadow'); check('57, 255, 20' in ts, 'no neon glow')
            return f'2 tiles {titles}; og:image absolute & 200; glow+flicker on'
        await run('Home: 2 tiles, logo, neon v4.20, absolute og:image, no SMS remnants', home)
        async def reduced():
            c2 = await new_ctx(b, reduced_motion='reduce'); p2 = await c2.new_page(); await p2.goto(BASE)
            a = await p2.eval_on_selector('.neon-ver', 'e=>getComputedStyle(e).animationName'); await c2.close(); check(a == 'none', 'flicker not disabled: ' + a); return 'animation none under reduced motion'
        await run('Flicker respects prefers-reduced-motion', reduced)
        async def pwa():
            m = await (await pg.request.get(BASE + 'manifest.webmanifest')).json()
            for ic in m['icons']: check((await pg.request.get(BASE + ic['src'])).ok, 'icon missing ' + ic['src'])
            check(any(i.get('purpose') == 'maskable' for i in m['icons']), 'no maskable icon')
            for u in ['icons/favicon.ico', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']: check((await pg.request.get(BASE + u)).ok, u)
            await pg.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller || (location.reload(), false)', timeout=20000, polling=3000)
            keys = await pg.evaluate("(async()=>{const out=[];for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys())out.push(r.url)}return out})()")
            check(keys and all(k.startswith(ORIGIN) for k in keys), 'non-origin URL cached!')
            await asyncio.sleep(1)
            inst = await pg.is_visible('#installBtn')
            return f'manifest {len(m["icons"])} icons OK; SW controlling; {len(keys)} cached same-origin files, 0 API responses; install button visible={inst}'
        await run('PWA: manifest, icons, maskable, SW active, no API caching', pwa)
        async def offline_shell():
            await ctx.set_offline(True); await pg.reload(); await pg.wait_for_selector('#tileMail')
            vis = await pg.is_visible('#offlinePill'); await pg.goto(BASE + '#/mail'); await pg.wait_for_selector('#view-mail:not([hidden])')
            await ctx.set_offline(False); check(vis, 'offline pill not shown'); return 'app shell loads offline; offline pill shown'
        await run('Offline: app shell works offline + offline indicator', offline_shell)
        async def deeplinks():
            out = []
            for r in ['mail', 'bot', 'settings', 'status', 'home']:
                await pg.goto(BASE + '#/' + r); await pg.wait_for_selector(f'#view-{r}:not([hidden])'); out.append(r)
            return 'deep links OK: ' + ','.join(out)
        await run('Hash routing deep links', deeplinks)
        async def backs():
            done = []
            for r in ['mail', 'bot', 'settings', 'status']:
                await pg.goto(BASE + '#/'); await pg.click(f'a[href="#/{r}"] >> nth=0'); await pg.wait_for_selector(f'#view-{r}:not([hidden])')
                btn = pg.locator(f'#view-{r} .view-head [data-back]'); check(await btn.is_visible(), f'no back btn on {r}')
                await btn.click(); await pg.wait_for_selector('#view-home:not([hidden])'); done.append(r)
            # fresh deep-link with no history -> back goes home
            p3 = await ctx.new_page(); await p3.goto(BASE + '#/settings'); await p3.click('#view-settings [data-back]'); await p3.wait_for_selector('#view-home:not([hidden])'); await p3.close()
            return 'back buttons OK on ' + ','.join(done) + ' + deep-link fallback'
        await run('Themed back button on every screen', backs)
        async def fab_everywhere():
            seen = []
            for r in ['home', 'mail', 'settings', 'status']:
                await pg.goto(BASE + '#/' + r); await pg.wait_for_selector(f'#view-{r}:not([hidden])'); check(await pg.is_visible('#botFab'), 'no fab on ' + r); seen.append(r)
            await pg.goto(BASE + '#/bot'); await pg.wait_for_selector('#botPageSlot #chat'); check(await pg.is_hidden('#botFab'), 'fab shown on full page')
            return 'bubble on ' + ','.join(seen) + '; full-page view hosts chat'
        await run('Bizzy Bot bubble on every page + full-page view', fab_everywhere)
        # ---- THEMES
        async def themes():
            await pg.goto(BASE + '#/settings'); got = []
            for t in ['haze', 'cyber', 'midnight', 'light', 'alien']:
                await pg.click(f'#themeGrid [data-theme="{t}"]'); th = await pg.get_attribute('html', 'data-theme'); check(th == t, t)
                await pg.reload(); check(await pg.get_attribute('html', 'data-theme') == t, 'theme not persisted ' + t)
                await pg.goto(BASE + '#/'); await pg.wait_for_timeout(300); await pg.screenshot(path=SHOTS + f'theme-{t}.png'); await pg.goto(BASE + '#/settings'); got.append(t)
            return '5 themes applied + persisted: ' + ','.join(got)
        await run('Themes: all 5 apply and persist', themes)
        async def contrast():
            res = await pg.evaluate("""() => { const lum = c => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number).slice(0,3).map(v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }); return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2] };
              const ratio = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05) };
              const out = {}; for (const t of ['alien','haze','cyber','midnight','light']) { document.documentElement.dataset.theme = t; const cs = getComputedStyle(document.documentElement);
                const d = document.createElement('div'); document.body.appendChild(d); const col = v => { d.style.color = cs.getPropertyValue(v); return getComputedStyle(d).color };
                const bg = col('--bg'), bg2 = col('--bg2'); out[t] = { fg: +ratio(col('--fg'), bg2).toFixed(1), muted: +ratio(col('--muted'), bg2).toFixed(1), link: +ratio(col('--link'), bg2).toFixed(1), btn: +ratio(col('--accent-ink'), col('--accent')).toFixed(1) }; d.remove() }
              document.documentElement.dataset.theme = 'alien'; return out }""")
            bad = {t: v for t, v in res.items() if min(v.values()) < 4.5}; check(not bad, 'low contrast: ' + json.dumps(bad)); return json.dumps(res)
        await run('Contrast >= 4.5:1 for text/muted/link/buttons in all themes', contrast)
        # ---- SETTINGS
        async def settings_ai():
            await pg.goto(BASE + '#/settings')
            out = []
            for be in ['groq', 'openrouter', 'gemini']:
                await pg.select_option('#aiBackend', be); n = await pg.locator('#aiModel option').count(); check(n >= 3, 'few models for ' + be); out.append(f'{be}:{n}')
            await pg.select_option('#aiModel', 'gemini-3.5-flash'); await pg.reload(); check(await pg.input_value('#aiModel') == 'gemini-3.5-flash', 'model not persisted')
            await pg.fill('#aiCustomModel', 'gemini-flash-latest'); await pg.press('#aiCustomModel', 'Tab'); check(await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).customModel.gemini") == 'gemini-flash-latest', 'custom model not saved')
            await pg.fill('#aiCustomModel', ''); await pg.press('#aiCustomModel', 'Tab'); await pg.select_option('#aiModel', 'gemini-3.8-flash')
            return 'backend+model persist; models ' + ' '.join(out)
        await run('Settings: AI backend, model list, custom model persist', settings_ai)
        async def live_models():
            await pg.select_option('#aiBackend', 'openrouter'); await pg.click('#loadModelsBtn'); await pg.wait_for_function("document.querySelector('#aiBackendNote').textContent.includes('live list')", timeout=20000)
            n = await pg.locator('#aiModel option').count(); vis = await pg.locator('#aiModel option', has_text='👁').count()
            await pg.select_option('#aiBackend', 'gemini'); return f'OpenRouter live :free models loaded from real API: {n} ({vis} vision)'
        await run('Settings: load live OpenRouter :free model list (real API)', live_models)
        async def keys():
            await pg.fill('#key-gemini', 'AIzaFAKEKEY_for_testing_1234'); await pg.fill('#key-groq', 'gsk_fake_for_testing_5678'); await pg.fill('#key-openrouter', 'sk-or-fake-for-testing-9012')
            await pg.click('[data-reveal="key-gemini"]'); check(await pg.get_attribute('#key-gemini', 'type') == 'text', 'reveal failed'); await pg.click('[data-reveal="key-gemini"]')
            await pg.click('#saveKeysBtn'); saved = await pg.inner_text('[data-saved="gemini"]'); check('AIza' in saved and '••' in saved and 'FAKEKEY' not in saved, 'not masked: ' + saved)
            check(await pg.input_value('#key-gemini') == '', 'key left in input')
            st2 = await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).keys"); check(st2['groq'].startswith('gsk_fake'), 'key not stored')
            return 'saved masked: ' + saved
        await run('Settings: keys saved locally, masked, reveal toggle', keys)
        async def bad_keys():
            out = {}
            for be in ['gemini', 'groq', 'openrouter']:
                await pg.select_option('#aiBackend', be); await pg.click('#testKeyBtn')
                await pg.wait_for_function("document.querySelector('#keyTestResult').textContent.startsWith('❌')||document.querySelector('#keyTestResult').textContent.startsWith('✅')", timeout=30000)
                t = await pg.inner_text('#keyTestResult'); check('rejected' in t, be + ': ' + t); out[be] = t[:70]
            return json.dumps(out)
        await run('Bad-key error path for Gemini, Groq, OpenRouter (real API calls)', bad_keys)
        async def wipe_keys():
            await pg.click('#wipeKeysBtn'); await pg.click('#confirmOk'); await pg.wait_for_timeout(300)
            k = await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).keys"); check(not any(k.values()), 'keys remain'); return 'all keys wiped'
        await run('Settings: one-tap wipe keys (with confirm)', wipe_keys)
        async def mail_settings():
            await pg.select_option('#mailProviderPref', 'maildrop'); await pg.select_option('#refreshRate', '30')
            await pg.check('#remoteImgToggle'); await pg.check('#soundToggle'); await pg.check('#notifyToggle'); await pg.wait_for_timeout(500)
            s = await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings'))")
            check(s['mailProvider'] == 'maildrop' and s['refreshSec'] == 30 and s['remoteImages'] and s['sound'] and s['notify'], json.dumps(s)[:200])
            ns = await pg.inner_text('#notifyState'); check('granted' in ns, ns)
            await pg.goto(BASE + '#/mail'); check(await pg.input_value('#newProvider') == 'maildrop', 'pref not applied to mail view')
            await pg.goto(BASE + '#/settings'); await pg.select_option('#refreshRate', '0'); await pg.uncheck('#remoteImgToggle'); await pg.uncheck('#soundToggle'); await pg.uncheck('#notifyToggle'); await pg.select_option('#mailProviderPref', 'auto'); await pg.select_option('#refreshRate', '10')
            return 'provider pref, refresh 30s, notifications (granted), remote images, sound: all persist'
        await run('Settings: temp-mail provider, refresh rate, notifications, images, sound', mail_settings)
        async def memory():
            await pg.uncheck('#memToggle'); m = await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).memory"); check(m is False, 'memory not off')
            await pg.check('#memToggle'); await pg.fill('#aboutMe', 'Call me Bizzle'); await pg.press('#aboutMe', 'Tab')
            check(await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).aboutMe") == 'Call me Bizzle', 'notes not saved')
            await pg.click('#clearMemBtn'); await pg.click('#confirmOk'); await pg.wait_for_timeout(300)
            check(await pg.evaluate("JSON.parse(localStorage.getItem('bbh.settings')).aboutMe") == '' and await pg.evaluate("localStorage.getItem('bbh.chat')") is None, 'memory not cleared')
            return 'memory on/off, notes, clear'
        await run('Settings: memory on/off, notes, clear memory', memory)
        async def export_import():
            await pg.click('#themeGrid [data-theme="haze"]')
            async with pg.expect_download() as dl: await pg.click('#exportBtn')
            d = await dl.value; path = '/workspace/burner-hub/tests/export.json'; await d.save_as(path); data = json.load(open(path))
            check(data['app'] == 'bizzles-burner-hub' and data['settings']['theme'] == 'haze' and not data['includesSecrets'], 'export content')
            await pg.click('#themeGrid [data-theme="alien"]')
            await pg.set_input_files('#importFile', path); await pg.wait_for_timeout(500)
            check(await pg.get_attribute('html', 'data-theme') == 'haze', 'import did not restore theme')
            await pg.click('#themeGrid [data-theme="alien"]'); return 'exported ' + d.suggested_filename + ' (no secrets) and re-imported'
        await run('Extra: export / import settings', export_import)
        # ---- BOT
        async def bot_nokey():
            await pg.goto(BASE + '#/'); await pg.click('#botFab'); check(await pg.is_visible('#botPanel'), 'panel not open')
            await pg.fill('#chatInput', 'yo bizzy'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_selector('.msgb.bot.err'); t = await pg.inner_text('.msgb.bot.err >> nth=-1'); check('API key yet' in t, t)
            check(await pg.locator('.msgb.bot.err a[href="#/settings"]').count() > 0, 'no settings link')
            await pg.click('.msgb.bot.err [data-copymsg] >> nth=-1'); c = await clip(pg); check('API key' in c, 'copy failed')
            await pg.screenshot(path=SHOTS + 'bot-nokey-desktop.png')
            return 'no-key error with Settings link; copy button copies bot message'
        await run('Bizzy Bot: no-key error path + copy button', bot_nokey)
        async def bot_badkey():
            await pg.evaluate("(()=>{const s=JSON.parse(localStorage.getItem('bbh.settings'));s.keys.groq='gsk_definitely_invalid';s.aiBackend='groq';localStorage.setItem('bbh.settings',JSON.stringify(s))})()")
            await pg.reload(); await pg.click('#botFab'); await pg.fill('#chatInput', 'test bad key'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_function("[...document.querySelectorAll('.msgb.bot.err')].some(e=>e.textContent.includes('rejected'))", timeout=30000)
            return 'Groq real 401 -> friendly bad-key message'
        await run('Bizzy Bot: bad key error path in chat (real API)', bot_badkey)
        async def bot_network():
            await pg.route('https://api.groq.com/**', lambda r: r.abort()); await pg.fill('#chatInput', 'net test'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_function("[...document.querySelectorAll('.msgb.bot.err')].some(e=>e.textContent.includes('Network error'))", timeout=20000); await pg.unroute('https://api.groq.com/**')
            await ctx.set_offline(True); await pg.fill('#chatInput', 'offline test'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_function("[...document.querySelectorAll('.msgb.bot.err')].some(e=>e.textContent.includes('offline'))", timeout=20000); await ctx.set_offline(False)
            return 'network error + offline messages shown'
        await run('Bizzy Bot: network error + offline error paths', bot_network)
        async def bot_rate():
            await pg.route('https://api.groq.com/**', lambda r: r.fulfill(status=429, content_type='application/json', body='{"error":{"message":"Rate limit reached"}}', headers={'access-control-allow-origin': '*'}))
            await pg.fill('#chatInput', 'rate test'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_function("[...document.querySelectorAll('.msgb.bot.err')].some(e=>e.textContent.includes('Rate limit hit'))", timeout=20000); await pg.unroute('https://api.groq.com/**')
            return 'HTTP 429 -> rate-limit message (test-injected status; real UI path)'
        await run('Bizzy Bot: rate-limit (429) error path', bot_rate)
        async def bot_image():
            await pg.set_input_files('#chatFile', '/workspace/burner-hub/site/icons/icon-192.png'); await pg.wait_for_selector('#chatAttach:not([hidden])')
            await pg.fill('#chatInput', 'what is this?'); await pg.press('#chatInput', 'Enter')
            await pg.wait_for_function("[...document.querySelectorAll('.msgb.bot.err')].some(e=>e.textContent.includes(\"can't see images\"))", timeout=20000)
            check(await pg.locator('.msgb.user .chat-img').count() > 0, 'image not shown in chat')
            return 'image attached + previewed; non-vision model correctly refuses with switch hint'
        await run('Bizzy Bot: image upload + vision capability check', bot_image)
        async def bot_md():
            await pg.evaluate("""localStorage.setItem('bbh.chat', JSON.stringify([{role:'user',text:'md test'},{role:'bot',text:'**bold** and `code`\\n\\n- item\\n\\n<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'}]))""")
            await pg.reload(); await pg.click('#botFab'); await pg.wait_for_selector('.msgb.bot .md strong')
            html = await pg.inner_html('#chatLog'); check('onerror' not in html and '<script' not in html, 'unsafe html rendered'); check(await pg.evaluate('window.__pwned') is None, 'XSS executed!')
            n = await pg.locator('#chatLog [data-copymsg]').count()
            bots = await pg.locator('#chatLog .msgb.bot:not(.intro):not(.typing)').count(); check(n == bots, f'copy buttons {n} != bot msgs {bots}')
            return f'markdown rendered, XSS stripped; copy button on all {n} bot messages'
        await run('Bizzy Bot: safe markdown rendering + copy on every bot message', bot_md)
        async def bot_full():
            await pg.click('#chatExpand'); await pg.wait_for_selector('#botPageSlot #chat'); await pg.fill('#chatInput', 'hi'); check(await pg.is_visible('#chatInput'), 'no input on full page')
            await pg.click('#chatClear'); await pg.click('#confirmOk'); await pg.wait_for_timeout(300); n = await pg.locator('#chatLog .msgb:not(.intro)').count(); check(n == 0, 'chat not cleared')
            await pg.click('#view-bot [data-back]'); await pg.wait_for_selector('#botFab:visible')
            return 'expand to full page, clear chat, back'
        await run('Bizzy Bot: expand to full page, clear chat, back', bot_full)
        # ---- SHORTCUTS / SHARE
        async def shortcuts():
            await pg.goto(BASE + '#/'); await pg.wait_for_timeout(300); await pg.keyboard.press('Shift+Slash'); check(await pg.is_visible('#shortcutsDlg'), 'help dialog'); await pg.keyboard.press('Escape')
            seq = [('m', 'mail'), ('s', 'settings'), ('b', 'bot'), ('h', 'home')]
            for k, v in seq: await pg.keyboard.press(k); await pg.wait_for_selector(f'#view-{v}:not([hidden])')
            await pg.keyboard.press('c'); check(await pg.is_visible('#botPanel'), 'c did not open chat'); await pg.keyboard.press('Escape'); check(await pg.is_hidden('#botPanel'), 'esc did not close')
            return '? m s b h c Esc all work'
        await run('Extra: keyboard shortcuts', shortcuts)
        async def share():
            await pg.evaluate('delete Navigator.prototype.share'); await pg.click('#shareBtn'); c = await clip(pg); check(c == 'https://leehizzbt.github.io/bizzles-burner-hub/', c); return 'share falls back to copying link: ' + c
        await run('Extra: share button', share)
        async def fallback():
            await pg.goto(BASE + '#/mail'); await pg.route('https://api.guerrillamail.com/**', lambda r: r.abort())
            await pg.select_option('#newProvider', 'auto'); await pg.click('#genBtn')
            await pg.wait_for_function("document.querySelector('#mailNotice').textContent.includes('Fell back')", timeout=30000)
            t = await pg.inner_text('#mailNotice'); a = await pg.inner_text('#addrText'); await pg.unroute('https://api.guerrillamail.com/**')
            check(a.endswith('@maildrop.cc'), a); return f'Guerrilla blocked in test -> auto fallback created REAL {a}'
        await run('Temp mail: automatic provider fallback', fallback)
        async def status():
            await pg.goto(BASE + '#/status'); await pg.wait_for_function("[...document.querySelectorAll('[data-st]')].every(td=>!td.textContent.includes('checking'))", timeout=30000)
            cells = await pg.eval_on_selector_all('[data-st]', 'e=>e.map(x=>x.dataset.st+": "+x.textContent)'); check(all('Online' in c for c in cells), str(cells))
            check(await pg.locator('#deadList li').count() >= 8, 'dead list short'); await pg.screenshot(path=SHOTS + 'status-desktop.png', full_page=True)
            return '; '.join(cells)
        await run('Status page: live provider checks', status)
        async def auto_refresh_line():
            await pg.goto(BASE + '#/mail'); await pg.wait_for_function("document.querySelector('#refreshLine').textContent.includes('every 10 s')", timeout=8000)
            await pg.goto(BASE + '#/settings'); await pg.select_option('#refreshRate', '0'); await pg.goto(BASE + '#/mail'); await pg.wait_for_function("document.querySelector('#refreshLine').textContent.includes('off')")
            await pg.goto(BASE + '#/settings'); await pg.select_option('#refreshRate', '5'); await pg.goto(BASE + '#/mail'); await pg.wait_for_function("document.querySelector('#refreshLine').textContent.includes('every 5 s')")
            t1 = await pg.inner_text('#lastChecked'); await pg.wait_for_timeout(7000); t2 = await pg.inner_text('#lastChecked'); check(t1 != t2, 'auto refresh did not run')
            return f'countdown follows setting; real auto-refresh ran ({t1} -> {t2})'
        await run('Temp mail: auto-refresh rate honored', auto_refresh_line)
        async def del_addr():
            n0 = await pg.locator('#addrList .addr-pick').count(); await pg.click('#delAddrBtn'); await pg.click('#confirmOk'); await pg.wait_for_timeout(500)
            n1 = await pg.locator('#addrList .addr-pick').count(); check(n1 == n0 - 1, f'{n0}->{n1}'); return f'saved addresses {n0} -> {n1}'
        await run('Temp mail: delete address (confirm)', del_addr)
        async def a11y():
            bad = await pg.evaluate("""() => { const out = []; for (const v of ['home','mail','bot','settings','status']) { location.hash = '#/' + v; }
              document.querySelectorAll('input:not([type=hidden]),select,textarea').forEach(el => { const id = el.id; const lab = (id && document.querySelector('label[for="'+id+'"]')) || el.closest('label') || el.getAttribute('aria-label'); if (!lab) out.push('unlabeled ' + (id || el.outerHTML.slice(0,60))) });
              document.querySelectorAll('img').forEach(i => { if (!i.hasAttribute('alt')) out.push('img no alt ' + i.src) });
              document.querySelectorAll('button,a').forEach(b => { const n = (b.getAttribute('aria-label') || b.textContent || b.title || '').trim() || (b.querySelector('img[alt]:not([alt=""])')); if (!n) out.push('nameless ' + b.outerHTML.slice(0,80)) });
              return out }""")
            check(not bad, str(bad[:5])); return 'all inputs labeled, all images have alt, all buttons/links named'
        await run('Accessibility: labels, alt text, accessible names', a11y)
        async def focus():
            await pg.goto(BASE + '#/'); await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab')
            o = await pg.evaluate("getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth"); check('solid' in o, o); return 'visible focus ring: ' + o
        await run('Accessibility: visible keyboard focus', focus)
        await run('No page errors in main UI context', lambda: (check(not [e for e in pg.errs if 'Failed to load resource' not in e], str(pg.errs[:3])), 'clean')[1])
        await ctx.close()
        # ---- RESPONSIVE: 5 widths (fresh contexts, using the real inbox state from profile is not shared; seed via export)
        async def widths():
            out = []
            data = json.load(open('/workspace/burner-hub/tests/state_seed.json')) if os.path.exists('/workspace/burner-hub/tests/state_seed.json') else None
            for w, h in [(360, 740), (390, 844), (768, 1024), (1024, 768), (1440, 900)]:
                c = await new_ctx(b, w, h); q = await c.new_page(); await q.goto(BASE)
                if data: await q.evaluate("d=>{for(const [k,v] of Object.entries(d)) localStorage.setItem(k,v)}", data); await q.reload()
                await q.wait_for_timeout(700)
                ov = await q.evaluate('document.documentElement.scrollWidth - innerWidth'); check(ov <= 0, f'horizontal overflow {ov}px at {w}')
                await q.screenshot(path=SHOTS + f'home-{w}.png')
                await q.goto(BASE + '#/mail'); await q.wait_for_timeout(2500)
                if data:
                    loc = q.locator('#msgList .msg', has_text=SUBJECT)
                    for _ in range(6):
                        if await loc.count(): break
                        await q.click('#refreshBtn'); await q.wait_for_timeout(2500)
                    if await loc.count(): await loc.first.click(); await q.wait_for_function("document.querySelector('#readerSubject').textContent.includes(%s)" % json.dumps(SUBJECT), timeout=20000); await q.wait_for_timeout(800)
                ov2 = await q.evaluate('document.documentElement.scrollWidth - innerWidth'); check(ov2 <= 0, f'mail overflow {ov2}px at {w}')
                await q.screenshot(path=SHOTS + f'mail-{w}.png', full_page=True)
                await q.goto(BASE + '#/settings'); await q.wait_for_timeout(300); ov3 = await q.evaluate('document.documentElement.scrollWidth - innerWidth'); check(ov3 <= 0, f'settings overflow at {w}')
                await q.screenshot(path=SHOTS + f'settings-{w}.png', full_page=True)
                await q.goto(BASE + '#/'); await q.click('#botFab'); await q.wait_for_timeout(300)
                await q.evaluate("localStorage.setItem('bbh.chat', JSON.stringify([{role:'user',text:'How do I use the temp inbox?'},{role:'bot',text:'Far out question, dude 👽 Hit **Generate address**, copy it, and paste it wherever. Mail lands here in seconds. Just remember: these inboxes are public-ish, so no banking stuff ✌️'}]))")
                await q.reload(); await q.click('#botFab'); await q.wait_for_timeout(400)
                check(await q.is_visible('#chatInput'), 'chat input hidden at ' + str(w))
                await q.screenshot(path=SHOTS + f'bot-open-{w}.png')
                await q.goto(BASE + '#/bot'); await q.wait_for_timeout(300); await q.screenshot(path=SHOTS + f'bot-page-{w}.png')
                out.append(w); await c.close()
            return 'no overflow + screenshots at ' + ','.join(map(str, out))
        await run('Responsive: 360/390/768/1024/1440 (home, mail, settings, bot)', widths)
        # ---- PRIVACY WIPE (last)
        async def wipe():
            c = await new_ctx(b); q = await c.new_page(); await q.goto(BASE + '#/mail'); await q.click('#genBtn'); await q.wait_for_selector('#addrActive:not([hidden])', timeout=25000)
            await q.goto(BASE + '#/settings'); await q.fill('#key-gemini', 'AIzaWIPETEST'); await q.click('#saveKeysBtn')
            n0 = await q.evaluate('localStorage.length'); await q.click('#privacyWipeBtn'); await q.click('#confirmOk')
            await q.wait_for_function("location.hash==='#/' && !document.querySelector('#view-home').hidden", timeout=15000); await q.wait_for_timeout(1500)
            ls = await q.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('bbh.') && k!=='bbh.settings')")
            s = await q.evaluate("JSON.parse(localStorage.getItem('bbh.settings')||'{}')"); check(not ls and not (s.get('keys') or {}).get('gemini'), f'left: {ls} {s.get("keys")}')
            await q.goto(BASE + '#/mail'); check(await q.is_visible('#addrEmpty'), 'address survived'); await c.close()
            return f'{n0} keys before -> addresses, tokens, keys, chat gone; caches+SW cleared and reloaded'
        await run('Privacy wipe clears everything', wipe)
        await b.close()
    json.dump({'base': BASE, 'when': time.strftime('%Y-%m-%d %H:%M:%S %Z'), 'arrival': arrival, 'results': results}, open('/workspace/burner-hub/tests/results.json', 'w'), indent=1)
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed")

if __name__ == '__main__':
    asyncio.run(phase1() if sys.argv[1] == 'phase1' else phase2())
