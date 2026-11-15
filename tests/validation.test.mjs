import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  easterSunday, berlinHolidays, slotsFor, dateProblem, validateBooking, validateContact,
  emailProblem, phoneProblem, berlinToday, addDays, formatDate, formatTime,
} from '../src/assets/js/validation.js';

// Fixed "now": Monday, March 9, 2026, 10:00 am Berlin time
const NOW = new Date('2026-03-09T09:00:00Z');

const valid = (over = {}) => ({
  service: 'inspection-basic',
  bikeType: 'city',
  date: '2026-03-12', // Thursday
  time: '10:00',
  name: 'Lea Example',
  email: 'lea@example.org',
  phone: '',
  description: '',
  privacy: true,
  ...over,
});

test('Easter Sunday for known years', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterSunday(2025), '2025-04-20');
  assert.equal(easterSunday(2026), '2026-04-05');
  assert.equal(easterSunday(2027), '2027-03-28');
});

test("Berlin holidays 2026 incl. International Women’s Day and movable holidays", () => {
  const h = berlinHolidays(2026);
  assert.equal(h.get('2026-01-01'), "New Year’s Day");
  assert.equal(h.get('2026-03-08'), "International Women’s Day");
  assert.equal(h.get('2026-04-03'), 'Good Friday');
  assert.equal(h.get('2026-04-06'), 'Easter Monday');
  assert.equal(h.get('2026-05-14'), 'Ascension Day');
  assert.equal(h.get('2026-05-25'), 'Whit Monday');
  assert.equal(h.size, 10);
  assert.equal(h.has('2026-10-31'), false, 'Reformation Day is not a public holiday in Berlin');
});

test('Drop-off times: weekdays 9–4:30, Saturdays 10–1, none on Sundays/holidays', () => {
  const weekday = slotsFor('2026-03-12');
  assert.equal(weekday[0], '09:00');
  assert.equal(weekday.at(-1), '16:30');
  assert.equal(weekday.length, 16);
  const saturday = slotsFor('2026-03-14');
  assert.deepEqual(saturday, ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']);
  assert.deepEqual(slotsFor('2026-03-15'), []); // Sunday
  assert.deepEqual(slotsFor('2026-04-03'), []); // Good Friday
  assert.deepEqual(slotsFor('not-a-date'), []);
});

test('Date: not today, not in the past, max. 60 days ahead, no Sundays/holidays', () => {
  assert.match(dateProblem('2026-03-09', NOW), /earliest you can book is tomorrow/);
  assert.match(dateProblem('2026-03-01', NOW), /earliest you can book is tomorrow/);
  assert.equal(dateProblem('2026-03-10', NOW), null);
  assert.equal(dateProblem(addDays('2026-03-09', 60), NOW), null);
  assert.match(dateProblem(addDays('2026-03-09', 61), NOW), /up to 60 days/);
  assert.match(dateProblem('2026-03-15', NOW), /closed on Sundays/);
  assert.equal(dateProblem('2026-04-06', NOW), 'Monday, April 6, 2026 is a public holiday (Easter Monday). The shop is closed.');
  assert.match(dateProblem('2026-02-30', NOW), /valid date/);
  assert.match(dateProblem('12.03.2026', NOW), /valid date/);
});

test('Dates and times are formatted in US English', () => {
  assert.equal(formatDate('2026-03-12'), 'Thursday, March 12, 2026');
  assert.equal(formatTime('09:00'), '9:00 am');
  assert.equal(formatTime('12:30'), '12:30 pm');
  assert.equal(formatTime('16:30'), '4:30 pm');
});

test('berlinToday uses Berlin time, not UTC', () => {
  // 11:30 pm UTC on March 9 is already March 10 in Berlin
  assert.equal(berlinToday(new Date('2026-03-09T23:30:00Z')), '2026-03-10');
});

test('valid booking is accepted and normalized', () => {
  const r = validateBooking(valid({ name: '  Lea   Example ', email: ' LEA@Example.org ' }), NOW);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.name, 'Lea Example');
  assert.equal(r.value.email, 'lea@example.org');
});

test('empty booking returns clear errors for every required field', () => {
  const r = validateBooking({}, NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['bikeType', 'date', 'email', 'name', 'privacy', 'service', 'time'].sort());
});

test('unknown service and time outside opening hours are rejected', () => {
  assert.ok(validateBooking(valid({ service: 'tuning' }), NOW).errors.service);
  assert.match(validateBooking(valid({ date: '2026-03-14', time: '15:00' }), NOW).errors.time, /isn’t available/);
});

test('repairs require a description, tune-ups do not', () => {
  assert.ok(validateBooking(valid({ service: 'repair', description: 'broken' }), NOW).errors.description);
  assert.equal(validateBooking(valid({ service: 'repair', description: 'Rear wheel has a flat' }), NOW).ok, true);
  assert.ok(validateBooking(valid({ service: 'estimate' }), NOW).errors.description);
  assert.equal(validateBooking(valid({ description: 'x'.repeat(1001) }), NOW).ok, false);
});

test('privacy checkbox accepts form values', () => {
  assert.equal(validateBooking(valid({ privacy: 'on' }), NOW).ok, true);
  assert.equal(validateBooking(valid({ privacy: false }), NOW).ok, false);
  assert.equal(validateBooking(valid({ privacy: 'false' }), NOW).ok, false);
});

test('email validation', () => {
  for (const ok of ['a@b.de', 'first.last@company.example', 'x+tag@sub.domain.org']) assert.equal(emailProblem(ok), null, ok);
  for (const bad of ['', 'abc', 'a@b', 'a@@b.de', 'a b@c.de', 'a@b.']) assert.ok(emailProblem(bad), bad);
});

test('phone is optional but must be plausible', () => {
  assert.equal(phoneProblem(''), null);
  assert.equal(phoneProblem('+49 30 23125 417'), null);
  assert.equal(phoneProblem('0170/1234567'), null);
  assert.ok(phoneProblem('12'));
  assert.ok(phoneProblem('call me'));
});

test('contact form', () => {
  assert.equal(validateContact({ name: 'Ali', email: 'ali@example.org', message: 'Are you open on Saturday?', privacy: true }).ok, true);
  const r = validateContact({ name: 'A', email: 'x', message: 'short' });
  assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'message', 'name', 'privacy']);
});
