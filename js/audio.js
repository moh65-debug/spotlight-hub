// ============================================================
//  AUDIO.JS - Audio player functionality
// ============================================================

const audioEl   = document.getElementById('audio-el');
const playerBar = document.getElementById('audio-player-bar');
const trackName = document.getElementById('audio-track-name');
const playBtn   = document.getElementById('audio-play');
const seekEl    = document.getElementById('audio-seek');
const curEl     = document.getElementById('audio-cur');
const durEl     = document.getElementById('audio-dur');

let audioQueue = [];
let audioIndex = 0;

function fmtTime(s) {
  if (isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

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

let _audioObjectUrl = null;

async function loadAudioTrack() {
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
      // Route archive.org through our same-origin proxy to avoid
      // mixed-content blocks (s3.us.archive.org redirects to HTTP).
      audioEl.src = isArchiveOrgURL(track.url)
        ? toProxyUrl(track.url)
        : track.url;
    }
  } catch (_) {
    audioEl.src = isArchiveOrgURL(track.url) ? toProxyUrl(track.url) : track.url;
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

function audioToggle() { audioEl.paused ? audioEl.play() : audioEl.pause(); }
function audioSkip(dir) {
  const next = audioIndex + dir;
  if (next >= 0 && next < audioQueue.length) { audioIndex = next; loadAudioTrack(); }
}
function audioClose() {
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
