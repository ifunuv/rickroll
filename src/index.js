// ============================================================
//  Cloudflare Worker — Personal Web Proxy
//  Có giao diện web đẹp + proxy URL
// ============================================================

const PASSWORD = "victory_v2_proxy"; // ← ĐỔI MẬT KHẨU Ở ĐÂY

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const PWD = env.PASSWORD || PASSWORD;

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // ---- Trang chủ ----
    if (path === "/" || path === "") {
      return new Response(getHTML(), {
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      });
    }

    // ---- API: Lấy thông tin IP Worker ----
    if (path === "/api/info") {
      const pwd = url.searchParams.get("pwd");
      if (pwd !== PWD) return jsonErr("Sai mật khẩu!", 401, cors);

      return new Response(JSON.stringify({
        ok: true,
        datacenter: request.cf?.colo,
        country: request.cf?.country,
        city: request.cf?.city,
        region: request.cf?.region,
        timezone: request.cf?.timezone,
        asOrganization: request.cf?.asOrganization,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ---- API: Proxy fetch URL ----
    if (path === "/api/fetch") {
      const pwd = url.searchParams.get("pwd");
      if (pwd !== PWD) return jsonErr("Sai mật khẩu!", 401, cors);

      const target = url.searchParams.get("url");
      if (!target) return jsonErr("Thiếu ?url=", 400, cors);

      let targetURL;
      try { targetURL = new URL(target); }
      catch { return jsonErr("URL không hợp lệ", 400, cors); }

      try {
        const res = await fetch(targetURL.toString(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });

        const ct = res.headers.get("Content-Type") || "text/plain";
        let body = await res.text();

        // Nếu là HTML thì inject base tag để assets load được
        if (ct.includes("text/html")) {
          body = body.replace(/<head>/i, `<head><base href="${targetURL.origin}/">`);
        }

        return new Response(JSON.stringify({
          ok: true,
          status: res.status,
          contentType: ct,
          country: request.cf?.country,
          datacenter: request.cf?.colo,
          body: body.slice(0, 500000), // giới hạn 500KB
        }), { headers: { ...cors, "Content-Type": "application/json" } });

      } catch (err) {
        return jsonErr(`Lỗi fetch: ${err.message}`, 500, cors);
      }
    }

    return jsonErr("Not found", 404, cors);
  }
};

function jsonErr(msg, status, cors) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ProxyHub — Personal Web Proxy</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #080b12;
    --surface: #0e1420;
    --border: #1e2a3a;
    --accent: #00d4ff;
    --accent2: #7c3aed;
    --text: #e2e8f0;
    --muted: #64748b;
    --success: #10b981;
    --error: #ef4444;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Syne', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* Background grid */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: 
      linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
  }

  .container {
    position: relative;
    z-index: 1;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 20px;
  }

  /* Header */
  .header {
    text-align: center;
    margin-bottom: 48px;
  }
  .logo {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--accent);
    letter-spacing: 4px;
    text-transform: uppercase;
    margin-bottom: 12px;
    opacity: 0.8;
  }
  h1 {
    font-size: clamp(36px, 6vw, 64px);
    font-weight: 800;
    line-height: 1;
    background: linear-gradient(135deg, #fff 0%, var(--accent) 50%, var(--accent2) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 12px;
  }
  .subtitle {
    color: var(--muted);
    font-size: 14px;
    font-family: 'JetBrains Mono', monospace;
  }

  /* Card */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 20px;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    opacity: 0.5;
  }

  .card-title {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--accent);
    letter-spacing: 3px;
    text-transform: uppercase;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card-title::before {
    content: '';
    width: 6px; height: 6px;
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--accent);
  }

  /* Password input */
  .input-row {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }
  input[type="password"], input[type="text"], input[type="url"] {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 16px;
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus { border-color: var(--accent); }
  input::placeholder { color: var(--muted); }

  /* URL input big */
  .url-input {
    width: 100%;
    margin-bottom: 12px;
    font-size: 14px;
    padding: 14px 18px;
  }

  /* Buttons */
  .btn {
    padding: 12px 24px;
    border: none;
    border-radius: 10px;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.5px;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: #fff;
    box-shadow: 0 0 20px rgba(0,212,255,0.2);
  }
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 30px rgba(0,212,255,0.35);
  }
  .btn-primary:active { transform: translateY(0); }
  .btn-sm {
    padding: 8px 16px;
    font-size: 12px;
  }
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }

  /* Info badge */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
  .info-item {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    text-align: center;
  }
  .info-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 6px;
  }
  .info-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    color: var(--accent);
    font-weight: 700;
  }

  /* Status */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--muted);
    margin-top: 12px;
    min-height: 20px;
  }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.success { background: var(--success); box-shadow: 0 0 6px var(--success); }
  .dot.error { background: var(--error); box-shadow: 0 0 6px var(--error); }
  .dot.loading {
    background: var(--accent);
    animation: pulse 1s infinite;
    box-shadow: 0 0 6px var(--accent);
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* Result iframe */
  .result-frame {
    display: none;
    width: 100%;
    height: 82vh;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: #fff;
    margin-top: 16px;
    transition: all 0.3s;
  }
  .result-frame.fullscreen {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
    border-radius: 0;
    border: none;
    margin: 0;
  }

  .fullscreen-bar {
    display: none;
    position: fixed;
    top: 12px; right: 12px;
    z-index: 10000;
  }
  .fullscreen-bar.visible { display: flex; }

  /* Result text */
  .result-text {
    display: none;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--text);
    max-height: 400px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin-top: 16px;
    line-height: 1.6;
  }

  /* Auth overlay */
  .auth-lock {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.3);
    border-radius: 10px;
    padding: 12px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #ef4444;
    margin-bottom: 16px;
    display: none;
  }

  .actions-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  /* Footer */
  .footer {
    text-align: center;
    margin-top: 48px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    opacity: 0.5;
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="logo">Personal Web Proxy</div>
    <h1>ProxyHub</h1>
    <div class="subtitle">// Cloudflare Edge Network · Secure · Fast</div>
  </div>

  <!-- Auth Card -->
  <div class="card">
    <div class="card-title">Authentication</div>
    <div class="input-row">
      <input type="password" id="pwdInput" placeholder="Nhập mật khẩu..." onkeydown="if(event.key==='Enter')verifyPwd()">
      <button class="btn btn-primary" onclick="verifyPwd()">Unlock</button>
    </div>
    <div class="auth-lock" id="authError">⚠ Sai mật khẩu!</div>
    <div class="status-bar" id="authStatus">
      <div class="dot" id="authDot"></div>
      <span id="authText">Chưa xác thực</span>
    </div>
  </div>

  <!-- Worker Info Card -->
  <div class="card" id="infoCard" style="display:none">
    <div class="card-title">Worker Info</div>
    <div class="info-grid" id="infoGrid">
      <div class="info-item"><div class="info-label">Datacenter</div><div class="info-value" id="i-dc">—</div></div>
      <div class="info-item"><div class="info-label">Country</div><div class="info-value" id="i-country">—</div></div>
      <div class="info-item"><div class="info-label">City</div><div class="info-value" id="i-city">—</div></div>
      <div class="info-item"><div class="info-label">Timezone</div><div class="info-value" id="i-tz">—</div></div>
      <div class="info-item"><div class="info-label">ASN Org</div><div class="info-value" id="i-asn" style="font-size:11px">—</div></div>
    </div>
  </div>

  <!-- Proxy Card -->
  <div class="card" id="proxyCard" style="display:none">
    <div class="card-title">Web Proxy</div>
    <input type="url" class="url-input" id="urlInput" placeholder="https://example.com" onkeydown="if(event.key==='Enter')fetchURL()">
    <div class="actions-row">
      <button class="btn btn-primary" onclick="fetchURL()">🚀 Fetch</button>
      <button class="btn btn-ghost btn-sm" id="btnRender" onclick="showMode('render')">Render HTML</button>
      <button class="btn btn-ghost btn-sm" id="btnText" onclick="showMode('text')">Raw Text</button>
      <button class="btn btn-ghost btn-sm" onclick="toggleFullscreen()" id="btnFS">⛶ Fullscreen</button>
      <button class="btn btn-ghost btn-sm" onclick="openNewTab()">↗ New Tab</button>
      <button class="btn btn-ghost btn-sm" onclick="clearResult()">✕ Clear</button>
    </div>
    <div class="status-bar" id="proxyStatus">
      <div class="dot" id="proxyDot"></div>
      <span id="proxyText">Sẵn sàng</span>
    </div>
    <iframe id="resultFrame" class="result-frame" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
    <div id="resultText" class="result-text"></div>
  </div>

  <!-- Fullscreen exit button -->
  <div class="fullscreen-bar" id="fsBar">
    <button class="btn btn-primary btn-sm" onclick="toggleFullscreen()">✕ Thoát Fullscreen</button>
  </div>

  <div class="footer">ProxyHub · Running on Cloudflare Edge · Personal use only</div>
</div>

<script>
let pwd = '';
let mode = 'render';
let lastHTML = '';

function showMode(m) {
  mode = m;
  document.getElementById('btnRender').style.borderColor = m === 'render' ? 'var(--accent)' : '';
  document.getElementById('btnRender').style.color = m === 'render' ? 'var(--accent)' : '';
  document.getElementById('btnText').style.borderColor = m === 'text' ? 'var(--accent)' : '';
  document.getElementById('btnText').style.color = m === 'text' ? 'var(--accent)' : '';
  // Re-render nếu đã có data
  if (lastHTML) {
    if (m === 'render') {
      document.getElementById('resultText').style.display = 'none';
      const frame = document.getElementById('resultFrame');
      frame.style.display = 'block';
      frame.srcdoc = lastHTML;
    } else {
      document.getElementById('resultFrame').style.display = 'none';
      const txt = document.getElementById('resultText');
      txt.style.display = 'block';
      txt.textContent = lastHTML;
    }
  }
}
showMode('render');

function toggleFullscreen() {
  const frame = document.getElementById('resultFrame');
  const fsBar = document.getElementById('fsBar');
  const isFS = frame.classList.contains('fullscreen');
  frame.classList.toggle('fullscreen');
  fsBar.classList.toggle('visible', !isFS);
  document.getElementById('btnFS').textContent = isFS ? '⛶ Fullscreen' : '⛶ Exit';
  document.body.style.overflow = isFS ? '' : 'hidden';
}

function openNewTab() {
  if (!lastHTML) return;
  const blob = new Blob([lastHTML], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

async function verifyPwd() {
  pwd = document.getElementById('pwdInput').value;
  if (!pwd) return;

  setStatus('authDot', 'authText', 'loading', 'Đang xác thực...');
  document.getElementById('authError').style.display = 'none';

  try {
    const res = await fetch(\`/api/info?pwd=\${encodeURIComponent(pwd)}\`);
    const data = await res.json();

    if (!data.ok) {
      document.getElementById('authError').style.display = 'flex';
      setStatus('authDot', 'authText', 'error', 'Xác thực thất bại');
      return;
    }

    setStatus('authDot', 'authText', 'success', '✓ Đã xác thực');
    document.getElementById('infoCard').style.display = 'block';
    document.getElementById('proxyCard').style.display = 'block';

    // Fill info
    document.getElementById('i-dc').textContent = data.datacenter || '—';
    document.getElementById('i-country').textContent = data.country || '—';
    document.getElementById('i-city').textContent = data.city || '—';
    document.getElementById('i-tz').textContent = data.timezone || '—';
    document.getElementById('i-asn').textContent = data.asOrganization || '—';

  } catch(e) {
    setStatus('authDot', 'authText', 'error', 'Lỗi kết nối');
  }
}

async function fetchURL() {
  const urlEl = document.getElementById('urlInput');
  let url = urlEl.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) {
    url = 'https://' + url;
    urlEl.value = url;
  }

  setStatus('proxyDot', 'proxyText', 'loading', 'Đang tải...');
  document.getElementById('resultFrame').style.display = 'none';
  document.getElementById('resultText').style.display = 'none';
  lastHTML = '';

  try {
    const res = await fetch(\`/api/fetch?pwd=\${encodeURIComponent(pwd)}&url=\${encodeURIComponent(url)}\`);
    const data = await res.json();

    if (!data.ok) {
      setStatus('proxyDot', 'proxyText', 'error', '✗ ' + data.error);
      return;
    }

    lastHTML = data.body;
    setStatus('proxyDot', 'proxyText', 'success', \`✓ \${data.status} · \${data.country} [\${data.datacenter}] · \${(data.body.length/1024).toFixed(1)}KB\`);

    if (mode === 'render' && data.contentType.includes('text/html')) {
      const frame = document.getElementById('resultFrame');
      frame.style.display = 'block';
      frame.srcdoc = data.body;
    } else {
      const txt = document.getElementById('resultText');
      txt.style.display = 'block';
      txt.textContent = data.body;
    }

  } catch(e) {
    setStatus('proxyDot', 'proxyText', 'error', 'Lỗi: ' + e.message);
  }
}

function clearResult() {
  lastHTML = '';
  document.getElementById('resultFrame').style.display = 'none';
  document.getElementById('resultText').style.display = 'none';
  // Exit fullscreen if active
  const frame = document.getElementById('resultFrame');
  if (frame.classList.contains('fullscreen')) toggleFullscreen();
  setStatus('proxyDot', 'proxyText', '', 'Sẵn sàng');
}

function setStatus(dotId, textId, state, msg) {
  const dot = document.getElementById(dotId);
  dot.className = 'dot' + (state ? ' ' + state : '');
  document.getElementById(textId).textContent = msg;
}
</script>
</body>
</html>`;
}
