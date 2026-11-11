const TZ = 'Europe/Prague';
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = {
  day: iso => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)),
  dayKey: iso => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)),
  time: iso => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
  part: (iso, o) => new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, ...o }).format(new Date(iso)),
  when(s) { return `${this.day(s.start)}, ${this.time(s.start)} až ${this.time(s.end)}`; },
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Ikony (vlastní, jednoduché tahy)
const P = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  move: '<path d="M4 12h14"/><path d="M14 7l5 5-5 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  coffee: '<path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c-1 1.5 1 2 0 3.5M12 3c-1 1.5 1 2 0 3.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
};
const icon = (name, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
// Doplní ikony do prvků s data-icon
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.removeAttribute('data-icon'); });
}
document.addEventListener('DOMContentLoaded', () => fillIcons());

// Kalendářní lístek pro den
function calTile(iso) {
  return `<div class="cal"><div class="m">${esc(fmt.part(iso, { month: 'short' }).replace('.', ''))}</div>
    <div class="d">${fmt.part(iso, { day: 'numeric' })}</div><div class="w">${esc(fmt.part(iso, { weekday: 'short' }))}</div></div>`;
}

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
  el.innerHTML = icon(type === 'ok' ? 'check' : 'bell') + `<div>${text}</div>`;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
const hideMsg = el => el.classList.add('hidden');

// Výběr času: vykreslí dny s tlačítky časů, onPick(slot)
function renderPicker(container, slots, onPick, emptyText = 'Momentálně nejsou vypsané žádné volné termíny.') {
  if (!slots.length) {
    container.innerHTML = `<div class="card empty">${icon('coffee', 'i big')}<p class="muted" style="margin:8px 0 0">${emptyText}</p></div>`;
    return;
  }
  container.innerHTML = groupByDay(slots).map(day => `
    <div class="day">${calTile(day[0].start)}
      <div><h3>${esc(cap(fmt.day(day[0].start)))}</h3>
      <div class="times">${day.map(s => `<button type="button" class="time" data-id="${s.id}">${fmt.time(s.start)}</button>`).join('')}</div></div>
    </div>`).join('');
  container.onclick = e => {
    const b = e.target.closest('.time');
    if (!b) return;
    container.querySelectorAll('.time.selected').forEach(x => x.classList.remove('selected'));
    b.classList.add('selected');
    onPick(slots.find(s => s.id === b.dataset.id));
  };
}

// Konfety pro potvrzení
function confetti() {
  const c = ['#590907', '#a5a79b', '#e8d2b5', '#3d0605'];
  let out = '';
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 100, y = Math.random() * 100, col = c[i % c.length];
    out += i % 3 ? `<rect x="${x}%" y="${y}%" width="8" height="4" rx="2" fill="${col}" opacity=".6"/>`
                 : `<circle cx="${x}%" cy="${y}%" r="3.5" fill="${col}" opacity=".55"/>`;
  }
  return `<svg class="confetti" width="100%" height="100%">${out}</svg>`;
}
