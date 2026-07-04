# SP Downloader - Project Overview

## Introduction

**SP Downloader** is a lightweight, web-based video downloader application built with Node.js and yt-dlp. It provides a user-friendly interface for downloading videos and audio from various online platforms, with support for multiple formats, qualities, and advanced features like proxy support and cookie-based authentication.

---

## Project Structure

```
SP-Downloader/
├── bin/
│   ├── yt-dlp.exe          # yt-dlp binary for Windows
│   └── phantomjs.exe       # PhantomJS binary (likely for legacy support)
├── public/
│   ├── index.html          # Main HTML file (RTL/Persian interface)
│   ├── app.js              # Frontend JavaScript application
│   ├── style.css           # Frontend styles
│   ├── Logo.png            # Application logo
│   ├── favicon/            # Favicon assets
│   ├── fontawesome/        # Font Awesome icons
│   └── fonts/              # Custom Persian fonts (Shabnam family)
├── server.js               # Main backend server (Node.js/Express-like)
├── update-ytdlp.js         # Script to update yt-dlp binary
├── package.json            # Node.js project configuration
├── .env                    # Environment variables
├── .gitignore              # Gitignore file
└── .vscode/                # VSCode settings
```

---

## Technical Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js (Native HTTP module) |
| **Frontend** | Vanilla JavaScript, HTML5, CSS3 |
| **Video Downloader** | yt-dlp (embedded binary) |
| **UI Framework** | Custom (Font Awesome icons) |
| **Database** | MongoDB (configured but unused in current codebase) |
| **Styling** | RTL (Right-to-Left) for Persian language |

---

## Core Features

### 1. Video Downloading
- Supports downloading from **YouTube, TikTok, Instagram, Twitter/X, Vimeo, Twitch, Dailymotion, PornHub, XHamster** and more
- **Format selection**: Video or Audio-only
- **Quality selection**: Multiple resolution options (1080p, 720p, 480p, etc.)
- **Progress tracking**: Real-time download progress with ETA and speed

### 2. Platform Detection
Automatic platform detection with appropriate icons:
- YouTube, TikTok, Instagram, Twitter/X, Vimeo, Twitch, Dailymotion, PornHub, XHamster
- Fallback icon for unknown platforms

### 3. Batch Operations
- **Preview system**: Up to 5 simultaneous preview cards
- **Queue management**: Multiple downloads can be queued
- **Parallel processing**: Multiple downloads can run simultaneously

### 4. Download Management
- **Status tracking**: Queued, Downloading, Finalizing, Done, Error, Paused, Cancelled
- **Actions**: Start, Pause, Resume, Cancel, Remove
- **Auto-finalization**: Automatic conversion to MP4 format

### 5. Configuration
- **Download folder**: Customizable download directory
- **Proxy support**: HTTP/SOCKS5 proxy configuration with testing
- **Cookies**: Browser cookie integration for authenticated content
- **Theme**: Light/Dark/Auto theme modes

### 6. Administration
- **Admin panel**: Full download queue management
- **Statistics**: Total downloads, data usage, errors, uptime
- **Core updates**: Update yt-dlp binary (stable or master builds)
- **Admin authentication**: Password-protected admin access

---

## Architecture

### Backend (server.js)

The server is built using Node.js native `http` and `https` modules (no Express framework). Key components:

#### 1. **HTTP Server**
- Runs on configurable port (default: 4000)
- CORS-enabled for cross-origin requests
- Serves static files (HTML, CSS, JS, fonts, images)

#### 2. **API Endpoints**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meta` | Fetch video metadata (title, thumbnail, duration, available formats) |
| POST | `/api/download` | Start a new download |
| GET | `/api/download-file?id=X` | Download completed file |
| POST | `/api/cancel` | Cancel a download |
| POST | `/api/pause` | Pause a download |
| POST | `/api/resume` | Resume a paused download |
| POST | `/api/remove` | Remove a download from queue |
| GET/POST | `/api/config` | Get/Set configuration |
| POST | `/api/proxy-test` | Test proxy connectivity |
| POST | `/api/open-folder` | Open download folder in file explorer |
| GET | `/api/admin/stats` | Admin statistics |
| POST | `/api/admin/cancel` | Admin cancel download |
| POST | `/api/admin/update-ytdlp` | Update yt-dlp binary |
| GET | `/events` | Server-Sent Events for real-time updates |

#### 3. **Download Engine**
- Uses `child_process.spawn` to run yt-dlp
- Progress parsing from stdout/stderr
- Automatic merger to MP4 format using ffmpeg
- Error handling with specific messages for common issues

#### 4. **State Management**
- In-memory store for active downloads
- Map-based data structure for O(1) access
- SSE (Server-Sent Events) for real-time client updates

### Frontend (public/app.js & index.html)

#### 1. **User Interface**
- **RTL (Right-to-Left)**: Persian language support
- **Responsive design**: Works on desktop and mobile
- **Theme system**: Auto/Light/Dark modes
- **Toast notifications**: For user feedback

#### 2. **Components**
- **Search Bar**: URL input with platform icon detection
- **Preview Grid**: Up to 5 simultaneous preview cards
- **Download List**: Filterable by status (All, Downloading, Done, Error)
- **Admin Panel**: Full queue management and statistics
- **Settings Modal**: Configuration options

#### 3. **Features**
- **Preview System**: Fetch metadata before downloading
- **Format Selection**: Toggle between video and audio
- **Quality Selection**: Per-format quality options
- **Real-time Updates**: SSE-based progress updates
- **History**: Download history with filtering

---

## Configuration

### Environment Variables (.env)

```env
PORT=4000
ADMIN_PASSWORD=admin123
MONGODB_URI=mongodb://localhost:27017/sp_downloader
MONGODB_DB_NAME=sp_downloader
MONGODB_DOWNLOADS_COLLECTION=download_history
# NODE_ENV=production
```

### User Configuration (~/.vdl_config.json)

```json
{
  "downloadFolder": "C:\\Users\\...\\Downloads\\VDL",
  "cookiesFrom": "none",
  "cookiesFile": "",
  "proxy": ""
}
```

---

## Dependencies

### Runtime Dependencies (package.json)

```json
{
  "dotenv": "^17.4.2",
  "mongodb": "^7.3.0"
}
```

### External Binaries

- **yt-dlp**: Video downloader (embedded in `bin/` directory)
- **ffmpeg**: Required for video merging (must be installed system-wide)
- **curl**: Used for proxy testing

---

## Special Features

### 1. **XHamster Support**
Special handling for XHamster platform:
- Automatic age verification cookies
- Custom referer and origin headers
- Specific error messages for format issues
- Recommendation to update yt-dlp for age-restricted content

### 2. ** Persian Localization**
- Full Persian (Farsi) interface
- RTL layout support
- Custom Persian fonts (Shabnam family)
- Localized error messages

### 3. **Real-time Updates**
- Server-Sent Events (SSE) for push notifications
- Progress updates without polling
- Automatic UI refresh on status changes

### 4. **Auto-Update System**
- Update yt-dlp binary from GitHub
- Support for both stable and master builds
- Automatic fallback to system yt-dlp if embedded binary not found

---

## Security Considerations

1. **Admin Authentication**: Password-protected admin endpoints
2. **Input Validation**: URL validation for all download requests
3. **Path Sanitization**: Proper handling of file paths
4. **Process Isolation**: Child process spawning for yt-dlp
5. **Error Handling**: Comprehensive error handling with user-friendly messages

---

## Usage

### Starting the Server

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with custom port
PORT=5000 npm start
```

### Accessing the Application

1. Open browser to `http://localhost:4000`
2. Enter video URL in the search bar
3. Select format (Video or Audio)
4. Select quality
5. Click "Start Download"

### Updating yt-dlp

```bash
# Run the update script
node update-ytdlp.js

# Or through admin panel
# Navigate to admin panel and click "Update Core"
```

---

## Development Notes

### Dev Mode

Enable development mode for verbose logging:
```bash
DEV_MODE=1 npm start
```

### Project Scripts

```json
{
  "start": "node src/server.js",
  "dev": "node src/server.js",
  "update-core": "node update-ytdlp.js",
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

### File Structure Notes

- The `src/` directory mentioned in package.json doesn't exist (server.js is in root)
- The `public/` directory contains all static assets
- The `bin/` directory contains platform-specific binaries
- MongoDB is configured but not actively used in the current codebase (uses in-memory store)

---

## Limitations

1. **Platform Support**: Primarily tested on Windows (contains Windows-specific code)
2. **Database**: MongoDB configuration exists but memory-based store is used
3. **Mobile**: UI is responsive but may have limitations on mobile devices
4. **Authentication**: Only basic admin password protection
5. **Scalability**: In-memory store limits scalability for large numbers of downloads

---

## Future Enhancements

Potential improvements:
1. Implement MongoDB for persistent storage
2. Add user authentication system
3. Support for download scheduling
4. Advanced download filters (size, duration, etc.)
5. Batch download operations
6. Playlist support
7. Subtitle download
8. Thumbnail download
9. Metadata embedding
10. Multi-language support

---

## Credits

- **Developer**: Amir Hadadi (mentioned in footer)
- **Icon Library**: Font Awesome
- **Video Downloader**: yt-dlp (https://github.com/yt-dlp/yt-dlp)
- **Fonts**: Shabnam font family

---

## License

ISC License (as specified in package.json)

---

*Generated on 2026-07-04*
