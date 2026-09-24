import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { api, AuthenticationError } from '../src/lib/api.ts';
import worker from '../src/worker.ts';

afterEach(() => mock.restoreAll());

const unavailableEnv = {
  DB: { prepare() { throw new Error('Database unavailable'); } },
};

test('login callback returns to the app without depending on D1 or accepting external redirects', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/login?returnTo=https://evil.example', {
    headers: { 'Cf-Access-Authenticated-User-Email': 'user@example.com' },
  }), unavailableEnv);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('login without Access returns an actionable error to the app', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/login'), unavailableEnv);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/?authError=access_required');
});

test('unauthenticated sessions cannot reach D1', async () => {
  const response = await worker.fetch(new Request('https://app.example/api/session'), unavailableEnv);
  assert.equal(response.status, 401);
});

test('Access redirects and expired or denied sessions become authentication errors', async () => {
  for (const response of [
    { type: 'opaqueredirect', status: 0 },
    new Response(null, { status: 302 }),
    new Response(null, { status: 401 }),
    new Response(null, { status: 403 }),
  ]) {
    const fetchMock = mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(api.getSession(), AuthenticationError);
    fetchMock.mock.restore();
  }
});

test('server failures remain distinct from authentication failures', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('Database unavailable', { status: 500 }));
  await assert.rejects(api.getSession(), error =>
    !(error instanceof AuthenticationError) && error.message === 'Database unavailable');
});

test('session requests use same-origin cookies without caching or following Access redirects', async () => {
  const session = { user: { id: 'u1' }, profile: {}, tenant: {} };
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json(session));
  assert.deepEqual(await api.getSession(), session);
  const [path, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(path, '/api/session');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'manual');
});

test('login navigates through Access and logout still navigates when the API is offline', () => {
  const previousWindow = globalThis.window;
  const destinations = [];
  globalThis.window = { location: {
    assign: path => destinations.push(['assign', path]),
    replace: path => destinations.push(['replace', path]),
  } };
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
  try {
    api.login();
    api.logout();
    assert.deepEqual(destinations, [
      ['assign', '/api/login'],
      ['replace', '/cdn-cgi/access/logout'],
    ]);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
