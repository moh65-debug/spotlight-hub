// ============================================================
//  UTILS.JS - Shared utilities and helpers
// ============================================================

// Constants
const ACCENTS = ['#C8603A', '#3A6B8A', '#4A7C59'];
const LEVELS  = ['7th Grade', '8th Grade', '9th Grade'];
const ARCHIVE_BASE = 'https://archive.org/download/spotlight-trilogy';

// Helper functions
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fileIsSB(n)    { return /sb/i.test(n) && n.endsWith('.pdf'); }
function fileIsTG(n)    { return /tg/i.test(n) && n.endsWith('.pdf'); }
function fileIsAudio(n) { return n.toLowerCase().endsWith('.mp3'); }
function fileIsScript(n){ return /script/i.test(n) && n.endsWith('.pdf'); }
function fileIsPdf(n)   { return n.endsWith('.pdf'); }

function buildPath(bookName, ...parts) {
  const segments = [bookName, ...parts].filter(p => p !== '').map(p => encodeURIComponent(p));
  return ARCHIVE_BASE + '/' + segments.join('/');
}

// SVG Icons
function dlIcon()    { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><path d="M6 2v6M3.5 5.5 6 8l2.5-2.5M2 10h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function playIcon()  { return `<svg width="10" height="11" fill="currentColor" viewBox="0 0 10 11"><path d="M1.5 1.5l7 4-7 4V1.5Z"/></svg>`; }
function saveIcon()  { return `<svg width="11" height="11" fill="none" viewBox="0 0 12 12"><path d="M9.5 10h-7a1 1 0 0 1-1-1V3l2-2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><rect x="3.5" y="6.5" width="5" height="3.5" rx="0.5" stroke="currentColor" stroke-width="1.2"/></svg>`; }

// Button Builders
function btnSB(href, label) {
  label = label || 'Student Book';
  return `<button class="btn btn-sb" onclick="downloadFile(event)" data-url="${escAttr(href)}" data-filename="${escAttr(label+'.pdf')}">${dlIcon()} ${escHtml(label)}</button>`
        + btnSaveOffline(href, label, 'pdf');
}

function btnTG(href, label) {
  label = label || 'Teacher Guide';
  return `<button class="btn btn-tg" onclick="downloadFile(event)" data-url="${escAttr(href)}" data-filename="${escAttr(label+'.pdf')}">${dlIcon()} ${escHtml(label)}</button>`
        + btnSaveOffline(href, label, 'pdf');
}

function btnSaveOffline(url, name, type) {
  return `<button class="btn btn-save btn-save-offline"
    data-url="${escAttr(url)}" data-name="${escAttr(name)}" data-type="${escAttr(type)}"
    onclick="handleSaveOffline(this)" title="Save for offline access">${saveIcon()} Offline</button>`;
}

function buildAudioRow(url, name, queue) {
  // Shorten display name: strip extension and truncate
  const displayName = name.replace(/\.mp3$/i, '');
  return `<div class="audio-row">
    <span class="audio-dot"></span>
    <span class="audio-name" title="${escAttr(name)}">${escHtml(displayName)}</span>
    <div class="audio-row-actions">
      <button class="btn btn-audio btn-audio-sm"
        onclick="playAudio(event)" data-url="${escAttr(url)}" data-name="${escAttr(name)}" data-queue='${JSON.stringify(queue)}'>${playIcon()} Play</button>
      <a class="btn btn-save btn-icon-only" href="${escAttr(url)}" download title="Download audio">${dlIcon()}</a>
      ${btnSaveOffline(url, name, 'mp3')}
    </div>
  </div>`;
}