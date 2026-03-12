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
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem; padding-top: 4rem;
  }
  .top-bar {
    position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1.25rem; z-index: 50; background: #0a0a0a;
  }
  .top-bar .logo { display: flex; align-items: center; gap: 0.5rem; text-decoration: none; color: #888; font-size: 0.8rem; font-weight: 500; }
  .top-bar .logo:hover { color: #bbb; }
  .top-bar .logo img { width: 22px; height: 22px; }
  .top-bar .github-link { color: #555; transition: color 0.2s; }
  .top-bar .github-link:hover { color: #e0e0e0; }
  .top-bar .github-link svg { width: 24px; height: 24px; }
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
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
</style>
<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onFeatureFlags onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('phc_9dAu8iyvFf71WULMCgpxI5OP5KaBidCC2nuMfCG2rj3',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'})</script>
</head>
<body>
  <div class="top-bar">
    <a class="logo" href="https://lintware.com" target="_blank"><img src="data:image/png;base64,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" alt="LintLabs">
LintLabs</a>
    <a class="github-link" href="https://github.com/lintware/lintfile" target="_blank"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
  </div>
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
    min-height: 100vh; display: flex; flex-direction: column; padding: 1.5rem; padding-top: 4rem;
  }
  .top-bar {
    position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1.25rem; z-index: 50; background: #0a0a0a;
  }
  .top-bar .logo { display: flex; align-items: center; gap: 0.5rem; text-decoration: none; color: #888; font-size: 0.8rem; font-weight: 500; }
  .top-bar .logo:hover { color: #bbb; }
  .top-bar .logo img { width: 22px; height: 22px; }
  .top-bar .github-link { color: #555; transition: color 0.2s; }
  .top-bar .github-link:hover { color: #e0e0e0; }
  .top-bar .github-link svg { width: 24px; height: 24px; }
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

  input[type="file"] { display: none; }
</style>
<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onFeatureFlags onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('phc_9dAu8iyvFf71WULMCgpxI5OP5KaBidCC2nuMfCG2rj3',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'})</script>
</head>
<body>
  <div class="top-bar">
    <a class="logo" href="https://lintware.com" target="_blank"><img src="data:image/png;base64,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" alt="LintLabs">
LintLabs</a>
    <a class="github-link" href="https://github.com/lintware/lintfile" target="_blank"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
  </div>
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
