// ============================================================
//  UTILS.JS - Shared utilities and helpers (enhanced)
// ============================================================

const ACCENTS = ['#C8603A', '#3A6B8A', '#4A7C59'];
const LEVELS  = ['7th Grade', '8th Grade', '9th Grade'];
const ARCHIVE_BASE = 'https://archive.org/download/spotlight-trilogy';

// Current book number (1-3). Set by main.js after parsing the URL param.
// Used by filename helpers to produce SP1-U2-L3-SB.pdf style names.
let CURRENT_BOOK_NUM = 1;

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fileIsSB(n)          { return /sb/i.test(n) && n.endsWith('.pdf'); }
function fileIsTG(n)          { return /tg/i.test(n) && n.endsWith('.pdf'); }
function fileIsAudio(n)       { return n.toLowerCase().endsWith('.mp3'); }
function fileIsAudioScript(n) { return /audio.?script/i.test(n) && n.endsWith('.pdf'); }
function fileIsPdf(n)         { return n.endsWith('.pdf'); }

function buildPath(bookName, ...parts) {
  const segments = [bookName, ...parts].filter(p => p !== '').map(p => encodeURIComponent(p));
  return ARCHIVE_BASE + '/' + segments.join('/');
}

// ── Filename helpers (include Spotlight version) ──────────────────────────────
// Produces names like SP1-U5-L2-SB.pdf, SP2-U3-L7-TG.pdf, SP1-U2-LP.docx

function spPrefix() {
  return `SP${CURRENT_BOOK_NUM}`;
}

function makePdfFilename(unitNum, lessonNum, type) {
  // type = 'SB' | 'TG' | 'LP' | 'SCRIPT' | string
  const u = unitNum  ? `U${unitNum}`  : '';
  const l = lessonNum ? `L${lessonNum}` : '';
  const parts = [spPrefix(), u, l, type].filter(Boolean);
  return parts.join('-') + '.pdf';
}

function makeLpFilename(unitNum, lessonNum) {
  const u = unitNum  ? `U${unitNum}`  : '';
  const l = lessonNum ? `L${lessonNum}` : '';
  const parts = [spPrefix(), u, l, 'LP'].filter(Boolean);
  return parts.join('-') + '.docx';
}

function makeAudioFilename(rawName, unitNum, lessonNum) {
  // Keeps original audio name but prefixes with SP1-U2-L3-
  const u = unitNum  ? `U${unitNum}`  : '';
  const l = lessonNum ? `L${lessonNum}` : '';
  const prefix = [spPrefix(), u, l].filter(Boolean).join('-');
  return prefix ? `${prefix}-${rawName}` : rawName;
}

function smartFilename(url, type) {
  // Fallback: parse unit/lesson numbers from URL segments
  try {
    const parts = decodeURIComponent(new URL(url).pathname).split('/');
    let unitNum = '', lessonNum = '';
    for (const p of parts) {
      const um = p.match(/^Unit\s+(\d+)/i);
      const lm = p.match(/^Lesson\s+(\d+)/i);
      if (um) unitNum = um[1];
      if (lm) lessonNum = lm[1];
    }
    if (unitNum || lessonNum) {
      return makePdfFilename(unitNum, lessonNum, type);
    }
  } catch (_) {}
  return `${spPrefix()}-${type}.pdf`;
}

// Icons
function dlIcon()      { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><path d="M6 2v6M3.5 5.5 6 8l2.5-2.5M2 10h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function playIcon()    { return `<svg width="10" height="11" fill="currentColor" viewBox="0 0 10 11"><path d="M1.5 1.5l7 4-7 4V1.5Z"/></svg>`; }
function saveIcon()    { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><path d="M9.5 10h-7a1 1 0 0 1-1-1V3l2-2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><rect x="3.5" y="6.5" width="5" height="3.5" rx="0.5" stroke="currentColor" stroke-width="1.2"/></svg>`; }
function saveAllIcon() { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><path d="M2 9h8M4 5l2 3 2-3M6 2v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 11h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`; }
function previewIcon() { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><ellipse cx="6" cy="6" rx="4.5" ry="4.5" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/></svg>`; }

// A grouped pill: [Primary label] [Preview ◉] [Offline 💾]
function btnPdfGroup(href, fname, primaryClass, primaryLabel, previewExtraClass) {
  previewExtraClass = previewExtraClass || '';
  return `<div class="btn-group">
    <button class="btn ${primaryClass} btn-group-main" onclick="downloadFile(event)" data-url="${escAttr(href)}" data-filename="${escAttr(fname)}">${dlIcon()} ${escHtml(primaryLabel)}</button><button class="btn btn-group-action btn-preview ${previewExtraClass}" onclick="previewPdf(event)" data-url="${escAttr(href)}" data-filename="${escAttr(fname)}" title="Preview">${previewIcon()}</button><button class="btn btn-group-action btn-save btn-save-offline" data-url="${escAttr(href)}" data-name="${escAttr(fname.replace(/\.pdf$/i,''))}" data-type="pdf" onclick="handleSaveOffline(this)" title="Save offline">${saveIcon()}</button>
  </div>`;
}

function btnSB(href, label, unitNum, lessonNum) {
  label = label || 'Student Book';
  const fname = (unitNum && lessonNum)
    ? makePdfFilename(unitNum, lessonNum, 'SB')
    : smartFilename(href, 'SB');
  return btnPdfGroup(href, fname, 'btn-sb', label, '');
}

function btnTG(href, label, unitNum, lessonNum) {
  label = label || 'Teacher Guide';
  const fname = (unitNum && lessonNum)
    ? makePdfFilename(unitNum, lessonNum, 'TG')
    : smartFilename(href, 'TG');
  return btnPdfGroup(href, fname, 'btn-tg', label, '');
}

// Audio Script — includes Download + Preview + Save Offline
function btnAudioScript(href, label, unitNum) {
  label = label || 'Audio Script';
  const fname = unitNum
    ? makePdfFilename(unitNum, null, 'SCRIPT')
    : `${spPrefix()}-${label.replace(/\s+/g, '-')}.pdf`;
  return `<div class="btn-group">
    <button class="btn btn-audio-script btn-group-main" onclick="downloadFile(event)" data-url="${escAttr(href)}" data-filename="${escAttr(fname)}">${dlIcon()} ${escHtml(label)}</button><button class="btn btn-group-action btn-preview btn-preview-script" onclick="previewPdf(event)" data-url="${escAttr(href)}" data-filename="${escAttr(fname)}" title="Preview PDF">${previewIcon()}</button><button class="btn btn-group-action btn-save btn-save-offline" data-url="${escAttr(href)}" data-name="${escAttr(fname.replace(/\.pdf$/i,''))}" data-type="pdf" onclick="handleSaveOffline(this)" title="Save offline">${saveIcon()}</button>
  </div>`;
}

function btnSaveOffline(url, name, type) {
  return `<button class="btn btn-save btn-save-offline"
    data-url="${escAttr(url)}" data-name="${escAttr(name)}" data-type="${escAttr(type)}"
    onclick="handleSaveOffline(this)" title="Save for offline access">${saveIcon()} Offline</button>`;
}

function btnSaveLesson(lessonFiles) {
  const data = escAttr(JSON.stringify(lessonFiles));
  return `<button class="btn btn-save-lesson" data-files="${data}" onclick="handleSaveLesson(this)" title="Save all lesson files offline">${saveAllIcon()} Save Lesson</button>`;
}

function buildAudioRow(url, name, queue, unitNum, lessonNum) {
  const displayName = name.replace(/\.mp3$/i, '');
  // Produce SP1-U2-L3-trackname.mp3 for downloads
  const dlName = (unitNum && lessonNum)
    ? makeAudioFilename(name, unitNum, lessonNum)
    : makeAudioFilename(name, null, null);
  return `<div class="audio-row">
    <div class="audio-row-info">
      <span class="audio-dot"></span>
      <span class="audio-name" title="${escAttr(name)}">${escHtml(displayName)}</span>
    </div>
    <div class="audio-row-actions">
      <div class="btn-group btn-group-audio">
        <button class="btn btn-audio btn-group-main btn-audio-sm"
          onclick="playAudio(event)" data-url="${escAttr(url)}" data-name="${escAttr(name)}" data-queue='${JSON.stringify(queue)}'>${playIcon()} Play</button><button class="btn btn-group-action" onclick="downloadAudio(event)" data-url="${escAttr(url)}" data-name="${escAttr(dlName)}" title="Download">${dlIcon()}</button><button class="btn btn-group-action btn-save btn-save-offline" data-url="${escAttr(url)}" data-name="${escAttr(dlName)}" data-type="mp3" onclick="handleSaveOffline(this)" title="Save offline">${saveIcon()}</button>
      </div>
    </div>
  </div>`;
}
