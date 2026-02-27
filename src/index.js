// ============================================================
//  Cloudflare Worker — Full Rewriting Web Proxy
//  Click links, forms work, JS loads — personal use only
// ============================================================

const PASSWORD = "victory"; // ← ĐỔI MẬT KHẨU

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const PWD = env.PASSWORD || PASSWORD;

    // Static UI
    if (url.pathname === "/" || url.pathname === "") {
      return html(getHTML());
    }

    // Proxy route: /p/{password}/{encoded_url}
    const match = url.pathname.match(/^\/p\/([^/]+)\/(.+)$/);
    if (match) {
      const [, reqPwd, encodedTarget] = match;
      if (reqPwd !== PWD) return new Response("401 Unauthorized", { status: 401 });

      let targetURL;
      try {
        targetURL = new URL(decodeURIComponent(encodedTarget));
      } catch {
        // Try as-is
        try { targetURL = new URL(encodedTarget); }
        catch { return new Response("Invalid URL", { status: 400 }); }
      }

      return proxyRequest(request, targetURL, PWD, url.origin);
    }

    // API info
    if (url.pathname === "/api/info") {
      const pwd = url.searchParams.get("pwd");
      if (pwd !== PWD) return new Response("401", { status: 401 });
      return Response.json({
        ok: true,
        datacenter: request.cf?.colo,
        country: request.cf?.country,
        city: request.cf?.city,
        timezone: request.cf?.timezone,
        asOrganization: request.cf?.asOrganization,
      });
    }

    return new Response("Not found", { status: 404 });
  }
};

async function proxyRequest(request, targetURL, pwd, origin) {
  const isNavigation = request.headers.get("Sec-Fetch-Mode") === "navigate" ||
                       request.headers.get("Accept")?.includes("text/html");

  // Build fetch headers
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const skip = ["host","cf-connecting-ip","cf-ray","cf-visitor","x-forwarded-for",
                  "x-real-ip","cf-ipcountry","cdn-loop","sec-fetch-site","origin","referer"];
    if (!skip.includes(k.toLowerCase())) headers.set(k, v);
  }
  headers.set("Host", targetURL.host);
  headers.set("Referer", targetURL.origin + "/");
  headers.set("Origin", targetURL.origin);

  let body = undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = request.body;
  }

  let response;
  try {
    response = await fetch(targetURL.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (e) {
    return new Response(`Proxy error: ${e.message}`, { status: 502 });
  }

  // Handle redirects — rewrite location
  if ([301,302,303,307,308].includes(response.status)) {
    const loc = response.headers.get("Location");
    if (loc) {
      const newTarget = resolveURL(loc, targetURL);
      const newLoc = `${origin}/p/${pwd}/${encodeURIComponent(newTarget)}`;
      const rHeaders = new Headers();
      rHeaders.set("Location", newLoc);
      return new Response(null, { status: response.status, headers: rHeaders });
    }
  }

  const ct = response.headers.get("Content-Type") || "";

  // Rewrite HTML
  if (ct.includes("text/html")) {
    let text = await response.text();
    text = rewriteHTML(text, targetURL, pwd, origin);
    const rh = new Headers();
    rh.set("Content-Type", "text/html;charset=UTF-8");
    rh.set("X-Proxy-Country", "CF");
    return new Response(text, { status: response.status, headers: rh });
  }

  // Rewrite CSS (url() references)
  if (ct.includes("text/css")) {
    let text = await response.text();
    text = rewriteCSS(text, targetURL, pwd, origin);
    const rh = new Headers();
    rh.set("Content-Type", ct);
    return new Response(text, { status: response.status, headers: rh });
  }

  // Rewrite JS — inject base rewriter
  if (ct.includes("javascript")) {
    let text = await response.text();
    text = rewriteJS(text, targetURL, pwd, origin);
    const rh = new Headers();
    rh.set("Content-Type", ct);
    return new Response(text, { status: response.status, headers: rh });
  }

  // Pass through binary (images, fonts, etc)
  const respHeaders = new Headers();
  if (ct) respHeaders.set("Content-Type", ct);
  respHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, { status: response.status, headers: respHeaders });
}

function resolveURL(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function proxyURL(url, base, pwd, origin) {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") ||
      url.startsWith("javascript:") || url.startsWith("#") || url.startsWith("mailto:")) {
    return url;
  }
  const resolved = resolveURL(url, base);
  if (!resolved.startsWith("http")) return url;
  return `${origin}/p/${pwd}/${encodeURIComponent(resolved)}`;
}

function rewriteHTML(html, base, pwd, origin) {
  // Inject proxy script at top of <head>
  const injectedScript = `<script>
(function(){
  const _pwd = ${JSON.stringify(pwd)};
  const _origin = ${JSON.stringify(origin)};
  const _base = ${JSON.stringify(base.origin)};
  function proxyURL(u) {
    if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#') || u.startsWith('javascript:') || u.startsWith('mailto:')) return u;
    try {
      const abs = new URL(u, _base).toString();
      if (!abs.startsWith('http')) return u;
      return _origin + '/p/' + _pwd + '/' + encodeURIComponent(abs);
    } catch { return u; }
  }
  // Intercept navigation
  const _pushState = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);
  // Override fetch
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = proxyURL(input);
    else if (input instanceof Request) input = new Request(proxyURL(input.url), input);
    return _fetch(input, init);
  };
  // Override XMLHttpRequest
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    return _open.call(this, method, proxyURL(url), ...args);
  };
  // Override link clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a');
    if (a && a.href && !a.href.startsWith(_origin)) {
      e.preventDefault();
      window.location.href = proxyURL(a.href);
    }
  }, true);
  // Override form submit
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.action && !form.action.startsWith(_origin)) {
      e.preventDefault();
      const action = proxyURL(form.action || window.location.href);
      const newForm = document.createElement('form');
      newForm.method = form.method;
      newForm.action = action;
      for (const el of form.elements) {
        if (el.name) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = el.name;
          input.value = el.value;
          newForm.appendChild(input);
        }
      }
      document.body.appendChild(newForm);
      newForm.submit();
    }
  }, true);
})();
<\/script>`;

  // Rewrite src, href, action attributes
  html = html
    .replace(/<head(\s[^>]*)?>/i, (m) => m + injectedScript)
    .replace(/(src|href|action|data-src)\s*=\s*["']([^"']+)["']/gi, (match, attr, val) => {
      const rewritten = proxyURL(val, base, pwd, origin);
      return `${attr}="${rewritten}"`;
    })
    .replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (match, val) => {
      return `url("${proxyURL(val, base, pwd, origin)}")`;
    });

  return html;
}

function rewriteCSS(css, base, pwd, origin) {
  return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (match, val) => {
    return `url("${proxyURL(val, base, pwd, origin)}")`;
  });
}

function rewriteJS(js, base, pwd, origin) {
  // Only rewrite absolute URLs in JS strings — safe minimal approach
  return js.replace(/(['"`])(https?:\/\/[^'"`\s]+)\1/g, (match, quote, url) => {
    return `${quote}${proxyURL(url, base, pwd, origin)}${quote}`;
  });
}

function html(content) {
  return new Response(content, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ProxyHub</title>
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
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: 'Syne', sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
body::before {
  content:'';
  position:fixed;
  inset:0;
  background-image:
    linear-gradient(rgba(0,212,255,0.03) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,212,255,0.03) 1px,transparent 1px);
  background-size:40px 40px;
  pointer-events:none;
}
.box {
  position:relative;
  z-index:1;
  width:100%;
  max-width:600px;
  padding:20px;
}
.header { text-align:center; margin-bottom:36px; }
.logo { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--accent); letter-spacing:4px; text-transform:uppercase; margin-bottom:10px; }
h1 {
  font-size:52px; font-weight:800; line-height:1;
  background:linear-gradient(135deg,#fff 0%,var(--accent) 50%,var(--accent2) 100%);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  margin-bottom:8px;
}
.sub { color:var(--muted); font-family:'JetBrains Mono',monospace; font-size:12px; }

.card {
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:16px;
  padding:24px;
  position:relative;
  overflow:hidden;
  margin-bottom:16px;
}
.card::before {
  content:'';
  position:absolute;
  top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--accent),transparent);
  opacity:.5;
}
.label {
  font-family:'JetBrains Mono',monospace;
  font-size:10px; color:var(--accent);
  letter-spacing:3px; text-transform:uppercase;
  margin-bottom:14px;
  display:flex; align-items:center; gap:8px;
}
.label::before { content:''; width:6px; height:6px; background:var(--accent); border-radius:50%; box-shadow:0 0 8px var(--accent); }

.row { display:flex; gap:10px; margin-bottom:12px; }
input {
  flex:1;
  background:var(--bg);
  border:1px solid var(--border);
  border-radius:10px;
  padding:12px 16px;
  color:var(--text);
  font-family:'JetBrains Mono',monospace;
  font-size:13px;
  outline:none;
  transition:border-color .2s;
}
input:focus { border-color:var(--accent); }
input::placeholder { color:var(--muted); }
.url-input { font-size:14px; padding:14px 18px; }

.btn {
  padding:12px 22px;
  border:none; border-radius:10px;
  font-family:'Syne',sans-serif; font-weight:700; font-size:13px;
  cursor:pointer; transition:all .2s; white-space:nowrap;
}
.btn-primary {
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  color:#fff;
  box-shadow:0 0 20px rgba(0,212,255,.2);
}
.btn-primary:hover { transform:translateY(-1px); box-shadow:0 0 30px rgba(0,212,255,.35); }

.status {
  display:flex; align-items:center; gap:8px;
  font-family:'JetBrains Mono',monospace; font-size:11px;
  color:var(--muted); min-height:18px;
}
.dot { width:6px;height:6px;border-radius:50%;background:var(--muted); }
.dot.ok { background:var(--success);box-shadow:0 0 6px var(--success); }
.dot.err { background:var(--error);box-shadow:0 0 6px var(--error); }
.dot.spin { background:var(--accent);animation:pulse 1s infinite;box-shadow:0 0 6px var(--accent); }
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

.err-box {
  display:none;
  background:rgba(239,68,68,.1);
  border:1px solid rgba(239,68,68,.3);
  border-radius:8px;
  padding:10px 14px;
  font-family:'JetBrains Mono',monospace;
  font-size:12px; color:var(--error);
  margin-bottom:12px;
}

.info-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:12px; }
.info-item { background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center; }
.info-lbl { font-family:'JetBrains Mono',monospace; font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:2px; margin-bottom:4px; }
.info-val { font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--accent); font-weight:700; }

.footer { text-align:center; margin-top:20px; font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); opacity:.4; }
</style>
</head>
<body>
<div class="box">
  <div class="header">
    <div class="logo">Personal Web Proxy</div>
    <h1>ProxyHub</h1>
    <div class="sub">// Full rewrite · Click links · Forms work</div>
  </div>

  <div class="card">
    <div class="label">Auth</div>
    <div class="err-box" id="errBox">⚠ Sai mật khẩu!</div>
    <div class="row">
      <input type="password" id="pwd" placeholder="Mật khẩu..." onkeydown="if(event.key==='Enter')go()">
      <button class="btn btn-primary" onclick="go()">Unlock</button>
    </div>
    <div class="status"><div class="dot" id="authDot"></div><span id="authTxt">Chưa xác thực</span></div>
  </div>

  <div class="card" id="infoCard" style="display:none">
    <div class="label">Worker Location</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-lbl">DC</div><div class="info-val" id="iDc">—</div></div>
      <div class="info-item"><div class="info-lbl">Country</div><div class="info-val" id="iCountry">—</div></div>
      <div class="info-item"><div class="info-lbl">City</div><div class="info-val" id="iCity">—</div></div>
    </div>
  </div>

  <div class="card" id="proxyCard" style="display:none">
    <div class="label">Browse</div>
    <div class="row">
      <input type="url" class="url-input" id="urlIn" placeholder="https://example.com" onkeydown="if(event.key==='Enter')browse()">
      <button class="btn btn-primary" onclick="browse()">🚀 Go</button>
    </div>
    <div class="status"><div class="dot" id="proxyDot"></div><span id="proxyTxt">Nhập URL và bấm Go — sẽ mở tab mới</span></div>
  </div>

  <div class="footer">ProxyHub · Cloudflare Edge · Full Rewrite Proxy</div>
</div>

<script>
let pwd = '';

async function go() {
  pwd = document.getElementById('pwd').value;
  if (!pwd) return;
  setDot('authDot','authTxt','spin','Đang xác thực...');
  document.getElementById('errBox').style.display = 'none';
  try {
    const r = await fetch('/api/info?pwd=' + encodeURIComponent(pwd));
    const d = await r.json();
    if (!d.ok) {
      document.getElementById('errBox').style.display = 'block';
      setDot('authDot','authTxt','err','Sai mật khẩu');
      return;
    }
    setDot('authDot','authTxt','ok','✓ Đã xác thực');
    document.getElementById('infoCard').style.display = 'block';
    document.getElementById('proxyCard').style.display = 'block';
    document.getElementById('iDc').textContent = d.datacenter || '—';
    document.getElementById('iCountry').textContent = d.country || '—';
    document.getElementById('iCity').textContent = d.city || '—';
  } catch(e) {
    setDot('authDot','authTxt','err','Lỗi kết nối');
  }
}

function browse() {
  let url = document.getElementById('urlIn').value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  document.getElementById('urlIn').value = url;
  const proxyURL = '/p/' + encodeURIComponent(pwd) + '/' + encodeURIComponent(url);
  setDot('proxyDot','proxyTxt','spin','Đang mở...');
  window.open(proxyURL, '_blank');
  setTimeout(() => setDot('proxyDot','proxyTxt','ok','✓ Đã mở tab mới'), 1000);
}

function setDot(dotId, txtId, state, msg) {
  document.getElementById(dotId).className = 'dot' + (state ? ' ' + state : '');
  document.getElementById(txtId).textContent = msg;
}
</script>
</body>
</html>`;
}
