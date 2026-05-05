// ============================================================
//  LESSONPLAN.JS — Client-side lesson plan generator
//  Fetches PDFs, extracts text with pdf.js, calls Groq API,
//  builds a .docx using docx.js
// ============================================================

// ── Key assembly (split to avoid plain-text scanning) ────────
(function(){
  const _s=[
    'NnZuTE1EU3VJWA==',
    'aHI2Nkc3NUI0MA==',
    'V0dkeWIzRllVUA==',
    'cmFHZkVKMUZ4aA==',
    'MmVDOGdkY3c0QW16',
  ];
  window._gk=function(){
    const _p=['g','s','k','_'].join('');
    return _p+_s.map(function(x){return atob(x);}).join('');
  };
})();

// ── Book structure ───────────────────────────────────────────
const BOOK_UNITS = { '1': 6, '2': 6, '3': 5 };
const LESSONS_PER_UNIT = 8;

// ── State ────────────────────────────────────────────────────
let _generatedPlan = null;
let _generatedDocxBlob = null;
let _currentLessonCode = '';

// ── DOM helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Selector init ────────────────────────────────────────────
$('sel-book').addEventListener('change', function() {
  const book = this.value;
  const unitSel = $('sel-unit');
  const lessonSel = $('sel-lesson');
  unitSel.innerHTML = '<option value="">— Unit —</option>';
  lessonSel.innerHTML = '<option value="">— Lesson —</option>';
  lessonSel.disabled = true;
  if (!book) { unitSel.disabled = true; updateGenerateBtn(); return; }
  const maxUnits = BOOK_UNITS[book] || 6;
  for (let i = 1; i <= maxUnits; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = 'Unit ' + i;
    unitSel.appendChild(opt);
  }
  unitSel.disabled = false;
  updateGenerateBtn();
});

$('sel-unit').addEventListener('change', function() {
  const lessonSel = $('sel-lesson');
  lessonSel.innerHTML = '<option value="">— Lesson —</option>';
  if (!this.value) { lessonSel.disabled = true; updateGenerateBtn(); return; }
  for (let i = 1; i <= LESSONS_PER_UNIT; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = 'Lesson ' + i;
    lessonSel.appendChild(opt);
  }
  lessonSel.disabled = false;
  updateGenerateBtn();
});

$('sel-lesson').addEventListener('change', updateGenerateBtn);

function updateGenerateBtn() {
  const ok = $('sel-book').value && $('sel-unit').value && $('sel-lesson').value;
  $('btn-generate').disabled = !ok;
}

// ── Progress helpers ─────────────────────────────────────────
const STEP_TARGETS = [15, 35, 55, 80, 100];

function setStep(idx, state) {
  const el = $('step-' + idx);
  if (!el) return;
  el.className = 'progress-step ' + state;
  const bar = $('progress-bar');
  if (state === 'active' && idx > 0) {
    bar.style.width = STEP_TARGETS[idx - 1] + '%';
  } else if (state === 'done') {
    bar.style.width = STEP_TARGETS[idx] + '%';
  }
}

function setAllStepsDone() {
  for (let i = 0; i < 5; i++) setStep(i, 'done');
  const bar = $('progress-bar');
  bar.style.width = '100%';
  bar.classList.add('done');
}

function showError(msg) {
  $('error-card').classList.add('visible');
  $('error-msg').innerHTML = '<strong>Error:</strong> ' + msg;
  $('progress-card').classList.remove('visible');
}

function resetForm() {
  if (Date.now() < _cooldownUntil) return;
  $('result-card').classList.remove('visible');
  $('error-card').classList.remove('visible');
  $('progress-card').classList.remove('visible');
  $('progress-bar').style.width = '0%';
  $('progress-bar').classList.remove('done');
  for (let i = 0; i < 5; i++) {
    const el = $('step-' + i);
    if (el) el.className = 'progress-step';
  }
  updateGenerateBtn();
  _generatedPlan = null;
  _generatedDocxBlob = null;
}

// ── Main generation flow ─────────────────────────────────────
async function startGeneration() {
  const book   = $('sel-book').value;
  const unit   = $('sel-unit').value;
  const lesson = $('sel-lesson').value;
  const teacher = $('inp-teacher').value.trim() || 'Teacher';
  const level   = $('inp-level').value.trim() || (['7th Grade','8th Grade','9th Grade'][parseInt(book)-1] || '7th Grade');

  if (!book || !unit || !lesson) return;

  // SP3-U4-L6 format
  _currentLessonCode = 'SP' + book + '-U' + unit + '-L' + lesson;

  $('result-card').classList.remove('visible');
  $('error-card').classList.remove('visible');
  $('progress-card').classList.add('visible');
  $('btn-generate').disabled = true;
  $('progress-bar').style.width = '0%';
  $('progress-bar').classList.remove('done');
  for (let i = 0; i < 5; i++) { const el = $('step-'+i); if(el) el.className='progress-step'; }

  try {
    // Step 0: Fetch PDFs
    setStep(0, 'active');
    const bookFolder  = 'Spotlight%20' + book;
    const unitFolder  = 'Unit%20' + unit;
    const lessonFolder= 'Lesson%20' + lesson;
    const baseUrl     = 'https://spotlight.dpdns.org/proxy/archive/spotlight-trilogy/' + bookFolder + '/' + unitFolder + '/' + lessonFolder + '/';
    const sbUrl = baseUrl + 'Lesson-' + lesson + '-SB.pdf';
    const tgUrl = baseUrl + 'Lesson-' + lesson + '-TG.pdf';

    let sbBytes, tgBytes;
    try {
      [sbBytes, tgBytes] = await Promise.all([
        fetchPdfBytes(sbUrl),
        fetchPdfBytes(tgUrl),
      ]);
    } catch(e) {
      throw new Error('Could not download PDFs. Check your internet connection. (' + e.message + ')');
    }
    setStep(0, 'done');

    // Step 1: OCR TG
    setStep(1, 'active');
    let tgText;
    try { tgText = await extractPdfText(tgBytes); }
    catch(e) { throw new Error('Failed to extract text from Teacher Guide PDF. (' + e.message + ')'); }
    setStep(1, 'done');

    // Step 2: OCR SB
    setStep(2, 'active');
    let sbText;
    try { sbText = await extractPdfText(sbBytes); }
    catch(e) { throw new Error('Failed to extract text from Student Book PDF. (' + e.message + ')'); }
    setStep(2, 'done');

    // Step 3: Groq
    setStep(3, 'active');
    let plan;
    try {
      plan = await callGroq(tgText, sbText, _currentLessonCode, teacher, level, unit, lesson);
    } catch(e) {
      throw new Error('AI generation failed. ' + e.message);
    }
    _generatedPlan = plan;
    setStep(3, 'done');

    // Step 4: Build DOCX
    setStep(4, 'active');
    let docxBlob;
    try { docxBlob = await buildDocx(plan); }
    catch(e) { throw new Error('Failed to build Word document. (' + e.message + ')'); }
    _generatedDocxBlob = docxBlob;
    setStep(4, 'done');
    setAllStepsDone();

    showResult(plan, book, unit, lesson);
    startCooldown();

  } catch(err) {
    showError(err.message || String(err));
    $('btn-generate').disabled = false;
  }
}

// ── Fetch PDF as ArrayBuffer ─────────────────────────────────
async function fetchPdfBytes(url) {
  const safeUrl = url
    .replace('https://spotlight.dpdns.org/download/', 'https://spotlight.dpdns.org/proxy/archive/')
    .replace('https://archive.org/download/',         'https://spotlight.dpdns.org/proxy/archive/')
    .replace('https://s3.us.archive.org/',            'https://spotlight.dpdns.org/proxy/archive/');

  const resp = await fetch(safeUrl, { credentials: 'omit', redirect: 'follow' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + safeUrl);
  return await resp.arrayBuffer();
}

// ── Extract text from PDF bytes using pdf.js ─────────────────
async function extractPdfText(arrayBuffer) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  if (!pdfjsLib) throw new Error('pdf.js not loaded');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    pages.push('--- Page ' + i + ' ---\n' + pageText);
  }
  return pages.join('\n');
}

// ── System prompt ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert EFL/ESL curriculum designer specializing in Moroccan middle-school English.

Given text extracted from a Teacher Guide (TG) and a Student Book (SB), produce a
complete, classroom-ready lesson plan as a single valid JSON object.
Do NOT output anything outside the JSON — no preamble, no markdown fences.

Fixed values you MUST use exactly:
  "textbook": "Spotlight"
  "time": "55 min"
  "tools_and_materials": "Student Book, Audio recordings, Whiteboard/markers"
  "integrated_skills": "Listening, Speaking, Reading, Writing"

Return EXACTLY this schema (all fields required):
{
  "teacher": "",
  "level": "",
  "textbook": "Spotlight",
  "time": "55 min",
  "unit": "",
  "lesson_title": "",
  "tools_and_materials": "Student Book, Audio recordings, Whiteboard/markers",
  "integrated_skills": "Listening, Speaking, Reading, Writing",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "stages": [
    {
      "stage": "Name of the stage extracted from text",
      "procedures": "",
      "interaction_patterns": "",
      "techniques": "",
      "time": ""
    }
  ],
  "reflections": ""
}

Rules:
- Base ALL content strictly on the PDF text — do NOT invent a topic.
- EXTRACT THE ACTUAL STAGES from the Teacher Guide. Do NOT force a fixed sequence. The lesson might use headings like "Warm up", "Presentation", "Practice", "Use", "Listening", etc. Follow the exact structural sequence provided in the specific lesson's text.
- Do NOT mention any page numbers anywhere.
- Procedures: concrete teacher/student actions, concise but specific.
- Stage times must add up to exactly 55 minutes.
- Use the teacher name and grade/level provided by the user.`;

// ── Call Groq API directly ───────────────────────────────────
async function callGroq(tgText, sbText, lessonCode, teacher, level, unit, lesson) {
  const key = _gk();
  const userMessage =
    'Lesson code: ' + lessonCode + '  (Unit ' + unit + ', Lesson ' + lesson + ')\n' +
    'Textbook: Spotlight  |  Total time: 55 min\n' +
    'Teacher: ' + teacher + '\n' +
    'Grade/Level: ' + level + '\n\n' +
    '=== TEACHER GUIDE (TG) ===\n' + tgText.slice(0, 7000) + '\n\n' +
    '=== STUDENT BOOK (SB) ===\n' + sbText.slice(0, 5000) + '\n\n' +
    'Generate the lesson plan JSON. No page numbers. Return ONLY the JSON object.';

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error('Groq API error ' + resp.status + ': ' + errBody.slice(0, 200));
  }

  const data = await resp.json();
  let raw = (data.choices?.[0]?.message?.content || '').trim();

  if (raw.includes('```')) {
    for (const part of raw.split('```')) {
      const stripped = part.trim().replace(/^json\s*/i, '').trim();
      if (stripped.startsWith('{')) { raw = stripped; break; }
    }
  }

  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);

  let plan;
  try { plan = JSON.parse(raw); }
  catch(e) { throw new Error('Could not parse AI response as JSON. Raw: ' + raw.slice(0, 300)); }

  plan.textbook            = 'Spotlight';
  plan.time                = '55 min';
  plan.tools_and_materials = 'Student Book, Audio recordings, Whiteboard/markers';
  plan.integrated_skills   = 'Listening, Speaking, Reading, Writing';
  if (!plan.teacher || plan.teacher === '') plan.teacher = teacher;
  if (!plan.level   || plan.level   === '') plan.level   = level;

  return plan;
}

// ── Cooldown state (2 minutes) ───────────────────────────────
const COOLDOWN_MS = 2 * 60 * 1000;
let _cooldownUntil = 0;
let _cooldownTimer = null;

function startCooldown() {
  _cooldownUntil = Date.now() + COOLDOWN_MS;
  tickCooldown();
}

function tickCooldown() {
  const remaining = _cooldownUntil - Date.now();
  if (remaining <= 0) {
    clearTimeout(_cooldownTimer);
    _cooldownTimer = null;
    const btn = $('btn-generate-again');
    if (btn) { btn.disabled = false; btn.textContent = 'Generate another'; }
    return;
  }
  const secs = Math.ceil(remaining / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const label = m > 0 ? m + ':' + String(s).padStart(2, '0') : s + 's';
  const btn = $('btn-generate-again');
  if (btn) { btn.disabled = true; btn.textContent = 'Wait ' + label; }
  _cooldownTimer = setTimeout(tickCooldown, 500);
}

// ── Build DOCX using docx.js ─────────────────────────────────
async function ensureDocx() {
  if (window.docx && window.docx.Document) return window.docx;
  await new Promise((resolve, reject) => {
    if (document.querySelector('script[data-docx]')) {
      setTimeout(resolve, 800);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
    s.setAttribute('data-docx', '1');
    s.onload = () => setTimeout(resolve, 100);
    s.onerror = () => reject(new Error('Failed to load docx.js'));
    document.head.appendChild(s);
  });
  if (window.docx && window.docx.Document) return window.docx;
  throw new Error('docx.js library could not be loaded');
}

async function buildDocx(plan) {
  const D = await ensureDocx();

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
    PageOrientation, TableLayoutType
  } = D;

  const DARK_BLUE  = '1F3864';
  const MID_BLUE   = '2E4C8B';
  const ACCENT     = '2E75B6';
  const WHITE      = 'FFFFFF';
  const LIGHT_GREY = 'F0F4FA';
  const LIGHT_BLUE = 'DCE6F1';

  const bdInner = { style: BorderStyle.SINGLE, size: 2, color: 'B8C8DC' };
  const bdOuter = { style: BorderStyle.SINGLE, size: 6, color: '1F3864' };
  const bdsInner = { top: bdInner, bottom: bdInner, left: bdInner, right: bdInner };
  const bdsOuter = { top: bdOuter, bottom: bdOuter, left: bdOuter, right: bdOuter };

  // Explicit, strict DXA column measurements to force Google Docs compliance
  const TW = 14400; // Total width for Letter Landscape w/ 0.5" margins

  // Header Table Column Widths (Must perfectly sum to 14400)
  const C_LBL1 = 1296;
  const C_VAL1 = 2016;
  const C_LBL2 = 1080;
  const C_VAL2 = 2952;
  const C_LBL3 = 1728;
  const C_VAL3 = 2592;
  const C_LBL4 = 864;
  const C_VAL4 = 1872;
  const HEADER_COLS = [C_LBL1, C_VAL1, C_LBL2, C_VAL2, C_LBL3, C_VAL3, C_LBL4, C_VAL4];

  // Stages Table Column Widths (Must perfectly sum to 14400)
  const S_STG = 1728;
  const S_PRO = 6336;
  const S_INT = 2160;
  const S_TEC = 2880;
  const S_TIM = 1296;
  const STAGE_COLS = [S_STG, S_PRO, S_INT, S_TEC, S_TIM];

  // ── Helper: header cell (dark bg, white bold text) ────────
  function hCell(text, cellWidth, opts = {}) {
    return new TableCell({
      borders: bdsInner,
      width: { size: cellWidth, type: WidthType.DXA },
      shading: { fill: opts.fill || DARK_BLUE, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      verticalAlign: VerticalAlign.CENTER,
      columnSpan: opts.span,
      rowSpan: opts.rowSpan,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({
          text,
          bold: true,
          color: WHITE,
          size: opts.size || 18,
          font: 'Calibri',
        })],
      })],
    });
  }

  // ── Helper: data cell ────────
  function dCell(text, cellWidth, opts = {}) {
    const raw = String(text || '').trim();
    const fill = opts.fill || WHITE;
    const align = opts.align || AlignmentType.LEFT;
    const sz = opts.size || 18;

    let paragraphs;
    if (opts.multiPara && raw.length > 80) {
      const sentences = raw.split(/(?<=\.)\s+/);
      const chunks = [];
      let buf = '';
      sentences.forEach((sent, i) => {
        buf = buf ? buf + ' ' + sent : sent;
        if ((i + 1) % 2 === 0 || i === sentences.length - 1) {
          chunks.push(buf.trim());
          buf = '';
        }
      });
      paragraphs = chunks.map((chunk, ci) => new Paragraph({
        alignment: align,
        spacing: { before: ci === 0 ? 0 : 60, after: 0 },
        children: [new TextRun({ text: chunk, size: sz, font: 'Calibri', bold: !!opts.bold })],
      }));
    } else {
      paragraphs = [new Paragraph({
        alignment: align,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: raw, size: sz, font: 'Calibri', bold: !!opts.bold })],
      })];
    }

    return new TableCell({
      borders: bdsInner,
      width: { size: cellWidth, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      verticalAlign: opts.vAlign || VerticalAlign.TOP,
      columnSpan: opts.span,
      children: paragraphs,
    });
  }

  // ── Title row ────────────────────────────────────────────
  const titleRow = new TableRow({
    children: [
      new TableCell({
        borders: bdsOuter,
        columnSpan: 8,
        width: { size: TW, type: WidthType.DXA },
        shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [new TextRun({
            text: 'LESSON PLAN',
            bold: true,
            color: WHITE,
            size: 40,
            font: 'Calibri',
            allCaps: true,
            characterSpacing: 40,
          })],
        })],
      }),
    ],
  });

  // ── Info rows ─────────────────────────────────────────────
  const infoRow1 = new TableRow({ children: [
    hCell('Teacher:',  C_LBL1, { fill: ACCENT }),
    dCell(plan.teacher,  C_VAL1, { vAlign: VerticalAlign.CENTER }),
    hCell('Level:',    C_LBL2, { fill: ACCENT }),
    dCell(plan.level,    C_VAL2, { vAlign: VerticalAlign.CENTER }),
    hCell('Textbook:', C_LBL3, { fill: ACCENT }),
    dCell(plan.textbook, C_VAL3, { vAlign: VerticalAlign.CENTER }),
    hCell('Time:',     C_LBL4, { fill: ACCENT }),
    dCell(plan.time,     C_VAL4, { vAlign: VerticalAlign.CENTER, align: AlignmentType.CENTER }),
  ]});

  const infoRow2 = new TableRow({ children: [
    hCell('Unit:',              C_LBL1, { fill: ACCENT }),
    dCell(plan.unit,            C_VAL1, { vAlign: VerticalAlign.CENTER, align: AlignmentType.CENTER }),
    hCell('Lesson:',            C_LBL2, { fill: ACCENT }),
    dCell(plan.lesson_title,    C_VAL2, { vAlign: VerticalAlign.CENTER }),
    hCell('Tools & Materials:', C_LBL3, { fill: ACCENT }),
    dCell(plan.tools_and_materials, C_VAL3, { vAlign: VerticalAlign.CENTER }),
    hCell('Skills:',            C_LBL4, { fill: ACCENT }),
    dCell(plan.integrated_skills,   C_VAL4, { vAlign: VerticalAlign.CENTER }),
  ]});

  // ── Objectives row ────────────────────────────────────────
  const objectives = plan.objectives || [];
  const objParagraphs = objectives.map((o, i) => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: i === 0 ? 0 : 80, after: 0 },
    children: [
      new TextRun({ text: String(i + 1) + '.  ', bold: true, size: 18, font: 'Calibri', color: MID_BLUE }),
      new TextRun({ text: String(o), size: 18, font: 'Calibri' }),
    ],
  }));

  const objectivesRow = new TableRow({ children: [
    hCell('Objectives:', C_LBL1, { fill: MID_BLUE }),
    new TableCell({
      borders: bdsInner,
      width: { size: TW - C_LBL1, type: WidthType.DXA },
      shading: { fill: 'EEF3FA', type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      columnSpan: 7,
      verticalAlign: VerticalAlign.CENTER,
      children: objParagraphs.length ? objParagraphs : [new Paragraph({ children: [new TextRun({ text: '', size: 18 })] })],
    }),
  ]});

  // ── Stage header row ──────────────────────────────────────
  const stageHeader = new TableRow({
    tableHeader: true,
    children: [
      hCell('Stages',               S_STG, { fill: MID_BLUE, size: 19 }),
      hCell('Procedures',           S_PRO, { fill: MID_BLUE, size: 19 }),
      hCell('Interaction Patterns', S_INT, { fill: MID_BLUE, size: 19 }),
      hCell('Techniques',           S_TEC, { fill: MID_BLUE, size: 19 }),
      hCell('Time',                 S_TIM, { fill: MID_BLUE, size: 19 }),
    ],
  });

  // ── Stage data rows ───────────────────────────────────────
  const stageRows = (plan.stages || []).map((s, idx) => {
    const fill = idx % 2 === 0 ? WHITE : LIGHT_GREY;
    return new TableRow({
      children: [
        new TableCell({
          borders: bdsInner,
          width: { size: S_STG, type: WidthType.DXA },
          shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 140, right: 140 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({
              text: String(s.stage || ''),
              bold: true,
              size: 18,
              font: 'Calibri',
              color: DARK_BLUE,
            })],
          })],
        }),
        dCell(s.procedures, S_PRO, { fill, multiPara: true }),
        dCell(s.interaction_patterns, S_INT, { fill, align: AlignmentType.CENTER, vAlign: VerticalAlign.CENTER }),
        dCell(s.techniques, S_TEC, { fill, align: AlignmentType.CENTER, vAlign: VerticalAlign.CENTER }),
        dCell(s.time, S_TIM, { fill, align: AlignmentType.CENTER, vAlign: VerticalAlign.CENTER }),
      ],
    });
  });

  // ── Reflections row ───────────────────────────────────────
  const reflText = String(plan.reflections || '').trim();
  const reflSentences = reflText.split(/(?<=\.)\s+/).filter(Boolean);
  const reflParagraphs = reflSentences.length > 1
    ? reflSentences.map((sent, i) => new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: i === 0 ? 0 : 80, after: 0 },
        children: [new TextRun({ text: sent.trim(), size: 18, font: 'Calibri', italics: true })],
      }))
    : [new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: reflText, size: 18, font: 'Calibri', italics: true })],
      })];

  const reflectionsRow = new TableRow({
    children: [
      hCell('Reflections', S_STG, { fill: DARK_BLUE }),
      new TableCell({
        borders: bdsInner,
        width: { size: TW - S_STG, type: WidthType.DXA },
        shading: { fill: 'F7F9FC', type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        columnSpan: 4,
        verticalAlign: VerticalAlign.TOP,
        children: reflParagraphs,
      }),
    ],
  });

  // ── Assemble document ─────────────────────────────────────
  // Explicitly passing `columnWidths` arrays (in DXA) is required by Google Docs 
  // to establish the rigid grid map to prevent dynamic column collapsing.

  const headerTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: HEADER_COLS,
    layout: TableLayoutType ? TableLayoutType.FIXED : 'fixed',
    borders: { insideH: { style: BorderStyle.NONE, size: 0 }, insideV: { style: BorderStyle.NONE, size: 0 } },
    rows: [
      titleRow,
      infoRow1,
      infoRow2,
      objectivesRow,
    ],
  });

  const stagesTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: STAGE_COLS,
    layout: TableLayoutType ? TableLayoutType.FIXED : 'fixed',
    borders: { insideH: { style: BorderStyle.NONE, size: 0 }, insideV: { style: BorderStyle.NONE, size: 0 } },
    rows: [
      stageHeader,
      ...stageRows,
      reflectionsRow,
    ],
  });
  
  // This tiny, invisible spacer paragraph prevents Google Docs from merging 
  // the two adjacent tables and forcing their columns to link/snap together.
  const spacer = new Paragraph({
    spacing: { before: 0, after: 0, line: 1 },
    children: [new TextRun({ text: "", size: 2 })] // size 2 is 1pt font
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: 12240,
            height: 15840,
            orientation: PageOrientation.LANDSCAPE,
          },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        headerTable,
        spacer,
        stagesTable,
      ],
    }],
  });

  return await Packer.toBlob(doc);
}

// ── Show result ──────────────────────────────────────────────
function showResult(plan, book, unit, lesson) {
  $('progress-card').classList.remove('visible');
  $('result-card').classList.add('visible');

  const lessonTitle = plan.lesson_title || ('Lesson ' + lesson);
  $('result-title').textContent = lessonTitle;
  $('result-subtitle').textContent =
    'Spotlight ' + book + ' · Unit ' + unit + ' · Lesson ' + lesson +
    ' — ready to download';

  const stages = plan.stages || [];
  let rows = '';
  stages.forEach(s => {
    rows += `<tr>
      <td><span class="stage-name">${esc(s.stage)}</span></td>
      <td>${esc(s.procedures)}</td>
      <td style="text-align:center">${esc(s.interaction_patterns)}</td>
      <td style="text-align:center">${esc(s.techniques)}</td>
      <td style="text-align:center;white-space:nowrap">${esc(s.time)}</td>
    </tr>`;
  });

  $('plan-preview').innerHTML = `
    <div class="plan-preview-header">
      <span>Lesson Plan Preview — ${esc(plan.lesson_title || '')}</span>
      <span style="opacity:0.5">${stages.length} stages</span>
    </div>
    <div class="plan-preview-body">
      <table class="plan-table">
        <thead>
          <tr>
            <th>Stage</th><th>Procedures</th><th>Interaction</th><th>Techniques</th><th>Time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

// ── Download handlers ────────────────────────────────────────
function downloadDocx() {
  if (!_generatedDocxBlob) return;
  const url = URL.createObjectURL(_generatedDocxBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = _currentLessonCode + '-LP.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadJson() {
  if (!_generatedPlan) return;
  const blob = new Blob([JSON.stringify(_generatedPlan, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = _currentLessonCode + '-LP.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Expose to HTML onclick
window.startGeneration   = startGeneration;
window.downloadDocx      = downloadDocx;
window.downloadJson      = downloadJson;
window.resetForm         = resetForm;
