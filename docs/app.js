(() => {
  'use strict';

  const D = window.APP_DATA;
  const placesById = Object.fromEntries(D.places.map((p) => [p.id, p]));
  const WEEKDAY = '日一二三四五六';
  const TESTAMENT = { OT: '舊約', NT: '新約', both: '新舊約' };
  const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
  const TILE_ATTR = 'Tiles &copy; Esri and the GIS User Community';

  // ---------- Storage (per device) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('ibm.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('ibm.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };
  const visited = store.get('visited', {});
  const notes = store.get('notes', {});

  // ---------- Helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）`; };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayNum = (day) => day.label.match(/\d+/)[0];
  const dayDates = (day) => day.dates.length > 1
    ? `${fmtDate(day.dates[0])}–${fmtDate(day.dates[day.dates.length - 1])}`
    : fmtDate(day.dates[0]);
  const shortDates = (day) => day.dates.map((s) => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; }).join('–');
  const fmtStamp = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const photo = (p) => p.photos[0]?.src || '';

  function haversine(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (km) => km < 1 ? `${Math.round(km * 1000 / 10) * 10} 公尺` : km < 100 ? `${km.toFixed(1)} 公里` : `${Math.round(km).toLocaleString()} 公里`;

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製，可以貼到 LINE 或筆記');
    } catch {
      toast('這個瀏覽器無法自動複製，請長按文字選取');
    }
  }

  // ---------- Itinerary indexes ----------
  const placeDays = {};
  const route = [];
  D.days.forEach((day) => day.items.forEach((it) => {
    if (!it.place) return;
    (placeDays[it.place] ||= []);
    if (!placeDays[it.place].includes(day)) placeDays[it.place].push(day);
    if (!route.includes(it.place) && !placesById[it.place].offItinerary) route.push(it.place);
  }));
  const eventsByPlace = {};
  D.timeline.forEach((e) => { (eventsByPlace[e.place] ||= []).push(e); });

  function tripPhase() {
    const t = todayStr();
    if (t < D.trip.start) return { phase: 'before', days: Math.round((parseDate(D.trip.start) - parseDate(t)) / 86400000) };
    if (t > D.trip.end) return { phase: 'after' };
    const day = D.days.find((d) => d.dates.includes(t));
    return { phase: 'during', day, n: Math.round((parseDate(t) - parseDate(D.trip.start)) / 86400000) + 1 };
  }

  // ---------- Scripture ----------
  function passageText(ref) {
    const b = D.bible[ref];
    return `${b.label}\n` + b.verses.map((v) => `${v.v} ${v.t}`).join('\n') + '\n（和合本）';
  }
  function versesHTML(ref) {
    return D.bible[ref].verses.map((v) => `<sup>${v.v}</sup>${esc(v.t)}`).join('');
  }
  function passageHTML(r, open) {
    const b = D.bible[r.ref];
    return `<details class="passage"${open ? ' open' : ''}>
      <summary><span class="p-title">${esc(r.title)}</span><span class="p-ref">${esc(b.label)}</span></summary>
      <div class="p-text">${versesHTML(r.ref)}</div>
      <div class="p-tools"><button class="text-btn" type="button" data-copy="${esc(r.ref)}">複製經文</button></div>
    </details>`;
  }
  function showPassage(ref, title) {
    const b = D.bible[ref];
    openSheet(title || b.label, `<p class="p-ref" style="margin:0 0 8px">${esc(b.label)}</p>
      <div class="p-text">${versesHTML(ref)}</div>
      <div class="p-tools" style="padding:10px 0 0"><button class="text-btn" type="button" data-copy="${esc(ref)}">複製經文</button></div>`);
  }

  // ---------- Sheet ----------
  const sheet = $('#sheet');
  function openSheet(title, body) {
    sheet.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="x-btn" type="button" data-close-sheet aria-label="關閉">×</button></div><div class="sheet-body">${body}</div>`;
    if (!sheet.open) sheet.showModal();
  }
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-close-sheet]')) sheet.close();
  });

  // ---------- Map ----------
  let map, tileLayer, userMarker;
  let dayFilter = 'all';
  let selectedId = null;
  let clusterLayer;
  let tilesOn = store.get('tilesOn', true);

  const REGIONS = [
    ['加利利', 32.86, 35.33], ['撒瑪利亞', 32.22, 35.2], ['猶大', 31.62, 35.02], ['南地', 30.85, 34.85],
    ['巴珊', 32.86, 35.86], ['摩押', 31.45, 35.78], ['基列', 32.3, 35.98], ['沙崙平原', 32.42, 34.93],
    ['大海', 32.35, 34.45, true], ['鹽海', 31.4, 35.5, true], ['約旦河', 32.5, 35.6, true],
  ];

  function visiblePlaces() {
    if (dayFilter === 'all') return D.places;
    const day = D.days.find((d) => d.id === dayFilter);
    const ids = [...new Set(day.items.filter((i) => i.place).map((i) => i.place))];
    return ids.map((id) => placesById[id]);
  }

  function pinHTML(p) {
    const days = placeDays[p.id];
    const n = p.offItinerary || !days ? '·' : dayNum(days[0]);
    const cls = ['pin', 't-' + p.testament, visited[p.id] && 'is-visited', p.offItinerary && 'is-off', selectedId === p.id && 'is-selected'].filter(Boolean).join(' ');
    return `<span class="${cls}" aria-label="${esc(p.name)}">${n}</span>`;
  }

  function renderMarkers() {
    if (!map) return;
    clusterLayer.clearLayers();
    const places = visiblePlaces();
    const pts = places.map((p) => ({ p, pt: map.latLngToLayerPoint([p.lat, p.lng]) }));
    const groups = [];
    pts.forEach((item) => {
      const g = groups.find((gr) => gr.pt.distanceTo(item.pt) < 34);
      if (g) g.items.push(item); else groups.push({ pt: item.pt, items: [item] });
    });
    groups.forEach((g) => {
      if (g.items.length === 1) {
        const { p } = g.items[0];
        const m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: 'pin-wrap', html: pinHTML(p), iconSize: [30, 30], iconAnchor: [15, 15] }),
          keyboard: true, title: p.name, riseOnHover: true,
        });
        m.on('click', () => selectPlace(p.id));
        clusterLayer.addLayer(m);
      } else {
        const ps = g.items.map((i) => i.p);
        const lat = ps.reduce((s, p) => s + p.lat, 0) / ps.length;
        const lng = ps.reduce((s, p) => s + p.lng, 0) / ps.length;
        const tally = {};
        ps.forEach((p) => { tally[p.region] = (tally[p.region] || 0) + 1; });
        const region = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
        const m = L.marker([lat, lng], {
          icon: L.divIcon({ className: 'pin-wrap', html: `<span class="cluster">${esc(region)} <b>${ps.length}</b></span>`, iconSize: [0, 0] }),
          title: ps.map((p) => p.name).join('、'),
        });
        m.on('click', () => map.flyToBounds(L.latLngBounds(ps.map((p) => [p.lat, p.lng])), { padding: [70, 70], maxZoom: 16, duration: 0.6 }));
        clusterLayer.addLayer(m);
      }
    });
  }

  function fitVisible(animate) {
    const ps = visiblePlaces();
    const b = L.latLngBounds(ps.map((p) => [p.lat, p.lng]));
    const opts = { paddingTopLeft: [40, 80], paddingBottomRight: [40, 70], maxZoom: 14 };
    if (animate) map.flyToBounds(b, { ...opts, duration: 0.7 }); else map.fitBounds(b, opts);
  }

  function renderDayChips() {
    const chips = [{ id: 'all', label: '全部地點', sub: `${D.places.length} 處` }]
      .concat(D.days.filter((d) => d.items.some((i) => i.place)).map((d) => ({ id: d.id, label: d.label, sub: shortDates(d) })));
    $('#dayChips').innerHTML = chips.map((c) =>
      `<button class="chip" role="tab" type="button" data-day="${c.id}" aria-selected="${c.id === dayFilter}">${esc(c.label)}<small>${esc(c.sub)}</small></button>`).join('');
  }

  function setDayFilter(id) {
    dayFilter = id;
    renderDayChips();
    hideCard();
    renderMarkers();
    fitVisible(true);
  }

  function applyTiles() {
    if (tilesOn) tileLayer.addTo(map); else tileLayer.remove();
    $('#layerLabel').textContent = tilesOn ? '簡圖' : '詳圖';
    $('#btnLayer').setAttribute('aria-label', tilesOn ? '切換成聖經簡圖' : '切換成詳細地圖');
  }

  function initMap() {
    map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 18, zoomSnap: 0.5, attributionControl: true });
    map.attributionControl.setPrefix(false);
    map.createPane('atlas').style.zIndex = 150;
    map.createPane('labels').style.zIndex = 350;

    fetch('data/basemap.json').then((r) => r.json()).then((bm) => {
      const ll = (ring) => ring.map(([x, y]) => [y, x]);
      const opt = { pane: 'atlas', interactive: false };
      bm.land.forEach((poly) => L.polygon(poly.map(ll), { ...opt, className: 'atlas-land', weight: 1.2, fillOpacity: 1 }).addTo(map));
      bm.lakes.forEach((poly) => L.polygon(poly.map(ll), { ...opt, className: 'atlas-lake', fillOpacity: 1 }).addTo(map));
      bm.rivers.forEach((line) => L.polyline(ll(line), { ...opt, className: 'atlas-river', weight: 1.6 }).addTo(map));
    }).catch(() => { /* base map missing; tiles still work online */ });

    REGIONS.forEach(([name, lat, lng, water]) => {
      L.marker([lat, lng], {
        pane: 'labels', interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: `<span class="region-label${water ? ' is-water' : ''}">${name}</span>`, iconSize: [0, 0] }),
      }).addTo(map);
    });

    tileLayer = L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19, maxNativeZoom: 17 });
    map.attributionControl.addAttribution('Natural Earth');
    applyTiles();

    clusterLayer = L.layerGroup().addTo(map);
    fitVisible(false);
    renderMarkers();
    const zoomClass = () => map.getContainer().classList.toggle('zoom-hi', map.getZoom() >= 10);
    zoomClass();
    map.on('zoomend', () => { renderMarkers(); zoomClass(); });
    map.on('click', hideCard);
  }

  function selectPlace(id) {
    selectedId = id;
    renderMarkers();
    showCard(placesById[id]);
  }

  function showCard(p) {
    const days = placeDays[p.id] || [];
    const when = p.offItinerary ? '行程外' : days.map((d) => `${d.label}・${shortDates(d)}`).join('、');
    const card = $('#mapCard');
    card.innerHTML = `
      <button class="card-close" type="button" aria-label="關閉">×</button>
      <div class="card-row" data-open="${p.id}">
        <img src="${photo(p)}" alt="" loading="lazy">
        <div class="card-body">
          <div class="eyebrow"><span>${esc(when)}</span><span class="tag t-${p.testament}"><i class="dot t-${p.testament}"></i>${TESTAMENT[p.testament]}</span></div>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.summary)}</p>
        </div>
      </div>
      <div class="card-actions">
        <button type="button" data-passage="${p.refs[0].ref}" data-title="${esc(p.refs[0].title)}">讀經文</button>
        <button type="button" class="primary" data-open="${p.id}">故事與照片 ›</button>
      </div>`;
    card.hidden = false;
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    const size = map.getSize();
    const targetY = Math.max(110, (size.y - card.offsetHeight) / 2);
    if (pt.y > size.y - card.offsetHeight - 40 || pt.y < 80 || pt.x < 30 || pt.x > size.x - 30) {
      map.panBy([pt.x - size.x / 2, pt.y - targetY], { animate: true });
    }
  }

  function hideCard() {
    if ($('#mapCard').hidden) return;
    $('#mapCard').hidden = true;
    selectedId = null;
    renderMarkers();
  }

  // ---------- Near me ----------
  function locate() {
    const btn = $('#btnNear');
    if (!navigator.geolocation) { toast('這台裝置不支援定位'); return; }
    btn.setAttribute('aria-busy', 'true');
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.removeAttribute('aria-busy');
      const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const list = D.places.map((p) => ({ p, km: haversine(me, p) })).sort((a, b) => a.km - b.km);
      const inIsrael = list[0].km < 150;
      if (inIsrael) {
        if (!userMarker) userMarker = L.marker([me.lat, me.lng], { icon: L.divIcon({ className: '', html: '<div class="user-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
        else userMarker.setLatLng([me.lat, me.lng]);
        map.flyTo([me.lat, me.lng], Math.max(map.getZoom(), 13), { duration: 0.8 });
      }
      showNear(list, inIsrael);
    }, (err) => {
      btn.removeAttribute('aria-busy');
      toast(err.code === 1 ? '請在瀏覽器設定裡允許使用定位，才能找到附近的地點' : '暫時抓不到位置，請到空曠的地方再試一次');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  function showNear(list, inIsrael) {
    const top = list[0];
    let hero = '';
    if (!inIsrael) {
      hero = `<div class="near-hero">你現在距離最近的聖經地點約 <strong>${fmtDist(top.km)}</strong>到了以色列再按一次「我附近」，這裡就會列出你身邊的地點和經文。</div>`;
    } else if (top.km < 3) {
      hero = `<div class="near-hero">你現在就在<strong>${esc(top.p.name)}</strong>附近（${fmtDist(top.km)}）
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" type="button" data-open="${top.p.id}">打開這裡的經文</button>
        </div></div>`;
    }
    const rows = list.slice(0, inIsrael ? 6 : 3).map(({ p, km }) => `
      <li><button type="button" data-open="${p.id}">
        <img src="${photo(p)}" alt="" loading="lazy">
        <span><span class="nm">${esc(p.name)}</span><br><small style="color:var(--muted)">${esc(p.refs[0].title)}</small></span>
        <span class="dist">${fmtDist(km)}</span>
      </button></li>`).join('');
    openSheet('我附近', hero + `<ul class="near-list">${rows}</ul>`);
  }

  // ---------- Detail page ----------
  const detail = $('#detail');
  let enteredDetailFromApp = false;

  function openPlace(id) {
    if (sheet.open) sheet.close();
    if (!detail.hidden) {
      // moving between places inside the detail page shouldn't stack history
      history.replaceState(null, '', '#place/' + id);
      onRoute();
      return;
    }
    enteredDetailFromApp = true;
    location.hash = 'place/' + id;
  }

  function closeDetail() {
    if (enteredDetailFromApp) history.back();
    else location.hash = currentView;
  }

  function renderDetail(p) {
    const days = placeDays[p.id] || [];
    const idx = route.indexOf(p.id);
    const prev = idx > 0 ? placesById[route[idx - 1]] : null;
    const next = idx >= 0 && idx < route.length - 1 ? placesById[route[idx + 1]] : null;
    const evs = eventsByPlace[p.id] || [];
    const pills = p.offItinerary
      ? '<span class="day-pill is-off">行程外・可順道認識</span>'
      : days.map((d) => `<span class="day-pill">${esc(d.label)}・${esc(dayDates(d))}</span>`).join('');
    const figures = p.photos.map((ph, i) => `
      <figure>
        <img src="${ph.src}" alt="${esc(p.name)}照片 ${i + 1}" ${i ? 'loading="lazy"' : ''}>
        <figcaption>${esc(ph.author)}・${esc(ph.license)}・<a href="${ph.page}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption>
      </figure>`).join('');

    detail.innerHTML = `
      <div class="detail-inner">
        <div class="hero">
          <div class="gallery">${figures}</div>
          ${p.photos.length > 1 ? `<span class="gallery-count">左右滑動看 ${p.photos.length} 張照片</span>` : ''}
          <div class="hero-bar">
            <button class="round-btn" type="button" data-close-detail aria-label="返回">
              <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>返回
            </button>
            <button class="round-btn" type="button" data-map="${p.id}">
              <svg viewBox="0 0 24 24"><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>地圖
            </button>
          </div>
        </div>

        <header class="d-head">
          <div class="eyebrow"><span>${esc(p.region)}</span><span class="tag t-${p.testament}"><i class="dot t-${p.testament}"></i>${TESTAMENT[p.testament]}</span></div>
          <h1>${esc(p.name)}</h1>
          <div class="d-en">${esc(p.en)}</div>
          <div class="day-pills">${pills}</div>
          <p class="lead">${esc(p.summary)}</p>
        </header>

        <section class="d-section">
          <h2>經文</h2>
          <div class="passages">${p.refs.map((r, i) => passageHTML(r, i === 0)).join('')}</div>
        </section>

        <section class="d-section story">
          <h2>故事</h2>
          ${p.story.map((s) => `<p>${esc(s)}</p>`).join('')}
        </section>

        <section class="d-section">
          <h2>到了現場看什麼</h2>
          <ul class="see">${p.see.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </section>

        ${evs.length ? `<section class="d-section">
          <h2>這裡在聖經歷史中</h2>
          <ol class="mini-tl">${evs.map((e) => `<li class="${e.year < 0 ? 'ev-ot' : ''}"><div class="yr">${esc(e.label)}・${esc(e.era)}</div>${esc(e.title)}${e.ref ? ` <button class="ref-link" type="button" data-passage="${e.ref}" data-title="${esc(e.title)}">${esc(D.bible[e.ref].label)}</button>` : ''}</li>`).join('')}</ol>
        </section>` : ''}

        <section class="d-section">
          <h2>我的紀錄</h2>
          <button class="checkin${visited[p.id] ? ' is-on' : ''}" type="button" data-checkin="${p.id}">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16.2 9.5"/></svg>
            <span>${visited[p.id] ? `已到訪・${fmtStamp(visited[p.id])}` : '我到過這裡'}</span>
          </button>
          <div class="note-box">
            <label for="note-${p.id}" class="eyebrow" style="margin-bottom:6px">筆記與心得（只存在這支手機）</label>
            <textarea id="note-${p.id}" data-note="${p.id}" placeholder="在這裡讀到的經文、導遊說的話、當下的感動…">${esc(notes[p.id]?.text || '')}</textarea>
            <div class="note-meta" id="noteMeta">${notes[p.id]?.t ? `上次儲存：${fmtStamp(notes[p.id].t)}` : ''}</div>
          </div>
        </section>

        <section class="d-section">
          <h2>導航</h2>
          <div class="links">
            <a class="link-btn" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">Google 地圖</a>
            <a class="link-btn" href="https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes" target="_blank" rel="noopener">Waze</a>
          </div>
        </section>

        ${idx >= 0 ? `<section class="d-section">
          <h2>行程順序</h2>
          <div class="pager">
            <button type="button" ${prev ? `data-open="${prev.id}"` : 'disabled'}><small>上一站</small><span>‹ ${prev ? esc(prev.name) : ''}</span></button>
            <button type="button" ${next ? `data-open="${next.id}"` : 'disabled'}><small>下一站</small><span>${next ? esc(next.name) : ''} ›</span></button>
          </div>
        </section>` : ''}
      </div>`;
  }

  function showDetail(p) {
    renderDetail(p);
    detail.hidden = false;
    detail.scrollTop = 0;
    document.title = `${p.name}・聖地經文地圖`;
  }

  function hideDetail() {
    detail.hidden = true;
    document.title = '聖地經文地圖';
  }

  let noteTimer;
  detail.addEventListener('input', (e) => {
    const id = e.target.dataset.note;
    if (!id) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const text = e.target.value;
      if (text.trim()) notes[id] = { text, t: Date.now() }; else delete notes[id];
      store.set('notes', notes);
      $('#noteMeta').textContent = text.trim() ? `已儲存 ${fmtStamp(Date.now())}` : '';
    }, 500);
  });

  function toggleVisited(id) {
    if (visited[id]) delete visited[id]; else visited[id] = Date.now();
    store.set('visited', visited);
    if (!detail.hidden) {
      const btn = detail.querySelector('[data-checkin]');
      btn.classList.toggle('is-on', !!visited[id]);
      btn.querySelector('span').textContent = visited[id] ? `已到訪・${fmtStamp(visited[id])}` : '我到過這裡';
      if (visited[id]) toast(`已記錄：${placesById[id].name}`);
    }
    renderMarkers();
    renderDays();
    renderMe();
  }

  // ---------- Days view ----------
  function renderDays() {
    const ph = tripPhase();
    let banner = '';
    if (ph.phase === 'before') {
      banner = `<div class="banner"><div><h2>${esc(D.trip.title)}</h2><p>${esc(D.trip.subtitle)}・${fmtDate(D.trip.start)} 出發</p></div><div class="big">${ph.days}<small>天</small></div></div>`;
    } else if (ph.phase === 'during') {
      banner = `<div class="banner"><div><h2>今天是第 ${ph.n} 天</h2><p>${ph.day ? esc(ph.day.title) : ''}</p></div><div class="big">${ph.n}<small>/11</small></div></div>`;
    }
    const today = todayStr();
    const html = D.days.map((day) => {
      const isToday = day.dates.includes(today);
      const items = day.items.map((it) => {
        if (it.place) {
          const p = placesById[it.place];
          return `<li><button class="stop" type="button" data-open="${p.id}">
            <img src="${photo(p)}" alt="" loading="lazy">
            <div class="stop-main">
              <div class="stop-name">${esc(p.name)} <i class="dot t-${p.testament}" title="${TESTAMENT[p.testament]}"></i></div>
              <div class="stop-sub">${esc(it.text)}</div>
              <div class="stop-refs">${p.refs.map((r) => esc(D.bible[r.ref].label)).join('・')}</div>
            </div>
            <span class="stop-check${visited[p.id] ? ' is-on' : ''}" aria-label="${visited[p.id] ? '已到訪' : '尚未到訪'}"><svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-8.5"/></svg></span>
          </button></li>`;
        }
        return `<li class="plain"><span>${esc(it.text)}${it.ref ? ` <button class="ref-link" type="button" data-passage="${it.ref}">${esc(D.bible[it.ref].label)}</button>` : ''}</span></li>`;
      }).join('');
      return `<section class="day${isToday ? ' is-today' : ''}" id="day-${day.id}">
        <div class="day-head">
          <div class="day-num">${dayNum(day)}<small>${esc(shortDates(day))}</small></div>
          <h2>${esc(day.title)}${isToday ? '<span class="today-badge">今天</span>' : ''}</h2>
          <div class="eyebrow">${esc(day.label)}・${esc(dayDates(day))}</div>
        </div>
        <ol class="stops">${items}</ol>
      </section>`;
    }).join('');
    $('#view-days').innerHTML = `<div>${banner}${html}</div>`;
  }

  // ---------- Timeline view ----------
  function renderTimeline() {
    const eras = [];
    [...D.timeline].sort((a, b) => a.year - b.year).forEach((e) => {
      let era = eras.find((x) => x.name === e.era);
      if (!era) eras.push(era = { name: e.era, events: [] });
      era.events.push(e);
    });
    const html = eras.map((era) => `
      <section class="era">
        <h2>${esc(era.name)} <small>${esc(era.events[0].label.replace(/^約/, ''))}${era.events.length > 1 && era.events.at(-1).label !== era.events[0].label ? ' 起' : ''}</small></h2>
        <ol class="tl">${era.events.map((e) => {
          const p = placesById[e.place];
          return `<li class="ev${e.year < 0 ? ' ev-ot' : ''}">
            <div class="ev-year">${esc(e.label.replace(' 年', '年'))}</div>
            <div class="ev-body">
              <div class="ev-title">${esc(e.title)}</div>
              <div class="ev-links">
                <button class="place-link" type="button" data-open="${p.id}">${esc(p.name)} ›</button>
                ${e.ref ? `<button class="ref-link" type="button" data-passage="${e.ref}" data-title="${esc(e.title)}">${esc(D.bible[e.ref].label)}</button>` : ''}
              </div>
            </div>
          </li>`;
        }).join('')}</ol>
      </section>`).join('');
    $('#view-timeline').innerHTML = `<div><p class="intro">把這趟會去的地方，放回聖經的歷史順序裡。年代都是大約的推算。點地點可以看經文和故事。</p>${html}</div>`;
  }

  // ---------- Me view ----------
  const FONT_SIZES = [['小', '1rem'], ['中', '1.125rem'], ['大', '1.3rem'], ['特大', '1.5rem']];
  let fontSize = store.get('fontSize', '1.125rem');
  document.documentElement.style.setProperty('--scripture-size', fontSize);

  function renderMe() {
    const total = D.places.length;
    const count = D.places.filter((p) => visited[p.id]).length;
    const ordered = [...route, ...D.places.filter((p) => !route.includes(p.id)).map((p) => p.id)];
    const noted = ordered.filter((id) => notes[id]?.text);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    $('#view-me').innerHTML = `<div>
      <section class="panel">
        <h2>朝聖足跡</h2>
        <div class="progress-num">${count}<small> / ${total} 個地點</small></div>
        <div class="stones">${ordered.map((id) => { const p = placesById[id]; return `<button class="stone t-${p.testament}${visited[id] ? ' is-on' : ''}" type="button" data-open="${id}" title="${esc(p.name)}" aria-label="${esc(p.name)}${visited[id] ? '（已到訪）' : ''}"></button>`; }).join('')}</div>
        <p style="margin:6px 0 0">每一格是一個地點，照行程順序排列。在地點頁按「我到過這裡」就會填滿。</p>
      </section>

      <section class="panel">
        <h2>我的筆記</h2>
        ${noted.length ? `<ul class="note-list">${noted.map((id) => `<li><button class="nm" type="button" data-open="${id}">${esc(placesById[id].name)} ›</button><div class="eyebrow">${fmtStamp(notes[id].t)}</div><div class="tx">${esc(notes[id].text)}</div></li>`).join('')}</ul>
          <div style="margin-top:14px"><button class="btn ghost" type="button" data-copy-notes>複製全部筆記</button></div>`
          : '<p>還沒有筆記。在每個地點頁的最下面可以寫下當天的感動，這些只會存在你的手機裡。</p>'}
      </section>

      <section class="panel">
        <h2>經文字體大小</h2>
        <div class="seg" role="group" aria-label="經文字體大小">${FONT_SIZES.map(([label, v]) => `<button type="button" data-font="${v}" aria-pressed="${v === fontSize}">${label}</button>`).join('')}</div>
        <p class="sample-text"><sup style="color:var(--olive);font-size:.6em">1</sup>耶和華是我的牧者，我必不致缺乏。</p>
      </section>

      <section class="panel" id="offlinePanel">
        <h2>離線使用</h2>
        <ul class="status-list" id="offlineStatus"><li><i></i>檢查中…</li></ul>
        <p>經文、故事和照片在第一次打開後就會存到手機裡。詳細地圖需要另外下載（約 15–25 MB，建議連 Wi-Fi）；沒下載也能用，沒網路時會顯示簡圖。</p>
        <button class="btn" type="button" id="btnTiles">下載離線地圖</button>
        <div class="bar" id="tileBar" hidden><div></div></div>
      </section>

      <section class="panel">
        <h2>加到手機主畫面</h2>
        ${isStandalone ? '<p>你已經從主畫面開啟這個 App 了。</p>' : `
        <p>加到主畫面之後，就可以像一般 App 一樣打開，沒網路也能用。</p>
        <ol class="howto">
          <li><b>iPhone</b>：用 Safari 打開這個網址 → 點下方的「分享」按鈕 → 「加入主畫面」</li>
          <li><b>Android</b>：用 Chrome 打開 → 右上角「⋮」→「安裝應用程式」或「加到主畫面」</li>
        </ol>`}
      </section>

      <section class="panel credits">
        <h2>資料來源</h2>
        經文：《和合本》（公有領域），經文資料取自 bolls.life。<br>
        照片：Wikimedia Commons，作者與授權標示在每張照片右下角。<br>
        地圖：Esri World Topographic Map；簡圖海岸線與河流取自 Natural Earth。<br>
        故事與年代：依聖經記載與一般考古、歷史資料整理，年代為大約推算。
      </section>
    </div>`;
    updateOfflineStatus();
  }

  // ---------- Offline ----------
  function tileList() {
    const set = new Set();
    const xy = (lat, lng, z) => {
      const n = 2 ** z, rad = lat * Math.PI / 180;
      return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)];
    };
    const add = (z, x, y) => set.add(TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    for (let z = 6; z <= 10; z++) {
      const [x0, y0] = xy(33.4, 34.2, z), [x1, y1] = xy(29.4, 35.95, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(z, x, y);
    }
    D.places.forEach((p) => {
      for (let z = 11; z <= 15; z++) {
        const [cx, cy] = xy(p.lat, p.lng, z);
        const rr = z >= 13 ? 1 : 0;
        for (let dx = -rr; dx <= rr; dx++) for (let dy = -rr; dy <= rr; dy++) add(z, cx + dx, cy + dy);
      }
    });
    return [...set];
  }

  async function updateOfflineStatus() {
    const el = $('#offlineStatus');
    if (!el) return;
    if (!('caches' in window) || !('serviceWorker' in navigator)) {
      el.innerHTML = '<li><i></i>這個瀏覽器不支援離線功能，請改用 Safari 或 Chrome。</li>';
      $('#btnTiles').disabled = true;
      return;
    }
    try {
      const keys = await caches.keys();
      const appCache = keys.find((k) => k.startsWith('app-'));
      const appReady = appCache && await (await caches.open(appCache)).match('data/data.js');
      const tileCount = keys.includes('tiles') ? (await (await caches.open('tiles')).keys()).length : 0;
      const need = tileList().length;
      el.innerHTML = `
        <li><i class="${appReady ? 'ok' : ''}"></i>經文、故事、照片：${appReady ? '已存到手機' : '下載中，請保持連線一下'}</li>
        <li><i class="${tileCount >= need * 0.95 ? 'ok' : ''}"></i>詳細地圖：已存 ${tileCount} 張圖磚${tileCount >= need * 0.95 ? '，可以離線使用' : `（完整約 ${need} 張）`}</li>`;
    } catch {
      el.innerHTML = '<li><i></i>無法讀取離線狀態</li>';
    }
  }

  async function downloadTiles() {
    const btn = $('#btnTiles');
    const bar = $('#tileBar');
    if (!navigator.onLine) { toast('目前沒有網路，請連上 Wi-Fi 後再下載'); return; }
    const urls = tileList();
    const cache = await caches.open('tiles');
    btn.disabled = true;
    bar.hidden = false;
    let done = 0, failed = 0, i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const url = urls[i++];
        try {
          if (!(await cache.match(url))) {
            const res = await fetch(url, { mode: 'no-cors' });
            await cache.put(url, res);
          }
        } catch { failed++; }
        done++;
        bar.firstElementChild.style.width = `${(done / urls.length) * 100}%`;
        btn.textContent = `下載中 ${done} / ${urls.length}`;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    btn.disabled = false;
    btn.textContent = failed ? '重新下載失敗的部分' : '重新檢查離線地圖';
    toast(failed ? `完成，但有 ${failed} 張下載失敗，可以再按一次` : '離線地圖下載完成');
    updateOfflineStatus();
  }

  // ---------- Trip status ----------
  function renderTripStatus() {
    const ph = tripPhase();
    const el = $('#tripStatus');
    if (ph.phase === 'before') el.innerHTML = `出發倒數 <b>${ph.days}</b> 天`;
    else if (ph.phase === 'during') el.innerHTML = `旅程第 <b>${ph.n}</b> 天`;
    else el.textContent = '旅程回顧';
  }

  // ---------- Router ----------
  const VIEWS = ['map', 'days', 'timeline', 'me'];
  let currentView = 'map';

  function showView(view) {
    currentView = view;
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('is-active', a.dataset.view === view));
    if (view === 'map' && map) setTimeout(() => map.invalidateSize(), 0);
    if (view === 'me') updateOfflineStatus();
    if (view === 'days' && tripPhase().phase === 'during') {
      const el = $('#view-days .is-today');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }

  function onRoute() {
    const h = decodeURIComponent(location.hash.slice(1)) || 'map';
    if (h.startsWith('place/')) {
      const p = placesById[h.slice(6)];
      if (p) { showDetail(p); return; }
    }
    hideDetail();
    enteredDetailFromApp = false;
    showView(VIEWS.includes(h) ? h : 'map');
  }

  // ---------- Global clicks ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-open], a');
    if (!t) return;
    const d = t.dataset;
    if (d.open) { e.preventDefault(); openPlace(d.open); return; }
    if (d.passage) { showPassage(d.passage, d.title); return; }
    if (d.copy) { copyText(passageText(d.copy)); return; }
    if (d.day) { setDayFilter(d.day); return; }
    if (d.checkin) { toggleVisited(d.checkin); return; }
    if (d.font) {
      fontSize = d.font;
      store.set('fontSize', fontSize);
      document.documentElement.style.setProperty('--scripture-size', fontSize);
      renderMe();
      return;
    }
    if ('closeDetail' in d) { closeDetail(); return; }
    if (d.map) {
      const p = placesById[d.map];
      dayFilter = 'all';
      renderDayChips();
      location.hash = 'map';
      setTimeout(() => {
        map.invalidateSize();
        map.setView([p.lat, p.lng], 14);
        selectPlace(p.id);
      }, 50);
      return;
    }
    if ('copyNotes' in d) {
      const ordered = [...route, ...D.places.map((p) => p.id).filter((id) => !route.includes(id))];
      const text = ordered.filter((id) => notes[id]?.text).map((id) => `【${placesById[id].name}】${fmtStamp(notes[id].t)}\n${notes[id].text}`).join('\n\n');
      copyText(`以色列朝聖筆記\n\n${text}`);
      return;
    }
    if (t.id === 'btnNear') { locate(); return; }
    if (t.id === 'btnLayer') { tilesOn = !tilesOn; store.set('tilesOn', tilesOn); applyTiles(); return; }
    if (t.id === 'btnTiles') { downloadTiles(); return; }
    if (t.classList.contains('card-close')) { hideCard(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !detail.hidden && !sheet.open) closeDetail();
  });

  // ---------- Boot ----------
  renderTripStatus();
  renderDayChips();
  renderDays();
  renderTimeline();
  renderMe();
  initMap();
  window.addEventListener('hashchange', onRoute);
  onRoute();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(() => setTimeout(updateOfflineStatus, 3000)).catch(() => { /* offline mode unavailable */ });
    // a new version finished installing: reload once so the fresh content shows right away
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (document.activeElement?.tagName === 'TEXTAREA') toast('有新版內容，下次打開時會更新');
      else location.reload();
    });
  }
})();
