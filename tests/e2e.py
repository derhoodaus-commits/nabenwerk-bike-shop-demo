"""End-to-end checks with Playwright (Python, Chromium).

Starts its own server, checks every page at three widths (plus overflow at 320 px) and writes
screenshots to screenshots/.
Usage:  python tests/e2e.py
Checks: console errors, horizontal scrolling, links, alt texts, contrast, keyboard use,
menu, cookie notice, booking (error + success), contact form, load time.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(exist_ok=True)
PAGES = ["index", "services", "pricing", "about", "faq", "contact", "booking",
         "booking-confirmed", "legal-notice", "privacy", "404"]
WIDTHS = {"phone": (390, 844), "tablet": (768, 1024), "desktop": (1440, 900)}
SMALL_PHONE = (320, 640)


def shot_name(page):
    return "home" if page == "index" else page

failures: list[str] = []
passes: list[str] = []


def check(cond, msg):
    (passes if cond else failures).append(msg)
    print(("  OK   " if cond else "  FAIL ") + msg)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


CONTRAST_JS = r"""
() => {
  const lum = (c) => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const parse = (s) => { const m = s.match(/[\d.]+/g); if (!m) return null; const v = m.map(Number);
    if (s.startsWith('color(srgb')) { return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; } return v; };
  const bgOf = (el) => {
    while (el) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c && (c.length < 4 || c[3] > .5)) return c.slice(0, 3);
      el = el.parentElement;
    }
    return [255, 255, 255];
  };
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || el.closest('[hidden],.visually-hidden,.hp')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(st.color).slice(0, 3), bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(st.fontSize), bold = parseInt(st.fontWeight) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio < need) bad.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)} < ${need}`);
  }
  return bad;
}
"""


def main():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "PORT": str(port)}
    data_dir = ROOT / "data"
    subprocess.run(["node", "build.mjs"], cwd=ROOT, check=True)
    server = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        run(base)
    finally:
        server.terminate()
        # Don't leave test bookings in the project
        for f in ("bookings.jsonl", "messages.jsonl"):
            (data_dir / f).unlink(missing_ok=True)
        if data_dir.exists() and not any(data_dir.iterdir()):
            data_dir.rmdir()
    print(f"\n{len(passes)} checks passed, {len(failures)} failed")
    if failures:
        print("\n".join("- " + f for f in failures))
        sys.exit(1)


def run(base):
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- Every page at three widths ----------
        for label, (w, h) in WIDTHS.items():
            ctx = browser.new_context(viewport={"width": w, "height": h}, locale="en-US")
            ctx.add_init_script("try{localStorage.setItem('nw-consent-v1','necessary')}catch(e){}")
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            for name in PAGES:
                url = f"{base}/{name}.html" + ("?ref=NW-TEST23" if name == "booking-confirmed" else "")
                errors.clear()
                resp = page.goto(url, wait_until="networkidle")
                expected = 404 if name == "404" else 200
                if name != "404":
                    check(resp.status == expected, f"[{label}] {name}: HTTP {resp.status}")
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                check(overflow <= 0, f"[{label}] {name}: no horizontal scrolling (overflow {overflow}px)")
                check(not errors, f"[{label}] {name}: no console errors {errors[:2]}")
                if label == "desktop":
                    bad = page.evaluate(CONTRAST_JS)
                    check(not bad, f"[{label}] {name}: contrast ok {bad[:3]}")
                if label == "phone":
                    small = page.evaluate("""() => [...document.querySelectorAll('a.btn, button, .site-nav a, .footer-links a, input[type=checkbox], input[type=radio], select')]
                      .filter(e => e.offsetParent && !e.closest('.hp,[hidden]'))
                      .filter(e => { const r = e.getBoundingClientRect(); const t = e.type === 'checkbox' || e.type === 'radio'; return t ? false : r.height < 44; })
                      .map(e => e.textContent.trim().slice(0, 25) || e.name)""")
                    check(not small, f"[{label}] {name}: tap targets ≥ 44px {small[:3]}")
                page.screenshot(path=str(SHOTS / f"{shot_name(name)}-{label}.png"), full_page=True)
            ctx.close()

        # ---------- Narrowest phones: overflow only ----------
        sctx = browser.new_context(viewport={"width": SMALL_PHONE[0], "height": SMALL_PHONE[1]}, locale="en-US")
        sctx.add_init_script("try{localStorage.setItem('nw-consent-v1','necessary')}catch(e){}")
        sp = sctx.new_page()
        for name in PAGES:
            sp.goto(f"{base}/{name}.html" + ("?ref=NW-TEST23" if name == "booking-confirmed" else ""), wait_until="networkidle")
            overflow = sp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(overflow <= 0, f"[320px] {name}: no horizontal scrolling (overflow {overflow}px)")
        sctx.close()

        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="en-US")
        page = ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)

        # ---------- Cookie notice ----------
        page.goto(base + "/")
        banner = page.locator("#consent")
        check(banner.is_visible(), "Cookie notice appears on first visit")
        page.wait_for_timeout(900)
        page.screenshot(path=str(SHOTS / "cookie-banner-desktop.png"))
        page.click("[data-consent='necessary']")
        check(banner.is_hidden(), "Cookie notice closes after a choice")
        page.reload()
        check(banner.is_hidden(), "Cookie choice persists after reload")
        page.click("footer [data-open-consent]")
        check(banner.is_visible(), "Cookie settings can be reopened from the footer")
        page.click("[data-consent='all']")
        check(page.evaluate("document.documentElement.dataset.consent") == "all", "Consent 'analytics' is applied")

        # ---------- Keyboard ----------
        page.goto(base + "/")
        page.keyboard.press("Tab")
        check(page.evaluate("document.activeElement.className") == "skip-link", "First tab stop is the skip link")
        check(page.locator(".skip-link").is_visible(), "Skip link becomes visible on focus")
        page.keyboard.press("Enter")
        check(page.evaluate("location.hash") == "#main", "Skip link jumps to the content")
        ring = page.evaluate("""() => { const a = document.querySelector('.site-nav a'); a.focus(); return getComputedStyle(a).outlineStyle; }""")
        check(ring != "none", "Focus ring visible on nav links")

        # ---------- All links reachable ----------
        hrefs = set()
        for name in PAGES:
            page.goto(f"{base}/{name}.html")
            hrefs.update(page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)"))
        internal = sorted(h for h in hrefs if h.startswith(base))
        broken = []
        for h in internal:
            r = page.request.get(h)
            if r.status != 200:
                broken.append(f"{h} → {r.status}")
        check(not broken, f"All {len(internal)} internal links return 200 {broken[:3]}")
        external = sorted(h for h in hrefs if not h.startswith(base))
        print(f"  INFO external links (not fetched): {len(external)} – " + ", ".join(sorted({h.split('/')[2] if '//' in h else h.split(':')[0] for h in external})))

        # ---------- Images ----------
        page.goto(base + "/")
        imgs = page.eval_on_selector_all("img", "els => els.map(e => ({alt: e.alt, ok: e.complete && e.naturalWidth > 0}))")
        check(all(i["alt"] for i in imgs), "All images have alt text")
        page.goto(base + "/services.html")
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
        imgs = page.eval_on_selector_all("img", "els => els.map(e => e.complete && e.naturalWidth > 0)")
        check(all(imgs), "All images load (lazy ones too)")

        # ---------- Load time ----------
        pctx = browser.new_context(viewport={"width": 390, "height": 844})
        pp = pctx.new_page()
        pp.goto(base + "/", wait_until="load")
        perf = pp.evaluate("""() => { const n = performance.getEntriesByType('navigation')[0];
          const r = performance.getEntriesByType('resource');
          return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd,
                   bytes: n.transferSize + r.reduce((s, x) => s + (x.transferSize || 0), 0), requests: r.length + 1 } }""")
        print(f"  INFO home page: DOMContentLoaded {perf['dcl']:.0f} ms, load {perf['load']:.0f} ms, "
              f"{perf['bytes']/1024:.0f} KB transferred, {perf['requests']} requests (local)")
        check(perf["bytes"] < 400 * 1024, "Home page under 400 KB")
        check(perf["requests"] <= 12, "Home page with at most 12 requests")
        pctx.close()

        # ---------- Booking: error case ----------
        page.goto(base + "/booking.html")
        page.wait_for_timeout(900)  # let the entrance animation finish (for the screenshot)
        page.click("button[type=submit]")
        summary = page.locator(".error-summary")
        check(summary.is_visible(), "Empty form shows the error summary")
        check(page.evaluate("document.activeElement.classList.contains('error-summary')"), "Focus moves to the error summary")
        n_err = page.locator(".field-error:not(:empty)").count()
        check(n_err >= 6, f"Error messages shown at the fields ({n_err})")
        check(page.locator("#email[aria-invalid=true]").count() == 1, "Invalid fields are marked with aria-invalid")
        page.evaluate("window.scrollTo(0, 0)")  # keeps the sticky header at the top of the full-page shot
        page.screenshot(path=str(SHOTS / "booking-error-desktop.png"), full_page=True)

        page.fill("#email", "broken")
        page.locator("#email").blur()
        check("email address" in page.inner_text("#email-error"), "Live email validation when leaving the field")

        # Pick a Sunday → closed
        sunday = page.evaluate("""() => { const d = new Date(); d.setDate(d.getDate() + 2);
            while (d.getDay() !== 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }""")
        page.fill("#date", sunday)
        page.locator("#date").dispatch_event("change")
        check(page.locator("#time").is_disabled(), "Sunday: no drop-off times available")

        # ---------- Booking: success ----------
        page.goto(base + "/booking.html?service=repair")
        check(page.input_value("#service") == "repair", "Service is preselected via ?service=")
        check(page.locator("#description-required").is_visible(), "'Description required' note shown for repairs")
        workday = page.evaluate("""() => { const d = new Date(); d.setDate(d.getDate() + 2);
            while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }""")
        page.fill("#date", workday)
        page.locator("#date").dispatch_event("change")
        opts = page.eval_on_selector_all("#time option", "o => o.map(x => x.value).filter(Boolean)")
        check(len(opts) >= 7, f"Weekday: {len(opts)} drop-off times")
        check(page.inner_text("#time option:nth-child(2)") == "9:00 am", "Drop-off times use the 12-hour US format")
        page.select_option("#time", opts[2])
        page.check("#bt-city")
        page.fill("#description", "Rear brake rubs, chain skips in third gear.")
        page.fill("#name", "Test Customer")
        page.fill("#email", "test.customer@example.org")
        page.fill("#phone", "0170 1234567")
        page.check("#privacy")
        page.click("button[type=submit]")
        page.wait_for_url("**/booking-confirmed.html?ref=*")
        ref = page.inner_text("#booking-ref")
        check(ref.startswith("NW-") and len(ref) == 9, f"Confirmation shows booking number {ref}")
        check(page.locator("#booking-summary").is_visible(), "Confirmation shows the summary")
        check(page.inner_text("[data-summary=service]") == "Repair", "Summary includes the chosen service")
        when = page.inner_text("[data-summary=when]")
        check(", at " in when and when.endswith(("am", "pm")), f"Summary shows US date and time ({when})")
        page.wait_for_timeout(900)  # let the entrance animation finish before the screenshot
        page.screenshot(path=str(SHOTS / "booking-confirmed-success-desktop.png"), full_page=True)
        stored = [json.loads(l) for l in (ROOT / "data" / "bookings.jsonl").read_text(encoding="utf8").splitlines()]
        check(stored[-1]["ref"] == ref, "Booking was stored on the server")

        page.goto(base + "/booking-confirmed.html?ref=<script>")
        check(page.locator("#booking-missing").is_visible(), "Invalid booking number shows a notice instead of data")

        # ---------- Contact ----------
        page.goto(base + "/contact.html")
        page.fill("#c-name", "Test Customer")
        page.fill("#c-email", "test@example.org")
        page.fill("#c-message", "Do you have time for a flat tire on Saturday?")
        page.check("#c-privacy")
        page.click("#contact-form button[type=submit]")
        page.wait_for_selector("#contact-done:not([hidden])")
        check(True, "Contact form submits and confirms")
        page.goto(base + "/contact.html?sent=1")
        check(page.locator("#contact-done").is_visible() and page.locator("#contact-form").is_hidden(),
              "?sent=1 shows the thank-you message (no-JS fallback)")

        # ---------- Mobile menu ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="en-US")
        mctx.add_init_script("try{localStorage.setItem('nw-consent-v1','necessary')}catch(e){}")
        m = mctx.new_page()
        m.goto(base + "/")
        check(m.locator("#site-nav").is_hidden(), "Mobile: menu starts closed")
        m.click(".nav-toggle")
        check(m.locator("#site-nav").is_visible(), "Mobile: menu opens")
        check(m.get_attribute(".nav-toggle", "aria-expanded") == "true", "Mobile: aria-expanded=true")
        m.wait_for_timeout(400)
        m.screenshot(path=str(SHOTS / "menu-open-phone.png"))
        m.keyboard.press("Escape")
        check(m.locator("#site-nav").is_hidden(), "Mobile: Escape closes the menu")
        m.click(".nav-toggle")
        m.click("#site-nav >> text=Pricing")
        m.wait_for_url("**/pricing.html")
        check(True, "Mobile: menu link navigates")
        mctx.close()

        check(not console, f"No console errors during the flows {console[:2]}")
        browser.close()


if __name__ == "__main__":
    main()
