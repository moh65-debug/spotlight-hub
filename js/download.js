// ============================================================
//  DOWNLOAD.JS - Download and offline save functionality
// ============================================================

// Expose all public functions immediately (hoisting makes this safe —
// 'function' declarations are available before this line executes).
window.downloadFile      = downloadFile;
window.downloadAudio     = downloadAudio;
window.previewPdf        = previewPdf;
window.handleSaveLesson  = handleSaveLesson;
window.saveOffline       = saveOffline;
window.handleSaveOffline = handleSaveOffline;
window.refreshSavedStates = refreshSavedStates;
window.openSavedFile     = openSavedFile;

// ── Archive.org helpers ───────────────────────────────────────────────────────

// Your Cloudflare Worker proxy — same domain, no CORS issues, no HTTP redirects.
// Route: spotlight.dpdns.org/proxy/archive/* → s3.us.archive.org/*
const ARCHIVE_PROXY = 'https://spotlight.dpdns.org/proxy/archive/';

function isArchiveOrgURL(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'archive.org' || u.hostname.endsWith('.archive.org');
  } catch (_) {
    return false;
  }
}

// Convert any archive.org URL to a same-origin proxy URL.
// https://archive.org/download/spotlight-trilogy/X/Y.pdf
//   → https://spotlight.dpdns.org/proxy/archive/spotlight-trilogy/X/Y.pdf
function toProxyUrl(url) {
  try {
    const u = new URL(url);
    // Handle archive.org/download/... canonical form
    if ((u.hostname === 'archive.org' || u.hostname.endsWith('.archive.org')) &&
        u.pathname.startsWith('/download/')) {
      return ARCHIVE_PROXY + u.pathname.slice('/download/'.length);
    }
    // Handle s3.us.archive.org/... form
    if (u.hostname === 's3.us.archive.org') {
      return ARCHIVE_PROXY + u.pathname.slice(1); // strip leading /
    }
  } catch (_) {}
  return url;
}

// Keep toArchiveS3Url for audio player's direct src= fallback (streaming, not downloaded)
function toArchiveS3Url(url) {
  try {
    const u = new URL(url);
    if ((u.hostname === 'archive.org' || u.hostname.endsWith('.archive.org')) &&
        u.pathname.startsWith('/download/')) {
      return 'https://s3.us.archive.org/' + u.pathname.slice('/download/'.length);
    }
  } catch (_) {}
  return url;
}

async function fetchArchiveFile(url, signal) {
  const proxyUrl = toProxyUrl(url);
  const resp = await fetch(proxyUrl, { credentials: 'omit', signal });
  if (!resp.ok) throw new Error('Proxy HTTP ' + resp.status);
  const blob = await resp.blob();
  if (blob.size < 512) throw new Error('Response too small (' + blob.size + ' bytes)');
  return blob;
}

// ── Public functions ──────────────────────────────────────────────────────────

async function downloadFile(evtOrUrl, urlOrFilename, filename) {
  var url, btn;
  if (evtOrUrl && typeof evtOrUrl === 'object' && evtOrUrl.currentTarget) {
    btn = evtOrUrl.currentTarget;
    url = btn.dataset.url;
    filename = btn.dataset.filename;
  } else {
    url = evtOrUrl;
    filename = urlOrFilename;
    btn = null;
  }
  if (btn) { btn.disabled = true; btn.style.opacity = '0.55'; }
  var originalFilename = filename;
  try {
    var record = await dbGet(fileKey(url)).catch(function() { return null; });
    if (record && record.blob) {
      triggerBlobDownload(record.blob, filename || record.name || 'file');
      showToast('Downloaded from offline library ✓');
      return;
    }
    showToast('Downloading… please wait');
    var blob;
    if (isArchiveOrgURL(url)) {
      blob = await fetchArchiveFile(url, null);
    } else {
      var resp = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      blob = await resp.blob();
      if (blob.size === 0) throw new Error('Empty response');
    }
    var rawName = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'download';
    triggerBlobDownload(blob, originalFilename || rawName);
    showToast('Download complete ✓');
  } catch (err) {
    console.warn('downloadFile error:', err);
    var fallbackUrl = isArchiveOrgURL(url) ? toProxyUrl(url) : url;
    window.open(fallbackUrl, '_blank', 'noopener');
    showToast('Opened in new tab — tap Share > Download to save');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

async function downloadAudio(evtOrBtn) {
  var btn = (evtOrBtn && evtOrBtn.currentTarget) ? evtOrBtn.currentTarget : evtOrBtn;
  var url  = btn.dataset.url;
  var name = btn.dataset.name;
  btn.disabled = true;
  btn.style.opacity = '0.55';
  showToast('Downloading audio…');
  try {
    var record = await dbGet(fileKey(url)).catch(function() { return null; });
    if (record && record.blob) {
      triggerBlobDownload(record.blob, name);
      showToast('Downloaded from offline library ✓');
      return;
    }
    var blob = await fetchArchiveFile(url, null);
    triggerBlobDownload(blob, name);
    showToast('Audio downloaded ✓');
  } catch (err) {
    showToast('Download failed — check connection and try again.');
    console.warn('downloadAudio error:', err);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '';
  }
}

async function previewPdf(evtOrBtn) {
  var btn      = (evtOrBtn && evtOrBtn.currentTarget) ? evtOrBtn.currentTarget : evtOrBtn;
  var url      = btn.dataset.url;
  var filename = btn.dataset.filename || 'Document.pdf';
  btn.disabled = true;
  try {
    var record = await dbGet(fileKey(url)).catch(function() { return null; });
    if (record && record.blob) {
      openPdfViewer(URL.createObjectURL(record.blob), filename, false);
      return;
    }
    showToast('Loading preview…');
    var blob   = await fetchArchiveFile(url, null);
    openPdfViewer(URL.createObjectURL(blob), filename, false);
  } catch (err) {
    showToast('Could not load PDF — check connection.');
    console.warn('previewPdf error:', err);
  } finally {
    btn.disabled = false;
  }
}

async function handleSaveLesson(btn) {
  var files;
  try { files = JSON.parse(btn.dataset.files); } catch (_) { return; }
  btn.disabled = true;
  btn.classList.add('saving');
  btn.innerHTML = saveAllIcon() + ' Saving 0/' + files.length + '\u2026';
  var done = 0, errors = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      var key    = fileKey(f.url);
      var exists = await dbGet(key).catch(function() { return null; });
      if (exists && exists.blob) { done++; continue; }
      var blob;
      if (isArchiveOrgURL(f.url)) {
        blob = await fetchArchiveFile(f.url, null);
      } else {
        var r = await fetch(f.url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        blob = await r.blob();
      }
      if (!blob || blob.size === 0) throw new Error('Empty blob');
      var sizeMB = (blob.size / 1024 / 1024).toFixed(1);
      await dbPut({ key: key, name: f.name, type: f.type, url: f.url, blob: blob, sizeMB: sizeMB, savedAt: Date.now() });
      done++;
      btn.innerHTML = saveAllIcon() + ' Saving ' + done + '/' + files.length + '\u2026';
    } catch (err) {
      errors.push(f.name);
      console.warn('handleSaveLesson failed for', f.name, err);
    }
  }
  btn.classList.remove('saving');
  if (errors.length === 0) {
    btn.classList.add('saved');
    btn.innerHTML = saveAllIcon() + ' Saved \u2713';
    showToast('All ' + files.length + ' lesson files saved offline \u2713');
  } else {
    btn.disabled = false;
    btn.innerHTML = saveAllIcon() + ' Save Lesson';
    showToast('Saved ' + done + '/' + files.length + ' \u2014 ' + errors.length + ' failed');
  }
  refreshSavedStates();
}

function triggerBlobDownload(blob, filename) {
  var objUrl = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(objUrl); a.remove(); }, 10000);
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

var DB_NAME = 'spotlight-offline';
var DB_VER  = 1;
var STORE   = 'files';
var db      = null;

function openDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(db); };
    req.onerror   = function() { reject(req.error); };
  });
}

function dbOp(mode, fn) {
  return openDB().then(function(d) {
    return new Promise(function(res, rej) {
      var t;
      try { t = d.transaction(STORE, mode); }
      catch (e) {
        db = null;
        openDB().then(function(d2) {
          var t2 = d2.transaction(STORE, mode);
          t2.onerror = function() { rej(t2.error); };
          fn(t2.objectStore(STORE), res, rej);
        }).catch(rej);
        return;
      }
      t.onerror = function() { rej(t.error); };
      fn(t.objectStore(STORE), res, rej);
    });
  });
}

function dbPut(r)    { return dbOp('readwrite', function(s, res) { s.put(r).onsuccess = res; }); }
function dbGet(key)  { return dbOp('readonly',  function(s, res) { var q = s.get(key); q.onsuccess = function() { res(q.result); }; }); }
function dbDelete(k) { return dbOp('readwrite', function(s, res) { s.delete(k).onsuccess = res; }); }
function dbAll()     { return dbOp('readonly',  function(s, res) { var q = s.getAll(); q.onsuccess = function() { res(q.result); }; }); }

function fileKey(url) {
  try { var u = new URL(url); if (u.hostname === 'archive.org') return 'arc_' + u.pathname; } catch (_) {}
  return url;
}

async function saveOffline(btn, url, name, type) {
  btn.disabled = true;
  btn.classList.add('saving');
  btn.innerHTML = saveIcon() + ' Saving\u2026';
  try {
    var blob;
    if (isArchiveOrgURL(url)) {
      blob = await fetchArchiveFile(url, null);
    } else {
      var resp = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      blob = await resp.blob();
    }
    if (blob.size === 0) throw new Error('Empty response');
    var key    = fileKey(url);
    var sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    try {
      await dbPut({ key: key, name: name, type: type, url: url, blob: blob, sizeMB: sizeMB, savedAt: Date.now() });
    } catch (dbErr) {
      var isQuota = dbErr && (dbErr.name === 'QuotaExceededError' || String(dbErr).includes('quota'));
      if (isQuota) throw new Error('Storage full. Free up space on your device and try again.');
      throw new Error("Could not save to device storage.");
    }
    btn.classList.remove('saving');
    btn.classList.add('saved');
    btn.innerHTML = saveIcon() + ' Saved \u2713';
    showToast('"' + name + '" saved (' + sizeMB + ' MB)');
  } catch (err) {
    btn.classList.remove('saving');
    btn.disabled = false;
    btn.innerHTML = saveIcon() + ' Offline';
    var msg = err.message || 'Could not save — check your connection.';
    showToast(msg.length > 80 ? 'Could not save. Check connection and try again.' : msg);
    console.warn('saveOffline error:', err);
  }
}

async function refreshSavedStates() {
  var all = await dbAll();
  var savedKeys = new Set(all.map(function(r) { return r.key; }));
  document.querySelectorAll('.btn-save-offline').forEach(function(btn) {
    var key = fileKey(btn.dataset.url || '');
    if (savedKeys.has(key)) {
      btn.classList.add('saved');
      btn.innerHTML = saveIcon() + ' Saved \u2713';
      btn.disabled = true;
    } else {
      if (!btn.classList.contains('saving')) btn.innerHTML = saveIcon() + ' Offline';
    }
  });
}

function handleSaveOffline(btn) {
  saveOffline(btn, btn.dataset.url, btn.dataset.name, btn.dataset.type);
}

function updateLibraryCount() { /* no-op — library panel removed */ }

var _savedFileObjectUrl = null;

async function openSavedFile(key) {
  var record = await dbGet(key);
  if (!record) { showToast('File not found in library.'); return; }
  if (_savedFileObjectUrl) {
    var prev = _savedFileObjectUrl;
    setTimeout(function() { URL.revokeObjectURL(prev); }, 5000);
    _savedFileObjectUrl = null;
  }
  var objectUrl = URL.createObjectURL(record.blob);
  _savedFileObjectUrl = objectUrl;
  if (record.type === 'pdf') {
    openPdfViewer(objectUrl, record.name, true);
  } else if (record.type === 'mp3') {
    playAudioFromBlob(objectUrl, record.name);
    _savedFileObjectUrl = null;
  }
}
