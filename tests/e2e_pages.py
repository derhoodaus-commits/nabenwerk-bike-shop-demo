"""End-to-end checks of the static GitHub Pages build (Playwright, Python, Chromium).

Builds with BASE_PATH=/nabenwerk-bike-shop-demo/ into a temp folder and serves it with a tiny
server that behaves like GitHub Pages for a project site:
  /repo -> 301 /repo/,  /dir/ -> dir/index.html,  /x -> x.html,  missing -> 404 with /repo/404.html,
  only GET/HEAD (anything else -> 405).
Usage:  python tests/e2e_pages.py            (set E2E_SHOTS=<folder> to save screenshots)
Checks at 390 px and 1440 px: every page loads, no console errors, no failed requests, all links,
navigation and buttons, cookie notice, booking + contact flows (no data sent: no POST at all),
styled 404 for unknown URLs, forms disabled without JavaScript.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
REPO = "nabenwerk-bike-shop-demo"
BASE_PATH = f"/{REPO}/"
SITE_URL = f"https://derhoodaus-commits.github.io/{REPO}"
PAGES = ["index", "services", "pricing", "about", "faq", "contact", "booking",
         "booking-confirmed", "legal-notice", "privacy"]
WIDTHS = {"phone": (390, 844), "desktop": (1440, 900)}
SHOTS = Path(os.environ["E2E_SHOTS"]) if os.environ.get("E2E_SHOTS") else None

failures: list[str] = []
passes: list[str] = []


def check(cond, msg):
    (passes if cond else failures).append(msg)
    print(("  OK   " if cond else "  FAIL ") + msg)


class PagesHandler(SimpleHTTPRequestHandler):
    """Mimics GitHub Pages' static file mapping for a project site."""

    def log_message(self, *args):
        pass

    def _resolve(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == f"/{REPO}":
            return "redirect", None
        if not path.startswith(BASE_PATH):
            return None, None
        rel = path[len(BASE_PATH):]
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        fs = Path(self.directory) / REPO / rel
        if fs.is_file():
            return "file", fs
        if not fs.suffix and fs.with_name(fs.name + ".html").is_file():
            return "file", fs.with_name(fs.name + ".html")
        return None, None

    def _serve(self, head):
        kind, fs = self._resolve()
        if kind == "redirect":
            self.send_response(301)
            self.send_header("Location", BASE_PATH)
            self.end_headers()
            return
        status = 200
        if kind is None:
            status, fs = 404, Path(self.directory) / REPO / "404.html"
        body = fs.read_bytes()
        self.send_response(status)
        self.send_header("Content-Type", self.guess_type(str(fs)))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def do_GET(self):
        self._serve(False)

    def do_HEAD(self):
        self._serve(True)

    def _not_allowed(self):
        self.send_response(405)
        self.end_headers()

    do_POST = do_PUT = do_DELETE = do_PATCH = _not_allowed


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nw-pages-e2e-"))
    out = tmp / REPO
    env = {**os.environ, "BASE_PATH": BASE_PATH, "SITE_URL": SITE_URL, "OUT_DIR": str(out), "MSYS_NO_PATHCONV": "1"}
    subprocess.run(["node", "build.mjs", "--pages"], cwd=ROOT, env=env, check=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(PagesHandler, directory=str(tmp)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        if SHOTS:
            SHOTS.mkdir(parents=True, exist_ok=True)
        run(origin)
    finally:
        server.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{len(passes)} checks passed, {len(failures)} failed")
    if failures:
        print("\n".join("- " + f for f in failures))
        sys.exit(1)


def watch(page, base):
    """Collects console errors, failed requests, HTTP errors and any non-GET request."""
    log = {"console": [], "failed": [], "http": [], "posts": []}
    page.on("console", lambda m: log["console"].append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: log["console"].append(str(e)))
    page.on("requestfailed", lambda r: log["failed"].append(f"{r.url} ({r.failure})"))
    page.on("request", lambda r: log["posts"].append(f"{r.method} {r.url}") if r.method not in ("GET", "HEAD") else None)

    def on_response(r):
        # The 404 document itself is expected when testing unknown URLs; everything else must be < 400.
        if r.status >= 400 and not (r.status == 404 and r.request.resource_type == "document"):
            log["http"].append(f"{r.status} {r.url}")
    page.on("response", on_response)
    return log


def clear(log):
    for v in log.values():
        v.clear()


def shot(page, name):
    if SHOTS:
        page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)


def find_open_day(page):
    """Fills #date with the next date (from the day after tomorrow) that has drop-off slots."""
    for offset in range(2, 30):
        iso = page.evaluate(f"""() => {{ const d = new Date(); d.setDate(d.getDate() + {offset});
            return d.toISOString().slice(0, 10); }}""")
        page.fill("#date", iso)
        page.locator("#date").dispatch_event("change")
        opts = page.eval_on_selector_all("#time option", "o => o.map(x => x.value).filter(Boolean)")
        if opts:
            return iso, opts
    return None, []


def run(origin):
    base = origin + BASE_PATH
    with sync_playwright() as p:
        browser = p.chromium.launch()

        for label, (w, h) in WIDTHS.items():
            ctx = browser.new_context(viewport={"width": w, "height": h}, locale="en-US")
            page = ctx.new_page()
            log = watch(page, base)

            # ---------- Every page ----------
            for name in PAGES:
                clear(log)
                url = base + ("" if name == "index" else f"{name}.html")
                if name == "booking-confirmed":
                    url += "?ref=NW-TEST23"
                resp = page.goto(url, wait_until="networkidle")
                check(resp.status == 200, f"[{label}] {name}: HTTP {resp.status}")
                check(page.evaluate("document.styleSheets.length > 0 && getComputedStyle(document.body).backgroundColor") == "rgb(243, 239, 230)",
                      f"[{label}] {name}: stylesheet applied")
                check("Demo project" in page.inner_text("footer"), f"[{label}] {name}: 'Demo project' visible in the footer")
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                check(overflow <= 0, f"[{label}] {name}: no horizontal scrolling ({overflow}px)")
                imgs = page.eval_on_selector_all("img", "els => els.map(e => { e.loading = 'eager'; return e.currentSrc || e.src; })")
                page.wait_for_load_state("networkidle")
                broken_imgs = page.eval_on_selector_all("img", "els => els.filter(e => !(e.complete && e.naturalWidth > 0)).map(e => e.src)")
                check(not broken_imgs, f"[{label}] {name}: all {len(imgs)} images load {broken_imgs[:2]}")
                check(not log["console"], f"[{label}] {name}: no console errors {log['console'][:2]}")
                check(not log["failed"] and not log["http"], f"[{label}] {name}: no failed requests {(log['failed'] + log['http'])[:2]}")
                shot(page, f"{name}-{label}")

            # ---------- Clean URL like GitHub Pages ----------
            resp = page.goto(base + "pricing", wait_until="networkidle")
            check(resp.status == 200 and page.locator("h1").count() == 1, f"[{label}] /pricing (no .html) serves the page")
            resp = page.goto(origin + "/" + REPO, wait_until="networkidle")
            check(page.url == base and resp.status == 200, f"[{label}] /{REPO} redirects to /{REPO}/")

            # ---------- 404 for unknown URLs (nested, so relative links would break) ----------
            for missing in ("does-not-exist", "some/deep/missing/page.html"):
                clear(log)
                resp = page.goto(base + missing, wait_until="networkidle")
                check(resp.status == 404, f"[{label}] 404 for /{missing}")
                check("chain came off" in page.inner_text("h1"), f"[{label}] 404 page content for /{missing}")
                styled = page.evaluate("""() => ({ bg: getComputedStyle(document.body).backgroundColor,
                    font: getComputedStyle(document.querySelector('h1')).fontFamily,
                    btn: getComputedStyle(document.querySelector('.btn-primary')).backgroundColor })""")
                check(styled["bg"] == "rgb(243, 239, 230)" and "Archivo" in styled["font"], f"[{label}] 404 page is styled {styled}")
                # Chromium logs the 404 status of the document itself; sub-resource errors are in log["http"].
                console = [m for m in log["console"] if "status of 404" not in m]
                check(not console and not log["failed"] and not log["http"],
                      f"[{label}] 404 /{missing}: no errors {(console + log['failed'] + log['http'])[:2]}")
                shot(page, f"404-{missing.replace('/', '_')}-{label}")
            page.click("main a.btn-primary")
            page.wait_for_load_state("networkidle")
            check(page.url == base, f"[{label}] 404 'Back to home' goes to {page.url}")

            # ---------- Cookie notice (fresh context, no stored choice) ----------
            clear(log)
            page.evaluate("localStorage.clear()")
            page.goto(base, wait_until="networkidle")
            banner = page.locator("#consent")
            check(banner.is_visible(), f"[{label}] cookie notice appears on first visit")
            page.click("[data-consent='necessary']")
            check(banner.is_hidden(), f"[{label}] cookie notice closes after a choice")
            page.reload(wait_until="networkidle")
            check(banner.is_hidden(), f"[{label}] cookie choice persists")
            page.click("footer [data-open-consent]")
            check(banner.is_visible(), f"[{label}] cookie settings reopen from the footer")
            page.click("[data-consent='all']")
            check(banner.is_hidden() and page.evaluate("document.documentElement.dataset.consent") == "all",
                  f"[{label}] 'Allow analytics' is applied")

            # ---------- Every link on every page ----------
            hrefs = set()
            for name in PAGES + ["404"]:
                page.goto(base + f"{name}.html", wait_until="domcontentloaded")
                hrefs.update(page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)"))
            internal = sorted(h for h in hrefs if h.startswith(origin))
            outside = [h for h in internal if not h.startswith(base)]
            broken = [f"{h} → {s}" for h in internal if (s := page.request.get(h).status) != 200]
            check(not outside, f"[{label}] all internal links stay under {BASE_PATH} {outside[:3]}")
            check(not broken, f"[{label}] all {len(internal)} internal links return 200 {broken[:3]}")

            # ---------- Clicking navigation, CTA and footer links ----------
            nav_labels = ["Services", "Pricing", "About", "FAQ", "Contact"]
            for text in nav_labels:
                page.goto(base, wait_until="networkidle")
                if label == "phone":
                    page.click(".nav-toggle")
                    check(page.locator("#site-nav").is_visible(), f"[{label}] menu opens before clicking {text}")
                page.click(f"#site-nav a:text-is('{text}')")
                page.wait_for_load_state("networkidle")
                check(page.url == base + text.lower() + ".html", f"[{label}] nav '{text}' → {page.url}")
            page.goto(base + "faq.html", wait_until="networkidle")
            if label == "phone":
                page.click(".nav-toggle")
                page.keyboard.press("Escape")
                check(page.locator("#site-nav").is_hidden(), f"[{label}] Escape closes the menu")
                page.click(".nav-toggle")
            page.click("#site-nav .nav-cta")
            page.wait_for_load_state("networkidle")
            check(page.url == base + "booking.html", f"[{label}] header CTA → booking")
            page.click(".brand")
            page.wait_for_load_state("networkidle")
            check(page.url == base, f"[{label}] logo → home ({page.url})")
            footer_links = page.eval_on_selector_all("footer a[href]", "els => els.map(e => e.getAttribute('href'))")
            for href in footer_links:
                if href.startswith(("tel:", "mailto:")):
                    continue
                page.goto(base, wait_until="networkidle")
                page.click(f"footer a[href='{href}']")
                page.wait_for_load_state("networkidle")
                check(page.url == origin + href and page.locator("h1").count() == 1, f"[{label}] footer link {href}")

            # ---------- Booking flow (static: nothing is sent) ----------
            clear(log)
            page.goto(base + "booking.html?service=repair", wait_until="networkidle")
            check(page.input_value("#service") == "repair", f"[{label}] service preselected via ?service=")
            check(page.locator("#booking-form button[type=submit]").is_enabled(), f"[{label}] submit enabled with JavaScript")
            check(page.locator("#booking-demo-note").is_visible(), f"[{label}] booking form shows the demo note")
            page.click("#booking-form button[type=submit]")
            check(page.locator(".error-summary").is_visible(), f"[{label}] empty booking shows the error summary")
            check(page.locator(".field-error:not(:empty)").count() >= 6, f"[{label}] field errors shown")
            sunday = page.evaluate("""() => { const d = new Date(); d.setDate(d.getDate() + 2);
                while (d.getDay() !== 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }""")
            page.fill("#date", sunday)
            page.locator("#date").dispatch_event("change")
            check(page.locator("#time").is_disabled(), f"[{label}] Sunday has no slots (client-side rules)")
            page.goto(base + "booking.html?service=repair", wait_until="networkidle")  # fresh form, no smooth scrolling in progress
            day, opts = find_open_day(page)
            check(bool(opts), f"[{label}] open day {day} has {len(opts)} slots")
            page.select_option("#time", opts[0])
            page.check("#bt-city")
            page.fill("#description", "Rear brake rubs.")
            page.fill("#name", "Test Customer")
            page.fill("#email", "test.customer@example.org")
            page.check("#privacy")
            page.click("#booking-form button[type=submit]")
            page.wait_for_url("**/booking-confirmed.html?ref=*")
            check("Test" not in page.url and "example.org" not in page.url, f"[{label}] no personal data in the URL ({page.url.split('?')[1]})")
            ref = page.inner_text("#booking-ref")
            check(ref.startswith("NW-") and len(ref) == 9, f"[{label}] confirmation shows booking number {ref}")
            check(page.locator("#demo-notice").is_visible() and "nothing was sent" in page.inner_text("#demo-notice"),
                  f"[{label}] confirmation says it's a demo and nothing was sent")
            check(page.locator("#booking-summary").is_visible() and page.inner_text("[data-summary=service]") == "Repair",
                  f"[{label}] confirmation shows the summary")
            check(not log["posts"], f"[{label}] booking sent no data (no POST) {log['posts'][:2]}")
            check(not log["console"] and not log["failed"] and not log["http"], f"[{label}] booking flow without errors")
            shot(page, f"booking-confirmed-demo-{label}")

            # ---------- Contact flow ----------
            clear(log)
            page.goto(base + "contact.html", wait_until="networkidle")
            page.click("#contact-form button[type=submit]")
            check(page.locator("#contact-form .error-summary").is_visible(), f"[{label}] empty contact form shows errors")
            page.goto(base + "contact.html", wait_until="networkidle")
            page.fill("#c-name", "Test Customer")
            page.fill("#c-email", "test@example.org")
            page.fill("#c-message", "Do you have time for a flat tire on Saturday?")
            page.check("#c-privacy")
            page.click("#contact-form button[type=submit]")
            page.wait_for_selector("#contact-done:not([hidden])")
            check("nothing was sent" in page.inner_text("#contact-done"), f"[{label}] contact confirmation says nothing was sent")
            check(not log["posts"], f"[{label}] contact sent no data (no POST) {log['posts'][:2]}")
            check(not log["console"] and not log["failed"] and not log["http"], f"[{label}] contact flow without errors")
            shot(page, f"contact-done-demo-{label}")
            ctx.close()

        # ---------- Without JavaScript: forms can't be submitted ----------
        nctx = browser.new_context(java_script_enabled=False)
        np_ = nctx.new_page()
        posts = []
        np_.on("request", lambda r: posts.append(r.url) if r.method != "GET" else None)
        for name, form in (("booking", "#booking-form"), ("contact", "#contact-form")):
            np_.goto(base + f"{name}.html")
            check(np_.locator(f"{form} button[type=submit]").is_disabled(), f"[no JS] {name}: submit button disabled")
            check(np_.locator("noscript").count() >= 1, f"[no JS] {name}: notice present")
            np_.locator(f"{form} input[type=email]").press("Enter")
            np_.wait_for_timeout(300)
        check(not posts, f"[no JS] pressing Enter sends nothing {posts[:2]}")
        nctx.close()
        browser.close()


if __name__ == "__main__":
    main()
