// ============================================================
//  DOWNLOAD.JS - Download and offline save functionality
// ============================================================

function isArchiveOrgURL(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'archive.org' || u.hostname.endsWith('.archive.org');
  } catch (_) {
    return false;
  }
}

function tryCorsProxies(url, signal) {
  const proxies = [
    { url: `https://corsproxy.io/?${encodeURIComponent(url)}`, headers: {} },
    { url: `https://cors.lol/?url=${encodeURIComponent(url)}`, headers: {} },
    { url: `https://cors-anywhere.herokuapp.com/${url}`, headers: { 'X-Requested-With': 'XMLHttpRequest' } },
    { url: `https://corsproxy.org/?${encodeURIComponent(url)}`, headers: {} }
  ];

  const errors = [];

  const tryNext = (index) => {
    if (index >= proxies.length) {
      return Promise.reject(new Error('All CORS proxies failed: ' + errors.join('; ')));
    }

    const proxy = proxies[index];
    return fetch(proxy.url, { mode: 'cors', credentials: 'omit', headers: proxy.headers, signal, redirect: 'follow' })
      .then(resp => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        // Check content-type to ensure we got a valid response
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('text/html') && !url.endsWith('.html')) {
          throw new Error('Got HTML instead of file');
        }
        return resp.blob().then(blob => {
          if (blob.size === 0) {
            throw new Error('Empty response');
          }
          // Basic validation: PDF should be > 10KB, audio > 1KB
          if (url.endsWith('.pdf') && blob.size < 10240) {
            throw new Error('PDF too small, likely error page');
          }
          if (url.endsWith('.mp3') && blob.size < 1024) {
            throw new Error('MP3 too small, likely error page');
          }
          return blob;
        });
      })
      .catch(err => {
        errors.push(`Proxy ${index}: ${err.message}`);
        return tryNext(index + 1);
      });
  };

  return tryNext(0);
}

function extractFileName(resp, fallback, originalUrl) {
  const cd = resp.headers.get('Content-Disposition');
  if (cd) {
    const match = /filename[^;=\s]*=((['"]).*?\2|[^;\s]+)/i.exec(cd);
    if (match != null && match[1]) {
      return match[1].replace(/['"]/g, '');
    }
  }
  if (originalUrl && isArchiveOrgURL(originalUrl)) {
    try {
      const u = new URL(originalUrl);
      const pathParts = u.pathname.split('/').filter(p => p);
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart.includes('.')) return lastPart;
    } catch (_) {}
  }
  return fallback;
}

async function downloadFile(evtOrUrl, urlOrFilename, filename) {
  let url, btn;
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

  const originalFilename = filename;

  try {
    const record = await dbGet(fileKey(url)).catch(() => null);
    if (record?.blob) {
      triggerBlobDownload(record.blob, filename || record.name || 'file');
      showToast('Downloaded from offline library ✓');
      return;
    }

    showToast('Downloading… please wait');
    
    let blob;
    let respSourceUrl = url;
    
    if (isArchiveOrgURL(url)) {
      try {
        blob = await tryCorsProxies(url, null);
        respSourceUrl = 'archive.org (proxied)';
      } catch (proxyErr) {
        throw new Error(`CDN fetch failed: ${proxyErr.message}`);
      }
    } else {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      blob = await resp.blob();
      if (blob.size === 0) throw new Error('Empty response');
    }
    
    const finalName = extractFileName(null, originalFilename || filename || url.split('/').pop(), url);
    triggerBlobDownload(blob, finalName);
    showToast('Download complete ✓');
  } catch (err) {
    console.warn('downloadFile error:', err);
    showToast('Trying alternative download method...');
    
    const finalName = originalFilename || filename || url.split('/').pop();
    
    try {
      await downloadViaIframe(url, finalName);
      showToast('Download started ✓');
    } catch (iframeErr) {
      console.warn('Iframe fallback also failed:', iframeErr);
      window.open(url, '_blank', 'noopener');
      showToast('Opened in new tab — use Save As to download');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  }
}

function downloadViaIframe(url, filename) {
  return new Promise((resolve, reject) => {
    if (url.includes('archive.org') && url.endsWith('.pdf')) {
      // For PDFs, use Google Docs viewer which has a download button
      const googleViewer = `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
      window.open(googleViewer, '_blank');
      resolve();
    } else {
      // For audio and other files, try native download attribute
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        resolve();
      }, 100);
    }
  });
}

function triggerBlobDownload(blob, filename) {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(objUrl); a.remove(); }, 10000);
}

// IndexedDB setup
const DB_NAME = 'spotlight-offline';
const DB_VER  = 1;
const STORE   = 'files';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

function dbOp(mode, fn) {
  return openDB().then(d => new Promise((res, rej) => {
    let t;
    try {
      t = d.transaction(STORE, mode);
    } catch (e) {
      db = null;
      openDB().then(d2 => {
        const t2 = d2.transaction(STORE, mode);
        t2.onerror = () => rej(t2.error);
        fn(t2.objectStore(STORE), res, rej);
      }).catch(rej);
      return;
    }
    t.onerror = () => rej(t.error);
    fn(t.objectStore(STORE), res, rej);
  }));
}
const dbPut    = r   => dbOp('readwrite', (s, res) => { s.put(r).onsuccess = res; });
const dbGet    = key => dbOp('readonly',  (s, res) => { const q = s.get(key); q.onsuccess = () => res(q.result); });
const dbDelete = key => dbOp('readwrite', (s, res) => { s.delete(key).onsuccess = res; });
const dbAll    = ()  => dbOp('readonly',  (s, res) => { const q = s.getAll(); q.onsuccess = () => res(q.result); });

function fileKey(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'archive.org') {
      return 'arc_' + u.pathname;
    }
  } catch (_) {}
  return url;
}

async function saveOffline(btn, url, name, type) {
  btn.disabled = true;
  btn.classList.add('saving');
  btn.innerHTML = `${saveIcon()} Saving…`;

  try {
    const isArchiveURL = isArchiveOrgURL(url);

    let blob;
    if (isArchiveURL) {
      try {
        blob = await tryCorsProxies(url, null);
      } catch (proxyErr) {
        throw new Error(`CDN fetch failed: ${proxyErr.message}`);
      }
    } else {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      blob = await resp.blob();
    }

    if (blob.size === 0) throw new Error('Empty response');
    const key    = fileKey(url);
    const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
    try {
      await dbPut({ key, name, type, url, blob, sizeMB, savedAt: Date.now() });
    } catch (dbErr) {
      // iOS Safari storage quota or private-browsing restriction
      const isQuota = dbErr && (dbErr.name === 'QuotaExceededError' || dbErr.name === 'NS_ERROR_DOM_QUOTA_REACHED' || String(dbErr).includes('quota'));
      if (isQuota) throw new Error('Storage full. Free up space on your device and try again.');
      throw new Error('Could not save to device storage. On iOS, ensure you\'re not in Private Browsing.');
    }
    btn.classList.remove('saving');
    btn.classList.add('saved');
    btn.innerHTML = `${saveIcon()} Saved ✓`;
    updateLibraryCount();
    showToast(`"${name}" saved (${sizeMB} MB)`);
  } catch (err) {
    btn.classList.remove('saving');
    btn.disabled = false;
    btn.innerHTML = `${saveIcon()} Offline`;
    const msg = err.message || 'Could not save — check your connection and try again.';
    showToast(msg.length > 80 ? 'Could not save. Check connection and try again.' : msg);
    console.warn('saveOffline error:', err);
  }
}

async function refreshSavedStates() {
  const all = await dbAll();
  const savedKeys = new Set(all.map(r => r.key));
  document.querySelectorAll('.btn-save-offline').forEach(btn => {
    const key = fileKey(btn.dataset.url || '');
    if (savedKeys.has(key)) {
      btn.classList.add('saved');
      btn.innerHTML = `${saveIcon()} Saved ✓`;
      btn.disabled = true;
    } else {
      // Ensure label is correct if not saved
      if (!btn.classList.contains('saving')) {
        btn.innerHTML = `${saveIcon()} Offline`;
      }
    }
  });
  updateLibraryCount();
}

function updateLibraryCount() {
  // Library panel removed — no-op kept for compatibility with save/delete callers
}

function handleSaveOffline(btn) {
  saveOffline(btn, btn.dataset.url, btn.dataset.name, btn.dataset.type);
}

// Expose to global
window.downloadFile = downloadFile;
window.saveOffline = saveOffline;
window.handleSaveOffline = handleSaveOffline;
window.refreshSavedStates = refreshSavedStates;
window.openSavedFile = openSavedFile;

let _savedFileObjectUrl = null;

async function openSavedFile(key) {
  const record = await dbGet(key);
  if (!record) { showToast('File not found in library.'); return; }

  if (_savedFileObjectUrl) {
    const prev = _savedFileObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 5000);
    _savedFileObjectUrl = null;
  }

  const objectUrl = URL.createObjectURL(record.blob);
  _savedFileObjectUrl = objectUrl;

  if (record.type === 'pdf') {
    openPdfViewer(objectUrl, record.name, true);
  } else if (record.type === 'mp3') {
    playAudioFromBlob(objectUrl, record.name);
    _savedFileObjectUrl = null;
  }
}