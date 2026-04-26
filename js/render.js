// ============================================================
//  RENDER.JS - DOM rendering functions
// ============================================================

// Lesson Render
function renderLesson(lesson, bookName, unitName, lessonIndex) {
  const files = lesson.children || [];
  const sbFile    = files.find(f => fileIsSB(f.name));
  const tgFile    = files.find(f => fileIsTG(f.name));
  const audioFiles = files.filter(f => fileIsAudio(f.name));

  const sbPath = sbFile ? buildPath(bookName, unitName, lesson.name, sbFile.name) : null;
  const tgPath = tgFile ? buildPath(bookName, unitName, lesson.name, tgFile.name) : null;

  let btns = '';
  if (sbPath) btns += btnSB(sbPath, 'SB');
  if (tgPath) btns += btnTG(tgPath, 'TG');

  let audioList = '';
  if (audioFiles.length) {
    const queue = audioFiles.map(f => ({
      url:  buildPath(bookName, unitName, lesson.name, f.name),
      name: f.name
    }));
    audioList = `<div class="audio-list">` +
      audioFiles.map((f, fi) => buildAudioRow(queue[fi].url, f.name, queue)).join('') +
    `</div>`;
  }

  return `
    <div class="lesson-row" data-lesson="${escHtml(lesson.name.toLowerCase())}">
      <div class="lesson-num">Lesson ${lessonIndex}</div>
      <div class="lesson-info">
        <div class="lesson-name">${escHtml(lesson.name)}</div>
        <div class="lesson-actions">${btns || '<span style="font-size:0.73rem;color:var(--slate-light)">No files</span>'}</div>
        ${audioList}
      </div>
    </div>`;
}

// Unit Render
function renderUnit(unit, bookName, unitIndex) {
  const children  = unit.children || [];
  const lessons   = children.filter(c => c.type === 'folder' && /lesson/i.test(c.name));
  const unitAudios = children.filter(c => fileIsAudio(c.name));
  const unitFiles = children.filter(c => fileIsSB(c.name) || fileIsTG(c.name));
  const unitScripts = children.filter(c => fileIsPdf(c.name) && !fileIsSB(c.name) && !fileIsTG(c.name));

  let audioRow = '';
  if (unitAudios.length) {
    const queue = unitAudios.map(f => ({ url: buildPath(bookName, unit.name, f.name), name: f.name }));
    audioRow = `<div class="unit-audio-row">
      <span class="unit-audio-label">Unit audio (${unitAudios.length})</span>
      ${unitAudios.map((f, fi) => {
        const url = queue[fi].url;
        return `<button class="btn btn-audio" style="font-size:0.7rem;padding:3px 8px;"
          onclick="playAudio(event)" data-url="${escAttr(url)}" data-name="${escAttr(f.name)}" data-queue='${JSON.stringify(queue)}'>${playIcon()} Play</button>`;
      }).join('')}
    </div>`;
  }

  let unitFilesRow = '';
  if (unitFiles.length) {
    unitFilesRow = `<div class="unit-audio-row">
      ${unitFiles.map(f => {
        const path = buildPath(bookName, unit.name, f.name);
        const cls  = fileIsSB(f.name) ? 'btn-sb' : 'btn-tg';
        return `<button class="btn ${cls}" style="font-size:0.72rem;" onclick="downloadFile(event)" data-url="${escAttr(path)}" data-filename="${escAttr(f.name)}">${dlIcon()} ${escHtml(f.name)}</button>`
             + btnSaveOffline(path, f.name, 'pdf');
      }).join('')}
    </div>`;
  }

  let unitScriptsRow = '';
  if (unitScripts.length) {
    unitScriptsRow = `<div class="unit-audio-row">
      ${unitScripts.map(f => {
        const path = buildPath(bookName, unit.name, f.name);
        return `<button class="btn btn-bundle" style="font-size:0.72rem;" onclick="downloadFile(event,${JSON.stringify(path)},${JSON.stringify(f.name)})">${dlIcon()} ${escHtml(f.name)}</button>`
             + btnSaveOffline(path, f.name, 'pdf');
      }).join('')}
    </div>`;
  }

  const lessonRows = lessons.map((l, li) => renderLesson(l, bookName, unit.name, li + 1)).join('');

  return `
    <div class="unit-block" data-unit="${escHtml(unit.name.toLowerCase())}">
      <div class="unit-header" onclick="toggleUnit(this)">
        <div class="unit-header-left">
          <span class="unit-num-badge">Unit ${unitIndex}</span>
          <span class="unit-name">${escHtml(unit.name)}</span>
          <span class="unit-lesson-count">${lessons.length} lesson${lessons.length !== 1 ? 's' : ''}</span>
        </div>
        <span class="unit-chevron">
          <svg width="12" height="12" fill="none" viewBox="0 0 12 12">
            <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div class="unit-body">${audioRow}${unitFilesRow}${unitScriptsRow}${lessonRows}</div>
    </div>`;
}