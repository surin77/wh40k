# Wahapedia WH40k GitHub Mirror

Автоматическая выгрузка данных Wahapedia (WH40k export CSV + Core Rules page) раз в час в GitHub, с веб-страницами для даташитов и чтения правил.

## Что уже настроено

- `scripts/fetch_wh40k.py` — скачивает официальные CSV из `https://wahapedia.ru/wh40k10ed/`, а также выгружает Core Rules в `core_rules.json`, обновляя только изменившиеся файлы.
- `.github/workflows/sync-wahapedia.yml` — GitHub Actions job раз в час (`0 * * * *`) + ручной запуск.
- `docs/` — страница даташитов (`index.html`) и отдельная страница Core Rules (`rules.html`).
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

- Для Core Rules нет отдельного подтверждённого публичного CSV в экспорте; используется выгрузка и парсинг страницы `the-rules/core-rules`.
