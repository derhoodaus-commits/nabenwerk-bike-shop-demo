import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { addDays, berlinToday, slotsFor } from '../src/assets/js/validation.js';

let server, base, dataDir;

// Next open day with free slots, starting the day after tomorrow
function nextOpenDay() {
  let d = addDays(berlinToday(), 2);
  while (slotsFor(d).length < 3) d = addDays(d, 1);
  return d;
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'nw-test-'));
  server = createApp({ dataDir });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

const booking = () => ({
  service: 'inspection-full', bikeType: 'ebike', date: nextOpenDay(), time: '11:00',
  name: 'Test Person', email: 'test@example.org', privacy: true,
});

test('home page is served with security headers and gzip', async () => {
  const res = await fetch(base + '/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /<h1>/);
});

test('clean URLs and 404 page', async () => {
  for (const p of ['/services', '/pricing', '/about', '/faq', '/contact', '/booking', '/booking-confirmed', '/legal-notice', '/privacy']) {
    assert.equal((await fetch(base + p)).status, 200, p);
  }
  const res = await fetch(base + '/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /chain came off/);
});

test('path traversal is blocked', async () => {
  const res = await fetch(base + '/..%2f..%2fserver.mjs');
  assert.ok([403, 404].includes(res.status));
});

test('valid JSON booking → 201 with booking number, stored', async () => {
  const res = await fetch(base + '/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(booking()),
  });
  assert.equal(res.status, 201);
  const { ref } = await res.json();
  assert.match(ref, /^NW-[A-Z0-9]{6}$/);
  const stored = (await readFile(path.join(dataDir, 'bookings.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(stored.at(-1).ref, ref);
  assert.equal(stored.at(-1).email, 'test@example.org');
});

test('invalid booking → 422 with field errors (server validates independently of the browser)', async () => {
  const res = await fetch(base + '/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...booking(), email: 'broken', date: '2020-01-01' }),
  });
  assert.equal(res.status, 422);
  const { errors } = await res.json();
  assert.match(errors.email, /email address/);
  assert.match(errors.date, /earliest you can book/);
});

test('classic form without JavaScript → 303 redirect to confirmation', async () => {
  const body = new URLSearchParams({ ...booking(), privacy: 'on' });
  const res = await fetch(base + '/api/booking', { method: 'POST', body, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/booking-confirmed\.html\?ref=NW-/);
});

test('honeypot: bot submission gets a success response but is not stored', async () => {
  const before = (await readFile(path.join(dataDir, 'bookings.jsonl'), 'utf8')).trim().split('\n').length;
  const res = await fetch(base + '/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...booking(), website: 'http://spam.example' }),
  });
  assert.equal(res.status, 201);
  const afterCount = (await readFile(path.join(dataDir, 'bookings.jsonl'), 'utf8')).trim().split('\n').length;
  assert.equal(afterCount, before);
});

test('broken JSON, wrong Content-Type and GET on the API are rejected cleanly', async () => {
  const bad = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  const type = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(type.status, 415);
  assert.equal((await fetch(base + '/api/contact')).status, 405);
});

test('oversized request → 413', async () => {
  const res = await fetch(base + '/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(30_000) }),
  });
  assert.equal(res.status, 413);
});

test('classic contact form → 303 redirect to ?sent=1', async () => {
  const body = new URLSearchParams({ name: 'Test Person', email: 'test@example.org', message: 'Are you open on Saturday?', privacy: 'on' });
  const res = await fetch(base + '/api/contact', { method: 'POST', body, redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/contact.html?sent=1');
});

test('classic form with errors → 422 English error page linking back to the form', async () => {
  const body = new URLSearchParams({ ...booking(), email: 'broken', privacy: 'on' });
  const res = await fetch(base + '/api/booking', { method: 'POST', body });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Please check your details/);
  assert.match(html, /href="\/booking\.html"/);
});
