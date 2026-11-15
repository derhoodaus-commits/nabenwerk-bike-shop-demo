// Small dependency-free production server:
// - serves dist/ (gzip, cache headers, security headers)
// - accepts bookings and contact requests (JSON or classic form POST)
// - validates with the same module as the browser and stores to data/*.jsonl
import http from 'node:http';
import { readFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBooking, validateContact } from './src/assets/js/validation.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.xml', '.txt', '.json']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeRef = () =>
  'NW-' + Array.from({ length: 6 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

async function readBody(req, limit = 20_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw Object.assign(new Error('Invalid JSON'), { status: 400 });
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  throw Object.assign(new Error('Unsupported Content-Type'), { status: 415 });
}

function errorPage(errors, back) {
  const items = Object.values(errors).map((e) => `<li>${e.replace(/[<>&]/g, '')}</li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Please check your details</title><link rel="stylesheet" href="/assets/css/main.css"><main class="wrap narrow section"><h1>Please check your details</h1><ul>${items}</ul><p><a class="btn btn-primary" href="${back}">Back to the form</a></p></main></html>`;
}

export function createApp({ distDir = path.join(root, 'dist'), dataDir = path.join(root, 'data'), now = () => new Date() } = {}) {
  const hits = new Map(); // simple rate limit: 10 form submissions per IP per 10 minutes
  const limited = (ip) => {
    const t = Date.now();
    const list = (hits.get(ip) || []).filter((x) => t - x < 10 * 60_000);
    list.push(t);
    hits.set(ip, list);
    return list.length > 10;
  };

  async function store(file, record) {
    await mkdir(dataDir, { recursive: true });
    await appendFile(path.join(dataDir, file), JSON.stringify(record) + '\n');
  }

  async function handleForm(req, res, kind) {
    const wantsJson = (req.headers.accept || '').includes('application/json');
    if (limited(req.socket.remoteAddress)) return sendJson(res, 429, { error: 'Too many requests. Please wait a few minutes.' });
    let input;
    try {
      input = await readBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { error: err.message });
    }
    const isBot = typeof input.website === 'string' && input.website.trim() !== '';
    const { ok, errors, value } = kind === 'booking' ? validateBooking(input, now()) : validateContact(input);
    if (!ok) {
      if (wantsJson) return sendJson(res, 422, { errors });
      return send(res, 422, errorPage(errors, kind === 'booking' ? '/booking.html' : '/contact.html'), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    const ref = kind === 'booking' ? makeRef() : null;
    if (!isBot) {
      // In production, this is where the confirmation email would be sent (e.g. via SMTP or a mail service).
      await store(kind === 'booking' ? 'bookings.jsonl' : 'messages.jsonl', { ref, ...value, createdAt: now().toISOString() });
    }
    if (wantsJson) return sendJson(res, 201, kind === 'booking' ? { ref } : { ok: true });
    const location = kind === 'booking' ? `/booking-confirmed.html?ref=${ref}` : '/contact.html?sent=1';
    return send(res, 303, '', { Location: location });
  }

  async function serveStatic(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      return send(res, 400, 'Bad Request');
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (!path.extname(pathname)) pathname += '.html'; // clean URLs: /pricing → pricing.html
    const file = path.join(distDir, path.normalize(pathname));
    if (!file.startsWith(distDir)) return send(res, 403, 'Forbidden');
    let status = 200;
    let target = file;
    try {
      if (!(await stat(file)).isFile()) throw new Error();
    } catch {
      status = 404;
      target = path.join(distDir, '404.html');
    }
    const ext = path.extname(target);
    let body = await readFile(target);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : req.url.includes('?v=') || ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
      Vary: 'Accept-Encoding',
    };
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    if (req.method === 'HEAD') return send(res, status, undefined, headers);
    return send(res, status, body, headers);
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/booking' || url.pathname === '/api/contact') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Only POST is allowed' });
        return await handleForm(req, res, url.pathname === '/api/booking' ? 'booking' : 'contact');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
      return await serveStatic(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 4173;
  createApp().listen(port, () => console.log(`Nabenwerk running at http://localhost:${port}`));
}
