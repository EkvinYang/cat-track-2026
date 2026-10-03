// Shared helpers for every Cat Track panel.
(function () {
  // One stroke icon set (1.75px, round caps) — no emoji, no sparkles.
  const ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 20h2M20 14h1"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    speaker: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    graph: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    image: '<rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    thumbUp: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
    thumbDown: '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>',
    history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 14"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    wifiOff: '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    // Equipment families, drawn side-on.
    excavator: '<rect x="2" y="17" width="12" height="4" rx="2"/><path d="M4 17v-4h7l1.5 4"/><path d="M6 13v-3h4v3"/><path d="M11 12l4-7 6 3-1.5 4"/><path d="M19.5 12l1.5 3.5h-3.5"/>',
    truck: '<path d="M2 15V7l12-1.5V15"/><path d="M14 9h4l3.5 3.5V15"/><line x1="2" y1="15" x2="22" y2="15"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/>',
    dozer: '<rect x="3" y="16" width="14" height="5" rx="2.5"/><path d="M5 16v-5h6l2 2h3v3"/><path d="M7 11V7h4v4"/><path d="M17 18h3"/><path d="M20 9c1.4 2.5 1.4 8.5 0 12"/>',
    loader: '<circle cx="6.5" cy="18" r="2.5"/><circle cx="15.5" cy="18" r="2.5"/><path d="M3 16V9h5l1.5 3H16v4"/><path d="M5 9V5.5h3.5V9"/><path d="M16 12l3-2.5"/><path d="M19 9.5h3v5.5h-2.5z"/>',
    grader: '<path d="M2 14h4V8h5v6h11"/><circle cx="4.5" cy="18" r="2"/><circle cx="10" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M13 14l-1.5 4h5"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const FAMILY_ICON = { 'Hydraulic Excavator': 'excavator', 'Off-Highway Truck': 'truck', 'Track-Type Dozer': 'dozer', 'Wheel Loader': 'loader', 'Motor Grader': 'grader' };
  const machineIcon = (family, cls = '') => icon(FAMILY_ICON[family] || 'excavator', cls);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'ngrok-skip-browser-warning': '1' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(path, init); } catch { throw new Error('No connection to Cat Track. Check your signal and try again.'); }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function ago(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const dateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const sevPill = (sev) => `<span class="sev sev-${esc(sev || 'low')}"><i></i>${esc(SEV_LABEL[sev] || sev || 'Info')}</span>`;
  const STATUS_LABEL = { operational: 'Running', attention: 'Needs attention', down: 'Down' };
  const statusPill = (st) => `<span class="st st-${esc(st)}"><i></i>${esc(STATUS_LABEL[st] || st)}</span>`;
  const healthBar = (h) => `<div class="health ${h < 60 ? 'bad' : h < 80 ? 'mid' : ''}" role="meter" aria-valuenow="${h}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(3, Math.min(100, h))}%"></i></div>`;
  const ROLE = { operator: 'Operator', technician: 'Technician', site_manager: 'Site manager', safety_officer: 'Safety officer', fleet_manager: 'Fleet manager', cat_engineer: 'CAT engineer' };
  const SOURCE_ICON = { voice: 'mic', text: 'chat', telemetry: 'radio', repair: 'wrench', inspection: 'check' };
  const SOURCE_LABEL = { voice: 'Voice note', text: 'Typed report', telemetry: 'Sensor alarm', repair: 'Repair record', inspection: 'Inspection' };

  /** Unglamorous states. */
  const emptyState = ({ icon: ic = 'inbox', title, body = '', action = '', error = false }) =>
    `<div class="empty-state ${error ? 'error' : ''}">${icon(ic)}<div class="t">${title}</div>${body ? `<div class="b">${body}</div>` : ''}${action ? `<div class="a">${action}</div>` : ''}</div>`;
  const skeleton = (rows = 3, kind = 'line') => Array.from({ length: rows }, (_, i) => `<span class="sk ${kind}" style="width:${kind === 'line' ? 92 - ((i * 17) % 40) : 100}%"></span>`).join('');

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
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 5000);
  }

  /** Live updates over SSE, with reconnect and a visible banner when the link drops. */
  function connectStream(handlers, liveEl) {
    let es; let retry = 0; let bannerTimer = null; let banner = null;
    const showBanner = () => {
      if (banner) return;
      banner = document.createElement('div');
      banner.className = 'conn-banner';
      banner.innerHTML = `${icon('wifiOff')}<span>Live updates paused — reconnecting. Anything on this screen may be out of date.</span>`;
      const bar = document.querySelector('.topbar, .op-top');
      if (bar) bar.after(banner); else document.body.prepend(banner);
    };
    const setLive = (on) => {
      if (liveEl) { liveEl.classList.toggle('on', on); const t = liveEl.querySelector('.txt'); if (t) t.textContent = on ? 'Live' : 'Offline'; }
      clearTimeout(bannerTimer);
      if (on) { banner?.remove(); banner = null; } else bannerTimer = setTimeout(showBanner, 4000);
    };
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
    const links = [['/', 'Overview'], ['/operator', 'Operator'], ['/site', 'Job sites'], ['/engineering', 'CAT Engineering'], ['/graph', 'Graph'], ['/tags', 'Tags']];
    return `<header class="topbar">
      <a class="brand" href="/">CAT TRACK</a>
      <nav class="nav">${links.map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}</nav>
      <div class="grow"></div>${extra}
      <span class="live" id="live"><span class="dot"></span><span class="txt">Connecting</span></span>
    </header>`;
  }

  function modal(html) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { back.remove(); document.removeEventListener('keydown', onKey); } });
    document.body.appendChild(back);
    return { el: back.querySelector('.modal'), close: () => back.remove() };
  }

  window.CT = { api, esc, ago, dateShort, dateTime, sevPill, statusPill, healthBar, md, toast, connectStream, store, topbar, modal, icon, machineIcon, emptyState, skeleton, ROLE, SOURCE_ICON, SOURCE_LABEL, STATUS_LABEL };
})();
