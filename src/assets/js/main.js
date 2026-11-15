// Navigation (mobile), cookie notice, small helpers. Runs on every page.

const CONSENT_KEY = 'nw-consent-v1';

function storage(action, key, value) {
  try {
    if (action === 'get') return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null; // private mode or similar – the site still works
  }
  return null;
}

// ---------- Mobile navigation ----------
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('site-nav');
if (toggle && nav) {
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.nav-toggle-label').textContent = open ? 'Close' : 'Menu';
    document.body.classList.toggle('nav-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 60em)').addEventListener('change', (e) => e.matches && setOpen(false));
}

// ---------- Cookie notice ----------
// The site itself sets no cookies. "Allow analytics" is the hook where a privacy-friendly
// analytics tool could be loaded later (event "nw:consent").
const banner = document.getElementById('consent');
function applyConsent(choice) {
  document.documentElement.dataset.consent = choice;
  window.dispatchEvent(new CustomEvent('nw:consent', { detail: { choice } }));
}
if (banner) {
  const saved = storage('get', CONSENT_KEY);
  if (saved) applyConsent(saved);
  else banner.hidden = false;

  banner.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-consent]');
    if (!btn) return;
    const choice = btn.dataset.consent;
    storage('set', CONSENT_KEY, choice);
    applyConsent(choice);
    banner.hidden = true;
  });
  document.querySelectorAll('[data-open-consent]').forEach((b) =>
    b.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector('button')?.focus();
    }),
  );
}
