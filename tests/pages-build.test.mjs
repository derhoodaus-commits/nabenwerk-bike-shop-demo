// Static GitHub Pages build: builds with a sub-path into a temp folder and checks that every
// internal URL in the output resolves to an existing file under that prefix.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/nabenwerk-bike-shop-demo/';
const SITE = 'https://derhoodaus-commits.github.io/nabenwerk-bike-shop-demo';
let out, pages;

function build(args, env) {
  const r = spawnSync(process.execPath, ['build.mjs', ...args], {
    cwd: root,
    env: { ...process.env, MSYS_NO_PATHCONV: '1', ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}

const exists = async (p) => stat(p).then((s) => s.isFile(), () => false);

// How GitHub Pages maps a URL path to a file in the published folder
async function resolveUrl(urlPath) {
  assert.ok(urlPath.startsWith(BASE), `outside the base path: ${urlPath}`);
  let rel = decodeURIComponent(urlPath.slice(BASE.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.join(out, rel);
  if (await exists(file)) return file;
  if (!path.extname(rel) && (await exists(file + '.html'))) return file + '.html';
  return null;
}

function urlsIn(html) {
  const urls = [];
  for (const [, , u] of html.matchAll(/\s(href|src|action)="([^"]*)"/g)) urls.push(u);
  for (const [, set] of html.matchAll(/\ssrcset="([^"]*)"/g)) {
    for (const part of set.split(',')) urls.push(part.trim().split(/\s+/)[0]);
  }
  return urls;
}

before(async () => {
  out = await mkdtemp(path.join(tmpdir(), 'nw-pages-'));
  build(['--pages'], { BASE_PATH: BASE, SITE_URL: SITE, OUT_DIR: out });
  pages = {};
  for (const f of (await readdir(out)).filter((f) => f.endsWith('.html'))) {
    pages[f] = await readFile(path.join(out, f), 'utf8');
  }
});
after(() => rm(out, { recursive: true, force: true }));

test('static build: all 11 pages plus .nojekyll, sitemap and robots', async () => {
  assert.equal(Object.keys(pages).length, 11);
  for (const f of ['.nojekyll', 'sitemap.xml', 'robots.txt', '404.html', 'index.html']) {
    assert.ok(await exists(path.join(out, f)), f);
  }
});

test('static build: every internal href/src/srcset resolves to a file under the base path', async () => {
  let checked = 0;
  const problems = [];
  for (const [file, html] of Object.entries(pages)) {
    for (const u of urlsIn(html)) {
      if (/^(https?:|mailto:|tel:|data:|#)/.test(u)) continue;
      if (!u.startsWith('/')) {
        problems.push(`${file}: relative URL ${u}`);
        continue;
      }
      const target = u.split('#')[0].split('?')[0];
      if (!target.startsWith(BASE)) problems.push(`${file}: not under ${BASE}: ${u}`);
      else if (!(await resolveUrl(target))) problems.push(`${file}: broken ${u}`);
      checked++;
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(checked > 200, `only ${checked} URLs checked`);
});

test('static build: CSS url() and JS module imports resolve', async () => {
  const cssFile = path.join(out, 'assets/css/main.css');
  const css = await readFile(cssFile, 'utf8');
  const refs = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  assert.ok(refs.length >= 2);
  for (const u of refs) assert.ok(await exists(path.resolve(path.dirname(cssFile), u)), u);
  const jsDir = path.join(out, 'assets/js');
  for (const f of await readdir(jsDir)) {
    const js = await readFile(path.join(jsDir, f), 'utf8');
    for (const [, spec] of js.matchAll(/from\s+'(\.[^']+)'/g)) assert.ok(await exists(path.resolve(jsDir, spec)), `${f} → ${spec}`);
  }
});

test('static build: canonical, OG, JSON-LD, sitemap and robots use SITE_URL', async () => {
  for (const [file, html] of Object.entries(pages)) {
    const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
    assert.ok(canonical.startsWith(SITE + '/'), `${file}: ${canonical}`);
    assert.match(html, new RegExp(`property="og:image" content="${SITE}/assets/img/share\\.jpg"`));
    assert.doesNotMatch(html, /www\.nabenwerk\.example/, file);
  }
  assert.match(pages['index.html'], new RegExp(`"url":"${SITE}/"`));
  const sitemap = await readFile(path.join(out, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 7);
  for (const loc of locs) {
    assert.ok(loc.startsWith(SITE + '/'), loc);
    assert.ok(await resolveUrl(new URL(loc).pathname), loc);
  }
  const robots = await readFile(path.join(out, 'robots.txt'), 'utf8');
  assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap\\.xml`));
  assert.doesNotMatch(robots, /api/);
});

test('static build: forms never post anywhere and the pages say so', () => {
  for (const [file, html] of Object.entries(pages)) {
    assert.match(html, /<html lang="en" data-mode="static">/, file);
    assert.match(html, /Demo project/, `${file}: demo label`);
    assert.doesNotMatch(html, /api\//, `${file}: API reference`);
    for (const [form] of html.matchAll(/<form\b[^>]*>/g)) assert.doesNotMatch(form, /\saction=/, `${file}: ${form}`);
    for (const [btn] of html.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)) assert.match(btn, /disabled data-needs-js/, `${file}: ${btn}`);
  }
  assert.match(pages['booking-confirmed.html'], /nothing was sent/);
  assert.doesNotMatch(pages['booking-confirmed.html'], /on its way to your inbox/);
  assert.match(pages['contact.html'], /nothing was sent/);
  assert.match(pages['booking.html'], /Nothing is sent or stored/);
});

test('server build (default): relative links, forms post to the API, 404 page uses absolute paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nw-dist-'));
  try {
    build([], { OUT_DIR: dir, BASE_PATH: '', SITE_URL: '' });
    const booking = await readFile(path.join(dir, 'booking.html'), 'utf8');
    assert.match(booking, /action="api\/booking"/);
    assert.match(booking, /href="assets\/css\/main\.css\?v=/);
    assert.doesNotMatch(booking, /data-mode|Nothing is sent|disabled data-needs-js/);
    const confirmed = await readFile(path.join(dir, 'booking-confirmed.html'), 'utf8');
    assert.match(confirmed, /on its way to your inbox/);
    const notFound = await readFile(path.join(dir, '404.html'), 'utf8');
    assert.match(notFound, /href="\/assets\/css\/main\.css\?v=/);
    assert.match(notFound, /href="\/booking\.html"/);
    assert.ok(!(await exists(path.join(dir, '.nojekyll'))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
