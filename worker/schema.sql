-- Записи клиентов. Применить: npx wrangler d1 execute britva --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id   TEXT    NOT NULL,              -- artem, denis, ruslan, ilya, maxim
  date        TEXT    NOT NULL,              -- '2026-10-14' (московская дата)
  start_min   INTEGER NOT NULL,              -- начало в минутах от полуночи: 15:00 -> 900
  dur         INTEGER NOT NULL,              -- длительность в минутах
  services    TEXT    NOT NULL,              -- id услуг через запятую: 'cut,beard'
  total       INTEGER NOT NULL,              -- сумма в рублях, посчитана на сервере
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  comment     TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'new', -- new / confirmed / cancelled
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ускоряет главный запрос: «какие записи у мастера в этот день»
CREATE INDEX IF NOT EXISTS idx_bookings_master_date ON bookings (master_id, date);
