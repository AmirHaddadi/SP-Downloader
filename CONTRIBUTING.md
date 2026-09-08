# Contributing to SP Downloader

Thanks for being here! This project is small, dependency-light and deliberately
framework-free — that makes it easy to jump in.

## Development setup

```bash
npm install
npm run update-core   # downloads the yt-dlp core for your OS into ./bin
npm run dev           # same as `npm start`, serves on PORT (default 4000)
```

You also need **FFmpeg** on your `PATH`. MongoDB is optional; without it the
history falls back to `~/.vdl_history.json`.

## Before opening a PR

Run the checks:

```bash
npm test
```

`npm test` performs:

1. **Syntax validation** — `node --check` on every `.js` file in `src/` and `public/`.
2. **End-to-end checks** — boots the server on a scratch port and exercises the
   API surface (`/api/config`, `/api/meta` validation, `/api/downloads`,
   `/events`), plus the pure `file-probe` logic (multi-part pattern parsing,
   file-extension detection).

No browser / visual testing is part of the suite.

## Guidelines

- **Keep it framework-free.** Vanilla JS on both ends. No build step.
- **No site-specific hacks in the core.** A URL is either something `yt-dlp`
  handles or a direct file. If a site needs special treatment, push it upstream
  to yt-dlp.
- **API shape:** success responses are `{ ok: true, ... }`, errors are
  `{ ok: false, error: '...' }`.
- **CSS:** use the existing custom properties in `public/style.css` (`--accent`,
  `--bg-card`, …). The UI is RTL-first and theme-aware — don't hardcode colors.
- **Commits:** short imperative subject lines. One logical change per PR.

## Good first issues

- Additional UI languages (the UI strings are inline in `public/`).
- Docker image / `docker-compose.yml`.
- systemd unit + packaging docs.
- Better error messages for specific download failures.

## Code of conduct

Be decent. Harassment or discrimination of any kind isn't welcome here.
