import {
  handle, json, body, loadData, mutate, HttpError, findSlot, findByToken, canBook, canCancel,
  cleanName, cleanEmail, activeBookingOf, makeBooking, publicSlot, sortSlots, trySend, t, now,
  BOOK_MIN_HOURS, CANCEL_MIN_HOURS, fmtWhen, cfg, MEETING_MINUTES, cleanPodklad, pdfUrl,
} from '../lib/core.mjs';

const freeSlots = data => sortSlots(data).filter(canBook).map(publicSlot);

export default handle(async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, '');

  // Volné termíny
  if (route === 'slots' && req.method === 'GET') {
    const { data } = await loadData();
    return json({ slots: freeSlots(data), place: cfg().place, minutes: MEETING_MINUTES, hasForm: !!cfg().formUrl });
  }

  // Nová rezervace
  if (route === 'book' && req.method === 'POST') {
    const b = await body(req);
    const name = cleanName(b.name);
    const email = cleanEmail(b.email);
    const podklad = cleanPodklad(b.podklad);
    const { result } = await mutate(data => {
      const slot = findSlot(data, b.slotId);
      if (!canBook(slot)) throw new HttpError(409, 'Tento termín už není volný.');
      const other = activeBookingOf(data, email);
      if (other) throw new HttpError(409, `Na tento e-mail už je zapsaná schůzka (${fmtWhen(other)}). Termín jde změnit přes odkaz v potvrzovacím e-mailu.`);
      slot.booking = makeBooking(name, email, podklad);
      return { slot: structuredClone(slot) };
    });
    const sent = await trySend('confirm', result.slot, result.slot.booking);
    return json({ ok: true, slot: publicSlot(result.slot), emailSent: sent, token: result.slot.booking.token });
  }

  // Detail vlastní rezervace
  if (route === 'booking' && req.method === 'GET') {
    const { data } = await loadData();
    const slot = findByToken(data, url.searchParams.get('t'));
    const past = t(slot.end) <= now();
    return json({
      slot: publicSlot(slot),
      name: slot.booking.name,
      podklad: slot.booking.podklad || null,
      formUrl: !past && t(slot.start) > now() ? cfg().formUrl || null : null,
      pdfUrl: pdfUrl(),
      past,
      canCancel: !past && canCancel(slot),
      canReschedule: !past && canCancel(slot),
      freeSlots: past ? [] : freeSlots(data),
      rules: { BOOK_MIN_HOURS, CANCEL_MIN_HOURS },
    });
  }

  // Zrušení
  if (route === 'cancel' && req.method === 'POST') {
    const b = await body(req);
    const { result } = await mutate(data => {
      const slot = findByToken(data, b.t);
      if (!canCancel(slot)) throw new HttpError(409, `Schůzku lze zrušit nejpozději ${CANCEL_MIN_HOURS} hodinu předem.`);
      const booking = slot.booking;
      booking.seq++;
      slot.booking = null;
      return { slot: structuredClone(slot), booking };
    });
    await trySend('cancelled', result.slot, result.booking);
    return json({ ok: true });
  }

  // Přesun na jiný volný termín
  if (route === 'reschedule' && req.method === 'POST') {
    const b = await body(req);
    const { result } = await mutate(data => {
      const from = findByToken(data, b.t);
      if (!canCancel(from)) throw new HttpError(409, `Schůzku lze měnit nejpozději ${CANCEL_MIN_HOURS} hodinu předem.`);
      const to = findSlot(data, b.slotId);
      if (!canBook(to)) throw new HttpError(409, `Nový termín musí být volný a nejméně ${BOOK_MIN_HOURS} hodin dopředu.`);
      const booking = from.booking;
      booking.seq++;
      booking.reminderSent = false;
      to.booking = booking;
      from.booking = null;
      return { from: structuredClone(from), to: structuredClone(to) };
    });
    await trySend('moved', result.to, result.to.booking, { from: result.from });
    return json({ ok: true, slot: publicSlot(result.to) });
  }

  // Změna volby podkladu, kolega dostane e-mail s podkladem
  if (route === 'podklad' && req.method === 'POST') {
    const b = await body(req);
    const podklad = cleanPodklad(b.podklad);
    const { result } = await mutate(data => {
      const slot = findByToken(data, b.t);
      if (t(slot.start) <= now()) throw new HttpError(409, 'Schůzka už začala.');
      slot.booking.podklad = podklad;
      return structuredClone(slot);
    });
    const sent = await trySend('podklad', result, result.booking);
    return json({ ok: true, emailSent: sent });
  }

  throw new HttpError(404, 'Neznámá adresa.');
});

export const config = { path: ['/api/slots', '/api/book', '/api/booking', '/api/cancel', '/api/reschedule', '/api/podklad'] };
