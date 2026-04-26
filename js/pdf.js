// ============================================================
//  PDF.JS - PDF viewer functionality
// ============================================================

// pdf.js 3.11.174 — confirmed available on cdnjs
const PDFJS_URL    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfJsLoaded = false;
let _pdfObjectUrl = null;

function ensurePdfJs() {
  return new Promise((resolve, reject) => {
    if (pdfJsLoaded) return resolve();
    const s = document.createElement('script');
    s.src = PDFJS_URL;
    s.onload = () => {
      // Use a blob worker so we don't depend on cdnjs serving the worker
      // with the right CORS headers — it just runs inline.
      const workerCode = `importScripts('${PDFJS_WORKER}');`;
      const blob       = new Blob([workerCode], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      pdfJsLoaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
    document.head.appendChild(s);
  });
}

async function openPdfViewer(url, name, isExternalBlob) {
  if (_pdfObjectUrl && _pdfObjectUrl !== url) {
    const prev = _pdfObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 5000);
    _pdfObjectUrl = null;
  }
  if (url.startsWith('blob:') && !isExternalBlob) {
    _pdfObjectUrl = url;
  }
  const overlay = document.getElementById('viewer-overlay');
  const body    = document.getElementById('viewer-body');
  document.getElementById('viewer-filename').textContent = name;
  document.getElementById('viewer-pages').textContent   = '';
  body.innerHTML = '<div class="viewer-loading">Loading PDF…</div>';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  try {
    await ensurePdfJs();
  } catch (loadErr) {
    body.innerHTML = `<div class="viewer-loading">Could not load PDF viewer.<br><small>Check your internet connection and try again.</small></div>`;
    return;
  }
  try {
    const pdf    = await pdfjsLib.getDocument(url).promise;
    const total  = pdf.numPages;
    document.getElementById('viewer-pages').textContent = `${total} page${total !== 1 ? 's' : ''}`;
    body.innerHTML = '';
    const dpr   = window.devicePixelRatio || 1;
    const scale = Math.min(2, dpr * (window.innerWidth < 600 ? 1.0 : 1.4));
    for (let p = 1; p <= total; p++) {
      const page   = await pdf.getPage(p);
      const vp     = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width  = vp.width;
      canvas.height = vp.height;
      canvas.style.width  = Math.floor(vp.width  / dpr) + 'px';
      canvas.style.height = Math.floor(vp.height / dpr) + 'px';
      body.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } catch (err) {
    body.innerHTML = `<div class="viewer-loading">Could not render PDF.<br><small>${escHtml(err.message)}</small></div>`;
  }
}

function closePdfViewer() {
  document.getElementById('viewer-overlay').classList.remove('active');
  document.body.style.overflow = '';
  document.getElementById('viewer-body').innerHTML = '';
  if (_pdfObjectUrl) {
    const prev = _pdfObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 1000);
    _pdfObjectUrl = null;
  }
  if (_savedFileObjectUrl) {
    const prev = _savedFileObjectUrl;
    setTimeout(() => URL.revokeObjectURL(prev), 1000);
    _savedFileObjectUrl = null;
  }
}

// Expose to global
window.openPdfViewer = openPdfViewer;
window.closePdfViewer = closePdfViewer;
