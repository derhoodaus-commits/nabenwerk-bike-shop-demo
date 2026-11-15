// Confirmation page: shows the booking number and, if available, the summary.
const params = new URLSearchParams(location.search);
const ref = params.get('ref') || '';
const valid = /^NW-[A-Z0-9]{6}$/.test(ref);

const refEl = document.getElementById('booking-ref');
const missing = document.getElementById('booking-missing');
const found = document.getElementById('booking-found');

if (!valid) {
  found.hidden = true;
  missing.hidden = false;
} else {
  refEl.textContent = ref;
  let summary = null;
  try {
    summary = JSON.parse(sessionStorage.getItem('nw-last-booking') || 'null');
  } catch { /* ignore */ }
  if (summary && summary.ref === ref) {
    const map = {
      service: summary.service,
      bikeType: summary.bikeType,
      when: `${summary.date}, at ${summary.time}`,
      name: summary.name,
      email: summary.email,
    };
    for (const [key, val] of Object.entries(map)) {
      const el = document.querySelector(`[data-summary="${key}"]`);
      if (el) el.textContent = val;
    }
    document.getElementById('booking-summary').hidden = false;
  }
}
