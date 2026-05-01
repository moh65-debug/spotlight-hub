// ============================================================
//  LP.JS  — Lesson Plan Generator (fixed: extracts PDF text)
// ============================================================

// ── Book structure ────────────────────────────────────────────
const BOOK_UNITS = { '1': 6, '2': 6, '3': 5 };
const LESSONS_PER_UNIT = 8;
const ARCHIVE_PROXY = 'https://spotlight.dpdns.org/proxy/archive/spotlight-trilogy/';

// ── Cooldown (2 minutes = 120 seconds) ───────────────────────
const COOLDOWN_MS = 120_000;
let cooldownTimer = null;
let cooldownEnd   = 0;

// ── State ─────────────────────────────────────────────────────
let _generatedPlan = null;
let _generatedFilename = '';

// ── DOM refs ──────────────────────────────────────────────────
const bookSel     = () => document.getElementById('lp-book');
const unitSel     = () => document.getElementById('lp-unit');
const lessonSel   = () => document.getElementById('lp-lesson');
const teacherInp  = () => document.getElementById('lp-teacher');
const classInp    = () => document.getElementById('lp-class');
const btnGen      = () => document.getElementById('btn-generate');
const statusBox   = () => document.getElementById('lp-status');
const errorBox    = () => document.getElementById('lp-error');
const resultBox   = () => document.getElementById('lp-result');
const cooldownWrap= () => document.getElementById('cooldown-wrap');
const cooldownSec = () => document.getElementById('cooldown-sec');
const cooldownFill= () => document.getElementById('cooldown-fill');

// ── Form wiring ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bookSel().addEventListener('change', onBookChange);
  unitSel().addEventListener('change', onUnitChange);
  [teacherInp(), classInp(), bookSel(), unitSel(), lessonSel()]
    .forEach(el => el && el.addEventListener('change', validateForm));
  [teacherInp(), classInp()]
    .forEach(el => el && el.addEventListener('input', validateForm));
  validateForm();
});

function onBookChange() {
  const book = bookSel().value;
  const uSel = unitSel();
  const lSel = lessonSel();

  uSel.innerHTML = '<option value="">— select —</option>';
  lSel.innerHTML = '<option value="">— select unit first —</option>';
  lSel.disabled  = true;

  if (!book) { uSel.disabled = true; validateForm(); return; }

  const maxUnits = BOOK_UNITS[book] || 8;
  for (let i = 1; i <= maxUnits; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Unit ${i}`;
    uSel.appendChild(o);
  }
  uSel.disabled = false;
  validateForm();
}

function onUnitChange() {
  const lSel = lessonSel();
  lSel.innerHTML = '<option value="">— select —</option>';

  if (!unitSel().value) { lSel.disabled = true; validateForm(); return; }

  for (let i = 1; i <= LESSONS_PER_UNIT; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `Lesson ${i}`;
    lSel.appendChild(o);
  }
  lSel.disabled = false;
  validateForm();
}

function validateForm() {
  const ok = teacherInp()?.value.trim() &&
             bookSel()?.value &&
             unitSel()?.value &&
             lessonSel()?.value &&
             !cooldownTimer;
  btnGen().disabled = !ok;
}

// ── Cooldown ──────────────────────────────────────────────────
function startCooldown() {
  cooldownEnd = Date.now() + COOLDOWN_MS;
  cooldownWrap().classList.add('visible');
  btnGen().disabled = true;

  cooldownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
    cooldownSec().textContent = remaining;
    cooldownFill().style.width = ((remaining / (COOLDOWN_MS / 1000)) * 100) + '%';
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      cooldownWrap().classList.remove('visible');
      validateForm();
    }
  }, 1000);
}

// ── Step helpers ──────────────────────────────────────────────
const STEPS = ['dl','extract-tg','extract-sb','ai','docx'];

function resetSteps() {
  STEPS.forEach(id => {
    const icon = document.getElementById(`step-${id}-icon`);
    const row  = document.getElementById(`step-${id}`);
    if (icon) { icon.className = 'lp-step-icon idle'; }
    if (row)  { row.className = 'lp-step'; }
  });
}

function setStep(id, state) {
  // state: 'running' | 'done' | 'error'
  const icon = document.getElementById(`step-${id}-icon`);
  const row  = document.getElementById(`step-${id}`);
  if (!icon) return;

  icon.className = `lp-step-icon ${state}`;
  if (state === 'running') {
    icon.textContent = '↻';
    row.className = 'lp-step active';
  } else if (state === 'done') {
    icon.textContent = '✓';
    row.className = 'lp-step done-step';
  } else if (state === 'error') {
    icon.textContent = '✕';
    row.className = 'lp-step';
  }
}

// ── Filename helper ───────────────────────────────────────────
function spFilename(book, unit, lesson, type) {
  return `SP${book}-U${unit}-L${lesson}-${type}`;
}

// ── PDF text extraction using pdf.js ──────────────────────────
async function fetchPdfText(book, unit, lesson, kind) {
  const pathPart = `Spotlight%20${book}/Unit%20${unit}/Lesson%20${lesson}/Lesson-${lesson}-${kind}.pdf`;
  const url = ARCHIVE_PROXY + pathPart;

  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`Failed to fetch ${kind} PDF (HTTP ${resp.status})`);

  const blob = await resp.blob();
  if (blob.size < 512) throw new Error(`${kind} PDF seems empty (${blob.size} bytes)`);

  // Use pdf.js (already guaranteed to be loaded via ensurePdfJs)
  await ensurePdfJs();

  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

// ── Groq API call (openai/gpt-oss-120b via proxy) ─────────────
const GROQ_API_URL = 'https://spotlight.dpdns.org/proxy/groq';
const GROQ_MODEL   = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are an expert EFL/ESL curriculum designer specializing in Moroccan middle-school English.

Given the text content from a Teacher Guide (TG) and a Student Book (SB), produce a complete, classroom-ready lesson plan as a single valid JSON object.
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

Required stages in order: Warm up, Pre-Reading, Reading & Comprehension, Vocabulary, Listening, Grammar, Writing, Speaking, Closure.

Rules:
- Base ALL content strictly on the PDF text — do NOT invent a topic.
- Do NOT mention any page numbers anywhere.
- Procedures: concrete teacher/student actions, concise but specific.
- Stage times must add up to exactly 55 minutes.
- If teacher name or grade are missing from the PDFs, use the values provided by the user.`;

async function callGroqApi(sbText, tgText, book, unit, lesson, teacher, grade) {
  const lessonCode = `SP${book}-U${unit}-L${lesson}`;

  const userMessage =
    `Lesson code: ${lessonCode} (Spotlight ${book}, Unit ${unit}, Lesson ${lesson})\n` +
    `Teacher: ${teacher || 'Teacher'}\n` +
    `Grade / Level: ${grade || '7th Grade'}\n` +
    `Total time: 55 min\n\n` +
    `=== TEACHER GUIDE (TG) TEXT ===\n${tgText.slice(0, 15000)}\n\n` +
    `=== STUDENT BOOK (SB) TEXT ===\n${sbText.slice(0, 15000)}\n\n` +
    `Generate the lesson plan JSON. No page numbers. ` +
    `Use teacher name "${teacher || 'Teacher'}" and level "${grade || '7th Grade'}". ` +
    `Return ONLY the JSON object.`;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      temperature: 1,
      max_completion_tokens: 4000,
      top_p: 1,
      reasoning_effort: 'medium',
      stream: false,
      stop: null,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Groq API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  let raw = (data.choices?.[0]?.message?.content || '').trim();

  // Strip markdown fences if present
  if (raw.includes('```')) {
    for (const part of raw.split('```')) {
      const cleaned = part.trim().replace(/^json\s*/i, '');
      if (cleaned.startsWith('{')) { raw = cleaned; break; }
    }
  }

  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);

  let plan;
  try { plan = JSON.parse(raw); }
  catch (e) { throw new Error('Could not parse AI response as JSON. Try again.'); }

  // Enforce fixed values
  plan.textbook            = 'Spotlight';
  plan.time                = '55 min';
  plan.tools_and_materials = 'Student Book, Audio recordings, Whiteboard/markers';
  plan.integrated_skills   = 'Listening, Speaking, Reading, Writing';
  if (teacher) plan.teacher = teacher;
  if (grade)   plan.level   = grade;

  return plan;
}

// ── DOCX builder (docx library via CDN) ───────────────────────
const DOCX_CDN = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
let _docxLoaded = false;

function loadDocxLib() {
  return new Promise((resolve, reject) => {
    if (_docxLoaded && window.docx) { resolve(); return; }
    const s = document.createElement('script');
    s.src = DOCX_CDN;
    s.onload = () => { _docxLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Could not load DOCX library. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function buildDocx(plan, filename) {
  await loadDocxLib();

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
    PageOrientation
  } = window.docx;

  const DARK_BLUE  = '1F3864';
  const MID_BLUE   = '2E4C8B';
  const WHITE      = 'FFFFFF';
  const LIGHT_GREY = 'F2F2F2';

  const bd  = { style: BorderStyle.SINGLE, size: 4, color: 'A0A0A0' };
  const bds = { top: bd, bottom: bd, left: bd, right: bd };

  const TW = 14400; // landscape letter, 0.5" margins

  const SW = [
    Math.floor(TW * 0.14),
    Math.floor(TW * 0.47),
    Math.floor(TW * 0.13),
    Math.floor(TW * 0.17),
    0,
  ];
  SW[4] = TW - SW[0] - SW[1] - SW[2] - SW[3];

  const LBL  = Math.floor(TW * 0.09);
  const WIDE = Math.floor(TW * 0.17);
  const MED  = Math.floor(TW * 0.12);

  const R1 = [LBL, WIDE, LBL, MED, LBL, WIDE, LBL, 0];
  R1[7] = TW - R1[0] - R1[1] - R1[2] - R1[3] - R1[4] - R1[5] - R1[6];

  const LLBL = Math.floor(TW * 0.12);
  const R2   = [LBL, Math.floor(TW * 0.07), LBL, WIDE, LLBL, 0, LBL, MED];
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
        children: [new TextRun({ text, bold: true, color: WHITE, size: opts.size || 18, font: 'Calibri' })]
      })]
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
        children: [new TextRun({ text: String(text || ''), size: opts.size || 18, font: 'Calibri', bold: !!opts.bold })]
      })]
    });
  }

  const rows = [
    // Title row
    new TableRow({ children: [
      new TableCell({
        borders: bds, columnSpan: 8,
        width: { size: TW, type: WidthType.DXA },
        shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
        margins: { top: 140, bottom: 140, left: 200, right: 200 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'LESSON PLAN', bold: true, color: WHITE, size: 36, font: 'Calibri' })]
        })]
      })
    ]}),

    // Info row 1
    new TableRow({ children: [
      hCell('Teacher:',  R1[0]), dCell(plan.teacher,  R1[1]),
      hCell('Level:',    R1[2]), dCell(plan.level,    R1[3]),
      hCell('Textbook:', R1[4]), dCell(plan.textbook, R1[5]),
      hCell('Time:',     R1[6]), dCell(plan.time,     R1[7]),
    ]}),

    // Info row 2
    new TableRow({ children: [
      hCell('Unit:',              R2[0]), dCell(plan.unit,                R2[1]),
      hCell('Lesson:',            R2[2]), dCell(plan.lesson_title,        R2[3]),
      hCell('Tools & Materials:', R2[4]), dCell(plan.tools_and_materials, R2[5]),
      hCell('Skills:',            R2[6]), dCell(plan.integrated_skills,   R2[7]),
    ]}),

    // Objectives
    (() => {
      const lw  = Math.floor(TW * 0.11);
      const txt = (plan.objectives || []).map((o, i) => `${i + 1}. ${o}`).join('    |    ');
      return new TableRow({ children: [
        hCell('Objectives:', lw),
        dCell(txt, TW - lw, { span: 7 }),
      ]});
    })(),

    // Stage header
    new TableRow({
      tableHeader: true,
      children: [
        hCell('Stages',               SW[0], { fill: MID_BLUE, size: 20 }),
        hCell('Procedures',           SW[1], { fill: MID_BLUE, size: 20 }),
        hCell('Interaction Patterns', SW[2], { fill: MID_BLUE, size: 20 }),
        hCell('Techniques',           SW[3], { fill: MID_BLUE, size: 20 }),
        hCell('Time',                 SW[4], { fill: MID_BLUE, size: 20 }),
      ]
    }),

    // Stage rows
    ...(plan.stages || []).map((s, idx) => {
      const fill = idx % 2 === 0 ? WHITE : LIGHT_GREY;
      return new TableRow({ children: [
        dCell(s.stage,                SW[0], { fill, bold: true }),
        dCell(s.procedures,           SW[1], { fill }),
        dCell(s.interaction_patterns, SW[2], { fill, align: AlignmentType.CENTER }),
        dCell(s.techniques,           SW[3], { fill, align: AlignmentType.CENTER }),
        dCell(s.time,                 SW[4], { fill, align: AlignmentType.CENTER }),
      ]});
    }),

    // Reflections
    (() => {
      const lw = SW[0];
      return new TableRow({ children: [
        hCell('Reflections', lw),
        dCell(plan.reflections || '', TW - lw, { span: 7 }),
      ]});
    })(),
  ];

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        }
      },
      children: [new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: R1,
        rows,
      })],
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return blob;
}

// ── Main generate handler ─────────────────────────────────────
async function handleGenerate() {
  const teacher = teacherInp().value.trim();
  const grade   = classInp().value.trim();
  const book    = bookSel().value;
  const unit    = unitSel().value;
  const lesson  = lessonSel().value;

  if (!teacher || !book || !unit || !lesson) return;

  // Reset UI
  errorBox().className = 'lp-error';
  resultBox().className = 'lp-result';
  document.getElementById('lp-preview-panel').className = 'lp-preview-panel';
  statusBox().classList.add('visible');
  resetSteps();
  btnGen().disabled = true;
  _generatedPlan = null;

  const filename = spFilename(book, unit, lesson, 'LP') + '.docx';
  _generatedFilename = filename;
  document.getElementById('result-pill').textContent = filename;

  try {
    // Step 1 — Download PDFs (unchanged, but we'll reuse for text extraction)
    setStep('dl', 'running');
    let sbBlob, tgBlob;
    try {
      // Fetch blobs first (we'll extract text later)
      const [sbResp, tgResp] = await Promise.all([
        fetch(ARCHIVE_PROXY + `Spotlight%20${book}/Unit%20${unit}/Lesson%20${lesson}/Lesson-${lesson}-SB.pdf`),
        fetch(ARCHIVE_PROXY + `Spotlight%20${book}/Unit%20${unit}/Lesson%20${lesson}/Lesson-${lesson}-TG.pdf`)
      ]);
      if (!sbResp.ok || !tgResp.ok) throw new Error('Failed to download PDFs');
      [sbBlob, tgBlob] = await Promise.all([sbResp.blob(), tgResp.blob()]);
    } catch (e) {
      throw new Error(`Could not download PDFs: ${e.message}`);
    }
    setStep('dl', 'done');

    // Step 2 & 3 — Extract text from PDFs
    setStep('extract-tg', 'running');
    let tgText;
    try {
      await ensurePdfJs();
      tgText = await extractTextFromBlob(tgBlob);
    } catch (e) {
      throw new Error(`TG text extraction failed: ${e.message}`);
    }
    setStep('extract-tg', 'done');

    setStep('extract-sb', 'running');
    let sbText;
    try {
      sbText = await extractTextFromBlob(sbBlob);
    } catch (e) {
      throw new Error(`SB text extraction failed: ${e.message}`);
    }
    setStep('extract-sb', 'done');

    // Step 4 — AI generation
    setStep('ai', 'running');
    let plan;
    try {
      plan = await callGroqApi(sbText, tgText, book, unit, lesson, teacher, grade);
    } catch (e) {
      throw new Error(`AI generation failed: ${e.message}`);
    }
    setStep('ai', 'done');

    // Step 5 — Build DOCX
    setStep('docx', 'running');
    let docxBlob;
    try {
      docxBlob = await buildDocx(plan, filename);
    } catch (e) {
      throw new Error(`DOCX build failed: ${e.message}`);
    }
    setStep('docx', 'done');

    _generatedPlan = plan;
    _generatedDocxBlob = docxBlob;

    document.getElementById('result-title').textContent = plan.lesson_title || `Lesson ${lesson}`;
    document.getElementById('result-sub').textContent = `Spotlight ${book} — Unit ${unit}, Lesson ${lesson} — ${teacher}`;
    resultBox().classList.add('visible');

    startCooldown();

  } catch (err) {
    console.error('Lesson plan generation error:', err);
    STEPS.forEach(id => {
      const icon = document.getElementById(`step-${id}-icon`);
      if (icon && icon.classList.contains('running')) setStep(id, 'error');
    });
    errorBox().textContent = '⚠ ' + (err.message || 'Unknown error. Please try again.');
    errorBox().classList.add('visible');
    btnGen().disabled = false;
  }
}

let _generatedDocxBlob = null;

function downloadDocx() {
  if (!_generatedDocxBlob) return;
  const url = URL.createObjectURL(_generatedDocxBlob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = _generatedFilename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 10000);
}

function togglePreview() {
  const panel = document.getElementById('lp-preview-panel');
  if (panel.classList.contains('visible')) {
    panel.classList.remove('visible');
    return;
  }
  if (!_generatedPlan) return;
  renderPlanPreview(_generatedPlan);
  panel.classList.add('visible');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPlanPreview(plan) {
  const content = document.getElementById('preview-content');
  const stages  = (plan.stages || []);
  const objs    = (plan.objectives || []).map((o, i) => `${i + 1}. ${o}`).join('<br>');

  const infoRows = `
    <table class="lp-preview-table" style="margin-bottom:0">
      <tr>
        <th>Teacher</th><th>Level</th><th>Textbook</th><th>Time</th>
      </tr>
      <tr>
        <td>${esc(plan.teacher)}</td>
        <td>${esc(plan.level)}</td>
        <td>${esc(plan.textbook)}</td>
        <td>${esc(plan.time)}</td>
      </tr>
      <tr>
        <th>Unit</th><th>Lesson</th><th>Materials</th><th>Skills</th>
      </tr>
      <tr>
        <td>${esc(plan.unit)}</td>
        <td>${esc(plan.lesson_title)}</td>
        <td>${esc(plan.tools_and_materials)}</td>
        <td>${esc(plan.integrated_skills)}</td>
      </tr>
      <tr>
        <th colspan="4">Objectives</th>
      </tr>
      <tr>
        <td colspan="4">${objs}</td>
      </tr>
    </table>`;

  const stagesHtml = `
    <table class="lp-preview-table" style="margin-top:1px">
      <tr class="lp-preview-header-row">
        <td style="width:12%">Stage</td>
        <td style="width:46%">Procedures</td>
        <td style="width:14%">Interaction</td>
        <td style="width:18%">Techniques</td>
        <td style="width:10%">Time</td>
      </tr>
      ${stages.map((s) => `
        <tr>
          <td class="stage-name">${esc(s.stage)}</td>
          <td>${esc(s.procedures)}</td>
          <td style="text-align:center">${esc(s.interaction_patterns)}</td>
          <td style="text-align:center">${esc(s.techniques)}</td>
          <td style="text-align:center">${esc(s.time)}</td>
        </tr>`).join('')}
      <tr>
        <td colspan="5"><strong>Reflections:</strong> ${esc(plan.reflections || '—')}</td>
      </tr>
    </table>`;

  content.innerHTML = infoRows + stagesHtml;
}

// ── PDF text extraction helper (uses already loaded pdf.js) ──
async function extractTextFromBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

// ── Ensure pdf.js is loaded (shared with main app) ─────────────
function ensurePdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) return resolve();
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const workerCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');`;
      const blob       = new Blob([workerCode], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(script);
  });
}

// ── Utilities ─────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
