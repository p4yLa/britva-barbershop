/* =========================================================
   Cloudflare Worker «Бритва»: расписание, запись, заявки в Telegram.

   GET  /slots?master=denis&services=cut,beard  -> свободное время на 14 дней
   POST /  { type: 'booking', ... }              -> сохранить запись (D1) + сообщение в Telegram
   POST /  { type: 'certificate', ... }          -> заявка на сертификат в Telegram

   Секреты (в коде их нет):  npx wrangler secret put BOT_TOKEN
                             npx wrangler secret put CHAT_ID
   База:                     env.DB (см. wrangler.toml, schema.sql)
   ========================================================= */

// Откуда разрешено обращаться к функции (CORS)
const ALLOWED_ORIGINS = [
  'https://p4yla.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:5500' // Live Server в VS Code
];

/* ---------- Данные салона ----------
   Цены и длительности дублируют таблицу на сайте. Сервер считает сумму сам:
   браузеру нельзя доверять — цену в запросе легко подменить. */
const SERVICES = {
  cut:     { name: 'Мужская стрижка',      dur: 60, prices: [1600, 2000, 2600] },
  clipper: { name: 'Стрижка машинкой',     dur: 30, prices: [900, 1100, 1400] },
  combo:   { name: 'Стрижка + борода',     dur: 90, prices: [2600, 3200, 4100] },
  shave:   { name: 'Королевское бритьё',   dur: 60, prices: [1800, 2200, 2800] },
  beard:   { name: 'Моделирование бороды', dur: 45, prices: [1200, 1500, 1900] },
  grey:    { name: 'Камуфляж седины',      dur: 30, prices: [1300, 1500, 1800] },
  family:  { name: 'Отец + сын',           dur: 90, prices: [2600, 3200, 4000] },
  kids:    { name: 'Детская стрижка',      dur: 45, prices: [1100, 1300, 1700] }
};
// Порядок важен: для «Любого свободного» сначала пробуем мастеров подешевле
const MASTERS = [
  { id: 'ilya',   name: 'Илья Соколов',   level: 0 },
  { id: 'maxim',  name: 'Максим Белов',   level: 0 },
  { id: 'denis',  name: 'Денис Орлов',    level: 1 },
  { id: 'ruslan', name: 'Руслан Гафаров', level: 1 },
  { id: 'artem',  name: 'Артём Карпов',   level: 2 }
];
const LEVEL_NAMES = ['Барбер', 'Топ-барбер', 'Бренд-барбер'];
const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // начало записи
const CLOSE_MIN = 22 * 60;   // салон закрывается в 22:00 — услуга должна успеть закончиться
const DAYS_AHEAD = 14;
const MIN_LEAD_MIN = 30;     // записаться можно не позже чем за 30 минут до начала

/* ---------- Демо-занятость ----------
   В новой базе нет записей, и расписание выглядело бы пустым. Поэтому часть часов
   «занята» по формуле (как раньше на сайте). Реальные записи ложатся поверх.
   Для настоящего салона поставьте DEMO_BUSY = false. */
const DEMO_BUSY = true;
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function demoBusy(dayKey, hour, masterId, isToday) {
  if (!DEMO_BUSY) return false;
  let chance = isToday ? 30 : 38;
  if (hour >= 18) chance += 15;
  return hash(dayKey + '|' + hour + '|' + masterId) % 100 < chance;
}

/* ---------- Время по Москве ---------- */
function moscowNow() {
  const p = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month - 1, d: +p.day, min: (+p.hour % 24) * 60 + +p.minute };
}
const pad = (n) => String(n).padStart(2, '0');
function nextDays() {
  const now = moscowNow();
  const days = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const dt = new Date(Date.UTC(now.y, now.m, now.d + i));
    days.push(dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()));
  }
  return { days, nowMin: now.min };
}
const fmtTime = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60);
function fmtDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'short' });
}
const rub = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? h + ' ч' + (m ? ' ' + m + ' мин' : '') : m + ' мин';
}

/* ---------- Свободно ли время ---------- */
// Пересекаются ли отрезки [a1, a2) и [b1, b2)
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// bookings — реальные записи из базы: [{ master_id, date, start_min, dur }]
function isFree(masterId, day, start, dur, ctx) {
  const end = start + dur;
  if (end > CLOSE_MIN) return false;
  if (day === ctx.days[0] && start < ctx.nowMin + MIN_LEAD_MIN) return false;
  // Демо-занятость: каждый «занятый» час — блок на 60 минут
  for (const h of SLOT_HOURS) {
    if (overlaps(start, end, h * 60, h * 60 + 60) && demoBusy(day, h, masterId, day === ctx.days[0])) return false;
  }
  for (const b of ctx.bookings) {
    if (b.master_id === masterId && b.date === day && overlaps(start, end, b.start_min, b.start_min + b.dur)) return false;
  }
  return true;
}

async function loadContext(env) {
  const { days, nowMin } = nextDays();
  const { results } = await env.DB.prepare(
    "SELECT master_id, date, start_min, dur FROM bookings WHERE date BETWEEN ?1 AND ?2 AND status != 'cancelled'"
  ).bind(days[0], days[days.length - 1]).all();
  return { days, nowMin, bookings: results };
}

// Разбираем список услуг из запроса, отбрасываем неизвестные
function parseServices(list) {
  const ids = [...new Set(String(list || '').split(',').map((s) => s.trim()))].filter((id) => SERVICES[id]);
  return { ids, dur: ids.reduce((a, id) => a + SERVICES[id].dur, 0) };
}
const priceFor = (ids, level) => ids.reduce((a, id) => a + SERVICES[id].prices[level], 0);

/* ---------- HTTP-утилиты ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
function json(data, status, origin, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...(extra || {}) }
  });
}

// Не больше 5 заявок с одного IP за 10 минут (память у каждого экземпляра своя — защита «примерная»)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

async function telegram(env, text) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return r.ok;
}
const phoneLink = (phone) => '<a href="tel:' + phone.replace(/[^\d+]/g, '') + '">' + esc(phone) + '</a>';

/* ---------- GET /slots ---------- */
async function handleSlots(url, env, origin) {
  const masterParam = url.searchParams.get('master') || 'any';
  const { ids, dur } = parseServices(url.searchParams.get('services'));
  if (!ids.length) return json({ ok: false, error: 'Не выбраны услуги' }, 400, origin);
  const candidates = masterParam === 'any' ? MASTERS : MASTERS.filter((m) => m.id === masterParam);
  if (!candidates.length) return json({ ok: false, error: 'Неизвестный мастер' }, 400, origin);

  const ctx = await loadContext(env);
  const days = ctx.days.map((day) => ({
    date: day,
    free: SLOT_HOURS
      .filter((h) => candidates.some((m) => isFree(m.id, day, h * 60, dur, ctx)))
      .map((h) => pad(h) + ':00')
  }));
  // Без кэша: после чужой записи браузер должен сразу увидеть свежее расписание
  return json({ ok: true, dur, days }, 200, origin, { 'Cache-Control': 'no-store' });
}

/* ---------- POST: запись ---------- */
async function handleBooking(d, env, origin) {
  const { ids, dur } = parseServices(Array.isArray(d.services) ? d.services.join(',') : d.services);
  if (!ids.length) return json({ ok: false, error: 'Не выбраны услуги' }, 422, origin);

  const ctx = await loadContext(env);
  const date = String(d.date || '');
  const time = /^(\d{2}):00$/.exec(String(d.time || ''));
  if (!ctx.days.includes(date) || !time || !SLOT_HOURS.includes(+time[1])) {
    return json({ ok: false, error: 'Некорректные дата или время' }, 422, origin);
  }
  const start = +time[1] * 60;
  const candidates = d.master === 'any' ? MASTERS : MASTERS.filter((m) => m.id === d.master);
  if (!candidates.length) return json({ ok: false, error: 'Неизвестный мастер' }, 422, origin);

  const name = clip(d.name, 60), phone = clip(d.phone, 20), comment = clip(d.comment, 500);

  // Пробуем мастеров по очереди. INSERT ... WHERE NOT EXISTS — одна атомарная операция:
  // если кто-то успел занять это время секундой раньше, вставка не произойдёт.
  for (const m of candidates) {
    if (!isFree(m.id, date, start, dur, ctx)) continue;
    const total = priceFor(ids, m.level);
    const res = await env.DB.prepare(
      `INSERT INTO bookings (master_id, date, start_min, dur, services, total, name, phone, comment)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE master_id = ?1 AND date = ?2 AND status != 'cancelled'
           AND start_min < ?3 + ?4 AND start_min + dur > ?3
       )`
    ).bind(m.id, date, start, dur, ids.join(','), total, name, phone, comment).run();
    if (res.meta.changes !== 1) continue;

    const id = res.meta.last_row_id;
    const lines = [
      '✂️ <b>Новая запись #' + id + '</b>',
      '',
      esc(ids.map((x) => SERVICES[x].name).join(', ')),
      'Мастер: ' + esc(m.name) + ' · ' + LEVEL_NAMES[m.level] + (d.master === 'any' ? ' (любой свободный)' : ''),
      esc(fmtDay(date)) + ', ' + fmtTime(start) + '–' + fmtTime(start + dur),
      'Сумма: <b>' + rub(total) + '</b>',
      '',
      esc(name) + ', ' + phoneLink(phone)
    ];
    if (comment) lines.push('', '💬 ' + esc(comment));
    // Запись уже в базе. Если Telegram не ответил — не пугаем клиента ошибкой.
    await telegram(env, lines.join('\n')).catch(() => false);

    return json({ ok: true, id, master: { id: m.id, name: m.name, level: m.level }, total, dur }, 200, origin);
  }
  return json({ ok: false, error: 'taken' }, 409, origin);
}

/* ---------- POST: сертификат ---------- */
async function handleCertificate(d, env, origin) {
  const text = [
    '🎁 <b>Заявка на сертификат</b>',
    '',
    'Номинал: <b>' + esc(clip(d.nominal, 20)) + '</b>',
    'Получатель: ' + (esc(clip(d.recipient, 40)) || '—'),
    '',
    esc(clip(d.name, 60)) + ', ' + phoneLink(clip(d.phone, 20))
  ].join('\n');
  if (!(await telegram(env, text))) return json({ ok: false, error: 'Telegram error' }, 502, origin);
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      if (request.method === 'GET' && url.pathname === '/slots') return await handleSlots(url, env, origin);
      if (request.method !== 'POST') return json({ ok: false, error: 'Not found' }, 404, origin);
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'Forbidden' }, 403, origin);

      let d;
      try { d = await request.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400, origin); }

      // Поле-ловушка: человек его не видит, а спам-бот заполнит
      if (d.website) return json({ ok: true }, 200, origin);

      // Та же проверка, что на сайте: сервер не доверяет браузеру
      const digits = String(d.phone || '').replace(/\D/g, '');
      if (clip(d.name, 60).length < 2 || digits.length !== 11 || d.consent !== true) {
        return json({ ok: false, error: 'Проверьте имя, телефон и согласие' }, 422, origin);
      }
      if (tooMany(request.headers.get('CF-Connecting-IP') || 'unknown')) {
        return json({ ok: false, error: 'Слишком много заявок, позвоните нам' }, 429, origin);
      }

      if (d.type === 'booking') return await handleBooking(d, env, origin);
      if (d.type === 'certificate') return await handleCertificate(d, env, origin);
      return json({ ok: false, error: 'Unknown type' }, 400, origin);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: 'Server error' }, 500, origin);
    }
  }
};
