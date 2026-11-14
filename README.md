# GEIMERI CS2 Stats

Статистика матчей [Cybershoke](https://cybershoke.net) с ELO, балансировщиком, драфтом и генерацией карточек.

Сайт: https://vortexgames574-blip.github.io/cybershoke-stats/

## Архитектура

```

data/matches.txt          — список матчей (Турнир | url)
│
▼
collect.js                — Playwright открывает браузер, парсит DOM
│
▼
data/matches/*.json       — сохранённые матчи (K/D/A из HTML)
│
▼
build.js                  — валидация + ELO + агрегация + кэш аватарок
│
▼
docs/data/stats.json      — итоговая статистика для сайта
│
▼
docs/app.js               — рендер, модалки, балансировщик, драфт

```

## Требования

- Node.js >= 20
- Playwright (устанавливается через `npm install`)
- Chrome (для `channel: 'chrome'` в collect.js)

## Установка

```bash
npm install
npx playwright install chromium
```

Опционально — для Steam API (быстрее, чем парсинг XML):

```
export STEAM_API_KEY=your_key_here
```

## Использование

### Собрать все матчи заново

1. Отредактируй `data/matches.txt`. Формат: `Турнир | url` по одному матчу на строку.

```
Rivals 2026 S2 | https://cybershoke.net/ru/match/12558289
Rivals 2026 S2 | https://cybershoke.net/ru/match/12558290
```
2. Запусти сбор + сборку:

```
npm run update
```

Это = `collect.js && build.js`. Скрипт:

- Откроет каждый матч в браузере
- Спарсит DOM (ник, K/D/A, аватар, профиль)
- Сохранит `data/matches/{matchId}.json`
- Проверит каждую карту через `validateMap()`
- Посчитает ELO, средние, рекорды
- Запишет `docs/data/stats.json`
3. Проверь `docs/data/stats.json` и запушь изменения:

```
git add -A
git commit -m "update: fresh stats"
git push
```

### Пересобрать без пересбора матчей

Если у тебя уже есть JSON-файлы, но изменилась логика `build.js`:

```
npm run build
```

### Локальный сервер

```
npm run serve
# открой http://localhost:3000
```

## Как добавить новый турнир

1. Добавь ссылки в `data/matches.txt` в формате `Название турнира | url`.
2. `npm run update`.
3. Всё. Турнир появится в селекте.

## Как починить битый матч

`build.js` пропускает карты, которые не проходят `validateMap()`:

- Суммарно > 500 смертей/фрагов на карте
- У кого-то > 60 фрагов/смертей
- Ассистов > 40
- ADR вне [5, 300] / KAST вне [5, 100] / Rating вне [0.02, 4.0]
- Помеченные `_warning` в `collect.js` (запасной пакет)

Если карта пропущена — в логе (`logs/build-YYYY-MM-DD.log`) будет строка:

```
[WARN] Пропущена карта de_mirage в матче 12558289: у Nick kills 78 > 60
```

Что делать:

1. Открой `data/matches/{matchId}.json`.
2. Найди проблемную карту.
3. Удали её из массива `maps` (или удали весь JSON целиком).
4. Запусти `npm run update` — соберёт заново.

## Что делает validateMap

Проверяет массив `players` карты и возвращает `{ok, reason}`. Если `ok: false` — карта **полностью пропускается**: не идёт ни в средние, ни в ELO, ни в рекорды. Это защита от старых битых пакетов Cybershoke (когда в JSON попадала агрегированная стата за сезон).

## Кэш аватарок

`data/avatars-cache.json` — кэш Steam-аватарок с TTL 30 дней. Если у игрока сменилась аватарка, он обновится только после истечения TTL или при ручном удалении записи из кэша.

## Логи

Каждый запуск `build.js` пишет лог в `logs/build-YYYY-MM-DD.log`. Если что-то упало, ищи причину там, а не в консоли.

## Известные ограничения

- **Дата матча** = время сбора (`new Date()`). Если пересобрать старые матчи, дата сдвинется. TODO: парсить дату со страницы.
- **ADR / KAST / Rating** = `null` в новых JSON (парсим только K/D/A из DOM). На графиках эти поля не отображаются, но и не ломаются — `safeNum(null)` возвращает `null`.
- **collect.js** использует `channel: 'chrome'` — нужен установленный Chrome. Если его нет — замени на `chromium` (но тогда некоторые сайты могут не открыться).

## Roadmap

- □  
Парсинг даты матча со страницы Cybershoke
- □  
Парсинг ADR/KAST/Rating из DOM (нужны точные селекторы)
- □  
Разбить `app.js` на модули (`render/*.js`)
- □  
GitHub Actions: автосбор раз в 6 часов
- □  
Lazy-load матчей (`matches/{id}.json` вместо одного большого `stats.json`)

