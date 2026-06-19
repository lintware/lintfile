# LintFile

Fast, account-free file and text sharing between your devices.

Open LintFile on one device, scan the QR code from another, and send files, photos, or text straight into the receiver page. It is built for the common "I just need this on my laptop" moment without logins, inboxes, or chat apps in the middle.

[Use LintFile](https://file.lintware.com) · [GitHub](https://github.com/lintware/lintfile)

![TypeScript](https://img.shields.io/badge/typescript-bun-blue)
![License](https://img.shields.io/badge/license-MIT-green)

![LintFile receiver interface](image.png)

## Why LintFile

- QR-based handoff: open the receiver, scan, send.
- Files and text: upload documents, photos, screenshots, or paste short notes.
- Real-time receiver feed: sent items appear immediately over WebSockets.
- Large file support: normal uploads up to 100 MB, chunked uploads up to 2 GB per file.
- No accounts: every transfer is scoped to a temporary session URL.
- Self-hostable: a single Bun server with no database requirement.

## How It Works

1. Open `https://file.lintware.com` on the device that should receive the files.
2. Scan the QR code with the device that has the files or text.
3. Upload files, take a photo, or paste text from the sender page.
4. Download or view received items from the receiver page.

Sessions live in memory and are cleaned up after 24 hours. Small files are held in memory for the session. Larger chunked uploads are assembled under `.lintfile-storage` or the directory set with `STORAGE_DIR`.

## Local Development

Install dependencies:

```bash
bun install
```

Run the server:

```bash
bun run server.ts
```

Open the receiver page:

```text
http://localhost:8473
```

Use a custom port:

```bash
PORT=8473 bun run server.ts
```

For phone-to-computer testing on the same network, open the network URL printed by the server or scan the generated QR code.

## Configuration

LintFile is configured with environment variables:

- `PORT`: HTTP port. Defaults to `8473`.
- `PUBLIC_HOST`: public hostname used in QR links, for example `file.lintware.com`.
- `STORAGE_DIR`: directory for chunked upload assembly. Defaults to `.lintfile-storage`.

Example:

```bash
PORT=8473 PUBLIC_HOST=file.lintware.com STORAGE_DIR=/var/lib/lintfile bun run server.ts
```

## Production

This repo includes a PM2 config for running the Bun server:

```bash
pm2 start ecosystem.config.cjs
pm2 restart lintfile
pm2 logs lintfile
```

The production config sets:

```text
PORT=8473
PUBLIC_HOST=file.lintware.com
```

Put LintFile behind HTTPS in production. The app uses WebSockets, file uploads, and camera capture, so the reverse proxy should support:

- WebSocket upgrades for `/ws/:sessionId`
- Request bodies up to at least 100 MB for regular uploads
- Long enough timeouts for large chunked uploads

## API

Send text to a session:

```bash
curl -X POST http://localhost:8473/api/text/:sessionId \
  -H "Content-Type: application/json" \
  -d '{ "text": "Hello from CLI" }'
```

Upload a file to a session:

```bash
curl -X POST http://localhost:8473/api/upload/:sessionId \
  -F "file=@/path/to/file.txt"
```

Download a received file:

```bash
curl -O http://localhost:8473/api/download/:sessionId/:fileId
```

Large browser uploads use `/api/upload-chunk/:sessionId` automatically.

## Security Notes

LintFile keeps sharing simple, but session links are bearer links. Anyone with the sender URL can send files into that receiver session, and anyone with a download URL can access that file while the session exists.

Recommended deployment posture:

- Serve over HTTPS.
- Do not expose untrusted sessions longer than needed.
- Keep the generated session URL private.
- Run behind a proxy with sane upload limits and abuse controls.
- Use `STORAGE_DIR` on a volume that can tolerate temporary large files.

## Tech Stack

- [Bun](https://bun.sh) runtime
- TypeScript
- Bun HTTP server and WebSocket support
- [`qrcode`](https://www.npmjs.com/package/qrcode) for QR generation

## License

MIT

Built by [Lint Labs](https://github.com/lintware).
