// ============================================================
//  PDF.JS - PDF viewer functionality
// ============================================================

let pdfJsLoaded = false;
let _pdfObjectUrl = null;

function ensurePdfJs() {
  return new Promise(resolve => {
    if (pdfJsLoaded) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.min.js';
    s.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.269/pdf.worker.min.js';
      pdfJsLoaded = true;
      resolve();
    };
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

  await ensurePdfJs();
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