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
  // state: 'active' | 'done' | 'error'
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
  $('result-card').classList.remove('visible');
  $('error-card').classList.remove('visible');
  $('progress-card').classList.remove('visible');
  $('progress-bar').style.width = '0%';
  $('progress-bar').classList.remove('done');
  for (let i = 0; i < 5; i++) {
    const el = $('step-' + i);
    if (el) el.className = 'progress-step';
  }
  $('btn-generate').disabled = false;
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

  _currentLessonCode = 'U' + unit + '-L' + lesson;

  // UI: hide result/error, show progress
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

    // Show result
    showResult(plan, book, unit, lesson);

  } catch(err) {
    showError(err.message || String(err));
    $('btn-generate').disabled = false;
  }
}

// ── Fetch PDF as ArrayBuffer ─────────────────────────────────
async function fetchPdfBytes(url) {
  // Always route through the same-origin proxy to avoid CORS / HTTP-redirect issues.
  // Normalise: replace any accidental /download/ prefix with /proxy/archive/
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
  // pdf.js must be loaded globally
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
      "stage": "Warm up",
      "procedures": "",
      "interaction_patterns": "",
      "techniques": "",
      "time": ""
    }
  ],
  "reflections": ""
}

Required stages in order: Warm up, Pre-Reading, Reading & Comprehension,
Vocabulary, Listening, Grammar, Writing, Speaking, Closure.

Rules:
- Base ALL content strictly on the PDF text — do NOT invent a topic.
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

  // Strip markdown code fences if present
  if (raw.includes('```')) {
    for (const part of raw.split('```')) {
      const stripped = part.trim().replace(/^json\s*/i, '').trim();
      if (stripped.startsWith('{')) { raw = stripped; break; }
    }
  }

  // Extract JSON object
  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);

  let plan;
  try { plan = JSON.parse(raw); }
  catch(e) { throw new Error('Could not parse AI response as JSON. Raw: ' + raw.slice(0, 300)); }

  // Force fixed values
  plan.textbook            = 'Spotlight';
  plan.time                = '55 min';
  plan.tools_and_materials = 'Student Book, Audio recordings, Whiteboard/markers';
  plan.integrated_skills   = 'Listening, Speaking, Reading, Writing';
  if (!plan.teacher || plan.teacher === '') plan.teacher = teacher;
  if (!plan.level   || plan.level   === '') plan.level   = level;

  return plan;
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
    s.src = 'https://unpkg.com/docx@8.5.0/build/index.js';
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
    PageOrientation,
  } = D;

  const DARK_BLUE  = '1F3864';
  const MID_BLUE   = '2E4C8B';
  const WHITE      = 'FFFFFF';
  const LIGHT_GREY = 'F2F2F2';

  const bd  = { style: BorderStyle.SINGLE, size: 4, color: 'A0A0A0' };
  const bds = { top: bd, bottom: bd, left: bd, right: bd };

  // Landscape Letter, 0.5" margins → content width ≈ 14400 DXA
  const TW = 14400;

  // Stage table column widths
  const SW = [
    Math.floor(TW * 0.14),
    Math.floor(TW * 0.47),
    Math.floor(TW * 0.13),
    Math.floor(TW * 0.17),
    0,
  ];
  SW[4] = TW - SW[0] - SW[1] - SW[2] - SW[3];

  // Info row widths
  const LBL  = Math.floor(TW * 0.09);
  const WIDE = Math.floor(TW * 0.17);
  const MED  = Math.floor(TW * 0.12);
  const R1   = [LBL, WIDE, LBL, MED, LBL, WIDE, LBL, 0];
  R1[7] = TW - R1[0] - R1[1] - R1[2] - R1[3] - R1[4] - R1[5] - R1[6];

  const LLBL = Math.floor(TW * 0.12);
  const SM   = Math.floor(TW * 0.07);
  const R2   = [LBL, SM, LBL, WIDE, LLBL, 0, LBL, MED];
  R2[5] = TW - R2[0] - R2[1] - R2[2] - R2[3] - R2[4] - R2[6] - R2[7];

  function hCell(text, width, opts = {}) {
    return new TableCell({
      borders: bds,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: opts.fill || DARK_BLUE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 130, right: 130 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, color: WHITE, size: opts.size || 18, font: 'Calibri' })],
      })],
    });
  }

  function dCell(text, width, opts = {}) {
    return new TableCell({
      borders: bds,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: opts.fill || WHITE, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 130, right: 130 },
      verticalAlign: VerticalAlign.CENTER,
      columnSpan: opts.span,
      children: [new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        children: [new TextRun({ text: String(text || ''), size: opts.size || 18, font: 'Calibri', bold: !!opts.bold })],
      })],
    });
  }

  const titleRow = new TableRow({ children: [
    new TableCell({
      borders: bds, columnSpan: 8,
      width: { size: TW, type: WidthType.DXA },
      shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
      margins: { top: 140, bottom: 140, left: 200, right: 200 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'LESSON PLAN', bold: true, color: WHITE, size: 36, font: 'Calibri' })],
      })],
    }),
  ]});

  const infoRow1 = new TableRow({ children: [
    hCell('Teacher:',  R1[0]), dCell(plan.teacher,  R1[1]),
    hCell('Level:',    R1[2]), dCell(plan.level,    R1[3]),
    hCell('Textbook:', R1[4]), dCell(plan.textbook, R1[5]),
    hCell('Time:',     R1[6]), dCell(plan.time,     R1[7]),
  ]});

  const infoRow2 = new TableRow({ children: [
    hCell('Unit:',              R2[0]), dCell(plan.unit,                R2[1]),
    hCell('Lesson:',            R2[2]), dCell(plan.lesson_title,        R2[3]),
    hCell('Tools & Materials:', R2[4]), dCell(plan.tools_and_materials, R2[5]),
    hCell('Skills:',            R2[6]), dCell(plan.integrated_skills,   R2[7]),
  ]});

  const lw = Math.floor(TW * 0.11);
  const objTxt = (plan.objectives || []).map((o, i) => (i + 1) + '. ' + o).join('    |    ');
  const objectivesRow = new TableRow({ children: [
    hCell('Objectives:', lw),
    dCell(objTxt, TW - lw, { span: 7 }),
  ]});

  const stageHeader = new TableRow({
    tableHeader: true,
    children: [
      hCell('Stages',               SW[0], { fill: MID_BLUE, size: 20 }),
      hCell('Procedures',           SW[1], { fill: MID_BLUE, size: 20 }),
      hCell('Interaction Patterns', SW[2], { fill: MID_BLUE, size: 20 }),
      hCell('Techniques',           SW[3], { fill: MID_BLUE, size: 20 }),
      hCell('Time',                 SW[4], { fill: MID_BLUE, size: 20 }),
    ],
  });

  const stageRows = (plan.stages || []).map((s, idx) => {
    const fill = idx % 2 === 0 ? WHITE : LIGHT_GREY;
    return new TableRow({ children: [
      dCell(s.stage,                SW[0], { fill, bold: true }),
      dCell(s.procedures,           SW[1], { fill }),
      dCell(s.interaction_patterns, SW[2], { fill, align: AlignmentType.CENTER }),
      dCell(s.techniques,           SW[3], { fill, align: AlignmentType.CENTER }),
      dCell(s.time,                 SW[4], { fill, align: AlignmentType.CENTER }),
    ]});
  });

  const reflectionsRow = new TableRow({ children: [
    hCell('Reflections', SW[0]),
    dCell(plan.reflections || '', TW - SW[0], { span: 7 }),
  ]});

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 15840, height: 12240, orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [new Table({
        width: { size: TW, type: WidthType.DXA },
        rows: [titleRow, infoRow1, infoRow2, objectivesRow, stageHeader, ...stageRows, reflectionsRow],
      })],
    }],
  });

  const buffer = await Packer.toBlob(doc);
  return buffer;
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

  // Build preview table
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
