/* =========================================================
   Cloudflare Worker: принимает заявки с сайта и шлёт их в Telegram.
   Секреты (токен бота и ID чата) хранятся в настройках Cloudflare,
   в коде их нет:  npx wrangler secret put BOT_TOKEN
                   npx wrangler secret put CHAT_ID
   ========================================================= */

// Откуда разрешено присылать заявки (CORS)
const ALLOWED_ORIGINS = [
  'https://p4yla.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:5500' // Live Server в VS Code
];

// Простая защита от флуда: не больше 5 заявок с одного IP за 10 минут.
// Память у каждого экземпляра воркера своя, так что защита «примерная» — для демо достаточно.
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

// Экранируем текст для HTML-разметки Telegram
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) }
  });
}

// Собираем текст сообщения для администратора
function buildMessage(d) {
  const name = esc(clip(d.name, 60));
  const phone = esc(clip(d.phone, 20));
  const tel = phone.replace(/[^\d+]/g, '');

  if (d.type === 'booking') {
    const lines = [
      '✂️ <b>Новая запись</b>',
      '',
      esc(clip(d.services, 300)),
      'Мастер: ' + esc(clip(d.master, 60)),
      esc(clip(d.date, 60)) + ', ' + esc(clip(d.time, 5)) + ' · ' + esc(clip(d.duration, 20)),
      'Сумма: <b>' + esc(clip(d.total, 20)) + '</b>',
      '',
      name + ', <a href="tel:' + tel + '">' + phone + '</a>'
    ];
    if (clip(d.comment, 500)) lines.push('', '💬 ' + esc(clip(d.comment, 500)));
    return lines.join('\n');
  }

  if (d.type === 'certificate') {
    return [
      '🎁 <b>Заявка на сертификат</b>',
      '',
      'Номинал: <b>' + esc(clip(d.nominal, 20)) + '</b>',
      'Получатель: ' + (esc(clip(d.recipient, 40)) || '—'),
      '',
      name + ', <a href="tel:' + tel + '">' + phone + '</a>'
    ].join('\n');
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'Forbidden' }, 403, origin);

    let d;
    try { d = await request.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400, origin); }

    // Поле-ловушка: человек его не видит, а спам-бот заполнит
    if (d.website) return json({ ok: true }, 200, origin);

    // Та же проверка, что на сайте: сервер не должен верить браузеру
    const digits = String(d.phone || '').replace(/\D/g, '');
    if (clip(d.name, 60).length < 2 || digits.length !== 11 || d.consent !== true) {
      return json({ ok: false, error: 'Проверьте имя, телефон и согласие' }, 422, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (tooMany(ip)) return json({ ok: false, error: 'Слишком много заявок, позвоните нам' }, 429, origin);

    const text = buildMessage(d);
    if (!text) return json({ ok: false, error: 'Unknown type' }, 400, origin);

    const tg = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!tg.ok) return json({ ok: false, error: 'Telegram error' }, 502, origin);

    return json({ ok: true }, 200, origin);
  }
};
