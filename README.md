# Escape Hatch

A local-only migration-readiness auditor for exported Replit projects.

## Run locally

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`.

## Tests

```sh
npm test
```

## Privacy model

- Project folders and ZIP files are parsed in the browser.
- There is no backend or upload endpoint.
- Secret values are never displayed in the report.
- Migration-plan requests open a clearly disclosed public GitHub issue; nothing is submitted automatically.

## Static deployment

The site can be served from any static host. Publish these files and directories:

- `index.html`
- `privacy.html`
- `styles.css`
- `app.js`
- `analyzer.js`
- `vendor/`

Do not deploy `node_modules/`.

## Before public validation

The current beta-interest action deliberately does not collect emails. Connect an explicit-consent endpoint only after selecting a hosting account, then update the privacy notice before publishing that change.
