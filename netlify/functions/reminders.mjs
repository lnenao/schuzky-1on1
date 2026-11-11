import { mutate, trySend, t, now } from '../lib/core.mjs';

// Každou hodinu pošle připomínku kolegům, jejichž schůzka začíná do 24 hodin.
export default async () => {
  const limit = now() + 24 * 3600 * 1000;
  const { result: due } = await mutate(data => {
    const list = [];
    for (const s of data.slots) {
      if (s.booking && !s.booking.reminderSent && t(s.start) > now() && t(s.start) <= limit) {
        s.booking.reminderSent = true;
        list.push(structuredClone(s));
      }
    }
    return list;
  });
  for (const s of due) await trySend('reminder', s, s.booking);
  console.log(`Připomínky odeslány: ${due.length}`);
};

export const config = { schedule: '@hourly' };
