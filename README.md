# Барбершоп «Бритва» — демо-сайт

**Сайт:** https://p4yla.github.io/britva-barbershop/

Одностраничный сайт вымышленного мужского барбершопа в Москве. Главная задача сайта — онлайн-запись к мастеру.

Демо-проект для портфолио. Компания, телефон, адрес и реквизиты вымышленные.
Разработка: Анисимов П.Э., Telegram [@p4yLa](https://t.me/p4yLa).

## Стек

Чистые HTML, CSS и JavaScript, без фреймворков и сборщиков. Сайт открывается двойным кликом по `index.html`.

```
index.html      главная: все секции, SEO, JSON-LD (HairSalon)
privacy.html    политика обработки ПДн (шаблон)
404.html        страница «не найдено»
css/style.css   переменные в начале файла, дальше mobile-first
js/main.js      меню, прайс, галерея, запись, сертификат, слайдер, маска, cookie
img/            фото WebP, og.jpg, favicon.svg
fonts/          Oswald 500/700, Onest 400/500 (woff2: кириллица, латиница, знак ₽)
netlify.toml    404, заголовки безопасности, кэширование
robots.txt, sitemap.xml
```

## Что внутри

- **Прайс с переключателем уровня мастера.** Цены хранятся в `data-prices` у строк таблицы. Форма записи берёт услуги оттуда же, так что цена правится в одном месте.
- **Запись в 4 шага.** Занятые слоты вычисляются хешем от «дата + час + мастер», поэтому после перезагрузки расписание не меняется. Время считается по Москве независимо от часового пояса посетителя. После записи можно скачать `.ics` с напоминанием за 2 часа.
- **Формы.** Маска `+7 (XXX) XXX-XX-XX`, проверка полей на лету, обязательное согласие по 152-ФЗ, экран успеха внутри формы.
- **Доступность.** Семантическая разметка, видимый фокус, `aria-live` для ошибок и шагов, учёт `prefers-reduced-motion`. Без JS весь контент остаётся видимым.
- **Для России.** Шрифты лежат на своём сервере, без Google Fonts. Вместо iframe с картой — заглушка со ссылкой на Яндекс Карты. В `<head>` есть закомментированные места под Яндекс Метрику и Вебмастер.

## Как подключить Netlify Forms

1. Добавьте в тег формы атрибуты `data-netlify="true"` и `name`:

   ```html
   <form class="booking" id="booking-form" name="booking" data-netlify="true" novalidate>
   ```

2. В `js/main.js` в обработчике `submit` (рядом с комментарием «Демо: данные никуда не отправляются») добавьте одну строку:

   ```js
   fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() + '&form-name=booking' });
   ```

Для формы сертификата то же самое, только `name="certificate"`. Заявки появятся в панели Netlify → Forms.

## Перед запуском настоящего сайта

- Сейчас адреса в canonical, og:url, og:image, JSON-LD, robots.txt и sitemap.xml указывают на GitHub Pages. При переезде на свой домен замените их, а в 404.html уберите `<base href="/britva-barbershop/">`.
- Раскомментируйте Метрику и Вебмастер в `<head>` и вставьте свои коды.
- Проставьте реальные ссылки на мессенджеры (сейчас `#`), реквизиты и текст политики, согласованный с юристом.

## Фото

Бесплатные фото с [Unsplash](https://unsplash.com/license): обрезаны и сжаты в WebP. Портреты мастеров сняты российскими фотографами (на фото есть вывеска «ОТКРЫТО» и таблица для проверки зрения с кириллицей).

| Файл | Автор | Unsplash ID |
|---|---|---|
| hero-*.webp, og.jpg | César Badilla Miranda | t34TLxxmwws |
| master-1 | Maks Styazhkin | OoKsg8xdk20 |
| master-2 | Eugene Chystiakov | taZSJ6xmt48 |
| master-3 | Vladislav Nikonov | 1u1QoAkONJw |
| master-4 | Maks Styazhkin | 7L63EOzZ8n8 |
| master-5 | Damian Barczak | 5st86wYikQQ |
| work-1 | Tá Focando | YDOc9F6HUFA |
| work-2 | Salah Regouane | MRCdF3qUbp0 |
| work-3 | Michael DeMoya | Q82AM6BWBPM |
| work-4 | Mr Shave | 4k60yfGy7fU |
| work-5 | Ahmad Ebadi | S3GxGKyGPWM |
| work-6 | Maxim Makarov (Санкт-Петербург) | mDmYTytLFMA |
| work-7 | Nathon Oski | fE42nRlBcG8 |
| work-8 | Arthur Humeau | Twd3yaqA2NM |
| work-9 | Allef Vinicius | IvQeAVeJULw |

Шрифты Oswald и Onest распространяются по лицензии SIL Open Font License.
