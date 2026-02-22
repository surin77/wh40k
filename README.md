# Wahapedia WH40k GitHub Mirror

Автоматическая выгрузка данных Wahapedia (раздел Warhammer 40,000 10th edition export) раз в час в GitHub, с простой веб-страницей для просмотра CSV.

## Что уже настроено

- `scripts/fetch_wh40k.py` — скачивает официальные CSV из `https://wahapedia.ru/wh40k10ed/` и обновляет только изменившиеся файлы.
- `.github/workflows/sync-wahapedia.yml` — GitHub Actions job раз в час (`0 * * * *`) + ручной запуск.
- `docs/` — простая страница просмотра данных (`index.html`, `app.js`, `styles.css`).
- `docs/data/index.json` — метаданные последней синхронизации (создаётся скриптом).

## Быстрый старт

1. Создай новый GitHub-репозиторий и запушь этот проект.
2. В репозитории включи GitHub Pages:
   - `Settings` -> `Pages`
   - `Build and deployment` -> `Source: Deploy from a branch`
   - `Branch: main`, folder `/docs`
3. Запусти workflow вручную: `Actions` -> `Sync Wahapedia WH40k` -> `Run workflow`.
4. После первого прогона открой Pages URL (обычно `https://<user>.github.io/<repo>/`).

## Локальный запуск синка

```bash
python3 scripts/fetch_wh40k.py
```

## Как работает commit only on change

Workflow выполняет скрипт и затем проверяет изменения в git:

- если `git diff --quiet` -> workflow завершается без коммита;
- если есть diff в `docs/data` -> создаётся commit `chore(data): sync wahapedia wh40k export` и push.

## Ограничения

- Это не официальный JSON API, а официальный CSV export Wahapedia.
- В таблице на странице для производительности выводится до 500 строк (поиск работает по загруженной таблице).
