// ============================================================
//  AUDIO.JS - Audio player functionality
// ============================================================

// DOM refs — resolved lazily so this file is safe to load in any order
let audioEl, playerBar, trackName, playBtn, seekEl, curEl, durEl;
let _audioRefsInit = false;

function _initAudioRefs() {
  if (_audioRefsInit) return;
  _audioRefsInit = true;
  audioEl   = document.getElementById('audio-el');
  playerBar = document.getElementById('audio-player-bar');
  trackName = document.getElementById('audio-track-name');
  playBtn   = document.getElementById('audio-play');
  seekEl    = document.getElementById('audio-seek');
  curEl     = document.getElementById('audio-cur');
  durEl     = document.getElementById('audio-dur');

  audioEl.addEventListener('timeupdate', () => {
    curEl.textContent = fmtTime(audioEl.currentTime);
    if (audioEl.duration) seekEl.value = (audioEl.currentTime / audioEl.duration) * 100;
  });
  audioEl.addEventListener('loadedmetadata', () => { durEl.textContent = fmtTime(audioEl.duration); });
  audioEl.addEventListener('ended', () => {
    if (audioIndex < audioQueue.length - 1) { audioIndex++; loadAudioTrack(); }
    else { playBtn.textContent = '▶'; }
  });
  audioEl.addEventListener('play',  () => { playBtn.textContent = '⏸'; });
  audioEl.addEventListener('pause', () => { playBtn.textContent = '▶'; });
  seekEl.addEventListener('input', () => {
    if (audioEl.duration) audioEl.currentTime = (seekEl.value / 100) * audioEl.duration;
  });
}

let audioQueue = [];
let audioIndex = 0;

function fmtTime(s) {
  if (isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

let _audioObjectUrl = null;

async function loadAudioTrack() {
  _initAudioRefs();
  const track = audioQueue[audioIndex];
  if (!track) return;
  trackName.textContent = track.name;

  if (_audioObjectUrl) {
    const prev = _audioObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 3000);
    _audioObjectUrl = null;
  }

  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();

  try {
    const key    = fileKey(track.url);
    const record = await dbGet(key);
    if (record?.blob) {
      const objUrl    = URL.createObjectURL(record.blob);
      _audioObjectUrl = objUrl;
      audioEl.src     = objUrl;
    } else {
      const isArchiveURL = isArchiveOrgURL(track.url);
      if (isArchiveURL) {
        // Use S3 endpoint for direct streaming (has CORS headers)
        audioEl.src = toArchiveS3Url(track.url);
      } else {
        audioEl.src = track.url;
      }
    }
  } catch (_) {
    audioEl.src = track.url;
  }

  try {
    await audioEl.play();
  } catch (err) {
    playBtn.textContent = '▶';
    console.warn('Audio autoplay blocked:', err);
  }
  playerBar.classList.add('active');
  const barH = playerBar.offsetHeight || 90;
  document.body.style.paddingBottom = barH + 'px';
  // Update toast position
  document.getElementById('toast-msg')?.classList.add('above-player');
}

function playAudio(url, name, queue) {
  if (typeof url === 'object' && url.currentTarget) { // event
    const btn = url.currentTarget;
    url = btn.dataset.url;
    name = btn.dataset.name;
    queue = JSON.parse(btn.dataset.queue);
  }
  audioQueue = Array.isArray(queue) ? queue : [{ url, name }];
  audioIndex = audioQueue.findIndex(t => t.url === url);
  if (audioIndex < 0) audioIndex = 0;
  loadAudioTrack();
}

function playAudioFromBlob(objectUrl, name) {
  _initAudioRefs();
  if (_audioObjectUrl && _audioObjectUrl !== objectUrl) {
    const prev = _audioObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 3000);
  }
  _audioObjectUrl = objectUrl;
  audioQueue = [{ url: objectUrl, name }];
  audioIndex = 0;
  audioEl.pause();
  audioEl.src = objectUrl;
  trackName.textContent = name;
  audioEl.play().catch(err => console.warn('playAudioFromBlob error:', err));
  playerBar.classList.add('active');
  const barH = playerBar.offsetHeight || 90;
  document.body.style.paddingBottom = barH + 'px';
  document.getElementById('toast-msg')?.classList.add('above-player');
}

function audioToggle() { _initAudioRefs(); audioEl.paused ? audioEl.play() : audioEl.pause(); }
function audioSkip(dir) {
  _initAudioRefs();
  const next = audioIndex + dir;
  if (next >= 0 && next < audioQueue.length) { audioIndex = next; loadAudioTrack(); }
}
function audioClose() {
  _initAudioRefs();
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  if (_audioObjectUrl) {
    const prev = _audioObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 1000);
    _audioObjectUrl = null;
  }
  playerBar.classList.remove('active');
  document.body.style.paddingBottom = '';
  document.getElementById('toast-msg')?.classList.remove('above-player');
}

// Expose to global
window.playAudio = playAudio;
window.playAudioFromBlob = playAudioFromBlob;
window.audioToggle = audioToggle;
window.audioSkip = audioSkip;
window.audioClose = audioClose;
