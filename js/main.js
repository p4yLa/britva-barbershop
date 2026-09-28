/* =========================================================
   Барбершоп «Бритва» — скрипты
   Без фреймворков. Каждый блок — отдельная функция init*().
   ========================================================= */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Адрес Cloudflare Worker, который пересылает заявки в Telegram (см. worker/).
  // Пустая строка — демо-режим: заявки никуда не уходят.
  var LEAD_ENDPOINT = 'https://britva-booking.p4yla.workers.dev';

  // Отправка заявки. Кнопка блокируется, пока идёт запрос; при ошибке — текст в errorEl.
  function sendLead(form, data, button, errorEl) {
    var trap = form.querySelector('[name="website"]');
    data.website = trap ? trap.value : '';
    if (!LEAD_ENDPOINT) return Promise.resolve();
    var label = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    errorEl.textContent = '';
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }).catch(function (err) {
      errorEl.textContent = 'Не получилось отправить заявку. Проверьте интернет или позвоните: +7 (495) 128-47-30.';
      throw err;
    }).finally(function () {
      button.disabled = false;
      button.innerHTML = label;
    });
  }

  /* ---------- Утилиты форматирования ---------- */

  // 2600 -> «2 600 ₽» (неразрывный пробел, чтобы цена не разрывалась на две строки)
  function rub(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
  }

  // 90 -> «1 ч 30 мин»
  function duration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' мин';
    return h + ' ч' + (m ? ' ' + m + ' мин' : '');
  }

  // Текущие дата и время в Москве — не зависят от часового пояса посетителя
  function moscowNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return { y: +parts.year, m: +parts.month - 1, d: +parts.day, h: +parts.hour % 24, min: +parts.minute };
  }

  // Детерминированный хеш строки (FNV-1a): одинаковый вход -> одинаковый результат
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- Шапка и меню ---------- */
  function initHeader() {
    var header = $('#header');
    var burger = $('.burger');
    var menu = $('#mobile-menu');

    function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 10); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    function setMenu(open) {
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      menu.hidden = !open;
      document.body.classList.toggle('menu-open', open);
    }
    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); burger.focus(); }
    });
    window.matchMedia('(min-width: 1100px)').addEventListener('change', function () { setMenu(false); });

    // Подсветка пункта меню текущей секции
    if (!('IntersectionObserver' in window)) return;
    var links = $$('.nav a');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) io.observe(s); });
  }

  /* ---------- Появление блоков при прокрутке ---------- */
  function initReveal() {
    var items = $$('.reveal');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Данные: услуги и мастера берём прямо из разметки ---------- */
  var SERVICES = $$('#price-table tbody tr').map(function (tr) {
    return {
      id: tr.dataset.id,
      name: $('b', tr).textContent,
      dur: +tr.dataset.dur,
      prices: tr.dataset.prices.split(',').map(Number)
    };
  });
  var MASTERS = $$('.master').map(function (li) {
    return { id: li.dataset.master, name: li.dataset.name, level: +li.dataset.level, photo: li.dataset.photo };
  });
  var LEVEL_NAMES = ['Барбер', 'Топ-барбер', 'Бренд-барбер'];

  /* ---------- Прайс: переключатель уровня мастера ---------- */
  function initPrices() {
    var buttons = $$('.level-switch button');
    var table = $('#price-table');
    var note = $('#level-note');
    var notes = [
      'Барберы — Илья и Максим. Стаж от 3 лет, каждый прошёл нашу внутреннюю аттестацию.',
      'Топ-барберы — Денис и Руслан. Стаж 7–8 лет, берут сложные формы, фейды и бороды.',
      'Бренд-барбер — Артём Карпов, основатель «Бритвы». Стаж 11 лет, обучает всю команду.'
    ];

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var level = +btn.dataset.level;
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        table.classList.add('is-changing');
        setTimeout(function () {
          $$('tbody tr', table).forEach(function (tr, i) {
            $('.td-price', tr).textContent = rub(SERVICES[i].prices[level]);
          });
          note.textContent = notes[level];
          table.classList.remove('is-changing');
        }, reduceMotion ? 0 : 180);
      });
    });
  }

  /* ---------- Галерея с фильтрами (техника FLIP) ---------- */
  function initGallery() {
    var buttons = $$('.filters button');
    var items = $$('.gallery__item');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.dataset.filter;
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });

        // First: запоминаем позиции до изменения
        var first = new Map();
        items.forEach(function (el) { if (!el.hidden) first.set(el, el.getBoundingClientRect()); });

        items.forEach(function (el) { el.hidden = !(f === 'all' || el.dataset.cat === f); });
        if (reduceMotion) return;

        // Last + Invert + Play: сдвигаем элементы из старой позиции в новую
        items.forEach(function (el) {
          if (el.hidden) return;
          var last = el.getBoundingClientRect();
          var was = first.get(el);
          var anim = was
            ? [{ transform: 'translate(' + (was.left - last.left) + 'px,' + (was.top - last.top) + 'px)' }, { transform: 'none' }]
            : [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }];
          el.animate(anim, { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' });
        });
      });
    });
  }

  /* ---------- Маска телефона и проверка полей ---------- */
  function phoneDigits(v) {
    var d = v.replace(/\D/g, '');
    if (d[0] === '8' || d[0] === '7') d = d.slice(1);
    return d.slice(0, 10);
  }
  function formatPhone(d) {
    var out = '+7';
    if (d.length) out += ' (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }
  function initPhoneMask(input) {
    var prev = '';
    input.addEventListener('focus', function () { if (!input.value) input.value = '+7 ('; });
    input.addEventListener('blur', function () { if (phoneDigits(input.value).length === 0) input.value = ''; });
    input.addEventListener('input', function (e) {
      var d = phoneDigits(input.value);
      // Набрали «8» или «7» первой цифрой по привычке — это код страны, он уже стоит
      if (!phoneDigits(prev) && (d === '8' || d === '7')) d = '';
      // Стёрли скобку или дефис — стираем и цифру перед ними
      if (e.inputType === 'deleteContentBackward' && d === phoneDigits(prev)) d = d.slice(0, -1);
      input.value = d.length ? formatPhone(d) : (document.activeElement === input ? '+7 (' : '');
      prev = input.value;
    });
    input.addEventListener('paste', function () { setTimeout(function () { input.dispatchEvent(new Event('input')); }, 0); });
  }

  var validators = {
    name: function (v) {
      v = v.trim();
      if (!v) return 'Введите имя';
      if (v.length < 2) return 'Имя слишком короткое';
      if (!/^[A-Za-zА-Яа-яЁё\s'-]+$/.test(v)) return 'Используйте только буквы';
      return '';
    },
    phone: function (v) {
      var d = phoneDigits(v);
      if (!d.length) return 'Введите телефон';
      if (d.length < 10) return 'Введите телефон полностью';
      return '';
    },
    consent: function (v, el) { return el.checked ? '' : 'Без согласия мы не сможем принять заявку'; }
  };

  // Проверяет одно поле и показывает ошибку под ним. Возвращает true, если всё хорошо.
  function validateField(el) {
    var err = validators[el.dataset.validate](el.value, el);
    var wrap = el.closest('.field, .consent');
    var box = $('.field__error, .consent__error', wrap);
    wrap.classList.toggle('is-invalid', !!err);
    wrap.classList.toggle('is-valid', !err && el.type !== 'checkbox');
    el.setAttribute('aria-invalid', String(!!err));
    box.textContent = err;
    return !err;
  }

  function initFieldValidation(form) {
    $$('[data-mask="phone"]', form).forEach(initPhoneMask);
    $$('[data-validate]', form).forEach(function (el) {
      // Проверяем «на лету», но только после первого ухода с поля — чтобы не ругаться на полуслове
      el.addEventListener('blur', function () { if (el.type !== 'checkbox') { el.dataset.touched = '1'; validateField(el); } });
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
        if (el.dataset.touched || el.type === 'checkbox') validateField(el);
      });
    });
  }

  // Проверить все поля формы; фокус на первое ошибочное
  function validateAll(root) {
    var firstBad = null;
    $$('[data-validate]', root).forEach(function (el) {
      el.dataset.touched = '1';
      if (!validateField(el) && !firstBad) firstBad = el;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  /* ---------- Онлайн-запись ---------- */
  function initBooking() {
    var form = $('#booking-form');
    if (!form) return;

    var state = { step: 1, services: [], master: null, date: null, time: null };
    var steps = $$('.step', form);
    var progress = $$('.progress li', form);
    var btnBack = $('#step-back'), btnNext = $('#step-next'), btnSubmit = $('#step-submit');
    var errorBox = $('#step-error');
    var stepNames = ['услуги', 'мастер', 'дата и время', 'контакты'];
    var check = '<span class="choice__mark"><svg aria-hidden="true"><use href="#i-check"/></svg></span>';
    var SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

    // Уровень мастера: для «Любого свободного» считаем по минимальной цене
    function level() {
      var m = MASTERS.find(function (x) { return x.id === state.master; });
      return m ? m.level : 0;
    }
    function selected() { return SERVICES.filter(function (s) { return state.services.indexOf(s.id) > -1; }); }
    function total() { return selected().reduce(function (a, s) { return a + s.prices[level()]; }, 0); }
    function totalDur() { return selected().reduce(function (a, s) { return a + s.dur; }, 0); }

    /* Шаг 1: услуги */
    var svcList = $('#svc-list');
    function renderServices() {
      svcList.innerHTML = SERVICES.map(function (s) {
        var price = s.prices[level()];
        return '<label class="choice"><input type="checkbox" name="services" value="' + s.id + '"' +
          (state.services.indexOf(s.id) > -1 ? ' checked' : '') + '>' +
          '<span class="choice__box">' + check +
          '<span class="choice__text"><b>' + s.name + '</b><small>' + duration(s.dur) + '</small></span>' +
          '<span class="choice__price">' + (state.master === 'any' || !state.master ? 'от ' : '') + rub(price) + '</span></span></label>';
      }).join('');
    }
    svcList.addEventListener('change', function () {
      state.services = $$('input:checked', svcList).map(function (i) { return i.value; });
      errorBox.textContent = '';
      renderSummary();
    });

    /* Шаг 2: мастер */
    var masterList = $('#master-list');
    function renderMasters() {
      var any = '<label class="choice"><input type="radio" name="master" value="any"' + (state.master === 'any' ? ' checked' : '') + '>' +
        '<span class="choice__box"><span class="choice__avatar choice__avatar--any"><svg aria-hidden="true"><use href="#i-users"/></svg></span>' +
        '<span class="choice__text"><b>Любой свободный</b><small>Больше свободного времени</small></span></span></label>';
      masterList.innerHTML = any + MASTERS.map(function (m) {
        return '<label class="choice"><input type="radio" name="master" value="' + m.id + '"' + (state.master === m.id ? ' checked' : '') + '>' +
          '<span class="choice__box"><img class="choice__avatar" src="' + m.photo + '" alt="" width="48" height="48" loading="lazy">' +
          '<span class="choice__text"><b>' + m.name + '</b><small>' + LEVEL_NAMES[m.level] + '</small></span>' +
          '<span class="choice__price">' + rub(total() ? selected().reduce(function (a, s) { return a + s.prices[m.level]; }, 0) : SERVICES[0].prices[m.level]) + '</span></span></label>';
      }).join('');
    }
    masterList.addEventListener('change', function (e) {
      state.master = e.target.value;
      state.time = null; // у другого мастера другое расписание
      errorBox.textContent = '';
      renderSummary();
    });

    /* Шаг 3: дата и слоты */
    var datesBox = $('#dates'), slotsBox = $('#slots');
    var now = moscowNow();
    var DAYS = [];
    for (var i = 0; i < 14; i++) {
      var dt = new Date(Date.UTC(now.y, now.m, now.d + i));
      DAYS.push({
        key: dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()),
        date: dt,
        today: i === 0,
        weekday: dt.toLocaleDateString('ru-RU', { timeZone: 'UTC', weekday: 'short' }),
        label: dt.toLocaleDateString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }),
        month: dt.toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'short' }).replace('.', ''),
        weekend: dt.getUTCDay() === 0 || dt.getUTCDay() === 6
      });
    }

    // Слот занят? Считаем от даты + мастера, поэтому после перезагрузки картина та же
    function isBusy(dayKey, hour, masterId) {
      var chance = DAYS[0].key === dayKey ? 30 : 38; // вечером и в выходные занято чаще
      if (hour >= 18) chance += 15;
      return hash(dayKey + '|' + hour + '|' + masterId) % 100 < chance;
    }
    function slotFree(day, hour) {
      if (day.today && hour * 60 <= now.h * 60 + now.min + 30) return false; // прошло или меньше 30 минут до начала
      if (state.master && state.master !== 'any') return !isBusy(day.key, hour, state.master);
      return MASTERS.some(function (m) { return !isBusy(day.key, hour, m.id); });
    }

    function renderDates() {
      if (!state.date) {
        // По умолчанию — первый день, где есть свободное время
        var first = DAYS.find(function (d) { return SLOT_HOURS.some(function (h) { return slotFree(d, h); }); });
        state.date = (first || DAYS[0]).key;
      }
      datesBox.innerHTML = DAYS.map(function (d) {
        return '<button type="button" class="date-btn' + (d.weekend ? ' is-weekend' : '') + '" data-date="' + d.key + '" aria-pressed="' + (d.key === state.date) + '" aria-label="' + (d.today ? 'Сегодня, ' : '') + d.weekday + ', ' + d.label + '">' +
          '<span>' + (d.today ? 'сегодня' : d.weekday) + '</span><b>' + d.date.getUTCDate() + '</b><span>' + d.month + '</span></button>';
      }).join('');
      renderSlots();
    }
    function renderSlots() {
      var day = DAYS.find(function (d) { return d.key === state.date; });
      var html = SLOT_HOURS.map(function (h) {
        var t = pad(h) + ':00', free = slotFree(day, h);
        if (!free && state.time === t) state.time = null;
        return '<button type="button" class="slot" data-time="' + t + '"' + (free ? '' : ' disabled aria-label="' + t + ', занято"') +
          ' aria-pressed="' + (state.time === t) + '">' + t + '</button>';
      }).join('');
      var anyFree = SLOT_HOURS.some(function (h) { return slotFree(day, h); });
      slotsBox.innerHTML = anyFree ? html : '<p class="slots-empty">На этот день всё занято. Выберите другую дату или позвоните — иногда освобождается время.</p>';
      $('#slots-label').textContent = 'Свободное время на ' + day.label;
    }
    datesBox.addEventListener('click', function (e) {
      var b = e.target.closest('.date-btn'); if (!b) return;
      state.date = b.dataset.date; state.time = null;
      $$('.date-btn', datesBox).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      renderSlots(); renderSummary();
    });
    slotsBox.addEventListener('click', function (e) {
      var b = e.target.closest('.slot'); if (!b || b.disabled) return;
      state.time = b.dataset.time;
      $$('.slot', slotsBox).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      errorBox.textContent = '';
      renderSummary();
    });

    /* Итог справа */
    function dayLabel() {
      var d = DAYS.find(function (x) { return x.key === state.date; });
      return d ? d.label + ', ' + d.weekday : '';
    }
    function masterName() {
      if (state.master === 'any') return 'Любой свободный';
      var m = MASTERS.find(function (x) { return x.id === state.master; });
      return m ? m.name + ' · ' + LEVEL_NAMES[m.level] : '—';
    }
    function renderSummary() {
      var sel = selected();
      $('#sum-services').textContent = sel.length ? sel.map(function (s) { return s.name; }).join(', ') : 'Не выбраны';
      $('#sum-master').textContent = masterName();
      $('#sum-date').textContent = state.time ? dayLabel() + ', ' + state.time : '—';
      $('#sum-dur').textContent = sel.length ? duration(totalDur()) : '—';
      $('#sum-total').textContent = sel.length ? (state.master === 'any' || !state.master ? 'от ' : '') + rub(total()) : '—';
      $('#sum-note').textContent = state.master === 'any'
        ? 'Цена «от» — по тарифу барбера. Точную сумму назовём, когда подберём мастера.'
        : 'Оплата после визита картой, по СБП или наличными. Первый визит −15%.';
    }

    /* Переходы между шагами */
    function validateStep() {
      if (state.step === 1 && !state.services.length) return 'Выберите хотя бы одну услугу';
      if (state.step === 2 && !state.master) return 'Выберите мастера или «Любой свободный»';
      if (state.step === 3 && !state.time) return 'Выберите удобное время';
      return '';
    }
    function goTo(n, focus) {
      state.step = n;
      steps.forEach(function (s) { s.hidden = +s.dataset.step !== n; });
      progress.forEach(function (li, i) {
        li.classList.toggle('is-current', i === n - 1);
        li.classList.toggle('is-done', i < n - 1);
      });
      btnBack.hidden = n === 1;
      btnNext.hidden = n === 4;
      btnSubmit.hidden = n !== 4;
      errorBox.textContent = '';
      $('#step-status').textContent = 'Шаг ' + n + ' из 4: ' + stepNames[n - 1];
      if (n === 1) renderServices();
      if (n === 2) renderMasters();
      if (n === 3) renderDates();
      if (focus) {
        var fs = steps[n - 1];
        fs.setAttribute('tabindex', '-1');
        fs.focus({ preventScroll: true });
        var top = form.getBoundingClientRect().top;
        if (top < 0) form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
    }
    btnNext.addEventListener('click', function () {
      var err = validateStep();
      if (err) { errorBox.textContent = err; return; }
      goTo(state.step + 1, true);
    });
    btnBack.addEventListener('click', function () { goTo(state.step - 1, true); });

    initFieldValidation(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.step !== 4) { btnNext.click(); return; }
      if (!validateAll(steps[3])) return;
      var name = $('#b-name').value.trim();
      var phone = $('#b-phone').value;
      sendLead(form, {
        type: 'booking',
        services: selected().map(function (s) { return s.name; }).join(', '),
        master: masterName(),
        date: dayLabel(),
        time: state.time,
        duration: duration(totalDur()),
        total: $('#sum-total').textContent,
        name: name,
        phone: phone,
        comment: $('#b-comment').value,
        consent: true
      }, btnSubmit, errorBox).then(function () { showBookingSuccess(name, phone); }, function () {});
    });

    function showBookingSuccess(name, phone) {
      $('#booking-success-text').textContent = name + ', ждём вас ' + dayLabel() + ' в ' + state.time +
        ' на Покровке, 31. ' + (state.master === 'any' ? 'Мастера подберём и назовём при звонке. ' : 'Мастер: ' + masterName().split(' · ')[0] + '. ') +
        'Администратор позвонит на ' + phone + ' в течение 15 минут.';
      $$('.step, .step-nav, .progress, #step-error', form).forEach(function (el) { el.hidden = true; });
      var ok = $('#booking-success');
      ok.hidden = false;
      ok.focus();
    }

    /* .ics — файл события для любого календаря */
    $('#add-calendar').addEventListener('click', function () {
      var p = state.date.split('-').map(Number), h = +state.time.split(':')[0];
      // Москва = UTC+3 круглый год, переводим в UTC
      var start = new Date(Date.UTC(p[0], p[1] - 1, p[2], h - 3, 0));
      var end = new Date(start.getTime() + totalDur() * 60000);
      var fmt = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
      var desc = selected().map(function (s) { return s.name; }).join(', ') + '. ' + masterName() + '. Телефон: +7 (495) 128-47-30';
      var ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Britva Barbershop//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:' + Date.now() + '@britva-barber.example',
        'DTSTAMP:' + fmt(new Date()),
        'DTSTART:' + fmt(start),
        'DTEND:' + fmt(end),
        'SUMMARY:Барбершоп «Бритва»',
        'DESCRIPTION:' + desc.replace(/([,;])/g, '\\$1'),
        'LOCATION:Москва\\, ул. Покровка\\, 31\\, стр. 2',
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Через 2 часа — стрижка в «Бритве»', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url; a.download = 'britva-' + state.date + '.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    $('#booking-again').addEventListener('click', function () {
      form.reset();
      $$('.field, .consent', form).forEach(function (w) { w.classList.remove('is-invalid', 'is-valid'); });
      $$('[data-touched]', form).forEach(function (el) { delete el.dataset.touched; });
      state = { step: 1, services: [], master: null, date: null, time: null };
      $('#booking-success').hidden = true;
      $$('.step-nav, .progress, #step-error', form).forEach(function (el) { el.hidden = false; });
      goTo(1, true);
      renderSummary();
    });

    /* Кнопки «Записаться к мастеру» */
    $$('[data-book-master]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.master = btn.dataset.bookMaster;
        state.time = null;
        if (!$('#booking-success').hidden) $('#booking-again').click();
        state.master = btn.dataset.bookMaster;
        goTo(state.services.length ? 2 : 1, false);
        renderSummary();
      });
    });

    goTo(1, false);
    renderSummary();
  }

  /* ---------- Подарочный сертификат ---------- */
  function initCertificate() {
    var form = $('#cert-form');
    if (!form) return;
    var nominal = 3000;
    var buttons = $$('.nominals button', form);
    var toInput = $('#c-to');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        nominal = +btn.dataset.nominal;
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        $('#cert-amount').textContent = rub(nominal);
      });
    });
    toInput.addEventListener('input', function () {
      $('#cert-to').textContent = toInput.value.trim() || 'Имени получателя';
    });
    $('#cert-num').textContent = '№ ' + String(hash(new Date().toDateString()) % 9000 + 1000) + '-' + moscowNow().y;

    initFieldValidation(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validateAll(form)) return;
      var to = toInput.value.trim();
      sendLead(form, {
        type: 'certificate',
        nominal: rub(nominal),
        recipient: to,
        name: $('#c-name').value.trim(),
        phone: $('#c-phone').value,
        consent: true
      }, $('button[type="submit"]', form), $('#cert-error')).then(function () { showCertSuccess(to); }, function () {});
    });
    function showCertSuccess(to) {
      $('#cert-success-text').textContent = 'Сертификат на ' + rub(nominal) + (to ? ' для получателя «' + to + '»' : '') +
        '. Перезвоним на ' + $('#c-phone').value + ' в течение 15 минут, уточним оплату и доставку.';
      $('.cert-fields', form).hidden = true;
      var ok = $('#cert-success');
      ok.hidden = false;
      ok.focus();
    }
    $('#cert-again').addEventListener('click', function () {
      form.reset();
      $$('.field, .consent', form).forEach(function (w) { w.classList.remove('is-invalid', 'is-valid'); });
      $$('[data-touched]', form).forEach(function (el) { delete el.dataset.touched; });
      $('#cert-to').textContent = 'Имени получателя';
      $('#cert-success').hidden = true;
      $('.cert-fields', form).hidden = false;
      $('#c-name').focus();
    });
  }

  /* ---------- Слайдер отзывов со свайпом ---------- */
  function initSlider() {
    var root = $('#slider');
    if (!root) return;
    var track = $('.slider__track', root);
    var slides = $$('.review', track);
    var dotsBox = $('#slider-dots');
    var prev = $('#slider-prev'), next = $('#slider-next');
    var index = 0, perView = 1, step = 0;

    function measure() {
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      step = slides[0].getBoundingClientRect().width + gap;
      perView = Math.max(1, Math.round((track.getBoundingClientRect().width + gap) / step));
      var max = slides.length - perView;
      dotsBox.innerHTML = '';
      for (var i = 0; i <= max; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Отзыв ' + (i + 1));
        b.dataset.i = i;
        dotsBox.appendChild(b);
      }
      go(Math.min(index, max));
    }
    function go(i) {
      var max = slides.length - perView;
      index = Math.max(0, Math.min(i, max));
      track.style.transform = 'translateX(' + (-index * step) + 'px)';
      prev.disabled = index === 0;
      next.disabled = index === max;
      $$('button', dotsBox).forEach(function (b, k) { b.setAttribute('aria-current', String(k === index)); });
      slides.forEach(function (s, k) {
        var visible = k >= index && k < index + perView;
        s.setAttribute('aria-hidden', String(!visible));
      });
    }
    prev.addEventListener('click', function () { go(index - 1); });
    next.addEventListener('click', function () { go(index + 1); });
    dotsBox.addEventListener('click', function (e) { if (e.target.dataset.i) go(+e.target.dataset.i); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') go(index - 1);
      if (e.key === 'ArrowRight') go(index + 1);
    });

    // Свайп: следим за пальцем, вертикальную прокрутку страницы не блокируем (touch-action: pan-y)
    var startX = 0, startY = 0, dx = 0, dragging = false, decided = false;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; decided = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(e.clientY - startY) < 6) return;
        decided = true;
        if (Math.abs(e.clientY - startY) > Math.abs(dx)) { dragging = false; return; }
        root.classList.add('is-dragging');
      }
      track.style.transform = 'translateX(' + (-index * step + dx) + 'px)';
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('is-dragging');
      if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1)); else go(index);
    }
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(measure, 150); });
    measure();
  }

  /* ---------- Липкая кнопка «Записаться» ---------- */
  function initStickyCta() {
    var cta = $('#sticky-cta');
    var booking = $('#booking');
    var hero = $('.hero');
    if (!cta || !('IntersectionObserver' in window)) return;
    var inBooking = false, inHero = true;
    function update() { cta.classList.toggle('is-hidden', inBooking || inHero); }
    new IntersectionObserver(function (en) { inBooking = en[0].isIntersecting; update(); }, { threshold: 0.05 }).observe(booking);
    // На первом экране уже есть большая кнопка — дубль не показываем
    new IntersectionObserver(function (en) { inHero = en[0].isIntersecting; update(); }, { threshold: 0.35 }).observe(hero);
    update();
  }

  /* ---------- Cookie-баннер ---------- */
  function initCookie() {
    var box = $('#cookie');
    if (!box) return;
    var KEY = 'britva-cookie-ok';
    var ok = false;
    try { ok = localStorage.getItem(KEY) === '1'; } catch (e) { /* приватный режим */ }
    if (ok) return;
    box.hidden = false;
    $('#cookie-ok').addEventListener('click', function () {
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* ничего страшного */ }
      box.hidden = true;
    });
  }

  /* ---------- Запуск ---------- */
  [initHeader, initReveal, initPrices, initGallery, initBooking, initCertificate, initSlider, initStickyCta, initCookie]
    .forEach(function (fn) {
      try { fn(); } catch (err) { console.error('[Бритва] ' + fn.name + ':', err); }
    });
})();
