// Shared helpers for every Cat Track panel.
(function () {
  const ICONS = {
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14h1"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    graph: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    thumbUp: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
    thumbDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
    brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>',
    machine: '<path d="M2 20h13"/><rect x="3" y="14" width="10" height="4" rx="2"/><path d="M5 14v-3h5l1 3"/><path d="M10 11l5-6 5 3-3 4"/><path d="M17 12l2 4h-3"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'ngrok-skip-browser-warning': '1' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(path, init); } catch (err) { throw new Error('Network error — check your connection.'); }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function ago(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  const sevPill = (sev) => `<span class="pill sev-${esc(sev || 'info')}">${esc(sev || 'info')}</span>`;
  const statusPill = (st) => `<span class="pill st-${esc(st)}">${esc(st)}</span>`;
  const healthBar = (h) => `<div class="health ${h < 60 ? 'bad' : h < 80 ? 'mid' : ''}"><i style="width:${Math.max(4, Math.min(100, h))}%"></i></div>`;
  const ROLE = { operator: 'Operator', technician: 'Technician', site_manager: 'Site manager', safety_officer: 'Safety officer', fleet_manager: 'Fleet manager', cat_engineer: 'CAT engineer' };
  const SOURCE_ICON = { voice: 'mic', text: 'chat', telemetry: 'radio', repair: 'wrench', inspection: 'check' };

  /** Tiny, safe markdown: **bold**, "- " bullets, [R12] report refs, line breaks. */
  function md(text) {
    const lines = esc(text || '').split(/\n/);
    let html = ''; let inList = false;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[R(\d+)\]/g, '<span class="ref">R$1</span>').replace(/^#{1,4}\s*(.+)$/, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw.trim();
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      if (bullet) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(bullet[1])}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line) html += `<p>${inline(line)}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  function toast(msg, kind = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4800);
  }

  /** Live updates over SSE with automatic reconnect and a status dot. */
  function connectStream(handlers, liveEl) {
    let es; let retry = 0;
    const setLive = (on) => { if (liveEl) { liveEl.classList.toggle('on', on); const t = liveEl.querySelector('.txt'); if (t) t.textContent = on ? 'Live' : 'Reconnecting…'; } };
    const open = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('hello', () => { retry = 0; setLive(true); });
      for (const [type, fn] of Object.entries(handlers)) {
        es.addEventListener(type, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(type, err); } });
      }
      es.onerror = () => { setLive(false); es.close(); setTimeout(open, Math.min(10000, 1000 * 2 ** retry++)); };
    };
    open();
    return () => es && es.close();
  }

  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(`cattrack:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`cattrack:${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  function topbar(active, extra = '') {
    const links = [['/', 'Home'], ['/operator', 'Operator'], ['/site', 'Site Command'], ['/engineering', 'CAT Engineering'], ['/graph', 'Knowledge Graph'], ['/tags', 'Asset Tags']];
    return `<header class="topbar">
      <a class="brand" href="/"><span class="mark">CT</span>CAT TRACK <small>Memory for Physical AI</small></a>
      <nav class="nav">${links.map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}</nav>
      <div class="grow"></div>${extra}
      <span class="live" id="live"><span class="dot"></span><span class="txt">Connecting…</span></span>
    </header>`;
  }

  function modal(html) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
    return { el: back.querySelector('.modal'), close: () => back.remove() };
  }

  window.CT = { api, esc, ago, dateShort, dateTime, sevPill, statusPill, healthBar, md, toast, connectStream, store, topbar, modal, icon, ROLE, SOURCE_ICON };
})();
