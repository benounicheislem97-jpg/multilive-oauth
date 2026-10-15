const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');
const os = require('os');

const PORT = Number(process.env.PORT || 4320);
const ROOT = __dirname;
const PRIVATE_DIR = process.env.RENDER ? path.join(os.tmpdir(), 'multilive-private') : path.resolve(ROOT, '../../work');
const CONFIG_FILE = path.join(PRIVATE_DIR, 'tiktok-oauth-config.json');
const TOKEN_FILE = path.join(PRIVATE_DIR, 'tiktok-oauth-tokens.json');
const META_CONFIG_FILE = path.join(PRIVATE_DIR, 'meta-oauth-config.json');
const META_TOKEN_FILE = path.join(PRIVATE_DIR, 'meta-oauth-tokens.json');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || `${PUBLIC_BASE_URL}/auth/tiktok/callback/`;
const META_REDIRECT_URI = `${PUBLIC_BASE_URL}/auth/meta/callback/`;
const pending = new Map();
const metaExchanges = new Map();
const mobileHandoffs = new Map();
const secureCookie = PUBLIC_BASE_URL.startsWith('https:') ? '; Secure' : '';

function signedValue(value, secret) {
  return `${value}.${crypto.createHmac('sha256', secret).update(value).digest('base64url')}`;
}

function validSignedValue(value, secret) {
  if (!value || !secret) return false;
  const split = value.lastIndexOf('.');
  if (split < 1) return false;
  const expected = Buffer.from(signedValue(value.slice(0, split), secret));
  const actual = Buffer.from(value);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function cookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map(part => part.trim().split('='))
    .filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#090b10;color:#fff;font-family:system-ui;padding:28px}.box{max-width:560px;margin:auto;background:#141821;border:1px solid #2c3340;border-radius:24px;padding:26px}h1{margin-top:0}label{display:block;margin:18px 0 7px;color:#b8c0cc;font-weight:700}input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #3a4351;background:#0b0e14;color:#fff}button,a.action{display:inline-block;margin-top:20px;padding:14px 18px;border:0;border-radius:13px;background:#25f4ee;color:#07090d;font-weight:900;text-decoration:none}.note{color:#929baa;line-height:1.55}.ok{color:#8fffb2}</style></head><body><main class="box">${body}</main></body></html>`;
}

function readConfig() {
  if (process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
    return { client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET };
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

function readMetaConfig() {
  if (process.env.META_APP_ID && process.env.META_APP_SECRET) {
    return { app_id: process.env.META_APP_ID, app_secret: process.env.META_APP_SECRET };
  }
  try { return JSON.parse(fs.readFileSync(META_CONFIG_FILE, 'utf8')); } catch { return null; }
}

function randomString(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url').slice(0, 64);
}

function safeMobileReturn(value) {
  if (!value) return '';
  try {
    const target = new URL(value);
    if (!['exp:', 'exps:', 'multilive:'].includes(target.protocol)) return '';
    if (!`${target.hostname}${target.pathname}`.endsWith('auth/connected')) return '';
    return target.toString();
  } catch { return ''; }
}

function mobileReturnFromState(state, secret) {
  if (!validSignedValue(state, secret)) return '';
  const encoded = state.split('.')[3];
  if (!encoded) return '';
  try { return safeMobileReturn(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return ''; }
}

function connectionStatus(tokens = {}) {
  return { facebook: Boolean(tokens.access_token), instagram: tokens.instagramAccounts || [], tiktok: false };
}

function issueMobileHandoff(returnTo, result) {
  const safeReturn = safeMobileReturn(returnTo);
  if (!safeReturn) return '';
  const code = randomString(32);
  mobileHandoffs.set(code, { result, expiresAt: Date.now() + 120000 });
  setTimeout(() => mobileHandoffs.delete(code), 120000).unref();
  const target = new URL(safeReturn);
  target.searchParams.set('handoff', code);
  return target.toString();
}

function mobileCompletionPage(title, message, returnTo, result) {
  const target = issueMobileHandoff(returnTo, result);
  if (!target) return page(title, message);
  const scriptTarget = JSON.stringify(target).replace(/</g, '\\u003c');
  return page(title, `${message}<a class="action" href="${escapeHtml(target)}">Retourner dans MultiLive</a><script>location.href=${scriptTarget}</script>`);
}

function metaSession(req) {
  const config = readMetaConfig();
  const sessionId = cookies(req).meta_session;
  if (!config || !validSignedValue(sessionId, config.app_secret)) return null;
  const file = path.join(PRIVATE_DIR, `meta-${sessionId.split('.')[0]}.json`);
  try { return { file, sessionId, tokens: JSON.parse(fs.readFileSync(file, 'utf8')), config }; } catch { return null; }
}

async function instagramAccounts(session, pageId) {
  const endpoint = new URL(`https://graph.facebook.com/v25.0/${pageId || 'me/accounts'}`);
  endpoint.search = new URLSearchParams({ fields: 'id,name,instagram_business_account{id,username}', limit: '100', appsecret_proof: crypto.createHmac('sha256', session.config.app_secret).update(session.tokens.access_token).digest('hex') });
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.tokens.access_token}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Impossible de vérifier Instagram.');
  const pages = pageId ? [data] : (data.data || []);
  const accounts = pages.filter(p => p.instagram_business_account).map(p => ({ pageId: p.id, pageName: p.name, id: p.instagram_business_account.id, username: p.instagram_business_account.username || '' }));
  return { accounts, pageCount: pages.length };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/mobile/exchange') {
    const code = url.searchParams.get('code');
    const handoff = mobileHandoffs.get(code);
    mobileHandoffs.delete(code);
    if (!handoff || handoff.expiresAt < Date.now()) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Retour expiré' }));
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(handoff.result));
  }

  if (req.method === 'GET' && url.pathname === '/api/connections') {
    const session = metaSession(req);
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ facebook: Boolean(session?.tokens.access_token), instagram: session?.tokens.instagramAccounts || [] }));
  }

  if (req.method === 'GET' && url.pathname === '/instagram/accounts/') {
    const session = metaSession(req);
    if (!session) { res.writeHead(303, { Location: '/oauth/instagram' }); return res.end(); }
    try {
      const pageId = url.searchParams.get('page_id') || session.tokens.instagramPageId;
      if (pageId && !/^\d{1,30}$/.test(pageId)) return send(res, 400, 'text/plain', 'Page invalide');
      const { accounts, pageCount } = await instagramAccounts(session, pageId);
      session.tokens.instagramAccounts = accounts;
      if (accounts.length && pageId) session.tokens.instagramPageId = pageId;
      fs.writeFileSync(session.file, JSON.stringify(session.tokens), { mode: 0o600 });
      const body = accounts.length
        ? `<h1 class="ok">✓ Instagram connecté</h1>${accounts.map(a => `<p><strong>${escapeHtml(a.username ? '@' + a.username : 'Compte Instagram')}</strong><br>Page Facebook : ${escapeHtml(a.pageName)}</p>`).join('')}<p class="note">Le compte est identifié. La diffusion en direct n’est pas encore activée.</p>`
        : `<h1>Compte Instagram introuvable</h1><p class="note">${pageCount ? 'Tes Pages Facebook sont visibles, mais aucun compte Instagram professionnel lié n’a été détecté.' : 'Aucune Page Facebook accessible n’a été détectée. Autorise la Page liée à ton compte Instagram.'}</p><p class="note">Pour cette connexion : utilise un compte Instagram Créateur ou Entreprise, lie-le à une Page Facebook que tu gères, puis reconnecte Instagram.</p><a class="action" href="/oauth/instagram">Reconnecter Instagram</a>`;
      const html = mobileCompletionPage('Connexion Instagram', body, session.tokens.mobileReturn, { platform: 'instagram', connections: connectionStatus(session.tokens) });
      return send(res, 200, 'text/html; charset=utf-8', session.tokens.mobileReturn ? html : page('Connexion Instagram', body + '<a class="action" href="/">Retour à MultiLive</a>'));
    } catch (error) {
      return send(res, 502, 'text/html; charset=utf-8', page('Autorisation Instagram', `<h1>Autorisation Instagram à compléter</h1><p class="note">${escapeHtml(error.message)}</p><a class="action" href="/oauth/instagram">Autoriser Instagram</a>`));
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return fs.readFile(path.join(ROOT, 'index.html'), (error, data) => {
      if (error) return send(res, 500, 'text/plain; charset=utf-8', 'Erreur');
      send(res, 200, 'text/html; charset=utf-8', data);
    });
  }

  if (req.method === 'GET' && url.pathname === '/setup') {
    const configured = Boolean(readConfig());
    return send(res, 200, 'text/html; charset=utf-8', page('Configuration TikTok', `
      <h1>Configuration TikTok</h1>
      <p class="note">Copiez le <b>Client key</b> et le <b>Client secret</b> depuis TikTok Developers → App details → Credentials. Ils restent uniquement sur ce PC.</p>
      ${configured ? '<p class="ok">✓ Des identifiants sont déjà enregistrés localement.</p>' : ''}
      <form method="post" action="/setup">
        <label>Client key</label><input name="client_key" required autocomplete="off">
        <label>Client secret</label><input name="client_secret" type="password" required autocomplete="off">
        <button type="submit">Enregistrer localement</button>
      </form>`));
  }

  if (req.method === 'GET' && url.pathname === '/setup/meta') {
    const configured = Boolean(readMetaConfig());
    return send(res, 200, 'text/html; charset=utf-8', page('Configuration Meta', `
      <h1>Configuration Facebook / Instagram</h1>
      <p class="note">Utilise uniquement l’identifiant et le secret de l’application Meta. Ne mets jamais ton mot de passe Facebook ou Instagram ici.</p>
      ${configured ? '<p class="ok">✓ Identifiants Meta déjà enregistrés sur ce PC.</p>' : ''}
      <form method="post" action="/setup/meta">
        <label>Identifiant de l’application Meta</label><input name="app_id" required autocomplete="off">
        <label>Secret de l’application Meta</label><input name="app_secret" type="password" required autocomplete="off">
        <button type="submit">Enregistrer localement</button>
      </form>`));
  }

  if (req.method === 'POST' && url.pathname === '/setup/meta') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    return req.on('end', () => {
      const values = querystring.parse(body);
      if (!values.app_id || !values.app_secret) return send(res, 400, 'text/plain; charset=utf-8', 'Champs manquants');
      fs.mkdirSync(PRIVATE_DIR, { recursive: true });
      fs.writeFileSync(META_CONFIG_FILE, JSON.stringify({ app_id: String(values.app_id).trim(), app_secret: String(values.app_secret).trim() }, null, 2), { mode: 0o600 });
      send(res, 200, 'text/html; charset=utf-8', page('Meta configuré', '<h1 class="ok">✓ Meta est configuré</h1><p class="note">Les identifiants restent uniquement sur ce PC.</p><a class="action" href="/oauth/meta">Connecter Facebook / Instagram</a>'));
    });
  }

  if (req.method === 'GET' && ['/oauth/meta', '/oauth/instagram'].includes(url.pathname)) {
    const config = readMetaConfig();
    if (!config) { res.writeHead(302, { Location: '/setup/meta' }); return res.end(); }
    const purpose = url.pathname === '/oauth/instagram' ? 'instagram' : 'facebook';
    const returnTo = safeMobileReturn(url.searchParams.get('return_to'));
    const returnPart = returnTo ? Buffer.from(returnTo).toString('base64url') : '';
    const state = signedValue(`${Date.now()}.${purpose}.${randomString(32)}.${returnPart}`, config.app_secret);
    const scope = purpose === 'instagram' ? 'public_profile,instagram_basic,pages_show_list,pages_read_engagement' : 'public_profile,email';
    const params = new URLSearchParams({ client_id: config.app_id, redirect_uri: META_REDIRECT_URI, state, response_type: 'code', scope });
    if (purpose === 'instagram') params.set('auth_type', 'rerequest');
    res.writeHead(302, {
      Location: `https://www.facebook.com/dialog/oauth?${params}`,
      'Cache-Control': 'no-store',
      'Set-Cookie': `meta_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly${secureCookie}; SameSite=Lax; Max-Age=600`
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/auth/meta/result/') {
    const config = readMetaConfig();
    const sessionId = cookies(req).meta_session;
    const valid = config && validSignedValue(sessionId, config.app_secret);
    const tokenPath = valid ? path.join(PRIVATE_DIR, `meta-${sessionId.split('.')[0]}.json`) : null;
    if (!valid || !fs.existsSync(tokenPath)) return send(res, 400, 'text/html; charset=utf-8', page('Connexion nécessaire', '<h1>Reconnecter Facebook</h1><a class="action" href="/oauth/meta">Connecter Facebook</a>'));
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    const message = '<h1 class="ok">✓ Facebook connecté</h1><p class="note">La connexion Facebook a réussi. Les autorisations Instagram et de diffusion en direct restent à configurer séparément.</p>';
    const html = mobileCompletionPage('Meta connecté', message, tokens.mobileReturn, { platform: 'facebook', connections: connectionStatus(tokens) });
    return send(res, 200, 'text/html; charset=utf-8', tokens.mobileReturn ? html : page('Meta connecté', message + '<a class="action" href="/">Retour à MultiLive</a>'));
  }

  if (['GET', 'POST'].includes(req.method) && url.pathname === '/auth/meta/callback/') {
    const error = url.searchParams.get('error');
    if (error) return send(res, 400, 'text/html; charset=utf-8', page('Connexion refusée', '<h1>Connexion refusée</h1><a class="action" href="/">Retour</a>'));
    let params = url.searchParams;
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16000) return send(res, 413, 'text/plain', 'Requête trop volumineuse');
      }
      params = new URLSearchParams(body);
    }
    const state = params.get('state');
    const code = params.get('code');
    const config = readMetaConfig();
    const cookieState = cookies(req).meta_oauth_state;
    const age = state ? Date.now() - Number(state.split('.')[0]) : Infinity;
    if (!code || !config || state !== cookieState || !validSignedValue(state, config.app_secret) || age < 0 || age > 600000) return send(res, 400, 'text/html; charset=utf-8', page('Erreur', '<h1>Demande expirée</h1><a class="action" href="/oauth/meta">Recommencer</a>'));
    if (req.method === 'GET') {
      res.setHeader('Referrer-Policy', 'no-referrer');
      // Reading/prefetching the callback never consumes Facebook's one-use code.
      return send(res, 200, 'text/html; charset=utf-8', page('Connexion Facebook', `<h1>Finalisation de la connexion…</h1><form method="post" action="/auth/meta/callback/"><input type="hidden" name="code" value="${escapeHtml(code)}"><input type="hidden" name="state" value="${escapeHtml(state)}"><noscript><button type="submit">Finaliser la connexion</button></noscript></form><script>document.querySelector('form').submit()</script>`));
    }
    const exchangeKey = crypto.createHash('sha256').update(state + ':' + code).digest('hex');
    try {
      if (!metaExchanges.has(exchangeKey)) {
        const exchange = (async () => {
          const tokenUrl = new URL('https://graph.facebook.com/oauth/access_token');
          tokenUrl.search = new URLSearchParams({ client_id: config.app_id, client_secret: config.app_secret, redirect_uri: META_REDIRECT_URI, code });
          const response = await fetch(tokenUrl);
          const tokens = await response.json();
          if (!response.ok || tokens.error || !tokens.access_token) throw new Error(tokens.error?.message || 'Échange de jeton impossible');
          fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
          tokens.mobileReturn = mobileReturnFromState(state, config.app_secret);
          const sessionId = randomString(32);
          fs.writeFileSync(path.join(PRIVATE_DIR, `meta-${sessionId}.json`), JSON.stringify(tokens), { mode: 0o600 });
          return signedValue(sessionId, config.app_secret);
        })();
        metaExchanges.set(exchangeKey, exchange);
        setTimeout(() => metaExchanges.delete(exchangeKey), 600000).unref();
      }
      const sessionId = await metaExchanges.get(exchangeKey);
      res.writeHead(303, {
        Location: state.split('.')[1] === 'instagram' ? '/instagram/accounts/' : '/auth/meta/result/',
        'Cache-Control': 'no-store',
        'Set-Cookie': `meta_session=${sessionId}; Path=/; HttpOnly${secureCookie}; SameSite=Lax; Max-Age=86400`
      });
      return res.end();
    } catch (exchangeError) {
      return send(res, 502, 'text/html; charset=utf-8', page('Erreur Meta', `<h1>Connexion incomplète</h1><p class="note">${escapeHtml(exchangeError.message)}</p><a class="action" href="/oauth/meta">Réessayer</a>`));
    }
  }

  if (req.method === 'POST' && url.pathname === '/setup') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    return req.on('end', () => {
      const values = querystring.parse(body);
      if (!values.client_key || !values.client_secret) return send(res, 400, 'text/plain; charset=utf-8', 'Champs manquants');
      fs.mkdirSync(PRIVATE_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ client_key: String(values.client_key).trim(), client_secret: String(values.client_secret).trim() }, null, 2), { mode: 0o600 });
      send(res, 200, 'text/html; charset=utf-8', page('TikTok configuré', '<h1 class="ok">TikTok est configuré</h1><p class="note">Les identifiants sont enregistrés uniquement sur ce PC.</p><a class="action" href="/oauth/tiktok">Connecter mon compte TikTok</a>'));
    });
  }

  if (req.method === 'GET' && url.pathname === '/oauth/tiktok') {
    const config = readConfig();
    if (!config) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
    const state = randomString(32);
    const verifier = randomString(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
    pending.set(state, { verifier, createdAt: Date.now(), returnTo: safeMobileReturn(url.searchParams.get('return_to')) });
    const params = new URLSearchParams({ client_key: config.client_key, response_type: 'code', scope: 'user.info.basic', redirect_uri: REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: 'S256' });
    res.writeHead(302, { Location: `https://www.tiktok.com/v2/auth/authorize/?${params}` });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/auth/tiktok/callback/') {
    const error = url.searchParams.get('error');
    if (error) return send(res, 400, 'text/html; charset=utf-8', page('Connexion refusée', `<h1>Connexion refusée</h1><p class="note">${error}</p><a class="action" href="/">Retour</a>`));
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const session = pending.get(state);
    pending.delete(state);
    if (!code || !session || Date.now() - session.createdAt > 10 * 60 * 1000) return send(res, 400, 'text/html; charset=utf-8', page('Erreur', '<h1>Demande expirée</h1><a class="action" href="/oauth/tiktok">Recommencer</a>'));
    const config = readConfig();
    try {
      const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }, body: new URLSearchParams({ client_key: config.client_key, client_secret: config.client_secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI, code_verifier: session.verifier }) });
      const tokens = await response.json();
      if (!response.ok || tokens.error) throw new Error(tokens.error_description || tokens.error || 'Échange de jeton impossible');
      fs.mkdirSync(PRIVATE_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      const message = '<h1 class="ok">✓ Compte TikTok connecté</h1><p class="note">L’autorisation est réelle et le mot de passe TikTok n’est jamais transmis à MultiLive.</p>';
      const html = mobileCompletionPage('TikTok connecté', message, session.returnTo, { platform: 'tiktok', connections: { facebook: false, instagram: [], tiktok: true } });
      return send(res, 200, 'text/html; charset=utf-8', session.returnTo ? html : page('TikTok connecté', message + '<a class="action" href="/">Retour à MultiLive</a>'));
    } catch (exchangeError) {
      return send(res, 502, 'text/html; charset=utf-8', page('Erreur TikTok', `<h1>Connexion incomplète</h1><p class="note">${exchangeError.message}</p><a class="action" href="/oauth/tiktok">Réessayer</a>`));
    }
  }

  send(res, 404, 'text/plain; charset=utf-8', 'Introuvable');
});

server.listen(PORT, '0.0.0.0', () => console.log(`http://127.0.0.1:${PORT}`));
