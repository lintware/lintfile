import { randomUUIDv7 } from "bun";
import QRCode from "qrcode";
import { networkInterfaces } from "os";

// --- Types ---

interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  data: Buffer;
  createdAt: number;
}

interface StoredText {
  id: string;
  content: string;
  createdAt: number;
}

interface Session {
  id: string;
  files: StoredFile[];
  texts: StoredText[];
  createdAt: number;
}

// --- In-memory store ---

const sessions = new Map<string, Session>();
const wsClients = new Map<string, Set<WebSocket>>();

function getOrCreateSession(id?: string): Session {
  if (id && sessions.has(id)) return sessions.get(id)!;
  const session: Session = {
    id: id || randomUUIDv7(),
    files: [],
    texts: [],
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

// Cleanup sessions older than 24h, every hour
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
      wsClients.delete(id);
    }
  }
}, 60 * 60 * 1000);

// --- Network IP detection ---

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// --- Broadcast to WebSocket clients ---

function broadcast(sessionId: string, message: object) {
  const clients = wsClients.get(sessionId);
  if (!clients) return;
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// --- HTML Pages ---

function receiverHTML(sessionId: string, qrDataUrl: string, sendUrl: string): string {
  const session = sessions.get(sessionId)!;

  const existingItems = [...session.texts.map(t => ({
    type: 'text' as const, id: t.id, content: t.content, createdAt: t.createdAt
  })), ...session.files.map(f => ({
    type: 'file' as const, id: f.id, name: f.name, mime: f.type, size: f.size, createdAt: f.createdAt
  }))].sort((a, b) => a.createdAt - b.createdAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LintFile - Receiver</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem;
  }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .qr-container {
    background: #fff; border-radius: 16px; padding: 1.25rem; margin-bottom: 1rem;
    box-shadow: 0 0 40px rgba(255,255,255,0.05);
  }
  .qr-container img { display: block; width: 220px; height: 220px; }
  .url-display {
    color: #666; font-size: 0.75rem; margin-bottom: 2rem; font-family: monospace;
    background: #161616; padding: 0.5rem 1rem; border-radius: 6px; user-select: all;
  }
  .status { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #888; }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #444;
    transition: background 0.3s;
  }
  .status-dot.connected { background: #4ade80; }
  .feed { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 0.75rem; }
  .feed-item {
    background: #161616; border: 1px solid #262626; border-radius: 10px; padding: 1rem;
    animation: fadeIn 0.3s ease;
  }
  .feed-item .meta { font-size: 0.7rem; color: #555; margin-bottom: 0.5rem; }
  .feed-item.text-item .content {
    white-space: pre-wrap; word-break: break-word; font-size: 0.95rem; line-height: 1.5;
  }
  .feed-item.file-item { display: flex; align-items: center; gap: 1rem; }
  .feed-item.file-item .file-icon {
    width: 40px; height: 40px; border-radius: 8px; background: #262626;
    display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;
  }
  .feed-item.file-item .file-info { flex: 1; min-width: 0; }
  .feed-item.file-item .file-name {
    font-size: 0.9rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .feed-item.file-item .file-size { font-size: 0.75rem; color: #666; }
  .feed-item.file-item a {
    color: #60a5fa; text-decoration: none; font-size: 0.8rem; flex-shrink: 0;
  }
  .feed-item.file-item a:hover { text-decoration: underline; }
  .image-preview {
    max-width: 100%; max-height: 300px; border-radius: 8px; margin-top: 0.5rem; object-fit: contain;
  }
  .empty-state { text-align: center; color: #444; padding: 3rem 1rem; font-size: 0.9rem; }
  .github-link { position: fixed; bottom: 1rem; right: 1rem; color: #444; font-size: 0.75rem; text-decoration: none; }
  .github-link:hover { color: #888; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
</style>
<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onFeatureFlags onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('phc_9dAu8iyvFf71WULMCgpxI5OP5KaBidCC2nuMfCG2rj3',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'})</script>
</head>
<body>
  <h1>LintFile</h1>
  <p class="subtitle">Scan the QR code with your phone to send files</p>
  <div class="qr-container"><img src="${qrDataUrl}" alt="QR Code"></div>
  <div class="url-display">${sendUrl}</div>
  <div class="status"><span class="status-dot" id="statusDot"></span><span id="statusText">Connecting...</span></div>
  <div class="feed" id="feed">
    ${existingItems.length === 0 ? '<div class="empty-state" id="emptyState">Waiting for files...</div>' : ''}
  </div>
<script>
const sessionId = "${sessionId}";
const feed = document.getElementById('feed');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const existingItems = ${JSON.stringify(existingItems)};

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function fileIcon(mime) {
  if (mime && mime.startsWith('image/')) return '🖼';
  if (mime && mime.startsWith('video/')) return '🎬';
  if (mime && mime.startsWith('audio/')) return '🎵';
  if (mime && mime.includes('pdf')) return '📄';
  if (mime && mime.includes('zip')) return '📦';
  return '📎';
}

function timeStr(ts) {
  return new Date(ts).toLocaleTimeString();
}

function removeEmpty() {
  const e = document.getElementById('emptyState');
  if (e) e.remove();
}

function addTextItem(item) {
  removeEmpty();
  const div = document.createElement('div');
  div.className = 'feed-item text-item';
  div.innerHTML = '<div class="meta">Text \u00b7 ' + timeStr(item.createdAt) + '</div><div class="content">' + escapeHtml(item.content) + '</div>';
  feed.prepend(div);
}

function addFileItem(item) {
  removeEmpty();
  const div = document.createElement('div');
  const isImage = item.mime && item.mime.startsWith('image/');
  const downloadUrl = '/api/download/' + sessionId + '/' + item.id;

  let html = '<div class="file-icon">' + fileIcon(item.mime) + '</div>';
  html += '<div class="file-info"><div class="file-name">' + escapeHtml(item.name) + '</div>';
  html += '<div class="file-size">' + formatSize(item.size) + '</div></div>';
  html += '<a href="' + downloadUrl + '" download="' + escapeHtml(item.name) + '">Download</a>';

  if (isImage) {
    const wrapper = document.createElement('div');
    wrapper.className = 'feed-item';
    wrapper.innerHTML = '<div class="meta">' + escapeHtml(item.name) + ' \u00b7 ' + formatSize(item.size) + ' \u00b7 ' + timeStr(item.createdAt) + '</div>';
    const img = document.createElement('img');
    img.className = 'image-preview';
    img.src = downloadUrl;
    img.alt = item.name;
    wrapper.appendChild(img);

    const fileRow = document.createElement('div');
    fileRow.style.display = 'flex';
    fileRow.style.alignItems = 'center';
    fileRow.style.gap = '1rem';
    fileRow.style.marginTop = '0.5rem';
    fileRow.innerHTML = html;
    wrapper.appendChild(fileRow);
    feed.prepend(wrapper);
  } else {
    div.className = 'feed-item file-item';
    div.innerHTML = html;
    feed.prepend(div);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Render existing items (oldest first, prepend reverses to newest-on-top)
existingItems.forEach(item => {
  if (item.type === 'text') addTextItem(item);
  else addFileItem(item);
});

// WebSocket connection
let ws;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws/' + sessionId);
  ws.onopen = () => { statusDot.classList.add('connected'); statusText.textContent = 'Connected'; };
  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusText.textContent = 'Reconnecting...';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'text') addTextItem(msg);
    else if (msg.type === 'file') addFileItem(msg);
  };
}
connect();
</script>
<a class="github-link" href="https://github.com/lintware/lintfile" target="_blank">GitHub</a>
</body>
</html>`;
}

function senderHTML(sessionId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>LintFile - Send</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh; display: flex; flex-direction: column; padding: 1.5rem;
  }
  h1 { font-size: 1.3rem; font-weight: 600; color: #fff; margin-bottom: 0.25rem; }
  .subtitle { color: #888; font-size: 0.8rem; margin-bottom: 1.5rem; }

  .drop-zone {
    border: 2px dashed #333; border-radius: 14px; padding: 2rem 1rem;
    text-align: center; color: #666; font-size: 0.9rem; margin-bottom: 1rem;
    transition: all 0.2s;
  }
  .drop-zone.active { border-color: #60a5fa; background: rgba(96,165,250,0.05); color: #60a5fa; }

  .actions { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
  .btn {
    display: flex; align-items: center; justify-content: center; gap: 0.75rem;
    padding: 1rem; border-radius: 12px; border: 1px solid #262626; background: #161616;
    color: #e0e0e0; font-size: 1rem; font-weight: 500; cursor: pointer;
    transition: all 0.15s; -webkit-tap-highlight-color: transparent;
  }
  .btn:active { transform: scale(0.98); background: #1a1a1a; }
  .btn .icon { font-size: 1.3rem; }
  .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  .btn-primary:active { background: #1d4ed8; }

  .text-section { margin-bottom: 1.5rem; }
  .text-section textarea {
    width: 100%; min-height: 100px; background: #161616; border: 1px solid #262626;
    border-radius: 12px; padding: 0.875rem; color: #e0e0e0; font-size: 0.95rem;
    font-family: inherit; resize: vertical; outline: none;
  }
  .text-section textarea:focus { border-color: #444; }
  .text-section .send-text { margin-top: 0.5rem; width: 100%; }

  .progress {
    background: #161616; border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem;
    border: 1px solid #262626; display: none;
  }
  .progress.show { display: block; }
  .progress-bar-bg { background: #262626; border-radius: 4px; height: 6px; overflow: hidden; margin-top: 0.5rem; }
  .progress-bar { background: #2563eb; height: 100%; width: 0%; transition: width 0.2s; border-radius: 4px; }
  .progress-text { font-size: 0.8rem; color: #888; }

  .toast {
    position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%) translateY(100px);
    background: #4ade80; color: #000; padding: 0.75rem 1.5rem; border-radius: 10px;
    font-weight: 600; font-size: 0.9rem; transition: transform 0.3s ease; z-index: 100;
  }
  .toast.show { transform: translateX(-50%) translateY(0); }

  .sent-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .sent-item {
    background: #161616; border: 1px solid #262626; border-radius: 8px; padding: 0.75rem;
    font-size: 0.85rem; color: #888; display: flex; align-items: center; gap: 0.5rem;
  }
  .sent-item .check { color: #4ade80; }

  .github-link { position: fixed; bottom: 1rem; right: 1rem; color: #444; font-size: 0.75rem; text-decoration: none; }
  .github-link:hover { color: #888; }
  input[type="file"] { display: none; }
</style>
<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onFeatureFlags onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('phc_9dAu8iyvFf71WULMCgpxI5OP5KaBidCC2nuMfCG2rj3',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'})</script>
</head>
<body>
  <h1>LintFile</h1>
  <p class="subtitle">Send files and text to the connected computer</p>

  <div class="drop-zone" id="dropZone">Drop files here or use buttons below</div>

  <div class="progress" id="progress">
    <div class="progress-text" id="progressText">Uploading...</div>
    <div class="progress-bar-bg"><div class="progress-bar" id="progressBar"></div></div>
  </div>

  <div class="actions">
    <button class="btn btn-primary" id="uploadBtn"><span class="icon">📁</span> Upload Files</button>
    <button class="btn" id="cameraBtn"><span class="icon">📷</span> Take Photo</button>
  </div>

  <div class="text-section">
    <textarea id="textInput" placeholder="Paste or type text here..."></textarea>
    <button class="btn send-text" id="sendTextBtn"><span class="icon">📝</span> Send Text</button>
  </div>

  <div class="sent-list" id="sentList"></div>

  <div class="toast" id="toast">Sent!</div>

  <input type="file" id="fileInput" multiple>
  <input type="file" id="cameraInput" accept="image/*" capture="environment">

<script>
const sessionId = "${sessionId}";
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const textInput = document.getElementById('textInput');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const sentList = document.getElementById('sentList');
const toast = document.getElementById('toast');

function showToast(msg) {
  toast.textContent = msg || 'Sent!';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

function addSentItem(text) {
  const div = document.createElement('div');
  div.className = 'sent-item';
  div.innerHTML = '<span class="check">\u2713</span> ' + text;
  sentList.prepend(div);
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

async function uploadFiles(files) {
  if (!files.length) return;
  progress.classList.add('show');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_SIZE) {
      showToast(file.name + ' exceeds 100MB limit');
      continue;
    }
    progressText.textContent = 'Uploading ' + (i + 1) + '/' + files.length + ': ' + file.name;
    progressBar.style.width = '0%';

    const form = new FormData();
    form.append('file', file);

    try {
      const xhr = new XMLHttpRequest();
      await new Promise((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) progressBar.style.width = Math.round(e.loaded / e.total * 100) + '%';
        };
        xhr.onload = () => {
          if (xhr.status === 200) { addSentItem(file.name); resolve(); }
          else if (xhr.status === 413) reject(new Error('File exceeds 100MB limit'))
          else reject(new Error('Upload failed'));
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('POST', '/api/upload/' + sessionId);
        xhr.send(form);
      });
    } catch (err) {
      progressText.textContent = 'Error: ' + err.message;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  progressBar.style.width = '100%';
  progressText.textContent = 'Done!';
  showToast(files.length > 1 ? files.length + ' files sent!' : 'File sent!');
  setTimeout(() => { progress.classList.remove('show'); progressBar.style.width = '0%'; }, 1500);
}

document.getElementById('uploadBtn').onclick = () => fileInput.click();
document.getElementById('cameraBtn').onclick = () => cameraInput.click();
fileInput.onchange = (e) => uploadFiles(e.target.files);
cameraInput.onchange = (e) => uploadFiles(e.target.files);

document.getElementById('sendTextBtn').onclick = async () => {
  const text = textInput.value.trim();
  if (!text) return;
  try {
    const res = await fetch('/api/text/' + sessionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (res.ok) {
      addSentItem('Text (' + text.length + ' chars)');
      showToast('Text sent!');
      textInput.value = '';
    }
  } catch (err) {
    showToast('Error sending text');
  }
};

// Drag and drop
dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('active'); };
dropZone.ondragleave = () => dropZone.classList.remove('active');
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove('active');
  uploadFiles(e.dataTransfer.files);
};

// Also allow clicking the drop zone
dropZone.onclick = () => fileInput.click();
</script>
<a class="github-link" href="https://github.com/lintware/lintfile" target="_blank">GitHub</a>
</body>
</html>`;
}

// --- Server ---

const PORT = parseInt(process.env.PORT || "8473");
const PUBLIC_HOST = process.env.PUBLIC_HOST || "";
const localIP = getLocalIP();

const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (path.startsWith("/ws/")) {
      const sessionId = path.slice(4);
      if (!sessions.has(sessionId)) {
        return new Response("Session not found", { status: 404 });
      }
      const upgraded = server.upgrade(req, { data: { sessionId } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
      return undefined as any;
    }

    // --- API Routes ---

    // File upload
    if (path.startsWith("/api/upload/") && req.method === "POST") {
      const sessionId = path.slice(12);
      const session = sessions.get(sessionId);
      if (!session) return new Response("Session not found", { status: 404 });

      const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return new Response("No file provided", { status: 400 });
      if (file.size > MAX_FILE_SIZE) {
        return Response.json({ error: "File exceeds 100MB limit" }, { status: 413 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const storedFile: StoredFile = {
        id: randomUUIDv7(),
        name: file.name,
        type: file.type,
        size: file.size,
        data: buffer,
        createdAt: Date.now(),
      };
      session.files.push(storedFile);

      broadcast(sessionId, {
        type: "file",
        id: storedFile.id,
        name: storedFile.name,
        mime: storedFile.type,
        size: storedFile.size,
        createdAt: storedFile.createdAt,
      });

      return Response.json({ ok: true, id: storedFile.id });
    }

    // Text send
    if (path.startsWith("/api/text/") && req.method === "POST") {
      const sessionId = path.slice(10);
      const session = sessions.get(sessionId);
      if (!session) return new Response("Session not found", { status: 404 });

      const body = await req.json() as { text: string };
      if (!body.text) return new Response("No text provided", { status: 400 });

      const storedText: StoredText = {
        id: randomUUIDv7(),
        content: body.text,
        createdAt: Date.now(),
      };
      session.texts.push(storedText);

      broadcast(sessionId, {
        type: "text",
        id: storedText.id,
        content: storedText.content,
        createdAt: storedText.createdAt,
      });

      return Response.json({ ok: true, id: storedText.id });
    }

    // File download
    if (path.startsWith("/api/download/")) {
      const parts = path.slice(14).split("/");
      const sessionId = parts[0];
      const fileId = parts[1];
      const session = sessions.get(sessionId);
      if (!session) return new Response("Session not found", { status: 404 });

      const file = session.files.find((f) => f.id === fileId);
      if (!file) return new Response("File not found", { status: 404 });

      return new Response(file.data, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "Content-Disposition": `inline; filename="${file.name}"`,
          "Content-Length": String(file.size),
        },
      });
    }

    // --- Pages ---

    // Sender page
    if (path.startsWith("/send/")) {
      const sessionId = path.slice(6);
      if (!sessions.has(sessionId)) {
        return new Response("Session not found. The link may have expired.", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response(senderHTML(sessionId), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Receiver page (home)
    if (path === "/" || path === "") {
      const session = getOrCreateSession();
      const sendUrl = PUBLIC_HOST
        ? `https://${PUBLIC_HOST}/send/${session.id}`
        : `http://${localIP}:${PORT}/send/${session.id}`;
      const qrDataUrl = await QRCode.toDataURL(sendUrl, {
        width: 440,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      return new Response(receiverHTML(session.id, qrDataUrl, sendUrl), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      if (!wsClients.has(sessionId)) {
        wsClients.set(sessionId, new Set());
      }
      wsClients.get(sessionId)!.add(ws as unknown as WebSocket);
    },
    close(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      wsClients.get(sessionId)?.delete(ws as unknown as WebSocket);
    },
    message() {
      // Receiver doesn't send messages
    },
  },
});

console.log(`
  LintFile Server
  ─────────────────────────────────
  Local:   http://localhost:${PORT}
  Network: http://${localIP}:${PORT}${PUBLIC_HOST ? `\n  Public:  https://${PUBLIC_HOST}` : ""}
  ─────────────────────────────────
`);
