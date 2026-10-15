const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

function harness(sharedFiles = new Map()) {
  let handler;
  let exchanges = 0;
  let directoryCreated = false;
  const fakeFs = {
    mkdirSync() { directoryCreated = true; },
    writeFileSync(file, data) { assert.ok(directoryCreated); sharedFiles.set(file, data); },
    existsSync(file) { return sharedFiles.has(file); },
    readFileSync() { throw new Error('No local config'); }
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
    async fetch() {
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
