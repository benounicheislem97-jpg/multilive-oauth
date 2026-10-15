const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

function harness(sharedFiles = new Map(), pages = []) {
  let handler;
  let exchanges = 0;
  let directoryCreated = false;
  const fakeFs = {
    mkdirSync() { directoryCreated = true; },
    writeFileSync(file, data) { assert.ok(directoryCreated); sharedFiles.set(file, data); },
    existsSync(file) { return sharedFiles.has(file); },
    readFileSync(file) { if (sharedFiles.has(file)) return sharedFiles.get(file); throw new Error('No local config'); }
  };
  const context = {
    require(name) {
      if (name === 'http') return { createServer(fn) { handler = fn; return { listen() {} }; } };
      if (name === 'fs') return fakeFs;
      return require(name);
    },
    process: { env: { RENDER: 'true', PUBLIC_BASE_URL: 'https://example.test', META_APP_ID: 'test-id', META_APP_SECRET: 'test-secret' } },
    __dirname: path.resolve(__dirname, '..'), URL, URLSearchParams, Buffer,
    setTimeout() { return { unref() {} }; }, console,
    async fetch(url) {
      if (String(url).includes('/me/accounts')) return { ok: true, async json() { return { data: pages }; } };
      exchanges++;
      await new Promise(resolve => setImmediate(resolve));
      return { ok: true, async json() { return { access_token: 'fake-test-token' }; } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  return {
    get exchanges() { return exchanges; },
    files: sharedFiles,
    async request(url, cookie = '', body) {
      const req = Readable.from(body === undefined ? [] : [body]);
      Object.assign(req, { url, method: body === undefined ? 'GET' : 'POST', headers: { cookie } });
      const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
      await handler(req, response);
      return response;
    }
  };
}

test('restart, prefetch, duplicate POST and refresh do not consume the code twice', async () => {
  const first = harness();
  const login = await first.request('/oauth/meta');
  const state = new URL(login.headers.Location).searchParams.get('state');
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const app = harness(first.files); // Render restarted during login.
  const callback = '/auth/meta/callback/?' + new URLSearchParams({ code: 'fresh-test-code', state });
  for (let i = 0; i < 2; i++) assert.equal((await app.request(callback, cookie)).status, 200);
  assert.equal(app.exchanges, 0); // GET never exchanges a code.
  const body = new URLSearchParams({ code: 'fresh-test-code', state }).toString();
  const replies = await Promise.all([app.request('/auth/meta/callback/', cookie, body), app.request('/auth/meta/callback/', cookie, body)]);
  assert.equal(app.exchanges, 1);
  assert.ok(replies.every(reply => reply.status === 303));
  const session = replies[0].headers['Set-Cookie'].split(';')[0];
  for (let i = 0; i < 2; i++) {
    const result = await app.request('/auth/meta/result/', session);
    assert.equal(result.status, 200);
    assert.match(result.body, /Facebook connecté/);
    assert.ok(!result.body.includes('fake-test-token'));
  }
  assert.equal(app.exchanges, 1);
});

test('missing cookie and forged or expired state never reach Meta', async () => {
  const app = harness();
  const login = await app.request('/oauth/meta');
  const state = new URL(login.headers.Location).searchParams.get('state');
  const body = new URLSearchParams({ code: 'test', state }).toString();
  assert.equal((await app.request('/auth/meta/callback/', '', body)).status, 400);
  const forged = '1.fake.invalid';
  assert.equal((await app.request('/auth/meta/callback/', 'meta_oauth_state=' + forged, new URLSearchParams({ code: 'test', state: forged }).toString())).status, 400);
  assert.equal(app.exchanges, 0);
});

test('Instagram requests only discovery permissions and reports real account connection', async () => {
  const app = harness(new Map(), [{ id: 'page1', name: 'Test Page', instagram_business_account: { id: 'ig1', username: 'testcreator' } }]);
  const login = await app.request('/oauth/instagram');
  const auth = new URL(login.headers.Location);
  assert.equal(auth.searchParams.get('scope'), 'public_profile,instagram_basic,pages_show_list,pages_read_engagement');
  const body = new URLSearchParams({ code: 'instagram-test-code', state: auth.searchParams.get('state') }).toString();
  const reply = await app.request('/auth/meta/callback/', login.headers['Set-Cookie'].split(';')[0], body);
  assert.equal(reply.headers.Location, '/instagram/accounts/');
  const session = reply.headers['Set-Cookie'].split(';')[0];
  const result = await app.request('/instagram/accounts/', session);
  assert.equal(result.status, 200);
  assert.match(result.body, /Instagram connecté/);
  assert.match(result.body, /@testcreator/);
  const status = JSON.parse((await app.request('/api/connections', session)).body);
  assert.equal(status.facebook, true);
  assert.equal(status.instagram[0].username, 'testcreator');
  assert.ok(!JSON.stringify(status).includes('fake-test-token'));
});

test('No Page never displays a false Instagram connection', async () => {
  const app = harness();
  const login = await app.request('/oauth/instagram');
  const state = new URL(login.headers.Location).searchParams.get('state');
  const reply = await app.request('/auth/meta/callback/', login.headers['Set-Cookie'].split(';')[0], new URLSearchParams({ code: 'empty-pages-test', state }).toString());
  const result = await app.request('/instagram/accounts/', reply.headers['Set-Cookie'].split(';')[0]);
  assert.match(result.body, /Compte Instagram introuvable/);
  assert.ok(!result.body.includes('✓ Instagram connecté'));
});

test('mobile OAuth returns a one-time verified connection handoff', async () => {
  const app = harness();
  const returnTo = 'multilive://auth/connected';
  const login = await app.request('/oauth/meta?return_to=' + encodeURIComponent(returnTo));
  const auth = new URL(login.headers.Location);
  const body = new URLSearchParams({ code: 'mobile-code', state: auth.searchParams.get('state') }).toString();
  const callback = await app.request('/auth/meta/callback/', login.headers['Set-Cookie'].split(';')[0], body);
  const result = await app.request(callback.headers.Location, callback.headers['Set-Cookie'].split(';')[0]);
  const match = result.body.match(/handoff=([^&"<]+)/);
  assert.ok(match);
  const exchange = await app.request('/api/mobile/exchange?code=' + decodeURIComponent(match[1]));
  assert.equal(exchange.status, 200);
  assert.equal(JSON.parse(exchange.body).connections.facebook, true);
  assert.equal((await app.request('/api/mobile/exchange?code=' + decodeURIComponent(match[1]))).status, 400);
});

test('PWA OAuth returns only to the hosted application', async () => {
  const app = harness();
  const clientId = 'test_client_12345678901234567890';
  const returnTo = 'https://example.test/auth/connected?client_id=' + clientId;
  const login = await app.request('/oauth/meta?return_to=' + encodeURIComponent(returnTo));
  const auth = new URL(login.headers.Location);
  const body = new URLSearchParams({ code: 'pwa-code', state: auth.searchParams.get('state') }).toString();
  const callback = await app.request('/auth/meta/callback/', login.headers['Set-Cookie'].split(';')[0], body);
  const result = await app.request(callback.headers.Location, callback.headers['Set-Cookie'].split(';')[0]);
  assert.match(result.body, /https:\/\/example\.test\/auth\/connected\?client_id=test_client_12345678901234567890(?:&|&amp;)handoff=/);
  const synced = await app.request('/api/mobile/status?client_id=' + clientId);
  assert.equal(synced.status, 200);
  assert.equal(JSON.parse(synced.body).connections.facebook, true);

  const rejected = await app.request('/oauth/meta?return_to=' + encodeURIComponent('https://evil.test/auth/connected'));
  const rejectedState = new URL(rejected.headers.Location).searchParams.get('state');
  assert.equal(rejectedState.split('.')[3], '');
});
