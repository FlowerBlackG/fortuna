# Fortuna

Personal asset settlement with Flask, SQLite, and React/TDesign.

## Run locally

Requires **Python 3.14+** and Vite+ (`vp`). From the repository root:

```sh
python3.14 -m venv venv
venv/bin/python -m pip install -r server/requirements.txt
mkdir -p user-data
cp server/src/config.template.json user-data/config.json
venv/bin/python server/src/main.py -c user-data/config.json
```

In another terminal:

```sh
cd web
vp install
vp run dev-all-hosts
```

Open the displayed frontend URL and connect to `http://127.0.0.1:5000`. Create an account, configure currencies/institutions/asset types, then create a report. The database path is relative to the config file.

Set `environment` in the server config to `development` (the local template) or `staging` to enable Flask debugging and automatically restart when Python code changes. Use `production` to serve the app with Waitress on the configured host and port, with debugging and live reload disabled. Configs that omit `environment` default to `production`. The About page shows the connected server’s environment.

## Build and check

`make build` builds `web/dist`; `make test` runs API/config tests, calculation tests, and frontend lint/type checks. With both local servers running, `cd web && vp run test:browser` exercises Chrome; `vp run test:regression` checks caching and chart values against Vite (`CHROME_PATH` overrides the Chrome executable).

To serve the built frontend from Flask:

```sh
venv/bin/python server/src/main.py -c user-data/config.json --web-dir web/dist --host 127.0.0.1 --port 5000
```

Static hosting elsewhere also works; routes use hashes. API routes live under `/api`, use `Fortuna-Auth`, and return `{code,msg,data}` with HTTP 200. Sessions are in memory and reset on server restart; run one server process.

Config is validated and decoded into nested attribute-access objects directly from `server/src/config.schema.json`, including defaults and relative paths. Set `"logging": {"file": "logs/fortuna.log"}` to append server logs to a file relative to the config; omit it or use `null` for stderr. Logs include request/API status, duration, and exceptions.

Exchange rates are configured **inside each report**; new reports start with no rates. `USD / CNY = 6` converts 6 USD to 36 CNY. Record values, distribution pies, report-list totals, and stacked analysis use the rates saved in the corresponding report. Rates are managed at `/api/reports/{report_id}/exchange-rates` and included in report responses; deleting a report deletes its rates too. Report-list totals use the default currency, with raw subtotals available via `/api/reports?include_totals=true`. Currency definitions remain user-wide. Conversions stay in the browser.

Set **Report time** on a report to record a historical snapshot. Report lists and analysis use this time; creation and update times are maintained by the server. The API accepts `report_time` on `POST /api/reports` and `PATCH /api/reports/{id}` as an ISO 8601 timestamp with a timezone (for example, `2025-12-31T18:00:00+08:00`). If omitted on creation, it defaults to the creation time. Existing reports are backfilled from their creation time on startup.
