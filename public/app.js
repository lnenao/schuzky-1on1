const TZ = 'Europe/Prague';
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = {
  day: iso => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)),
  dayKey: iso => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)),
  time: iso => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
  when(s) { return `${this.day(s.start)}, ${this.time(s.start)} až ${this.time(s.end)}`; },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function groupByDay(slots) {
  const map = new Map();
  for (const s of slots) {
    const k = fmt.dayKey(s.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  return [...map.values()];
}

async function api(path, { method = 'GET', data, admin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (admin) headers['x-admin-password'] = admin;
  const res = await fetch(path, { method, headers, body: data ? JSON.stringify(data) : undefined });
  let out = {};
  try { out = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(out.error || 'Spojení selhalo.'); e.status = res.status; throw e; }
  return out;
}

function showMsg(el, text, type = 'ok') {
  el.className = `msg ${type}`;
  el.innerHTML = text;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
const hideMsg = el => el.classList.add('hidden');

// Výběr času: vykreslí dny s tlačítky časů, onPick(slot)
function renderPicker(container, slots, onPick, emptyText = 'Momentálně nejsou vypsané žádné volné termíny.') {
  if (!slots.length) { container.innerHTML = `<p class="muted">${emptyText}</p>`; return; }
  container.innerHTML = groupByDay(slots).map(day => `
    <div class="day"><h3>${esc(cap(fmt.day(day[0].start)))}</h3>
      <div class="times">${day.map(s => `<button type="button" class="time" data-id="${s.id}">${fmt.time(s.start)}</button>`).join('')}</div>
    </div>`).join('');
  container.onclick = e => {
    const b = e.target.closest('.time');
    if (!b) return;
    container.querySelectorAll('.time.selected').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    onPick(slots.find(s => s.id === b.dataset.id));
  };
}
