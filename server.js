const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const PORT = Number(process.env.PORT || 4320);
const ROOT = __dirname;
const PRIVATE_DIR = path.resolve(ROOT, '../../work');
const CONFIG_FILE = path.join(PRIVATE_DIR, 'tiktok-oauth-config.json');
const TOKEN_FILE = path.join(PRIVATE_DIR, 'tiktok-oauth-tokens.json');
const META_CONFIG_FILE = path.join(PRIVATE_DIR, 'meta-oauth-config.json');
const META_TOKEN_FILE = path.join(PRIVATE_DIR, 'meta-oauth-tokens.json');
const REDIRECT_URI = `http://127.0.0.1:${PORT}/auth/tiktok/callback/`;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const META_REDIRECT_URI = `${PUBLIC_BASE_URL}/auth/meta/callback/`;
const pending = new Map();

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#090b10;color:#fff;font-family:system-ui;padding:28px}.box{max-width:560px;margin:auto;background:#141821;border:1px solid #2c3340;border-radius:24px;padding:26px}h1{margin-top:0}label{display:block;margin:18px 0 7px;color:#b8c0cc;font-weight:700}input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #3a4351;background:#0b0e14;color:#fff}button,a.action{display:inline-block;margin-top:20px;padding:14px 18px;border:0;border-radius:13px;background:#25f4ee;color:#07090d;font-weight:900;text-decoration:none}.note{color:#929baa;line-height:1.55}.ok{color:#8fffb2}</style></head><body><main class="box">${body}</main></body></html>`;
}

function readConfig() {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

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

  if (req.method === 'GET' && url.pathname === '/oauth/meta') {
    const config = readMetaConfig();
    if (!config) { res.writeHead(302, { Location: '/setup/meta' }); return res.end(); }
    const state = randomString(32);
    pending.set(`meta:${state}`, { createdAt: Date.now() });
    const params = new URLSearchParams({ client_id: config.app_id, redirect_uri: META_REDIRECT_URI, state, response_type: 'code', scope: 'public_profile,email' });
    res.writeHead(302, { Location: `https://www.facebook.com/dialog/oauth?${params}` });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/auth/meta/callback/') {
    const error = url.searchParams.get('error');
    if (error) return send(res, 400, 'text/html; charset=utf-8', page('Connexion refusée', `<h1>Connexion refusée</h1><p class="note">${error}</p><a class="action" href="/">Retour</a>`));
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const session = pending.get(`meta:${state}`);
    pending.delete(`meta:${state}`);
    if (!code || !session || Date.now() - session.createdAt > 10 * 60 * 1000) return send(res, 400, 'text/html; charset=utf-8', page('Erreur', '<h1>Demande expirée</h1><a class="action" href="/oauth/meta">Recommencer</a>'));
    const config = readMetaConfig();
    try {
      const tokenUrl = new URL('https://graph.facebook.com/oauth/access_token');
      tokenUrl.search = new URLSearchParams({ client_id: config.app_id, client_secret: config.app_secret, redirect_uri: META_REDIRECT_URI, code });
      const response = await fetch(tokenUrl);
      const tokens = await response.json();
      if (!response.ok || tokens.error) throw new Error(tokens.error?.message || 'Échange de jeton impossible');
      fs.writeFileSync(META_TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      return send(res, 200, 'text/html; charset=utf-8', page('Meta connecté', '<h1 class="ok">✓ Facebook connecté</h1><p class="note">L’autorisation Meta est enregistrée localement. Instagram sera disponible si le compte est professionnel et relié à une Page Facebook.</p><a class="action" href="/">Retour à MultiLive</a>'));
    } catch (exchangeError) {
      return send(res, 502, 'text/html; charset=utf-8', page('Erreur Meta', `<h1>Connexion incomplète</h1><p class="note">${exchangeError.message}</p><a class="action" href="/oauth/meta">Réessayer</a>`));
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
    pending.set(state, { verifier, createdAt: Date.now() });
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
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      return send(res, 200, 'text/html; charset=utf-8', page('TikTok connecté', '<h1 class="ok">✓ Compte TikTok connecté</h1><p class="note">L’autorisation est réelle et les jetons restent sur ce PC.</p><a class="action" href="/">Retour à MultiLive</a>'));
    } catch (exchangeError) {
      return send(res, 502, 'text/html; charset=utf-8', page('Erreur TikTok', `<h1>Connexion incomplète</h1><p class="note">${exchangeError.message}</p><a class="action" href="/oauth/tiktok">Réessayer</a>`));
    }
  }

  send(res, 404, 'text/plain; charset=utf-8', 'Introuvable');
});

server.listen(PORT, '0.0.0.0', () => console.log(`http://127.0.0.1:${PORT}`));
