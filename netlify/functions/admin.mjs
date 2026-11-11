import {
  handle, json, body, loadData, mutate, HttpError, requireAdmin, findSlot, newId, overlaps,
  cleanName, cleanEmail, makeBooking, activeBookingOf, sortSlots, prune, trySend, t, fmtWhen,
  MEETING_MINUTES, cleanPodklad, dayKey,
} from '../lib/core.mjs';

const MIN = 60 * 1000;

function parseStart(v) {
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, 'Neplatné datum nebo čas.');
  return d;
}
// Když admin zapíše nebo přesune schůzku na méně než 24 hodin dopředu, připomínka se už neposílá.
const markReminder = slot => { if (slot.booking) slot.booking.reminderSent = t(slot.start) - Date.now() < 24 * 3600 * 1000; };
const adminView = s => ({
  id: s.id, start: s.start, end: s.end,
  booking: s.booking ? { name: s.booking.name, email: s.booking.email, podklad: s.booking.podklad || null, createdAt: s.booking.createdAt, reminderSent: s.booking.reminderSent } : null,
});

export default handle(async (req) => {
  requireAdmin(req);
  const route = new URL(req.url).pathname.replace(/^\/api\/admin\/?/, '');

  if (route === 'data' && req.method === 'GET') {
    const { data } = await loadData();
    return json({ slots: sortSlots(data).map(adminView), meetingMinutes: MEETING_MINUTES });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Nepovolená metoda.');
  const b = await body(req);
  const notify = b.notify !== false;
  let mails = [];
  let out;

  switch (route) {
    // Přidání termínů: [{start}], konec se dopočítá
    case 'slots-add': {
      const list = Array.isArray(b.starts) ? b.starts : [];
      if (!list.length || list.length > 300) throw new HttpError(400, 'Žádné termíny k přidání.');
      const r = await mutate(data => {
        prune(data);
        let added = 0, skipped = 0;
        for (const v of list) {
          const start = parseStart(v);
          const end = new Date(start.getTime() + MEETING_MINUTES * MIN);
          if (overlaps(data, start.toISOString(), end.toISOString())) { skipped++; continue; }
          data.slots.push({ id: newId(), start: start.toISOString(), end: end.toISOString(), booking: null });
          added++;
        }
        sortSlots(data);
        return { added, skipped };
      });
      out = r.result;
      break;
    }

    // Smazání termínu (obsazený se nejdřív zruší a kolega dostane e-mail)
    case 'slot-delete': {
      const r = await mutate(data => {
        const slot = findSlot(data, b.id);
        data.slots = data.slots.filter(s => s.id !== slot.id);
        if (slot.booking) slot.booking.seq++;
        return structuredClone(slot);
      });
      if (r.result.booking && notify) mails.push(['cancelled', r.result, r.result.booking]);
      out = { ok: true };
      break;
    }

    // Změna času termínu
    case 'slot-update': {
      const start = parseStart(b.start);
      const end = new Date(start.getTime() + MEETING_MINUTES * MIN);
      const r = await mutate(data => {
        const slot = findSlot(data, b.id);
        if (overlaps(data, start.toISOString(), end.toISOString(), slot.id)) throw new HttpError(409, 'V tomto čase už jiný termín je.');
        const before = structuredClone(slot);
        slot.start = start.toISOString();
        slot.end = end.toISOString();
        if (slot.booking) { slot.booking.seq++; markReminder(slot); }
        sortSlots(data);
        return { before, after: structuredClone(slot) };
      });
      if (r.result.after.booking && notify) mails.push(['moved', r.result.after, r.result.after.booking, { from: r.result.before }]);
      out = { ok: true };
      break;
    }

    // Ruční zápis kolegy na volný termín (bez omezení 24 hodin)
    case 'book': {
      const name = cleanName(b.name);
      const email = cleanEmail(b.email);
      const podklad = cleanPodklad(b.podklad);
      const r = await mutate(data => {
        const slot = findSlot(data, b.id);
        if (slot.booking) throw new HttpError(409, 'Termín je obsazený.');
        const other = activeBookingOf(data, email);
        if (other && !b.allowSecond) throw new HttpError(409, `${name} už má zapsaný termín ${fmtWhen(other)}.`);
        slot.booking = makeBooking(name, email, podklad);
        markReminder(slot);
        return structuredClone(slot);
      });
      if (notify) mails.push(['confirm', r.result, r.result.booking]);
      out = { ok: true };
      break;
    }

    // Oprava jména nebo e-mailu
    case 'booking-update': {
      const name = cleanName(b.name);
      const email = cleanEmail(b.email);
      const podklad = cleanPodklad(b.podklad);
      await mutate(data => {
        const slot = findSlot(data, b.id);
        if (!slot.booking) throw new HttpError(409, 'Termín není obsazený.');
        slot.booking.name = name;
        slot.booking.email = email;
        slot.booking.podklad = podklad;
      });
      out = { ok: true };
      break;
    }

    // Zrušení rezervace, termín zůstane volný
    case 'cancel': {
      const r = await mutate(data => {
        const slot = findSlot(data, b.id);
        if (!slot.booking) throw new HttpError(409, 'Termín není obsazený.');
        const booking = slot.booking;
        booking.seq++;
        slot.booking = null;
        return { slot: structuredClone(slot), booking };
      });
      if (notify) mails.push(['cancelled', r.result.slot, r.result.booking]);
      out = { ok: true };
      break;
    }

    // Přesun rezervace na jiný volný termín
    case 'move': {
      const r = await mutate(data => {
        const from = findSlot(data, b.fromId);
        const to = findSlot(data, b.toId);
        if (!from.booking) throw new HttpError(409, 'Původní termín není obsazený.');
        if (to.booking) throw new HttpError(409, 'Cílový termín je obsazený.');
        const booking = from.booking;
        booking.seq++;
        to.booking = booking;
        from.booking = null;
        markReminder(to);
        return { from: structuredClone(from), to: structuredClone(to) };
      });
      if (notify) mails.push(['moved', r.result.to, r.result.to.booking, { from: r.result.from }]);
      out = { ok: true };
      break;
    }

    // Den znovu: všechny termíny dotčených dnů se nahradí novými.
    // Rezervace, jejíž čas v novém rozpisu zůstal, se přenese; ostatní se zruší.
    case 'days-replace': {
      const list = Array.isArray(b.starts) ? b.starts : [];
      if (!list.length || list.length > 400) throw new HttpError(400, 'Žádné termíny k přidání.');
      const starts = [...new Set(list.map(v => parseStart(v).toISOString()))];
      const days = new Set(starts.map(dayKey));
      const r = await mutate(data => {
        prune(data);
        const old = data.slots.filter(s => days.has(dayKey(s.start)));
        const keepBooked = new Map(old.filter(s => s.booking).map(s => [s.start, s]));
        data.slots = data.slots.filter(s => !days.has(dayKey(s.start)));
        let added = 0, kept = 0;
        for (const st of starts) {
          const end = new Date(t(st) + MEETING_MINUTES * MIN).toISOString();
          if (overlaps(data, st, end)) continue;
          const prev = keepBooked.get(st);
          data.slots.push({ id: prev ? prev.id : newId(), start: st, end, booking: prev ? prev.booking : null });
          if (prev) { keepBooked.delete(st); kept++; }
          added++;
        }
        sortSlots(data);
        const cancelled = [...keepBooked.values()].map(s => { s.booking.seq++; return structuredClone(s); });
        return { added, kept, cancelled, replacedDays: days.size, removed: old.length };
      });
      if (notify) for (const s of r.result.cancelled) mails.push(['cancelled', s, s.booking]);
      out = { added: r.result.added, kept: r.result.kept, cancelled: r.result.cancelled.length, removed: r.result.removed };
      break;
    }

    // Smazání dne: všech termínů, nebo jen volných
    case 'day-delete': {
      const day = String(b.day || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Neplatný den.');
      const r = await mutate(data => {
        const hit = data.slots.filter(s => dayKey(s.start) === day && (!b.onlyFree || !s.booking));
        const ids = new Set(hit.map(s => s.id));
        data.slots = data.slots.filter(s => !ids.has(s.id));
        return hit.filter(s => s.booking).map(s => { s.booking.seq++; return structuredClone(s); });
      });
      if (notify) for (const s of r.result) mails.push(['cancelled', s, s.booking]);
      out = { ok: true, cancelled: r.result.length };
      break;
    }

    default:
      throw new HttpError(404, 'Neznámá akce.');
  }

  let emailSent = null;
  for (const m of mails) emailSent = await trySend(...m);
  return json({ ...out, emailSent });
});

export const config = { path: '/api/admin/*' };
