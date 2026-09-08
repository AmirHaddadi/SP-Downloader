<div align="center">

# SP Downloader

**A free, open-source, self-hosted download manager.**

Paste a link — get an MP4, an MP3, or the file itself. Video pages, audio,
direct downloads and multi-part archives, all from one clean web UI, with a
searchable history and a configurable proxy.

[![License: MIT](https://img.shields.io/badge/License-MIT-e07b39.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node-%E2%89%A518-3c873a.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

</div>

---

## Why SP Downloader

Most download tools are either a command line you have to memorise, a bloated
desktop app, or a website that wraps ads around someone else's work. SP
Downloader is none of those:

- **100% free and open source.** MIT licensed. No accounts, no telemetry, no
  paywalled "pro" tier. Run it on your own machine, own your data.
- **One UI for everything.** A single link box handles video, audio-only, and
  plain file downloads — the app figures out which one you gave it.
- **Not tied to any one platform.** It rides on top of
  [`yt-dlp`](https://github.com/yt-dlp/yt-dlp), so it works with the
  1000+ sites yt-dlp supports, plus any direct `https://…/file.ext` URL.
- **Real history.** Every download is recorded, filterable by status, type and
  source, and resumable after a crash or a reboot.
- **Yours to host.** Pure Node.js, no framework, no build step. Works offline
  once the core is fetched.

## Features

| | |
|---|---|
| 🎬 **Video** | Pick a resolution, get a merged MP4. |
| 🎵 **Audio** | Extract straight to MP3 at a chosen bitrate. |
| 📦 **Files** | Direct downloads for archives, installers, documents, images, fonts… and automatic detection + grouping of **multi-part archives** (`file.part1.rar`, `file.7z.001`, `file.z01`, …). |
| 🗂️ **History & data separation** | Persistent history with status / format / source filters. Downloads are sorted on disk into `Video/`, `Music/` and `Files/` folders, dated by day. |
| ⏸️ **Pause · resume · retry** | Interrupted downloads continue from the partial file instead of starting over. |
| 🌐 **Proxy** | HTTP or SOCKS5 proxy, with a one-click "test & show my IP" check. |
| 🍪 **Browser cookies** | Optionally reuse your logged-in browser session for sources that require sign-in. |
| ⚡ **Live progress** | Server-Sent Events stream speed, ETA and a per-download log — up to 5 downloads in parallel. |
| 🌗 **Themeable PWA** | RTL-first, light / dark / auto, installable. |
| 🧩 **Self-updating core** | Update the bundled `yt-dlp` from the UI in one click. |

## Quick start

### Prerequisites

- **[Node.js](https://nodejs.org/) 18 or newer**
- **[FFmpeg](https://ffmpeg.org/download.html)** on your `PATH` (needed to merge
  video+audio and to convert to MP3)
  - Windows: `winget install Gyan.FFmpeg` &nbsp;·&nbsp; macOS: `brew install ffmpeg` &nbsp;·&nbsp; Debian/Ubuntu: `sudo apt install ffmpeg`
- MongoDB is **optional** — without it, history is kept in a local JSON file.

### Install & run

```bash
git clone https://github.com/AmirHaddadi/SP-Downloader.git
cd SP-Downloader
npm install

# fetch the yt-dlp core binary for your OS into ./bin
npm run update-core

# optional: create a .env (all values have sane defaults)
cp .env.example .env

npm start
```

Open **http://localhost:4000** and paste a link.

## Configuration

Runtime options live in the **Settings** panel of the UI and are stored in
`~/.vdl_config.json`:

| Setting | Purpose |
|---|---|
| Download folder | Root folder for all downloads. |
| Organise automatically | Sort into `Video/ Music/ Files/` sub-folders by date. |
| Browser cookies | Reuse cookies from Chrome / Edge / Firefox / Brave / Opera / Vivaldi, or a `cookies.txt` file. |
| Proxy | `http://user:pass@host:port` or `socks5://host:port`. |

Server-level options go in `.env` — see [`.env.example`](.env.example).

## How it works

```
public/            Vanilla JS + CSS PWA (no framework, no build)
src/
  server.js        HTTP server: static files, SSE stream, API router
  routes/api.js    REST endpoints (/api/meta, /api/download, /api/config, …)
  services/
    downloader.js  Spawns & tracks yt-dlp, parses progress, broadcasts events
    file-probe.js  Direct-file detection + multi-part archive enumeration
    database.js    Optional MongoDB connection
    config.js      User config read/write
  models/
    download-history.js  History store (MongoDB, or JSON-file fallback)
```

The backend never bakes in site-specific logic — a URL is either something
`yt-dlp` understands or a direct file, and both paths share the same queue,
progress model and history.

## Contributing

Issues and pull requests are very welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: new UI languages,
packaging (Docker, systemd), and download-source edge cases.

## Legal

SP Downloader is a general-purpose tool, like a web browser or `wget`. **You**
are responsible for having the right to download any given content and for
complying with the terms of service of the sites you use it with, and with your
local laws. The maintainers do not endorse or support copyright infringement.

## License

[MIT](LICENSE) © Amir Haddadi and contributors.
Built on the shoulders of [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and
[FFmpeg](https://ffmpeg.org/).

---

<div align="center">
🇮🇷 <a href="README.fa.md">راهنمای فارسی</a>
</div>
