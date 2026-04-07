const JSON_URL = 'https://carloswunsche.github.io/music/artist.json';
const BASE = JSON_URL.substring(0, JSON_URL.lastIndexOf('/') + 1);
let queue = [], qi = -1, paused = false;
const aud = document.getElementById('aud');
let lyricsOpen = false, lrcLines = [], lrcInterval = null, lrcUserScrolling = false, lrcScrollTimer = null;

function res(base, p) { return !p ? '' : p.startsWith('http') ? p : base + p; }
function fmt(s) { if (!s || isNaN(s)) return '0:00'; return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'); }
function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

aud.ontimeupdate = () => {
  document.getElementById('b-cur').textContent = fmt(aud.currentTime);
  const seek = document.getElementById('b-seek');
  if (!seek._drag && aud.duration) seek.value = aud.currentTime / aud.duration * 100;
  if (lrcLines.length) highlightCurrentLine(aud.currentTime);
};

aud.ondurationchange = () => { document.getElementById('b-dur').textContent = fmt(aud.duration); };
aud.onended = () => skip(1);
const seek = document.getElementById('b-seek');
seek.addEventListener('mousedown', () => seek._drag = true);
seek.addEventListener('mouseup', () => { seek._drag = false; aud.currentTime = seek.value / 100 * (aud.duration || 0); });
seek.addEventListener('touchstart', () => seek._drag = true, {passive:true});
seek.addEventListener('touchend', () => { seek._drag = false; aud.currentTime = seek.value / 100 * (aud.duration || 0); });

function parseLrc(lrc) {
  const lines = [];
  lrc.split('\n').forEach(line => {
    const m = line.match(/^\[(\d+):(\d+[.:](\d+))\](.*)$/);
    if (m) {
      const mins = parseInt(m[1]), secs = parseFloat(m[2].replace(':', '.'));
      lines.push({ time: mins * 60 + secs, text: m[4].trim() });
    }
  });
  return lines.sort((a,b) => a.time - b.time);
}

function renderLrcLines() {
  const container = document.getElementById('lyrics-text');
  if (!container) return;
  container.innerHTML = lrcLines.map((l, i) => l.text ? `<span class="lrc-line" id="lrc-${i}" onclick="seekToLine(${i})">${esc(l.text)}</span>` : `<span class="lrc-line-blank" id="lrc-${i}"></span>`).join('');
}

function renderPlainLyrics(text) {
  const container = document.getElementById('lyrics-text');
  container.innerHTML = text.split('\n').map((l, i) => l.trim() ? `<span class="lrc-line" id="lrc-${i}">${esc(l)}</span>` : `<span class="lrc-line-blank" id="lrc-${i}"></span>`).join('');
}

function highlightCurrentLine(currentTime) {
  let active = -1;
  for (let i = 0; i < lrcLines.length; i++) if (lrcLines[i].time <= currentTime) active = i;
  lrcLines.forEach((_, i) => { const el = document.getElementById(`lrc-${i}`); if (el) el.classList.toggle('active', i === active); });
  if (!lrcUserScrolling && active >= 0) {
    const activeEl = document.getElementById(`lrc-${active}`);
    const scrollDiv = document.getElementById('lyrics-scroll');
    if (activeEl && scrollDiv) scrollDiv.scrollTo({ top: activeEl.offsetTop - scrollDiv.clientHeight / 3, behavior: 'smooth' });
  }
}

function startLrcHighlight() {
  if (lrcInterval) clearInterval(lrcInterval);
  const scrollDiv = document.getElementById('lyrics-scroll');
  if (scrollDiv) scrollDiv.onscroll = () => { lrcUserScrolling = true; clearTimeout(lrcScrollTimer); lrcScrollTimer = setTimeout(() => { lrcUserScrolling = false; }, 3000); };
  lrcInterval = setInterval(() => { if (lrcLines.length && aud.src && !aud.paused) highlightCurrentLine(aud.currentTime); }, 200);
}

function updateLyricsPanel(track) {
  const btn = document.getElementById('lyrics-btn');
  const has = track.lyrics && track.lyrics.trim();
  btn.style.display = has ? 'flex' : 'none';
  if (lrcInterval) { clearInterval(lrcInterval); lrcInterval = null; }
  lrcLines = [];
  if (!has) { if (lyricsOpen) { lyricsOpen = false; applyLyricsOpen(false); btn.classList.remove('active'); } return; }
  const raw = track.lyrics.trim();
  if (raw.startsWith('[')) { lrcLines = parseLrc(raw); renderLrcLines(); startLrcHighlight(); }
  else renderPlainLyrics(raw);
  if (lyricsOpen) applyLyricsOpen(true);
}

function seekToLine(idx) { if (lrcLines[idx]) { aud.currentTime = lrcLines[idx].time; lrcUserScrolling = false; highlightCurrentLine(aud.currentTime); } }
function applyLyricsOpen(open) { document.getElementById('lyrics-panel').classList.toggle('up', open); }
function toggleLyrics() { lyricsOpen = !lyricsOpen; applyLyricsOpen(lyricsOpen); document.getElementById('lyrics-btn').classList.toggle('active', lyricsOpen); }

function playTrack(i) {
  if (i < 0 || i >= queue.length) return;
  qi = i;
  const t = queue[i];
  aud.src = t.src;
  aud.play().catch(()=>{});
  paused = false;
  setPP(false);
  document.getElementById('b-title').textContent = t.title;
  let album = t.album || '';
  if (album.toLowerCase() === 'singles') album = '';
  document.getElementById('b-sub').textContent = album;
  document.getElementById('bar').classList.add('on');
  document.querySelectorAll('.track').forEach((el, idx) => el.classList.toggle('playing', idx === i));
  document.querySelectorAll('.t-num').forEach((el, idx) => { el.innerHTML = idx === i ? '▶' : idx + 1; });
  updateLyricsPanel(t);
}

function togglePlay() { if (aud.paused) { aud.play(); paused=false; } else { aud.pause(); paused=true; } setPP(paused); }
function skip(d) { playTrack(qi + d); }
function setPP(p) {
  document.getElementById('ico-play').style.display = p ? 'none' : 'block';
  document.getElementById('ico-pause').style.display = p ? 'block' : 'none';
}

function renderTracks(tracks, base, startIdx) {
  return tracks.map((t, i) => {
    const gi = startIdx + i;
    const art = t.artwork ? `<img class="t-art" src="${esc(res(base, t.artwork))}" loading="lazy" onerror="this.style.display='none'">` : '';
    return `<div class="track" data-qi="${gi}" onclick="playTrack(${gi})"><span class="t-num">${i+1}</span>${art}<div class="t-info"><strong>${esc(t.title)}</strong><span>${esc(t.feat||'')}</span></div><span class="t-dur" id="dur-${gi}">—</span></div>`;
  }).join('');
}

function loadDurations(tracks, base, startIdx) {
  tracks.forEach((t, i) => {
    if (!t.src && !t.file && !t.stream) return;
    const a = new Audio();
    a.preload = 'metadata';
    a.src = res(base, t.src || t.file || t.stream);
    a.onloadedmetadata = () => { const el = document.getElementById('dur-'+(startIdx+i)); if (el) el.textContent = fmt(a.duration); };
  });
}

function buildQueue(releases, base) {
  queue = [];
  releases.forEach(rel => {
    const rb = rel._base || base;
    (rel.tracks || []).forEach(t => {
      queue.push({ title: t.title, album: rel.title || '', src: res(rb, t.src || t.file || t.stream || ''), feat: t.feat || '', lyrics: t.lyrics || null });
    });
  });
}

function loadTrackToPlayer(i) {
  if (i < 0 || i >= queue.length) return;
  qi = i;
  const t = queue[i];
  aud.src = t.src;
  aud.load(); // preload but don't play
  paused = true;
  setPP(true);
  document.getElementById('b-title').textContent = t.title;
  let album = t.album || '';
  if (album.toLowerCase() === 'singles') album = '';
  document.getElementById('b-sub').textContent = album;
  document.getElementById('bar').classList.add('on');
  // Highlight track in list
  document.querySelectorAll('.track').forEach((el, idx) => el.classList.toggle('playing', idx === i));
  document.querySelectorAll('.t-num').forEach((el, idx) => { el.innerHTML = idx === i ? '▶' : idx + 1; });
  updateLyricsPanel(t);
}

function renderArtist(d, base) {
  const root = document.getElementById('root');
  const av = d.avatar ? `<img class="av" src="${esc(res(base, d.avatar))}" onerror="this.outerHTML='<div class=av-ph>🎵</div>'">` : '<div class="av-ph">🎵</div>';
  const linkMap = { instagram:'Instagram', youtube:'YouTube', spotify:'Spotify', bandcamp:'Bandcamp', soundcloud:'SoundCloud', twitter:'Twitter', facebook:'Facebook', tiktok:'TikTok', website:'Website' };
  const links = d.links ? Object.entries(d.links).map(([k,v]) => `<a class="lnk" href="${esc(v)}" target="_blank" rel="noopener">${linkMap[k]||k}</a>`).join('') : '';
  let relHTML = '', idx = 0;
  (d.releases || []).forEach(rel => {
    const rb = rel._base || base;
    const tracks = rel.tracks || [];
    const startIdx = idx;
    // Treat any release with type 'singles' as flat list (no header)
    if (rel.type === 'singles') {
      tracks.forEach((t, ti) => {
        const art = t.artwork ? `<img class="t-art" src="${esc(res(rb, t.artwork))}" loading="lazy" onerror="this.style.display='none'">` : '';
        relHTML += `<div class="track" onclick="playTrack(${startIdx + ti})">
          <span class="t-num">${startIdx + ti + 1}</span>${art}
          <div class="t-info"><strong>${esc(t.title)}</strong><span>${esc(rel.year || '')}</span></div>
          <span class="t-dur" id="dur-${startIdx + ti}">—</span>
        </div>`;
      });
      idx += tracks.length;
    }
    else if (tracks.length > 1 || rel.type === 'album' || rel.type === 'ep') {
      const cover = rel.artwork ? `<img class="album-cv" src="${esc(res(rb, rel.artwork))}" loading="lazy" onerror="this.style.display='none'">` : '';
      relHTML += `<div class="album-block"><div class="album-hd">${cover}<div class="album-meta"><strong>${esc(rel.title)}</strong><span>${esc(rel.type||'album')}${rel.year?' · '+rel.year:''}</span></div></div><div class="track-list">${renderTracks(tracks, rb, startIdx)}</div></div>`;
      idx += tracks.length;
    } else if (tracks.length === 1) {
      const t = tracks[0];
      const art = rel.artwork ? `<img class="t-art" src="${esc(res(rb, rel.artwork))}" loading="lazy" onerror="this.style.display='none'">` : '';
      relHTML += `<div class="track" onclick="playTrack(${startIdx})">
        <span class="t-num">${startIdx+1}</span>${art}
        <div class="t-info"><strong>${esc(t.title)}</strong><span>${esc(rel.year||'')}</span></div>
        <span class="t-dur" id="dur-${startIdx}">—</span>
      </div>`;
      idx += tracks.length;
    }
  });
  root.innerHTML = `<div class="hd">${av}<div class="hd-info"><h1>${esc(d.name)}</h1>${d.location?`<div class="loc">${esc(d.location)}</div>`:''}${d.bio?`<p class="bio">${esc(d.bio)}</p>`:''}${links?`<div class="links">${links}</div>`:''}</div></div>${relHTML || '<p class="msg">No releases yet.</p>'}`;
  buildQueue(d.releases || [], base);
  (d.releases || []).forEach((rel, ri) => loadDurations(rel.tracks||[], rel._base||base, (d.releases||[]).slice(0,ri).reduce((a,r)=>a+(r.tracks||[]).length,0)));
}

async function resolveRelease(base, ref) {
  if (typeof ref !== 'string') { if (!ref._base) ref._base = base; return ref; }
  const url = res(base, ref), r = await fetch(url); if (!r.ok) return null;
  const d = await r.json(); d._base = url.substring(0,url.lastIndexOf('/')+1); return d;
}
async function boot() {
  try {
    const r = await fetch(JSON_URL); if (!r.ok) throw new Error('HTTP '+r.status);
    const d = await r.json();
    if (d.name) document.title = d.name;
    if (d.releases) d.releases = (await Promise.all(d.releases.map(ref => resolveRelease(BASE, ref)))).filter(Boolean);
    renderArtist(d, BASE);
    if (queue.length && !document.getElementById('bar').classList.contains('on')) {
      loadTrackToPlayer(0);
    }
  } catch(e) { document.getElementById('root').innerHTML = `<p class="msg">Could not load — ${esc(e.message)}</p>`; }
}
boot();