// ============================================================
//  MAIN.JS - Main application logic
// ============================================================

// Boot after load
window.addEventListener('load', () => {
  console.log('Window loaded, SPOTLIGHT_DATA:', typeof SPOTLIGHT_DATA);
  if (typeof SPOTLIGHT_DATA !== 'undefined') {
    console.log('Initializing page');
    initializePage();
  } else {
    document.getElementById('nav-title').textContent = 'Error: Data not loaded. Please refresh.';
  }
});

function initializePage() {
  const bookNum = parseInt(getParam('book') || '1', 10);
  const bookIdx = bookNum - 1;
  const book    = SPOTLIGHT_DATA[bookIdx] || SPOTLIGHT_DATA[0];
  const accent  = ACCENTS[bookIdx] || ACCENTS[0];
  const level   = LEVELS[bookIdx] || '';

  document.documentElement.style.setProperty('--accent', accent);
  document.getElementById('nav-title').textContent = book.name;
  document.getElementById('nav-accent-bar').style.background = accent;
  document.title = `${book.name} — Spotlight Trilogy`;
  document.getElementById('footer-book').textContent = book.name;

  let unitCount = 0, lessonCount = 0, audioCount = 0;
  const units = [], welcomeBlocks = [], specialFolders = [], orphanLessons = [];

  for (const child of book.children) {
    if (child.type === 'folder') {
      if (/^unit/i.test(child.name)) {
        units.push(child);
        unitCount++;
        for (const c of (child.children || [])) {
          if (c.type === 'folder') {
            lessonCount++;
            for (const f of (c.children || [])) { if (fileIsAudio(f.name)) audioCount++; }
          }
        }
      } else if (/welcome/i.test(child.name)) {
        welcomeBlocks.push(child);
      } else if (/^lesson/i.test(child.name)) {
        orphanLessons.push(child);
      } else {
        specialFolders.push(child);
      }
    }
  }

  const bookSB = book.children.find(c => fileIsSB(c.name));
  const bookTG = book.children.find(c => fileIsTG(c.name));
  const loosePdfs  = book.children.filter(c => c.type === 'pdf' && !fileIsSB(c.name) && !fileIsTG(c.name));
  const looseAudio = book.children.filter(c => c.type === 'mp3');
  let rootBtns = '';
  if (bookSB) { const p = buildPath(book.name, bookSB.name); rootBtns += btnSB(p, 'Full Student Book'); }
  if (bookTG) { const p = buildPath(book.name, bookTG.name); rootBtns += btnTG(p, 'Full Teacher Guide'); }

  const header = document.getElementById('book-header');
  header.innerHTML = `
    <p class="book-header-eyebrow">Book ${bookNum} &mdash; ${level}</p>
    <h1>${escHtml(book.name)}</h1>
    <div class="book-header-meta">
      <div class="meta-stat"><strong>${unitCount}</strong><span>units</span></div>
      <div class="meta-stat"><strong>${lessonCount}</strong><span>lessons</span></div>
      <div class="meta-stat"><strong>${audioCount}</strong><span>audio files</span></div>
    </div>
    ${rootBtns ? `<div class="book-downloads">
      <p class="book-downloads-title">Full book downloads</p>
      <div class="download-row">${rootBtns}</div>
    </div>` : ''}`;

  const section = document.getElementById('units-section');

  if (welcomeBlocks.length) {
    const wb = welcomeBlocks[0];
    const wFiles   = (wb.children || []).filter(c => c.type !== 'folder');
    const wLessons = (wb.children || []).filter(c => c.type === 'folder');
    let wContent = wFiles.map(f => {
      const path = buildPath(book.name, wb.name, f.name);
      if (fileIsAudio(f.name)) {
        const queue = wFiles.filter(x => fileIsAudio(x.name)).map(x => ({
          url: buildPath(book.name, wb.name, x.name), name: x.name
        }));
        return `<button class="btn btn-audio" onclick="playAudio(event)" data-url="${escAttr(path)}" data-name="${escAttr(f.name)}" data-queue='${JSON.stringify(queue)}'>${playIcon()} ${escHtml(f.name)}</button>`;
      }
      const cls  = fileIsSB(f.name) ? 'btn-sb' : fileIsTG(f.name) ? 'btn-tg' : 'btn-bundle';
      return `<button class="btn ${cls}" onclick="downloadFile(event)" data-url="${escAttr(path)}" data-filename="${escAttr(f.name)}">${dlIcon()} ${escHtml(f.name)}</button>`
           + btnSaveOffline(path, f.name, 'pdf');
    }).join('');
    if (wLessons.length) wContent += wLessons.map((l, li) => renderLesson(l, book.name, wb.name, li + 1)).join('');
    section.innerHTML = `<div class="welcome-block">
      <p class="welcome-title">Welcome / Introduction</p>
      <div class="download-row">${wContent}</div>
    </div>`;
  }

  units.forEach((unit, i) => { section.innerHTML += renderUnit(unit, book.name, i + 1); });

  if (orphanLessons.length) {
    const wrap = document.createElement('div');
    wrap.className = 'unit-block';
    wrap.style.marginTop = '0.5rem';
    wrap.innerHTML = `
      <div class="unit-header" onclick="toggleUnit(this)">
        <div class="unit-header-left">
          <span class="unit-num-badge">Extra</span>
          <span class="unit-name">Additional Lessons</span>
          <span class="unit-lesson-count">${orphanLessons.length} lesson${orphanLessons.length !== 1 ? 's' : ''}</span>
        </div>
        <span class="unit-chevron">
          <svg width="12" height="12" fill="none" viewBox="0 0 12 12">
            <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div class="unit-body">
        ${orphanLessons.map((l, li) => renderLesson(l, book.name, '', li + 1)).join('')}
      </div>`;
    section.appendChild(wrap);
  }

  specialFolders.forEach(folder => {
    const fFiles   = (folder.children || []).filter(c => c.type !== 'folder');
    const fLessons = (folder.children || []).filter(c => c.type === 'folder');
    const audioQueue = fFiles.filter(f => fileIsAudio(f.name)).map(f => ({
      url: buildPath(book.name, folder.name, f.name), name: f.name
    }));
    let fContent = fFiles.map(f => {
      const path = buildPath(book.name, folder.name, f.name);
      if (fileIsAudio(f.name)) {
        return `<button class="btn btn-audio" onclick="playAudio(event)" data-url="${escAttr(path)}" data-name="${escAttr(f.name)}" data-queue='${JSON.stringify(audioQueue)}'>${playIcon()} ${escHtml(f.name)}</button>`;
      }
      const cls = fileIsSB(f.name) ? 'btn-sb' : fileIsTG(f.name) ? 'btn-tg' : 'btn-bundle';
      return `<button class="btn ${cls}" onclick="downloadFile(event)" data-url="${escAttr(path)}" data-filename="${escAttr(f.name)}">${dlIcon()} ${escHtml(f.name)}</button>`
           + btnSaveOffline(path, f.name, 'pdf');
    }).join('');
    const lessonHtml = fLessons.map((l, li) => renderLesson(l, book.name, folder.name, li + 1)).join('');
    const wrap = document.createElement('div');
    wrap.className = 'unit-block';
    wrap.style.marginTop = '0.5rem';
    wrap.innerHTML = `
      <div class="unit-header" onclick="toggleUnit(this)">
        <div class="unit-header-left">
          <span class="unit-num-badge" style="background:rgba(74,124,89,0.08);border-color:rgba(74,124,89,0.2);color:#4A7C59;">Extra</span>
          <span class="unit-name">${escHtml(folder.name)}</span>
          ${fLessons.length ? `<span class="unit-lesson-count">${fLessons.length} lesson${fLessons.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <span class="unit-chevron">
          <svg width="12" height="12" fill="none" viewBox="0 0 12 12">
            <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div class="unit-body">
        ${fContent ? `<div class="unit-audio-row" style="flex-wrap:wrap;gap:0.4rem;">${fContent}</div>` : ''}
        ${lessonHtml}
      </div>`;
    section.appendChild(wrap);
  });

  if (loosePdfs.length || looseAudio.length) {
    const looseAudioQueue = looseAudio.map(f => ({
      url: buildPath(book.name, f.name), name: f.name
    }));
    let looseHtml = loosePdfs.map(f => {
      const path = buildPath(book.name, f.name);
      return `<button class="btn btn-bundle" onclick="downloadFile(event)" data-url="${escAttr(path)}" data-filename="${escAttr(f.name)}">${dlIcon()} ${escHtml(f.name)}</button>`
           + btnSaveOffline(path, f.name, 'pdf');
    }).join('') + looseAudio.map(f => {
      const path = buildPath(book.name, f.name);
      return `<button class="btn btn-audio" onclick="playAudio(event)" data-url="${escAttr(path)}" data-name="${escAttr(f.name)}" data-queue='${JSON.stringify(looseAudioQueue)}'>${playIcon()} ${escHtml(f.name)}</button>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'welcome-block';
    wrap.style.marginTop = '0.75rem';
    wrap.innerHTML = `<p class="welcome-title">Additional Files</p><div class="download-row">${looseHtml}</div>`;
    section.appendChild(wrap);
  }

  const firstUnit = section.querySelector('.unit-block');
  if (firstUnit) firstUnit.classList.add('open');

  setTimeout(refreshSavedStates, 80);
}

function toggleUnit(header) {
  header.closest('.unit-block').classList.toggle('open');
}

// Search
document.getElementById('search').addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  document.querySelectorAll('.unit-block').forEach(block => {
    const unitMatch = block.dataset.unit && block.dataset.unit.includes(q);
    const rows = block.querySelectorAll('.lesson-row');
    let anyLesson = false;
    rows.forEach(row => {
      const match = !q || unitMatch || (row.dataset.lesson && row.dataset.lesson.includes(q));
      row.style.display = match ? '' : 'none';
      if (match) anyLesson = true;
    });
    const show = !q || unitMatch || anyLesson;
    block.style.display = show ? '' : 'none';
    if (q && show) block.classList.add('open');
  });
});

// Toast
function showToast(message) {
  const el = document.getElementById('toast-msg');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2400);
}

// PWA Install
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById('btn-install');
  if (btn) btn.classList.add('visible');
});

window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const btn = document.getElementById('btn-install');
  if (btn) btn.classList.remove('visible');
  showToast('App installed ✓');
});

function triggerInstall() {
  if (!_installPrompt) {
    showToast('Open this page in your browser to install.');
    return;
  }
  _installPrompt.prompt();
  _installPrompt.userChoice.then(({ outcome }) => {
    if (outcome === 'accepted') _installPrompt = null;
  });
}

// Offline banner
function updateOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  banner.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online',  updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
updateOfflineBanner();

// Expose to global
window.toggleUnit = toggleUnit;
window.showToast = showToast;
window.triggerInstall = triggerInstall;