# Nabenwerk Radservice – Small-Business Website with Online Booking

> **Demo project.** “Nabenwerk Radservice” is a fictional bike repair shop in Berlin. Prices, people, phone
> number and address are examples. Before creating it, a web search confirmed that no shop with this name
> exists in Berlin.

## Live demo (GitHub Pages)

<https://derhoodaus-commits.github.io/nabenwerk-bike-shop-demo/>

The live demo is a **fully static build**, so it differs from the server version in one way: **the forms
never send anything**. Booking and contact use the same validation as the server version (including the
Berlin holiday and drop-off rules from `validation.js`), entirely in the browser. A valid booking goes to the
normal confirmation page with a made-up booking number; the details for the summary are kept only in the
tab's `sessionStorage` (nothing personal in the URL). Every form and confirmation says clearly that this is a
demo and nothing was sent. Without JavaScript the submit buttons stay disabled, so nothing is posted anywhere.

Build it yourself (output in `dist-pages/`, ready for any static host, `.nojekyll` included):

```bash
# bash / CI   (in Git Bash on Windows, prefix with MSYS_NO_PATHCONV=1)
BASE_PATH=/nabenwerk-bike-shop-demo/ SITE_URL=https://derhoodaus-commits.github.io/nabenwerk-bike-shop-demo npm run build:pages

# PowerShell
$env:BASE_PATH="/nabenwerk-bike-shop-demo/"; $env:SITE_URL="https://derhoodaus-commits.github.io/nabenwerk-bike-shop-demo"; npm run build:pages
```

`BASE_PATH` (default `/`) is the sub-path the site lives under; all links, assets and the 404 page use it.
`SITE_URL` sets canonical, Open Graph, JSON-LD and `sitemap.xml` URLs. Deployment runs automatically on every
push to `main` via [`.github/workflows/pages.yml`](.github/workflows/pages.yml). Note: crawlers only read
`robots.txt` at the domain root, so on a project sub-path it is informational.

## What is it?

A complete, fast website for a local trade business: home, services, pricing, about, FAQ, contact,
**online booking with a confirmation page**, a cookie notice, and placeholders for the legal notice
(Impressum) and privacy policy. Plus a small server that accepts and validates bookings and contact requests.

## What problem does it solve?

Small shops lose customers when prices are unclear and appointments only work by phone. The site answers
the three questions repair customers have (What does it cost? When can I come in? Where is it?) and lets
them book a slot themselves in under a minute, on their phone too.

## Tech and decisions

| Area | Decision | Why |
|---|---|---|
| Stack | Plain HTML/CSS/JS + a custom mini build (`build.mjs`, ~150 lines) | Next.js is overkill for an 11-page site. This produces static files that run on any host, with no framework updates to chase. |
| Layout | Shared header/footer as partials; the build assembles the pages | Navigation and footer live in one place. |
| Build checks | The build fails on broken internal links, missing files, `<img>` without `alt`, ≠ 1 `<h1>`, or skipped heading levels | Quality is enforced on every build. |
| SEO | Per-page `title`/`description`/canonical/Open Graph, automatic `sitemap.xml` + `robots.txt`, JSON-LD (`BikeStore`, `FAQPage`), legal pages `noindex` | Basics for local search. Domain placeholder: `https://www.nabenwerk.example` (override with the `SITE_URL` environment variable). |
| Fonts | Archivo (variable width + weight) and IBM Plex Mono, **self-hosted** from the `@fontsource` npm packages (OFL) | No Google Fonts request (GDPR), only 2 font files. |
| Design | Warm paper white, ink, signal orange, pine green; prices as punched “workshop tickets”; monospace for numbers | A look that fits the trade, not a template. |
| Forms | One validation module (`src/assets/js/validation.js`) for browser **and** server | Same rules everywhere; the server doesn't trust the browser. |
| Booking rules | Drop-off Mon–Fri 9 am–4:30 pm, Sat 10 am–1 pm; Sundays and **Berlin public holidays** (incl. International Women's Day, Easter calculated) blocked; earliest tomorrow, at most 60 days ahead | Realistic rules for a repair shop. |
| Locale | US English copy, dates like “Thursday, March 12, 2026”, 12-hour times, prices like “€59”; the business itself stays in Berlin (Berlin time zone, Berlin holidays, German phone number) | Written for international clients while staying true to a Berlin shop. |
| Without JavaScript | Forms fall back to a classic POST; the server validates and redirects to the confirmation | Works even with JS blocked. |
| Spam | Honeypot field + simple rate limit (10 submissions per IP per 10 minutes) | No CAPTCHA needed. |
| Storage | `data/bookings.jsonl`, `data/messages.jsonl` | A file is enough for the demo. In production: send email or connect a calendar system (the spot is marked in `server.mjs`). |
| Cookie notice | Equal-weight buttons “Essential only” / “Allow analytics”, changeable anytime from the footer; choice stored in `localStorage`; `nw:consent` event as a hook for a future analytics tool | The site itself sets no cookies. |
| Server | Dependency-free `server.mjs`: gzip, cache headers, clean URLs (`/pricing`), custom 404 page, Content Security Policy, path traversal protection | Runs as-is on a small VPS. |
| Phone number | `030 23125 417` from the range the German Federal Network Agency (BNetzA) reserves for film/TV | Looks real, but rings nowhere. |
| Photos | 3 photos from Wikimedia Commons (CC0 or CC BY-SA 4.0), credited in the footer and legal notice, resized to WebP in 3 sizes (`srcset`) | Real photos instead of illustrations. Replace with the shop's own photos for a real client. |

## Pages

`/` (home), `/services`, `/pricing`, `/about`, `/faq`, `/contact`, `/booking`, `/booking-confirmed`,
`/legal-notice`, `/privacy`, plus a custom 404. Service links preselect the booking form via
`/booking?service=<id>` (`inspection-basic`, `inspection-full`, `repair`, `ebike`, `cargo-bike`, `estimate`).

## Getting started

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:4173>. `npm start` builds to `dist/` and starts the server. To use a different
port, set the `PORT` environment variable (see `.env.example`). No keys or credentials are needed.

Build only: `npm run build` (output in `dist/`, for `server.mjs`; the forms post to its `/api/*`). For a
static host without a server, use `npm run build:pages` (see “Live demo” above).

## Tests

```bash
npm test                # build + 31 unit/API/static-build tests (node:test)
npm run test:e2e        # 167 browser checks with Playwright (Python) + screenshots
npm run test:e2e:pages  # 251 browser checks of the static build under /nabenwerk-bike-shop-demo/
```

`test:e2e:pages` builds the static version into a temp folder and serves it with a small server that
behaves like GitHub Pages (`/x` → `x.html`, `404.html` for unknown paths, no POST), then checks every page at
390 px and 1440 px, all links and buttons, both forms (no request with data is ever sent), the cookie notice
and the styled 404 page for nested unknown URLs. Set `E2E_SHOTS=<folder>` to save screenshots.

`test:e2e` needs Python with the `playwright` package and Chromium installed
(`pip install playwright` and `python -m playwright install chromium`).

**What was tested (all passing):**

- Validation: Easter 2024–2027, all Berlin public holidays 2026, drop-off times per weekday, date limits
  (today, past, > 60 days, Sunday, holiday, invalid dates), Berlin time zone around midnight, US date and
  time formatting, email and phone formats, required fields, description required for repairs and estimates.
- Server/API: delivery with gzip and security headers, clean URLs for every page, 404, path traversal,
  valid and invalid booking (201/422), classic form submission (303) for booking and contact, English error
  page for invalid classic submissions, honeypot, broken JSON (400), wrong Content-Type (415), wrong
  method (405), oversized request (413).
- Browser (Chromium) at **390 px, 768 px and 1440 px** for all 11 pages: HTTP status, no horizontal
  scrolling, no console errors, tap targets ≥ 44 px on phones, WCAG AA contrast for every visible text
  (desktop). Plus a horizontal-overflow check for all pages at **320 px**.
- Flows: cookie notice (appears, saves, reopens), keyboard (skip link as first tab stop, visible focus
  ring), all 31 internal links (incl. anchors and parameters) return 200, all images have alt text and load,
  submitting an empty booking (error summary gets focus, errors at the fields, `aria-invalid`), live
  validation, Sunday without time slots, 12-hour time labels, successful booking through to the
  confirmation page incl. storage, tampered booking number, contact form incl. the `?sent=1` fallback,
  mobile menu (open, Escape, navigate).
- Load time (local, phone width, empty cache): home page **~150–170 KB** in 6–7 requests, `load` after
  ~20–55 ms.

Screenshots: folder [`screenshots/`](screenshots/) (every page as `-phone`, `-tablet`, `-desktop`, plus
`booking-error-desktop`, `booking-confirmed-success-desktop`, `cookie-banner-desktop`, `menu-open-phone`).

## What's not perfect / limitations

- The GitHub Pages demo sends nothing at all (see above).
- No real email is sent; bookings end up in `data/*.jsonl`. For production, connect email delivery (SMTP)
  or a calendar system.
- Double bookings of the same slot aren't prevented (no capacity planning). That's acceptable for a repair
  shop with drop-off times; for a hair salon or similar, slot occupancy would have to be checked.
- The legal notice (Impressum) and privacy policy are deliberately just outlines with placeholders, not
  legal advice. A German business needs real, legally reviewed texts (§ 5 DDG, GDPR) before going live.
- The photos are fitting stand-ins from Wikimedia Commons, not pictures of a real shop.
- The native date picker's format follows the visitor's browser language (the screenshots show
  `dd.mm.yyyy` because the test browser runs with a German system locale).
- No Lighthouse score was measured (Lighthouse isn't installed); page weight, request count and timings
  were measured directly in the browser instead.
