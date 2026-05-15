// ============================================================
//  LESSONPLAN.JS — Client-side lesson plan generator (A4 OPTIMIZED)
//  Fetches PDFs, extracts text with pdf.js, calls Groq API via
//  Cloudflare Worker proxy (API key hidden server-side),
//  builds a .docx using docx.js
// ============================================================

// Groq API is proxied through Cloudflare Worker — key never exposed to client
const GROQ_PROXY = 'https://spotlight.dpdns.org/proxy/groq';

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
      plan = await callGroq(tgText, sbText, _currentLessonCode, teacher, level, unit, lesson, book);
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
comprehensive lesson plan in JSON format. The lesson must:
1. Have a clear, descriptive title based on the content
2. Include detailed learning objectives aligned with CEFR levels
3. Break down the lesson into 5-8 logical stages (Presentation/Practice/Use)
4. Provide specific, actionable procedures for each stage
5. Specify interaction patterns (whole class, pairs, groups, individual)
6. List teaching techniques (role-play, discussion, etc.)
7. Allocate realistic timings that sum to 55 minutes
8. Include meaningful reflections on assessment and differentiation

Return ONLY valid JSON with this exact structure:
{
  "lesson_title": "...",
  "objectives": ["...", "..."],
  "stages": [
    {
      "stage": "Presentation: Name",
      "procedures": "1. ... 2. ...",
      "interaction_patterns": "Whole class, pairs",
      "techniques": "Modeling, repetition",
      "time": "5 min"
    }
  ],
  "reflections": "Assessment notes..."
}`;

// ── Call Groq via proxy ──────────────────────────────────────
async function callGroq(tgText, sbText, code, teacher, level, unit, lesson, book) {
  const messageContent = `Textbook: Spotlight ${book}
Lesson Code: ${code}
Teacher: ${teacher}
Level: ${level}
Unit: ${unit}
Lesson: ${lesson}

--- TEACHER GUIDE TEXT ---
${tgText.slice(0, 3000)}

--- STUDENT BOOK TEXT ---
${sbText.slice(0, 3000)}

Generate a comprehensive lesson plan.`;

  const response = await fetch(GROQ_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mixtral-8x7b-32768',
      messages: [{ role: 'user', content: messageContent }],
      temperature: 0.7,
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Failed to parse Groq response: ${e.message}`);
  }
}

// ── Build DOCX with A4 Portrait formatting ───────────────────
async function buildDocx(plan) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
          AlignmentType, PageOrientation, WidthType, ShadingType, VerticalAlign,
          BorderStyle } = window.docx;

  if (!Document) throw new Error('docx library not loaded');

  // ── A4 Portrait Page Setup ─────────────────────────────────
  // A4: 11906 x 16838 DXA (210 x 297 mm)
  // Content width with 1" margins (1440 DXA each side): 9026 DXA
  
  const A4_WIDTH = 11906;
  const A4_HEIGHT = 16838;
  const MARGIN = 720;  // 0.5 inch (smaller for better fit)
  const CONTENT_WIDTH = A4_WIDTH - (MARGIN * 2);

  // ── Colors ─────────────────────────────────────────────────
  const DARK_BLUE = '1F4E78';
  const MID_BLUE = '4472C4';
  const LIGHT_BLUE = 'D9E2F3';
  const WHITE = 'FFFFFF';
  const LIGHT_GREY = 'F2F2F2';

  // ── Helper: Header Cell ──────────────────────────────────────
  const hCell = (text, width, opts = {}) => {
    const { fill = MID_BLUE, size = 18 } = opts;
    const bdsInner = {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    };
    return new TableCell({
      borders: bdsInner,
      width: { size: width, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({
          text: String(text),
          bold: true,
          size: size,
          font: 'Calibri',
          color: WHITE,
        })],
      })],
    });
  };

  // ── Helper: Data Cell ────────────────────────────────────────
  const dCell = (text, width, opts = {}) => {
    const { fill = WHITE, multiPara = false, align = AlignmentType.LEFT, vAlign = VerticalAlign.TOP } = opts;
    const bdsInner = {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    };

    let children;
    if (multiPara) {
      const sentences = String(text || '').split(/(?<=\.)\s+/).filter(Boolean);
      children = sentences.length > 1
        ? sentences.map((sent, i) => new Paragraph({
            alignment: align,
            spacing: { before: i === 0 ? 0 : 60, after: 0 },
            children: [new TextRun({ text: sent.trim(), size: 16, font: 'Calibri' })],
          }))
        : [new Paragraph({
            alignment: align,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: String(text || ''), size: 16, font: 'Calibri' })],
          })];
    } else {
      children = [new Paragraph({
        alignment: align,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: String(text || ''), size: 16, font: 'Calibri' })],
      })];
    }

    return new TableCell({
      borders: bdsInner,
      width: { size: width, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 70, bottom: 70, left: 80, right: 80 },
      verticalAlign: vAlign,
      children,
    });
  };

  // ── Header Table Widths ──────────────────────────────────────
  const C_LABEL = 1600;  // Teacher, Level, Textbook labels
  const C_VALUE = (CONTENT_WIDTH - C_LABEL * 2) / 2;
  const HEADER_COLS = [C_LABEL, C_VALUE, C_LABEL, C_VALUE];

  const bdsInner = {
    top: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
    right: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
  };

  // ── Title Row ────────────────────────────────────────────────
  const titleRow = new TableRow({
    children: [
      new TableCell({
        borders: bdsInner,
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnSpan: 4,
        shading: { fill: DARK_BLUE, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [new TextRun({
            text: 'LESSON PLAN',
            bold: true,
            size: 28,
            font: 'Calibri',
            color: WHITE,
          })],
        })],
      }),
    ],
  });

  // ── Info Rows (Teacher, Level, Textbook, Time) ───────────────
  const infoRow1 = new TableRow({
    children: [
      hCell('Teacher:', C_LABEL, { fill: MID_BLUE }),
      dCell('Teacher', C_VALUE, { fill: 'F0F0F0' }),
      hCell('Level:', C_LABEL, { fill: MID_BLUE }),
      dCell('7th Grade', C_VALUE, { fill: 'F0F0F0' }),
    ],
  });

  const infoRow2 = new TableRow({
    children: [
      hCell('Unit:', C_LABEL, { fill: MID_BLUE }),
      dCell('Unit 3', C_VALUE, { fill: 'F0F0F0' }),
      hCell('Lesson:', C_LABEL, { fill: MID_BLUE }),
      dCell('Lesson 3', C_VALUE, { fill: 'F0F0F0' }),
    ],
  });

  // ── Objectives Row ───────────────────────────────────────────
  const objParagraphs = (Array.isArray(plan.objectives) ? plan.objectives : []).map((o, i) => new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: i === 0 ? 0 : 60, after: 0 },
    children: [new TextRun({ text: String(o), size: 16, font: 'Calibri' })],
  }));

  const objectivesRow = new TableRow({
    children: [
      hCell('Objectives:', C_LABEL, { fill: MID_BLUE }),
      new TableCell({
        borders: bdsInner,
        width: { size: CONTENT_WIDTH - C_LABEL, type: WidthType.DXA },
        shading: { fill: 'EEF3FA', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        columnSpan: 3,
        verticalAlign: VerticalAlign.TOP,
        children: objParagraphs.length ? objParagraphs : [new Paragraph({ children: [new TextRun({ text: '', size: 16 })] })],
      }),
    ],
  });

  // ── Stage Table Widths ───────────────────────────────────────
  const S_STG = Math.round(CONTENT_WIDTH * 0.15);
  const S_PRO = Math.round(CONTENT_WIDTH * 0.45);
  const S_INT = Math.round(CONTENT_WIDTH * 0.15);
  const S_TEC = Math.round(CONTENT_WIDTH * 0.15);
  const S_TIM = CONTENT_WIDTH - S_STG - S_PRO - S_INT - S_TEC;

  const STAGE_COLS = [S_STG, S_PRO, S_INT, S_TEC, S_TIM];

  // ── Stage Header Row ─────────────────────────────────────────
  const stageHeader = new TableRow({
    tableHeader: true,
    children: [
      hCell('Stages', S_STG, { fill: MID_BLUE, size: 16 }),
      hCell('Procedures', S_PRO, { fill: MID_BLUE, size: 16 }),
      hCell('Interaction Patterns', S_INT, { fill: MID_BLUE, size: 16 }),
      hCell('Techniques', S_TEC, { fill: MID_BLUE, size: 16 }),
      hCell('Time', S_TIM, { fill: MID_BLUE, size: 16 }),
    ],
  });

  // ── Stage Data Rows ──────────────────────────────────────────
  const stageRows = (plan.stages || []).map((s, idx) => {
    const fill = idx % 2 === 0 ? WHITE : LIGHT_GREY;
    return new TableRow({
      children: [
        new TableCell({
          borders: bdsInner,
          width: { size: S_STG, type: WidthType.DXA },
          shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR },
          margins: { top: 70, bottom: 70, left: 80, right: 80 },
          verticalAlign: VerticalAlign.TOP,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({
              text: String(s.stage || ''),
              bold: true,
              size: 14,
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

  // ── Reflections Row ──────────────────────────────────────────
  const reflText = String(plan.reflections || '').trim();
  const reflSentences = reflText.split(/(?<=\.)\s+/).filter(Boolean);
  const reflParagraphs = reflSentences.length > 1
    ? reflSentences.map((sent, i) => new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: i === 0 ? 0 : 70, after: 0 },
        children: [new TextRun({ text: sent.trim(), size: 15, font: 'Calibri', italics: true })],
      }))
    : [new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: reflText, size: 15, font: 'Calibri', italics: true })],
      })];

  const reflectionsRow = new TableRow({
    children: [
      hCell('Reflections', S_STG, { fill: DARK_BLUE, size: 16 }),
      new TableCell({
        borders: bdsInner,
        width: { size: CONTENT_WIDTH - S_STG, type: WidthType.DXA },
        shading: { fill: 'F7F9FC', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        columnSpan: 4,
        verticalAlign: VerticalAlign.TOP,
        children: reflParagraphs,
      }),
    ],
  });

  // ── Assemble Document ────────────────────────────────────────
  const headerTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: HEADER_COLS,
    layout: 'fixed',
    borders: { insideH: { style: BorderStyle.NONE, size: 0 }, insideV: { style: BorderStyle.NONE, size: 0 } },
    rows: [
      titleRow,
      infoRow1,
      infoRow2,
      objectivesRow,
    ],
  });

  const stagesTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: STAGE_COLS,
    layout: 'fixed',
    borders: { insideH: { style: BorderStyle.NONE, size: 0 }, insideV: { style: BorderStyle.NONE, size: 0 } },
    rows: [
      stageHeader,
      ...stageRows,
      reflectionsRow,
    ],
  });

  // Spacer to prevent table merging
  const spacer = new Paragraph({
    spacing: { before: 0, after: 0, line: 1 },
    children: [new TextRun({ text: "", size: 2 })]
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: A4_WIDTH,
            height: A4_HEIGHT,
            // Use portrait orientation (default)
          },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
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
