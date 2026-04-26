// ============================================================
//  RENDER.JS - DOM rendering functions
// ============================================================

// Lesson Render
function renderLesson(lesson, bookName, unitName, lessonIndex, unitIndex) {
  const files = lesson.children || [];
  const sbFile     = files.find(f => fileIsSB(f.name));
  const tgFile     = files.find(f => fileIsTG(f.name));
  const audioFiles = files.filter(f => fileIsAudio(f.name));

  const sbPath = sbFile ? buildPath(bookName, unitName, lesson.name, sbFile.name) : null;
  const tgPath = tgFile ? buildPath(bookName, unitName, lesson.name, tgFile.name) : null;

  // Collect all lesson files for "Save Lesson" button
  const lessonFilesForSave = [];
  if (sbPath) {
    const fname = `U${unitIndex||'?'}-L${lessonIndex}-SB.pdf`;
    lessonFilesForSave.push({ url: sbPath, name: fname, type: 'pdf' });
  }
  if (tgPath) {
    const fname = `U${unitIndex||'?'}-L${lessonIndex}-TG.pdf`;
    lessonFilesForSave.push({ url: tgPath, name: fname, type: 'pdf' });
  }

  let btns = '';
  if (sbPath || tgPath) {
    btns = `<div class="pdf-cards">` +
      (sbPath ? `<div class="pdf-card pdf-card-sb">
        <span class="pdf-card-label">Student Book</span>
        <div class="pdf-card-actions">${btnSB(sbPath, 'Download', unitIndex, lessonIndex)}</div>
      </div>` : '') +
      (tgPath ? `<div class="pdf-card pdf-card-tg">
        <span class="pdf-card-label">Teacher Guide</span>
        <div class="pdf-card-actions">${btnTG(tgPath, 'Download', unitIndex, lessonIndex)}</div>
      </div>` : '') +
      `</div>`;
  }

  let audioList = '';
  if (audioFiles.length) {
    const queue = audioFiles.map(f => ({
      url:  buildPath(bookName, unitName, lesson.name, f.name),
      name: f.name
    }));
    audioFiles.forEach((f, fi) => {
      lessonFilesForSave.push({ url: queue[fi].url, name: f.name, type: 'mp3' });
    });
    audioList = '<div class="audio-list">' +
      audioFiles.map((f, fi) => buildAudioRow(queue[fi].url, f.name, queue)).join('') +
      '</div>';
  }

  const saveLessonBtn = lessonFilesForSave.length > 1 ? `<div class="save-lesson-wrap">${btnSaveLesson(lessonFilesForSave)}</div>` : '';

  return `
    <div class="lesson-row" data-lesson="${escHtml(lesson.name.toLowerCase())}">
      <div class="lesson-num">Lesson ${lessonIndex}</div>
      <div class="lesson-info">
        <div class="lesson-name">${escHtml(lesson.name)}</div>
        ${btns ? btns : '<span class="no-files-label">No files</span>'}
        ${saveLessonBtn}
        ${audioList}
      </div>
    </div>`;
}

// Unit Render
function renderUnit(unit, bookName, unitIndex) {
  const children   = unit.children || [];
  const lessons     = children.filter(c => c.type === 'folder' && /lesson/i.test(c.name));
  const unitAudios  = children.filter(c => fileIsAudio(c.name));
  const unitFiles   = children.filter(c => fileIsSB(c.name) || fileIsTG(c.name));
  const unitScripts = children.filter(c => fileIsAudioScript(c.name));
  const otherPdfs   = children.filter(c => fileIsPdf(c.name) && !fileIsSB(c.name) && !fileIsTG(c.name) && !fileIsAudioScript(c.name));

  let audioRow = '';
  if (unitAudios.length) {
    const queue = unitAudios.map(f => ({ url: buildPath(bookName, unit.name, f.name), name: f.name }));
    audioRow = `<div class="unit-audio-row">
      <span class="unit-audio-label">Unit audio (${unitAudios.length})</span>
      <div class="btn-group btn-group-audio">
        <button class="btn btn-audio btn-group-main btn-audio-sm"
          onclick="playAudio(event)" data-url="${escAttr(queue[0].url)}" data-name="${escAttr(queue[0].name)}" data-queue='${JSON.stringify(queue)}'>${playIcon()} Play All</button>
      </div>
    </div>`;
  }

  let unitFilesRow = '';
  if (unitFiles.length) {
    unitFilesRow = `<div class="unit-audio-row">
      ${unitFiles.map(f => {
        const path = buildPath(bookName, unit.name, f.name);
        const isSB = fileIsSB(f.name);
        return btnPdfGroup(path, f.name, isSB ? 'btn-sb' : 'btn-tg', isSB ? 'Student Book' : 'Teacher Guide', '');
      }).join('')}
    </div>`;
  }

  let unitScriptsRow = '';
  if (unitScripts.length) {
    unitScriptsRow = `<div class="unit-audio-row unit-script-row">
      <span class="unit-audio-label">Audio Script</span>
      ${unitScripts.map(f => {
        const path = buildPath(bookName, unit.name, f.name);
        return btnAudioScript(path, f.name.replace(/\.pdf$/i, ''));
      }).join('')}
    </div>`;
  }

  let otherPdfsRow = '';
  if (otherPdfs.length) {
    otherPdfsRow = `<div class="unit-audio-row">
      ${otherPdfs.map(f => {
        const path = buildPath(bookName, unit.name, f.name);
        return btnPdfGroup(path, f.name, 'btn-bundle', f.name.replace(/\.pdf$/i,''), '');
      }).join('')}
    </div>`;
  }

  const lessonRows = lessons.map((l, li) => renderLesson(l, bookName, unit.name, li + 1, unitIndex)).join('');

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
      <div class="unit-body">${audioRow}${unitFilesRow}${unitScriptsRow}${otherPdfsRow}${lessonRows}</div>
    </div>`;
}
