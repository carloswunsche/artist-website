// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  JSON_URL: 'https://carloswunsche.github.io/music/artist.json',
  RESTART_THRESHOLD: 1.2,
  DOUBLE_TAP_DELAY: 400,
  TIMELINE_DEBOUNCE_MS: 100,
  DURATION_LOAD_CONCURRENCY: 3,
  LRC_UPDATE_INTERVAL: 200,
  VOLUME_STORAGE_KEY: 'cw_player_volume',
  LAST_POSITION_STORAGE_KEY: 'cw_player_last_pos'
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
const state = {
  queue: [],
  currentIndex: -1,
  paused: true,
  lyricsOpen: false,
  lrcLines: [],
  lrcInterval: null,
  lrcUserScrolling: false,
  lrcScrollTimer: null,
  seekDragging: false,
  lastRewindTap: 0,
  durationLoadQueue: [],
  durationLoadActive: 0
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================
let DOM = {};

// ============================================================================
// UTILITIES
// ============================================================================
const BASE = CONFIG.JSON_URL.substring(0, CONFIG.JSON_URL.lastIndexOf('/') + 1);

function resolveUrl(base, path) {
  if (!path) return '';
  return path.startsWith('http') ? path : base + path;
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ============================================================================
// LYRICS PARSING & RENDERING
// ============================================================================
function parseLRC(lrcText) {
  const lines = [];
  lrcText = lrcText.replace(/^\uFEFF/, ''); // Remove BOM
  lrcText.split(/\r?\n/).forEach(line => {
    line = line.trim();
    const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!match) return;
    lines.push({
      time: parseInt(match[1], 10) * 60 + parseFloat(match[2]),
      text: match[3].trim()
    });
  });
  return lines.sort((a, b) => a.time - b.time);
}

function renderLRCLines() {
  const container = DOM.lyricsText;
  if (!container) return;
  container.innerHTML = state.lrcLines
    .map((line, i) => `<span class="lrc-line" id="lrc-${i}" data-index="${i}">${escapeHTML(line.text)}</span>`)
    .join('');
}

function renderPlainLyrics(text) {
  const container = DOM.lyricsText;
  container.innerHTML = text
    .split('\n')
    .map((line, i) => line.trim()
      ? `<span class="lrc-line" id="lrc-${i}" data-index="${i}">${escapeHTML(line)}</span>`
      : `<span class="lrc-line-blank" id="lrc-${i}"></span>`)
    .join('');
}

function highlightCurrentLine(currentTime) {
  let activeIndex = -1;
  for (let i = 0; i < state.lrcLines.length; i++) {
    if (state.lrcLines[i].time <= currentTime) activeIndex = i;
  }

  state.lrcLines.forEach((_, i) => {
    const el = document.getElementById(`lrc-${i}`);
    if (el) el.classList.toggle('active', i === activeIndex);
  });

  if (!state.lrcUserScrolling && activeIndex >= 0) {
    const activeEl = document.getElementById(`lrc-${activeIndex}`);
    if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function startLRCHighlight() {
  if (state.lrcInterval) clearInterval(state.lrcInterval);
  const scrollDiv = DOM.lyricsScroll;
  if (scrollDiv) {
    scrollDiv.onscroll = () => {
      state.lrcUserScrolling = true;
      clearTimeout(state.lrcScrollTimer);
      state.lrcScrollTimer = setTimeout(() => { state.lrcUserScrolling = false; }, 2000);
    };
  }
  state.lrcInterval = setInterval(() => {
    if (state.lrcLines.length && DOM.aud.src && !DOM.aud.paused) {
      highlightCurrentLine(DOM.aud.currentTime);
    }
  }, CONFIG.LRC_UPDATE_INTERVAL);
}

async function updateLyricsPanel(track) {
  const btn = DOM.lyricsBtn;
  const hasLyrics = !!(track.lyrics_url || (track.lyrics && track.lyrics.trim()));

  btn.classList.toggle('disabled', !hasLyrics);
  if (state.lrcInterval) {
    clearInterval(state.lrcInterval);
    state.lrcInterval = null;
  }
  state.lrcLines = [];

  if (!hasLyrics) {
    if (state.lyricsOpen) {
      state.lyricsOpen = false;
      DOM.lyricsPanel.classList.remove('up');
      btn.classList.remove('active');
    }
    DOM.lyricsText.innerHTML = '';
    return;
  }

  let raw = '';
  if (track.lyrics_url) {
    const lyricsBase = track._base || BASE;
    const url = resolveUrl(lyricsBase, track.lyrics_url);
    console.log('Fetching lyrics:', url);
    const res = await fetch(url);
    console.log('Response status:', res.status);
    raw = await res.text();
    console.log('Raw length:', raw.length);
  } else if (track.lyrics) {
    raw = track.lyrics;
  }

  if (!raw.trim()) {
    DOM.lyricsText.innerHTML = '<span class="lrc-line">No lyrics available</span>';
    return;
  }

  if (raw.trim().startsWith('[')) {
    state.lrcLines = parseLRC(raw);
    console.log('Parsed lines:', state.lrcLines.length)
    renderLRCLines();
    startLRCHighlight();
  } else {
    renderPlainLyrics(raw);
  }

  if (state.lyricsOpen) {
    DOM.lyricsPanel.classList.add('up');
    btn.classList.add('active');
  }
}

function seekToLine(index) {
  if (!state.lrcLines[index]) return;
  state.lrcUserScrolling = true;
  clearTimeout(state.lrcScrollTimer);
  DOM.aud.currentTime = state.lrcLines[index].time;
  const el = document.getElementById(`lrc-${index}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  state.lrcScrollTimer = setTimeout(() => { state.lrcUserScrolling = false; }, 2000);
  highlightCurrentLine(DOM.aud.currentTime);
}

// ============================================================================
// PLAYBACK CONTROL
// ============================================================================
function setPlayPauseIcon(paused) {
  DOM.icoPlay.style.display = paused ? 'none' : 'block';
  DOM.icoPause.style.display = paused ? 'block' : 'none';
}

function updateTrackInfo(track) {
  DOM.bTitle.textContent = track.title;
  let album = track.album || '';
  if (album.toLowerCase() === 'singles') album = '';
  DOM.bSub.textContent = album;

  const img = DOM.pCover;
  if (track.artwork) {
    img.src = track.artwork;
    img.style.display = 'block';
    img.nextElementSibling.style.display = 'none';
  } else {
    img.style.display = 'none';
    img.nextElementSibling.style.display = 'block';
  }

  DOM.bar.classList.add('on');
}

function highlightCurrentTrack(index) {
  document.querySelectorAll('.track, .track-singles').forEach((el, i) => {
    el.classList.toggle('playing', i === index);
  });
  document.querySelectorAll('.t-num').forEach((el, i) => {
    el.innerHTML = i === index ? '▶' : i + 1;
  });
  document.querySelectorAll('.t-now-icon').forEach((el, i) => {
    if (el) el.style.display = i === index ? 'flex' : 'none';
  });
}

function playTrack(index) {
  if (index < 0 || index >= state.queue.length) return;

  state.currentIndex = index;
  const track = state.queue[index];
  DOM.aud.src = track.src;
  DOM.aud.play().catch(() => {});
  state.paused = false;
  setPlayPauseIcon(false);

  updateTrackInfo(track);
  highlightCurrentTrack(index);
  updateLyricsPanel(track); // async, no await needed
}

function loadTrackToPlayer(index) {
  if (index < 0 || index >= state.queue.length) return;
  state.currentIndex = index;
  const track = state.queue[index];
  DOM.aud.src = track.src;
  DOM.aud.load();
  state.paused = true;
  setPlayPauseIcon(true);
  updateTrackInfo(track);
  highlightCurrentTrack(index);
  updateLyricsPanel(track);
}

function togglePlay() {
  if (DOM.aud.paused) {
    DOM.aud.play();
    state.paused = false;
  } else {
    DOM.aud.pause();
    state.paused = true;
  }
  setPlayPauseIcon(state.paused);
}

function skip(direction) {
  if (direction < 0) {
    const now = Date.now();
    const isDoubleTap = now - state.lastRewindTap < CONFIG.DOUBLE_TAP_DELAY;
    state.lastRewindTap = now;

    if (DOM.aud.currentTime > CONFIG.RESTART_THRESHOLD) {
      DOM.aud.currentTime = 0;
      setPlayPauseIcon(state.paused);
      if (state.lrcLines.length) {
        const firstLine = document.getElementById('lrc-0');
        if (firstLine) firstLine.scrollIntoView({ block: 'center' });
      }
      return;
    }

    if (isDoubleTap && state.currentIndex > 0) {
      playTrack(state.currentIndex - 1);
      return;
    }

    if (state.currentIndex > 0) {
      playTrack(state.currentIndex - 1);
      return;
    }
    return;
  }

  playTrack(state.currentIndex + direction);
}

// ============================================================================
// DURATION LOADING (batched)
// ============================================================================
function loadNextDuration() {
  if (state.durationLoadActive >= CONFIG.DURATION_LOAD_CONCURRENCY) return;
  if (state.durationLoadQueue.length === 0) return;

  const { track, elementId } = state.durationLoadQueue.shift();
  state.durationLoadActive++;

  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = track.src;
  audio.onloadedmetadata = () => {
    const el = document.getElementById(elementId);
    if (el) el.textContent = formatTime(audio.duration);
    state.durationLoadActive--;
    loadNextDuration();
  };
  audio.onerror = () => {
    state.durationLoadActive--;
    loadNextDuration();
  };
}

function enqueueDurationLoad(track, elementId) {
  state.durationLoadQueue.push({ track, elementId });
  loadNextDuration();
}

// ============================================================================
// RENDERING ARTIST & TRACKS
// ============================================================================
function buildQueue(releases, base) {
  state.queue = [];
  releases.forEach(rel => {
    const relBase = rel._base || base;
    (rel.tracks || []).forEach(t => {
      // Support both 'cover' and 'artwork' field names
      const artwork = t.cover ? resolveUrl(relBase, t.cover) 
                    : (t.artwork ? resolveUrl(relBase, t.artwork) 
                    : (rel.cover ? resolveUrl(relBase, rel.cover) 
                    : (rel.artwork ? resolveUrl(relBase, rel.artwork) : '')));
      state.queue.push({
        title: t.title,
        album: rel.title || '',
        src: resolveUrl(relBase, t.src || t.file || t.stream || ''),
        feat: t.feat || '',
        lyrics: t.lyrics || null,
        lyrics_url: t.lyrics_url || null,
        artwork: artwork,
        _base: relBase // Store release base for relative paths
      });
    });
  });
}

function renderTracksHTML(tracks, base, startIdx) {
  return tracks.map((t, i) => {
    const globalIndex = startIdx + i;
    const artwork = t.cover ? resolveUrl(base, t.cover) : (t.artwork ? resolveUrl(base, t.artwork) : '');
    const art = artwork
      ? `<img class="t-art" src="${escapeHTML(artwork)}" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="t-art-placeholder"></div>`;
    return `
      <div class="track" data-qi="${globalIndex}">
        <span class="t-num">${i + 1}</span>
        <span class="t-now-icon" style="display:none"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><use href="icons.svg#play-small"/></svg></span>
        ${art}
        <div class="t-info">
          <strong>${escapeHTML(t.title)}</strong>
          <span>${escapeHTML(t.feat || '')}</span>
        </div>
        <span class="t-dur" id="dur-${globalIndex}">—</span>
      </div>
    `;
  }).join('');
}

function renderArtist(data, base) {
  const root = DOM.root;
  const avatar = data.avatar
    ? `<img class="av" src="${escapeHTML(resolveUrl(base, data.avatar))}" onerror="this.outerHTML='<div class=av-ph>🎵</div>'">`
    : '<div class="av-ph">🎵</div>';

  const linkMap = {
    instagram: 'Instagram', youtube: 'YouTube', spotify: 'Spotify',
    bandcamp: 'Bandcamp', soundcloud: 'SoundCloud', twitter: 'Twitter',
    facebook: 'Facebook', tiktok: 'TikTok', website: 'Website'
  };
  const links = data.links
    ? Object.entries(data.links)
        .map(([k, v]) => `<a class="lnk" href="${escapeHTML(v)}" target="_blank" rel="noopener">${linkMap[k] || k}</a>`)
        .join('')
    : '';

  let releasesHTML = '';
  let trackIndex = 0;

  (data.releases || []).forEach(rel => {
    const relBase = rel._base || base;
    const tracks = rel.tracks || [];
    const startIdx = trackIndex;

    if (rel.type === 'singles') {
      releasesHTML += `<div class="singles-header">Singles</div>`;
      releasesHTML += `<div class="singles-list">`;
      tracks.forEach((t, i) => {
        const artwork = t.cover ? resolveUrl(relBase, t.cover) : (t.artwork ? resolveUrl(relBase, t.artwork) : '');
        const art = artwork
          ? `<img class="t-art" src="${escapeHTML(artwork)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="t-art-placeholder"></div>`;
        releasesHTML += `
          <div class="track-singles" data-qi="${startIdx + i}">
            ${art}
            <div class="t-info">
              <strong>${escapeHTML(t.title)}</strong>
              <span>${escapeHTML(rel.year || '')}</span>
            </div>
            <span class="t-now-icon" style="display:none"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><use href="icons.svg#play-small"/></svg></span>
            <span class="t-dur" id="dur-${startIdx + i}">—</span>
          </div>
        `;
      });
      releasesHTML += `</div>`;
      trackIndex += tracks.length;
    } else if (tracks.length > 1 || rel.type === 'album' || rel.type === 'ep') {
      const cover = rel.cover ? resolveUrl(relBase, rel.cover) : (rel.artwork ? resolveUrl(relBase, rel.artwork) : '');
      const coverHTML = cover
        ? `<img class="album-cv" src="${escapeHTML(cover)}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="album-cv-placeholder" style="background:var(--bg2);width:72px;height:72px;border-radius:var(--r-sm);"></div>`;
      releasesHTML += `
        <div class="album-block">
          <div class="album-hd">
            ${coverHTML}
            <div class="album-meta">
              <strong>${escapeHTML(rel.title)}</strong>
              <span>${escapeHTML(rel.type || 'album')}${rel.year ? ' · ' + rel.year : ''}</span>
            </div>
          </div>
          <div class="track-list">
            ${renderTracksHTML(tracks, relBase, startIdx)}
          </div>
        </div>
      `;
      trackIndex += tracks.length;
    } else if (tracks.length === 1) {
      const t = tracks[0];
      const artwork = t.cover ? resolveUrl(relBase, t.cover) : (t.artwork ? resolveUrl(relBase, t.artwork) : '');
      const art = artwork
        ? `<img class="t-art" src="${escapeHTML(artwork)}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="t-art-placeholder"></div>`;
      releasesHTML += `
        <div class="track" data-qi="${startIdx}">
          <span class="t-num">${startIdx + 1}</span>
          <span class="t-now-icon" style="display:none"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><use href="icons.svg#play-small"/></svg></span>
          ${art}
          <div class="t-info">
            <strong>${escapeHTML(t.title)}</strong>
            <span>${escapeHTML(rel.year || '')}</span>
          </div>
          <span class="t-dur" id="dur-${startIdx}">—</span>
        </div>
      `;
      trackIndex++;
    }
  });

  root.innerHTML = `
    <div class="hd">
      ${avatar}
      <div class="hd-info">
        <h1>${escapeHTML(data.name)}</h1>
        ${data.location ? `<div class="loc">${escapeHTML(data.location)}</div>` : ''}
        ${data.bio ? `<p class="bio">${escapeHTML(data.bio)}</p>` : ''}
        ${links ? `<div class="links">${links}</div>` : ''}
      </div>
    </div>
    ${releasesHTML || '<p class="msg">No releases yet.</p>'}
  `;

  buildQueue(data.releases || [], base);

  (data.releases || []).forEach(rel => {
    const relBase = rel._base || base;
    (rel.tracks || []).forEach((track, i) => {
      const src = track.src || track.file || track.stream || '';
      const globalIdx = state.queue.findIndex(q => q.src === resolveUrl(relBase, src));
      if (globalIdx !== -1) {
        enqueueDurationLoad(state.queue[globalIdx], `dur-${globalIdx}`);
      }
    });
  });
}

// ============================================================================
// EVENT HANDLERS & INITIALIZATION
// ============================================================================
function setupEventListeners() {
  DOM.aud.ontimeupdate = debounce(() => {
    DOM.bCur.textContent = formatTime(DOM.aud.currentTime);
    if (!state.seekDragging && DOM.aud.duration) {
      const percent = (DOM.aud.currentTime / DOM.aud.duration) * 100;
      DOM.pFill.style.width = percent + '%';
    }
    if (state.lrcLines.length) {
      highlightCurrentLine(DOM.aud.currentTime);
    }
  }, CONFIG.TIMELINE_DEBOUNCE_MS);

  DOM.aud.ondurationchange = () => {
    DOM.bDur.textContent = formatTime(DOM.aud.duration);
  };

  DOM.aud.onended = () => skip(1);

  DOM.pBar.addEventListener('click', e => {
    const rect = DOM.pBar.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    DOM.aud.currentTime = percent * DOM.aud.duration;
  });

  DOM.volSlider.addEventListener('input', e => {
    DOM.aud.volume = e.target.value / 100;
  });

  const savedVolume = localStorage.getItem(CONFIG.VOLUME_STORAGE_KEY);
  if (savedVolume !== null) {
    DOM.aud.volume = parseFloat(savedVolume);
    DOM.volSlider.value = savedVolume * 100;
  } else {
    DOM.aud.volume = 0.8;
    DOM.volSlider.value = 80;
  }

  document.addEventListener('click', e => {
    const trackDiv = e.target.closest('.track, .track-singles');
    if (!trackDiv) return;
    const qi = trackDiv.dataset.qi;
    if (qi !== undefined) {
      playTrack(parseInt(qi, 10));
    }
  });

  DOM.lyricsText.addEventListener('click', e => {
    const line = e.target.closest('.lrc-line');
    if (!line) return;
    const idx = line.dataset.index;
    if (idx !== undefined && state.lrcLines[idx]) {
      seekToLine(parseInt(idx, 10));
    }
  });

  DOM.lyricsBtn.addEventListener('click', () => {
    if (DOM.lyricsBtn.classList.contains('disabled')) return;
    state.lyricsOpen = !state.lyricsOpen;
    DOM.lyricsPanel.classList.toggle('up', state.lyricsOpen);
    DOM.lyricsBtn.classList.toggle('active', state.lyricsOpen);
  });

  DOM.bPp.addEventListener('click', togglePlay);
  DOM.bPrev.addEventListener('click', () => skip(-1));
  DOM.bNext.addEventListener('click', () => skip(1));

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) skip(-1);
        else DOM.aud.currentTime = Math.max(0, DOM.aud.currentTime - 5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) skip(1);
        else DOM.aud.currentTime = Math.min(DOM.aud.duration, DOM.aud.currentTime + 5);
        break;
    }
  });

  window.addEventListener('beforeunload', () => {
    if (DOM.aud.src) {
      localStorage.setItem(CONFIG.LAST_POSITION_STORAGE_KEY, DOM.aud.currentTime);
    }
    localStorage.setItem(CONFIG.VOLUME_STORAGE_KEY, DOM.aud.volume);
  });
}

// ============================================================================
// BOOTSTRAP
// ============================================================================
async function resolveRelease(base, ref) {
  if (typeof ref !== 'string') {
    if (!ref._base) ref._base = base;
    return ref;
  }
  const url = resolveUrl(base, ref);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    data._base = url.substring(0, url.lastIndexOf('/') + 1);
    return data;
  } catch {
    return null;
  }
}

async function boot() {
  DOM = {
    aud: document.getElementById('aud'),
    bCur: document.getElementById('b-cur'),
    bDur: document.getElementById('b-dur'),
    bTitle: document.getElementById('b-title'),
    bSub: document.getElementById('b-sub'),
    bar: document.getElementById('bar'),
    icoPlay: document.getElementById('ico-play'),
    icoPause: document.getElementById('ico-pause'),
    lyricsBtn: document.getElementById('lyrics-btn'),
    lyricsPanel: document.getElementById('lyrics-panel'),
    lyricsScroll: document.getElementById('lyrics-scroll'),
    lyricsText: document.getElementById('lyrics-text'),
    root: document.getElementById('root'),
    bPrev: document.getElementById('b-prev'),
    bNext: document.getElementById('b-next'),
    bPp: document.getElementById('b-pp'),
    pCover: document.getElementById('p-cover'),
    volSlider: document.getElementById('vol-slider'),
    pFill: document.getElementById('pfill'),
    pBar: document.getElementById('pbar')
  };

  setupEventListeners();

  try {
    const response = await fetch(CONFIG.JSON_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.name) document.title = data.name;

    if (data.releases) {
      data.releases = (await Promise.all(
        data.releases.map(ref => resolveRelease(BASE, ref))
      )).filter(Boolean);
    }

    renderArtist(data, BASE);

    if (state.queue.length && !DOM.bar.classList.contains('on')) {
      const lastPos = localStorage.getItem(CONFIG.LAST_POSITION_STORAGE_KEY);
      loadTrackToPlayer(0);
      if (lastPos !== null) {
        DOM.aud.currentTime = parseFloat(lastPos) || 0;
      }
    }
  } catch (error) {
    DOM.root.innerHTML = `<p class="msg">Could not load — ${escapeHTML(error.message)}</p>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}