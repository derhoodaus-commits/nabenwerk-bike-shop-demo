// Form logic for booking and contact: live validation, accessible error messages,
// submission via fetch to the local server. Without JavaScript the form submits as a classic POST;
// the server then validates with the same module and redirects.
// Static demo build (GitHub Pages, <html data-mode="static">): there is no server, so the same
// validation runs in the browser only and nothing is ever sent; the confirmation is shown locally.
import {
  validateBooking, validateContact, slotsFor, dateProblem, berlinToday, addDays,
  BOOKING_WINDOW_DAYS, DESCRIPTION_REQUIRED, SERVICES, BIKE_TYPES, labelFor, formatDate, formatTime,
} from './validation.js';

const STATIC_DEMO = document.documentElement.dataset.mode === 'static';
if (STATIC_DEMO) {
  // The static build ships submit buttons disabled so a no-JS submit can't post anywhere.
  document.querySelectorAll('[data-needs-js]').forEach((b) => { b.disabled = false; });
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // same format as the server's booking numbers
function demoRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'NW-' + [...bytes].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
}

// Server build: POST to the API. Static build: never send anything, just simulate the response.
function submit(form, kind, payload) {
  if (STATIC_DEMO) return Promise.resolve(kind === 'booking' ? { ref: demoRef(), demo: true } : { ok: true, demo: true });
  return send(form, form.action, payload);
}

function fieldErrorEl(form, name) {
  return form.querySelector(`[data-error-for="${name}"]`);
}

function showErrors(form, errors, onlyFields) {
  const names = onlyFields ?? [...new Set([...form.querySelectorAll('[data-error-for]')].map((e) => e.dataset.errorFor))];
  for (const name of names) {
    const msg = errors[name];
    const el = fieldErrorEl(form, name);
    const inputs = form.querySelectorAll(`[name="${name}"]`);
    if (el) el.textContent = msg || '';
    inputs.forEach((i) => {
      if (msg) i.setAttribute('aria-invalid', 'true');
      else i.removeAttribute('aria-invalid');
    });
  }
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const privacy = form.querySelector('[name="privacy"]');
  if (privacy) data.privacy = privacy.checked;
  return data;
}

function renderSummary(form, errors) {
  const box = form.querySelector('.error-summary');
  if (!box) return;
  const entries = Object.entries(errors);
  if (!entries.length) {
    box.hidden = true;
    return;
  }
  const list = box.querySelector('ul');
  list.innerHTML = '';
  for (const [name, msg] of entries) {
    const target = form.querySelector(`[name="${name}"]`);
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${target?.id ?? ''}`;
    a.textContent = msg;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      target?.focus();
    });
    li.append(a);
    list.append(li);
  }
  box.hidden = false;
  box.focus();
}

async function send(form, url, payload) {
  const status = form.querySelector('.form-status');
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.dataset.label ??= button.textContent;
  button.textContent = 'Sending…';
  status.textContent = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 422 && body.errors) {
      showErrors(form, body.errors);
      renderSummary(form, body.errors);
      return null;
    }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  } catch (err) {
    status.textContent =
      "Sorry, that didn’t work. Please try again later or email us at werkstatt@nabenwerk.example.";
    console.warn('Form submission failed:', err.message);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
}

function wireLiveValidation(form, validate) {
  const touched = new Set();
  form.addEventListener('focusout', (e) => {
    const name = e.target.name;
    if (!name || name === 'website') return;
    touched.add(name);
    showErrors(form, validate(readForm(form)).errors, [...touched]);
  });
  form.addEventListener('input', (e) => {
    if (touched.has(e.target.name)) showErrors(form, validate(readForm(form)).errors, [e.target.name]);
  });
  form.addEventListener('change', (e) => {
    if (e.target.type === 'radio' || e.target.type === 'checkbox') {
      touched.add(e.target.name);
      showErrors(form, validate(readForm(form)).errors, [e.target.name]);
    }
  });
}

// ---------- Booking ----------
const booking = document.getElementById('booking-form');
if (booking) {
  const dateInput = booking.querySelector('#date');
  const timeSelect = booking.querySelector('#time');
  const dateHint = booking.querySelector('#date-hint');
  const service = booking.querySelector('#service');
  const descLabelHint = booking.querySelector('#description-required');

  const today = berlinToday();
  dateInput.min = addDays(today, 1);
  dateInput.max = addDays(today, BOOKING_WINDOW_DAYS);

  const preset = new URLSearchParams(location.search).get('service');
  if (preset && SERVICES.some((s) => s.id === preset)) service.value = preset;

  function updateDescriptionHint() {
    const required = DESCRIPTION_REQUIRED.has(service.value);
    descLabelHint.hidden = !required;
    booking.querySelector('#description').toggleAttribute('aria-required', required);
  }
  service.addEventListener('change', updateDescriptionHint);
  updateDescriptionHint();

  function updateSlots() {
    const previous = timeSelect.value;
    const problem = dateInput.value ? dateProblem(dateInput.value) : null;
    const slots = dateInput.value && !problem ? slotsFor(dateInput.value) : [];
    timeSelect.innerHTML = '';
    const placeholder = new Option(
      !dateInput.value ? 'Pick a date first' : slots.length ? 'Choose a time' : 'Closed on this day',
      '',
    );
    timeSelect.append(placeholder);
    for (const s of slots) timeSelect.append(new Option(formatTime(s), s));
    timeSelect.disabled = slots.length === 0;
    if (slots.includes(previous)) timeSelect.value = previous;
    dateHint.textContent = dateInput.value && !problem ? formatDate(dateInput.value) : 'Mon–Fri 9 am–4:30 pm, Sat 10 am–1 pm. Closed Sundays and public holidays.';
  }
  dateInput.addEventListener('change', updateSlots);
  updateSlots();

  wireLiveValidation(booking, validateBooking);

  booking.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(booking);
    const { ok, errors, value } = validateBooking(data);
    showErrors(booking, errors);
    if (!ok) {
      renderSummary(booking, errors);
      return;
    }
    renderSummary(booking, {});
    const result = await submit(booking, 'booking', { ...data, privacy: true });
    if (!result) return;
    try {
      sessionStorage.setItem('nw-last-booking', JSON.stringify({
        ref: result.ref,
        service: labelFor(SERVICES, value.service),
        bikeType: labelFor(BIKE_TYPES, value.bikeType),
        date: formatDate(value.date),
        time: formatTime(value.time),
        name: value.name,
        email: value.email,
      }));
    } catch { /* without sessionStorage the confirmation shows only the booking number */ }
    location.href = `booking-confirmed.html?ref=${encodeURIComponent(result.ref)}`;
  });
}

// ---------- Contact form ----------
const contact = document.getElementById('contact-form');
if (contact) {
  if (new URLSearchParams(location.search).get('sent') === '1') {
    // Returning after a classic form submission (no JavaScript at submit time)
    contact.hidden = true;
    document.getElementById('contact-done').hidden = false;
  }
  wireLiveValidation(contact, validateContact);
  contact.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(contact);
    const { ok, errors } = validateContact(data);
    showErrors(contact, errors);
    if (!ok) {
      renderSummary(contact, errors);
      return;
    }
    renderSummary(contact, {});
    const result = await submit(contact, 'contact', { ...data, privacy: true });
    if (!result) return;
    const done = document.getElementById('contact-done');
    contact.hidden = true;
    done.hidden = false;
    done.focus();
  });
}
