// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  JSON_URL: 'https://carloswunsche.github.io/music/artist.json',
  RESTART_THRESHOLD: 1.2,          // seconds before track restart instead of previous
  DOUBLE_TAP_DELAY: 400,            // ms
  TIMELINE_DEBOUNCE_MS: 100,        // throttle UI updates from ontimeupdate
  DURATION_LOAD_CONCURRENCY: 3,     // max simultaneous metadata requests
  LRC_UPDATE_INTERVAL: 200,         // ms
  VOLUME_STORAGE_KEY: 'cw_player_volume',
  LAST_POSITION_STORAGE_KEY: 'cw_player_last_pos'
};

// ============================================================================
// GLOBAL STATE
// ============================================================================
const state = {
  // Playback
  queue: [],
  currentIndex: -1,
  paused: true,

  // Lyrics
  lyricsOpen: false,
  lrcLines: [],
  lrcInterval: null,
  lrcUserScrolling: false,
  lrcScrollTimer: null,

  // UI interaction
  seekDragging: false,
  lastRewindTap: 0,
  durationLoadQueue: [],      // tracks waiting for metadata
  durationLoadActive: 0
};

// ============================================================================
// DOM ELEMENTS (cached after DOM ready)
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

// Debounce utility
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
  lrcText.split('\n').forEach(line => {
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

function updateLyricsPanel(track) {
  const btn = DOM.lyricsBtn;
  const raw = track.lyrics ? track.lyrics.trim() : '';
  const hasLyrics = raw.length > 0;

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
    return;
  }

  if (raw.startsWith('[')) {
    state.lrcLines = parseLRC(raw);
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
  DOM.bar.classList.add('on');
}

function highlightCurrentTrack(index) {
  document.querySelectorAll('.track').forEach((el, i) => {
    el.classList.toggle('playing', i === index);
  });
  document.querySelectorAll('.t-num').forEach((el, i) => {
    el.innerHTML = i === index ? '▶' : i + 1;
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
  updateLyricsPanel(track);

  // Save last position intent (we'll store actual time on pause/unload)
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
  // Rewind special handling
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

  // Forward skip
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
    loadNextDuration(); // continue
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
      state.queue.push({
        title: t.title,
        album: rel.title || '',
        src: resolveUrl(relBase, t.src || t.file || t.stream || ''),
        feat: t.feat || '',
        lyrics: t.lyrics || null
      });
    });
  });
}

function renderTracksHTML(tracks, base, startIdx) {
  return tracks.map((t, i) => {
    const globalIndex = startIdx + i;
    const art = t.artwork
      ? `<img class="t-art" src="${escapeHTML(resolveUrl(base, t.artwork))}" loading="lazy" onerror="this.style.display='none'">`
      : '';
    return `
      <div class="track" data-qi="${globalIndex}">
        <span class="t-num">${i + 1}</span>
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
      tracks.forEach((t, i) => {
        const art = t.artwork
          ? `<img class="t-art" src="${escapeHTML(resolveUrl(relBase, t.artwork))}" loading="lazy" onerror="this.style.display='none'">`
          : '';
        releasesHTML += `
          <div class="track" data-qi="${startIdx + i}">
            <span class="t-num">${startIdx + i + 1}</span>
            ${art}
            <div class="t-info">
              <strong>${escapeHTML(t.title)}</strong>
              <span>${escapeHTML(rel.year || '')}</span>
            </div>
            <span class="t-dur" id="dur-${startIdx + i}">—</span>
          </div>
        `;
      });
      trackIndex += tracks.length;
    } else if (tracks.length > 1 || rel.type === 'album' || rel.type === 'ep') {
      const cover = rel.artwork
        ? `<img class="album-cv" src="${escapeHTML(resolveUrl(relBase, rel.artwork))}" loading="lazy" onerror="this.style.display='none'">`
        : '';
      releasesHTML += `
        <div class="album-block">
          <div class="album-hd">
            ${cover}
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
      const art = rel.artwork
        ? `<img class="t-art" src="${escapeHTML(resolveUrl(relBase, rel.artwork))}" loading="lazy" onerror="this.style.display='none'">`
        : '';
      releasesHTML += `
        <div class="track" data-qi="${startIdx}">
          <span class="t-num">${startIdx + 1}</span>
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

  // Enqueue duration loads
  (data.releases || []).forEach(rel => {
    const relBase = rel._base || base;
    (rel.tracks || []).forEach((track, i) => {
      const globalIdx = state.queue.findIndex(q => q.src === resolveUrl(relBase, track.src || track.file || track.stream || ''));
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
  // Audio events
  DOM.aud.ontimeupdate = debounce(() => {
    DOM.bCur.textContent = formatTime(DOM.aud.currentTime);
    if (!state.seekDragging && DOM.aud.duration) {
      DOM.bSeek.value = (DOM.aud.currentTime / DOM.aud.duration) * 100;
    }
    if (state.lrcLines.length) {
      highlightCurrentLine(DOM.aud.currentTime);
    }
  }, CONFIG.TIMELINE_DEBOUNCE_MS);

  DOM.aud.ondurationchange = () => {
    DOM.bDur.textContent = formatTime(DOM.aud.duration);
  };

  DOM.aud.onended = () => skip(1);

  // Seek bar
  DOM.bSeek.addEventListener('mousedown', () => { state.seekDragging = true; });
  DOM.bSeek.addEventListener('mouseup', () => {
    state.seekDragging = false;
    DOM.aud.currentTime = (DOM.bSeek.value / 100) * (DOM.aud.duration || 0);
  });
  DOM.bSeek.addEventListener('touchstart', () => { state.seekDragging = true; }, { passive: true });
  DOM.bSeek.addEventListener('touchend', () => {
    state.seekDragging = false;
    DOM.aud.currentTime = (DOM.bSeek.value / 100) * (DOM.aud.duration || 0);
  });

  // Track click delegation (avoid inline onclick)
  document.addEventListener('click', e => {
    const trackDiv = e.target.closest('.track');
    if (!trackDiv) return;
    const qi = trackDiv.dataset.qi;
    if (qi !== undefined) {
      playTrack(parseInt(qi, 10));
    }
  });

  // Lyrics line click delegation
  DOM.lyricsText.addEventListener('click', e => {
    const line = e.target.closest('.lrc-line');
    if (!line) return;
    const idx = line.dataset.index;
    if (idx !== undefined && state.lrcLines[idx]) {
      seekToLine(parseInt(idx, 10));
    }
  });

  // Lyrics panel toggle
  DOM.lyricsBtn.addEventListener('click', () => {
    if (DOM.lyricsBtn.classList.contains('disabled')) return;
    state.lyricsOpen = !state.lyricsOpen;
    DOM.lyricsPanel.classList.toggle('up', state.lyricsOpen);
    DOM.lyricsBtn.classList.toggle('active', state.lyricsOpen);
  });

  // Play/pause button
  DOM.bPp.addEventListener('click', togglePlay);

  // Prev/next
  DOM.bPrev.addEventListener('click', () => skip(-1));
  DOM.bNext.addEventListener('click', () => skip(1));

  // Keyboard shortcuts
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

  // Save volume and last position
  window.addEventListener('beforeunload', () => {
    if (DOM.aud.src) {
      localStorage.setItem(CONFIG.LAST_POSITION_STORAGE_KEY, DOM.aud.currentTime);
    }
    localStorage.setItem(CONFIG.VOLUME_STORAGE_KEY, DOM.aud.volume);
  });

  // Restore volume
  const savedVolume = localStorage.getItem(CONFIG.VOLUME_STORAGE_KEY);
  if (savedVolume !== null) {
    DOM.aud.volume = parseFloat(savedVolume);
  }
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
  // Cache DOM elements
  DOM = {
    aud: document.getElementById('aud'),
    bCur: document.getElementById('b-cur'),
    bDur: document.getElementById('b-dur'),
    bSeek: document.getElementById('b-seek'),
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
    bPp: document.getElementById('b-pp')
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
      // Try to restore last position
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

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}