// Dependency-free mini build:
// - wraps every page from src/pages/*.html in the shared layout (head, navigation, footer)
// - copies assets and appends cache-busting hashes to CSS/JS
// - generates sitemap.xml and robots.txt
// - checks internal links, alt texts and heading hierarchy (the build fails on any problem)
//
// Two modes:
//   node build.mjs           → dist/        for server.mjs (forms POST to /api/*)
//   node build.mjs --pages   → dist-pages/  fully static, e.g. for GitHub Pages (forms never send data)
// Environment variables:
//   BASE_PATH  URL path the site lives under, e.g. /nabenwerk-bike-shop-demo/ (default: /)
//   SITE_URL   absolute site URL for canonical/OG/sitemap, no trailing slash (default: https://www.nabenwerk.example)
//   OUT_DIR    overrides the output folder (used by the tests)
import { readFile, writeFile, mkdir, readdir, cp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const PAGES_MODE = process.argv.includes('--pages');
const out = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, PAGES_MODE ? 'dist-pages' : 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://www.nabenwerk.example').replace(/\/+$/, '');
const BASE_PATH = normalizeBase(process.env.BASE_PATH);

function normalizeBase(b) {
  if (/^[a-z]:[\\/]/i.test(b || '') || /[\\:]/.test(b || '')) {
    // Git Bash on Windows rewrites "/x/" into "C:/Program Files/Git/x/"; use MSYS_NO_PATHCONV=1 there.
    console.error(`BASE_PATH looks like a file system path: "${b}". Expected something like /my-repo/.`);
    process.exit(1);
  }
  const trimmed = (b || '/').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

// Turns relative URLs (href, src, srcset, action) into absolute paths under BASE_PATH.
// Used for every page in --pages mode, and always for 404.html: the 404 page is served for
// arbitrary missing URLs (e.g. /a/b/c), so its links must not be relative to that URL.
function absolutize(html, base) {
  const fix = (u) => {
    if (!u || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u)) return u; // external, absolute, data:, mailto:, tel:, anchors
    if (/^index\.html(?=$|[?#])/.test(u)) return base + u.slice('index.html'.length);
    return base + u;
  };
  return html
    .replace(/(\s)(href|src|action)="([^"]*)"/g, (_, sp, attr, u) => `${sp}${attr}="${fix(u)}"`)
    .replace(/(\s)srcset="([^"]*)"/g, (_, sp, v) => {
      const list = v.split(',').map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/);
        return [fix(u), ...rest].join(' ');
      });
      return `${sp}srcset="${list.join(', ')}"`;
    });
}

// <!--static-->…<!--/static--> is only kept in the static build, <!--server-->…<!--/server--> only in the server build.
function applyModeBlocks(html) {
  const drop = PAGES_MODE ? 'server' : 'static';
  const keep = PAGES_MODE ? 'static' : 'server';
  return html
    .replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->`, 'g'), '')
    .replace(new RegExp(`<!--/?${keep}-->`, 'g'), '');
}

const NAV = [
  { href: 'services.html', label: 'Services', key: 'services' },
  { href: 'pricing.html', label: 'Pricing', key: 'pricing' },
  { href: 'about.html', label: 'About', key: 'about' },
  { href: 'faq.html', label: 'FAQ', key: 'faq' },
  { href: 'contact.html', label: 'Contact', key: 'contact' },
];

function parsePage(raw, file) {
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file}: meta block missing`);
  const meta = JSON.parse(m[1]);
  for (const k of ['title', 'description']) if (!meta[k]) throw new Error(`${file}: meta.${k} missing`);
  return { meta, body: raw.slice(m[0].length) };
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(src, 'assets'), path.join(out, 'assets'), { recursive: true });

  // Minify CSS, hashes for cache busting
  const cssPath = path.join(out, 'assets/css/main.css');
  const css = minifyCss(await readFile(cssPath, 'utf8'));
  await writeFile(cssPath, css);
  const versions = { css: hash(css) };
  for (const f of await readdir(path.join(out, 'assets/js'))) {
    versions[f] = hash(await readFile(path.join(out, 'assets/js', f)));
  }

  const [header, footer, head] = await Promise.all(
    ['header', 'footer', 'head'].map((p) => readFile(path.join(src, 'partials', `${p}.html`), 'utf8')),
  );

  const files = (await readdir(path.join(src, 'pages'))).filter((f) => f.endsWith('.html'));
  const pages = [];
  for (const file of files) {
    const { meta, body } = parsePage(await readFile(path.join(src, 'pages', file), 'utf8'), file);
    const urlPath = file === 'index.html' ? '/' : `/${file}`;
    const nav = NAV.map(
      (n) =>
        `<li><a href="${n.href}"${n.key === meta.nav ? ' aria-current="page"' : ''}>${n.label}</a></li>`,
    ).join('');
    const scripts = (meta.scripts || [])
      .map((s) => `<script type="module" src="assets/js/${s}?v=${versions[s]}"></script>`)
      .join('\n  ');
    const jsonLd = meta.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replaceAll('{{siteurl}}', SITE_URL)}</script>`
      : '';
    let html = head
      .replaceAll('{{title}}', meta.title)
      .replaceAll('{{description}}', meta.description)
      .replaceAll('{{canonical}}', SITE_URL + urlPath)
      .replaceAll('{{siteurl}}', SITE_URL)
      .replaceAll('{{mode}}', PAGES_MODE ? ' data-mode="static"' : '')
      .replaceAll('{{robots}}', meta.noindex ? 'noindex, follow' : 'index, follow')
      .replaceAll('{{cssv}}', versions.css)
      .replaceAll('{{mainv}}', versions['main.js'])
      .replaceAll('{{scripts}}', scripts)
      .replaceAll('{{jsonld}}', jsonLd)
      .replaceAll('{{bodyclass}}', meta.bodyClass || '') +
      header.replaceAll('{{nav}}', nav) +
      `<main id="main" tabindex="-1">\n${body}\n</main>\n` +
      footer.replaceAll('{{year}}', String(new Date().getFullYear()));
    html = applyModeBlocks(html);
    if (PAGES_MODE) {
      // Static hosting has no /api: the forms are handled entirely in the browser (see forms.js).
      // Without JavaScript the submit buttons stay disabled, so nothing is ever posted anywhere.
      html = html
        .replace(/(<form\b[^>]*?)\s+action="api\/[a-z]+"/g, '$1')
        .replace(/(<button\b[^>]*type="submit")>/g, '$1 disabled data-needs-js>');
    }
    // The quality checks below run on the relative version; the written file may be absolutized.
    const written = PAGES_MODE || file === '404.html' ? absolutize(html, BASE_PATH) : html;
    await writeFile(path.join(out, file), written);
    pages.push({ file, urlPath, meta, html });
  }

  // Sitemap + robots
  const today = new Date().toISOString().slice(0, 10);
  const indexable = pages.filter((p) => !p.meta.noindex).sort((a, b) => (b.meta.priority ?? 0.5) - (a.meta.priority ?? 0.5));
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    indexable
      .map((p) => `  <url><loc>${SITE_URL}${p.urlPath}</loc><lastmod>${today}</lastmod><priority>${(p.meta.priority ?? 0.5).toFixed(1)}</priority></url>`)
      .join('\n') +
    '\n</urlset>\n';
  await writeFile(path.join(out, 'sitemap.xml'), sitemap);
  await writeFile(
    path.join(out, 'robots.txt'),
    `User-agent: *\nAllow: /\n${PAGES_MODE ? '' : 'Disallow: /api/\n'}\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
  if (PAGES_MODE) await writeFile(path.join(out, '.nojekyll'), ''); // GitHub Pages: publish files as-is, no Jekyll

  // Quality checks
  const problems = [];
  const existing = new Set(pages.map((p) => p.file));
  for (const p of pages) {
    for (const [, href] of p.html.matchAll(/href="([^"]+)"/g)) {
      if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
      const target = href.split('#')[0].split('?')[0];
      if (!target) continue;
      if (target.endsWith('.html') && !existing.has(target)) problems.push(`${p.file}: broken link → ${href}`);
      if (target.startsWith('assets/')) {
        try { await stat(path.join(out, target)); } catch { problems.push(`${p.file}: missing file → ${href}`); }
      }
    }
    for (const [, srcAttr] of p.html.matchAll(/(?:src|srcset)="([^"\s]+)/g)) {
      const t = srcAttr.split('?')[0];
      if (t.startsWith('assets/')) {
        try { await stat(path.join(out, t)); } catch { problems.push(`${p.file}: missing file → ${t}`); }
      }
    }
    for (const [img] of p.html.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt="/.test(img)) problems.push(`${p.file}: <img> without alt → ${img.slice(0, 60)}`);
    }
    const h1 = (p.html.match(/<h1\b/g) || []).length;
    if (h1 !== 1) problems.push(`${p.file}: ${h1} × <h1> (expected exactly 1)`);
    let last = 1;
    for (const [, lvl] of p.html.matchAll(/<h([1-6])\b/g)) {
      const l = Number(lvl);
      if (l > last + 1) problems.push(`${p.file}: heading jumps from h${last} to h${l}`);
      last = l;
    }
  }
  if (problems.length) {
    console.error('Build check failed:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log(
    `Build ok${PAGES_MODE ? ' (static, for GitHub Pages)' : ''}: ${pages.length} pages, ` +
      `sitemap.xml with ${indexable.length} URLs, base path ${BASE_PATH} → ${path.relative(root, out) || out}`,
  );
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
