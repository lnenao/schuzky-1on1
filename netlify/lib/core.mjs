import { getStore } from '@netlify/blobs';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';

export const MEETING_MINUTES = 30;
export const BOOK_MIN_HOURS = 24;       // rezervace a přesun nejpozději 24 h předem
export const CANCEL_MIN_HOURS = 1;      // zrušení nejpozději 1 h předem
const HOUR = 3600 * 1000;
const TZ = 'Europe/Prague';

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
export const cfg = () => ({
  adminPassword: env('ADMIN_PASSWORD'),
  gmailUser: env('GMAIL_USER'),
  gmailPass: env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''),
  ownerName: env('OWNER_NAME', 'Ondřej Lněnička'),
  place: env('MEETING_PLACE', 'ředitelna'),
  siteUrl: env('SITE_URL') || env('URL') || 'http://localhost:8888',
});

/* ---------- úložiště ---------- */

const store = () => getStore({ name: 'schuzky-1on1', consistency: 'strong' });
const KEY = 'data';

export async function loadData() {
  const res = await store().getWithMetadata(KEY, { type: 'json' });
  return { data: res?.data ?? { slots: [] }, etag: res?.etag };
}

// Bezpečná změna dat: při souběžném zápisu se změna zopakuje nad čerstvými daty.
// fn(data) může vyhodit HttpError, nebo vrátit libovolný výsledek.
export async function mutate(fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, etag } = await loadData();
    const result = await fn(data);
    const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const w = await store().setJSON(KEY, data, opts);
    if (w?.modified !== false) return { data, result };
    await new Promise(r => setTimeout(r, 80 + Math.random() * 200));
  }
  throw new HttpError(409, 'Někdo právě měnil termíny. Stačí akci zopakovat.');
}

/* ---------- HTTP ---------- */

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export function handle(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Něco se pokazilo. Akci je potřeba zopakovat později.' }, 500);
    }
  };
}

export async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'Neplatný požadavek.'); }
}

export function requireAdmin(req) {
  const pass = cfg().adminPassword;
  const given = req.headers.get('x-admin-password') || '';
  if (!pass) throw new HttpError(500, 'Na serveru chybí ADMIN_PASSWORD.');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pass).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Špatné heslo.');
}

/* ---------- pomocné funkce pro termíny ---------- */

export const newId = () => crypto.randomBytes(8).toString('hex');
export const newToken = () => crypto.randomBytes(24).toString('base64url');
export const now = () => Date.now();
export const t = iso => new Date(iso).getTime();

export const isActive = slot => slot.booking && t(slot.end) > now();
export const canBook = slot => !slot.booking && t(slot.start) - now() >= BOOK_MIN_HOURS * HOUR;
export const canCancel = slot => t(slot.start) - now() >= CANCEL_MIN_HOURS * HOUR;

export function cleanName(v) {
  const s = (v ?? '').toString().replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 80) throw new HttpError(400, 'Chybí jméno a příjmení.');
  return s;
}
export function cleanEmail(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 120) throw new HttpError(400, 'E-mail není ve správném tvaru.');
  return s;
}

export function findSlot(data, id) {
  const slot = data.slots.find(s => s.id === id);
  if (!slot) throw new HttpError(404, 'Termín nebyl nalezen.');
  return slot;
}
export function findByToken(data, token) {
  const slot = token && data.slots.find(s => s.booking?.token === token);
  if (!slot) throw new HttpError(404, 'Rezervace nebyla nalezena. Možná byla zrušena.');
  return slot;
}

export function activeBookingOf(data, email, exceptSlotId) {
  return data.slots.find(s => s.id !== exceptSlotId && isActive(s) && s.booking.email === email);
}

export function overlaps(data, start, end, exceptId) {
  return data.slots.some(s => s.id !== exceptId && t(s.start) < t(end) && t(start) < t(s.end));
}

export function makeBooking(name, email) {
  return { name, email, token: newToken(), uid: `${newId()}@schuzky-1on1`, seq: 0, createdAt: new Date().toISOString(), reminderSent: false };
}

export const sortSlots = data => data.slots.sort((a, b) => t(a.start) - t(b.start));

// Staré termíny (víc než 120 dní) se průběžně mažou, aby data nerostla donekonečna.
export function prune(data) {
  const limit = now() - 120 * 24 * HOUR;
  data.slots = data.slots.filter(s => t(s.end) > limit);
}

/* ---------- formátování ---------- */

export function fmtDate(iso) {
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
export function fmtTime(iso) {
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export const fmtWhen = slot => `${fmtDate(slot.start)}, ${fmtTime(slot.start)} až ${fmtTime(slot.end)}`;

const esc = s => s.toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- e-maily ---------- */

let transporter;
function mailer() {
  const c = cfg();
  if (!c.gmailUser || !c.gmailPass) return null;
  transporter ??= nodemailer.createTransport({ service: 'gmail', auth: { user: c.gmailUser, pass: c.gmailPass } });
  return transporter;
}

function icsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function icsText(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function ics(slot, booking, method) {
  const c = cfg();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//schuzky-1on1//CZ', `METHOD:${method}`, 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${booking.uid}`,
    `SEQUENCE:${booking.seq}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(slot.start)}`,
    `DTEND:${icsDate(slot.end)}`,
    `SUMMARY:${icsText(`Schůzka 1on1 (${c.ownerName})`)}`,
    `LOCATION:${icsText(c.place)}`,
    `ORGANIZER;CN=${icsText(c.ownerName)}:mailto:${c.gmailUser}`,
    `ATTENDEE;CN=${icsText(booking.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${booking.email}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

const manageUrl = booking => `${cfg().siteUrl.replace(/\/$/, '')}/sprava.html?t=${encodeURIComponent(booking.token)}`;

function layout(paragraphs, link) {
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:15px;color:#2a2220;line-height:1.55;max-width:560px">
${paragraphs.map(p => `<p style="margin:0 0 12px">${p}</p>`).join('\n')}
${link ? `<p style="margin:18px 0"><a href="${esc(link.href)}" style="background:#590907;color:#f7efe4;text-decoration:none;padding:9px 16px;border-radius:6px;display:inline-block">${esc(link.label)}</a></p>` : ''}
<p style="margin:18px 0 0">${esc(cfg().ownerName)}</p></div>`;
  return html;
}
const strip = s => s.replace(/<[^>]+>/g, '');

export async function sendMail(kind, slot, booking, extra = {}) {
  const tr = mailer();
  const c = cfg();
  if (!tr) { console.warn('E-mail neodeslán: chybí GMAIL_USER nebo GMAIL_APP_PASSWORD'); return false; }
  const when = `<strong>${esc(fmtWhen(slot))}</strong>`;
  const where = esc(c.place);
  const manage = { href: manageUrl(booking), label: 'Zrušit nebo přesunout' };
  let subject, paras, link = manage, method = 'REQUEST';

  switch (kind) {
    case 'confirm':
      subject = `Schůzka 1on1: ${fmtDate(slot.start)} v ${fmtTime(slot.start)}`;
      paras = ['Dobrý den,', `potvrzuji schůzku 1on1 ${when}, místo: ${where}.`,
        `Termín lze přesunout nejpozději ${BOOK_MIN_HOURS} hodin předem a zrušit nejpozději ${CANCEL_MIN_HOURS} hodinu předem.`];
      break;
    case 'moved':
      subject = `Změna termínu schůzky 1on1: ${fmtDate(slot.start)} v ${fmtTime(slot.start)}`;
      paras = ['Dobrý den,', `schůzka 1on1 se přesouvá na ${when}, místo: ${where}.`,
        extra.from ? `Původní termín: ${esc(fmtWhen(extra.from))}.` : ''].filter(Boolean);
      break;
    case 'cancelled':
      subject = `Zrušená schůzka 1on1: ${fmtDate(slot.start)} v ${fmtTime(slot.start)}`;
      paras = ['Dobrý den,', `schůzka 1on1 ${when} je zrušená.`,
        'Nový termín je možné kdykoli vybrat přes odkaz níže.'];
      link = { href: cfg().siteUrl, label: 'Vybrat nový termín' };
      method = 'CANCEL';
      break;
    case 'reminder':
      subject = `Připomínka schůzky 1on1: ${fmtDate(slot.start)} v ${fmtTime(slot.start)}`;
      paras = ['Dobrý den,', `připomínám schůzku 1on1 ${when}, místo: ${where}.`];
      break;
    default: throw new Error('Neznámý typ e-mailu');
  }

  const html = layout(paras, link);
  const text = [...paras.map(strip), '', `${link.label}: ${link.href}`, '', c.ownerName].join('\n');
  const calendar = ics(slot, booking, method);

  await tr.sendMail({
    from: { name: c.ownerName, address: c.gmailUser },
    to: { name: booking.name, address: booking.email },
    replyTo: c.gmailUser,
    subject, text, html,
    icalEvent: { method, filename: 'schuzka.ics', content: calendar },
  });
  return true;
}

// Odeslání, které neshodí akci, když Gmail selže.
export async function trySend(...args) {
  try { return await sendMail(...args); } catch (e) { console.error('Chyba e-mailu', e); return false; }
}

export const publicSlot = s => ({ id: s.id, start: s.start, end: s.end });
