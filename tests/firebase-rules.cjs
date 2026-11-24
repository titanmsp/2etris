// Run against local Emulator Suite only (see README). No cloud credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

async function guest() {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function status(path, who, method = 'GET', value) {
  const url = new URL(`http://127.0.0.1:9000/sessions${path}.json`);
  url.searchParams.set('ns', 'demo-2etris-default-rtdb');
  if (who) url.searchParams.set('auth', who.idToken);
  const res = await fetch(url, { method, body: JSON.stringify(value) });
  return res.status;
}

test('room access, authenticated authorship and immutable history', async () => {
  const [host, visitor, third] = await Promise.all([guest(), guest(), guest()]);
  const room = '/' + randomBytes(4).toString('hex');
  const ev = who => ({ user: who.localId, time: { '.sv': 'timestamp' }, localTime: Date.now() });
  const init = { ...ev(host), t: 8, seed: 'smoke' };
  assert.equal(await status(room, host, 'PATCH', { 'members/host': host.localId, 'events/0': init }), 200);
  assert.equal(await status('', host), 401); // no room listing
  assert.equal(await status(room + '/events', null), 401);
  assert.equal(await status(room + '/events', visitor), 401);
  assert.equal(await status(room + '/members/guest', visitor, 'PUT', visitor.localId), 200);
  assert.equal(await status(room + '/events', visitor), 200);
  assert.equal(await status(room + '/members/guest', third, 'PUT', third.localId), 401);
  assert.equal(await status(room + '/events', third), 401);
  const claim = { ...ev(visitor), t: 9, player: 1 };
  assert.equal(await status(room + '/events/claim', visitor, 'PUT', claim), 200);
  assert.equal(await status(room + '/events/other', host, 'PUT', claim), 401);
  assert.equal(await status(room + '/events/claim', visitor, 'PUT', claim), 401);
  assert.equal(await status(room + '/events/claim', visitor, 'DELETE'), 401);
  assert.equal(await status(room + '/events/extra', third, 'PUT', { ...ev(third), t: 11, val: 2 }), 401);
  assert.equal(await status(room + '/events/level', host, 'PUT', { ...ev(host), t: 11, val: 99 }), 401);
});
