# LintFile �ariant

A fast, privacy-first file and text sharing tool. Send files and text between your computer and phone instantly—no accounts, no cloud storage, no hassle.

![LintFile Interface](image.png)

## Features

- **Instant Sharing** — Open, scan QR, send. That's it.
- **Privacy First** — Files stay on your device. No cloud storage, no accounts.
- **Cross-Device** — Desktop to mobile, or vice versa.
- **Real-Time Updates** — See files arrive as they come in.
- **Text & Files** — Send plain text or files up to 100MB.

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run server.ts

# Or specify a custom port
PORT=8473 bun run server.ts
```

Open `http://localhost:8473` on your computer to get started.

## Production

```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# Restart
pm2 restart lintfile

# View logs
pm2 logs lintfile
```

## How It Works

1. **Receiver** — Open LintFile on your computer. You'll see a QR code.
2. **Sender** — Scan the QR code with your phone to open the sender page.
3. **Send** — Upload files or type text on your phone.
4. **Receive** — Watch files appear instantly on your computer.

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Server:** Single-file HTTP server with WebSocket
- **QR Generation:** `qrcode` package
- **TypeScript** for type safety

## API

If you want to integrate programmatically:

```bash
# Upload a file
curl -X POST http://localhost:8473/api/upload/:sessionId \
  -F "file=@/path/to/file.txt"

# Send text
curl -X POST http://localhost:8473/api/text/:sessionId \
  -H "Content-Type: application/json" \
  -d '{ "text": "Hello from CLI!" }'

# Download a file
curl -O http://localhost:8473/api/download/:sessionId/:fileId
```

## License

MIT

---

Built with 🔥 by [LintWare](https://lintware.com)
