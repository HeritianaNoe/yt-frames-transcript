'use strict';
const express = require('express');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { runPipeline, LANGS, YT_RE } = require('./pipeline');

const PORT = process.env.PORT || 3000;
const OUT = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output'));
fs.mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/files', express.static(OUT));

const jobs = new Map();
let queue = Promise.resolve(); // job iray isaky ny fotoana

function clearOutputDir() {
  try {
    for (const name of fs.readdirSync(OUT)) {
      fs.rmSync(path.join(OUT, name), { recursive: true, force: true });
    }
  } catch (_) { /* ignore */ }
}

app.post('/api/jobs', (req, res) => {
  const { url, lang, interval, quality } = req.body || {};
  if (typeof url !== 'string' || !YT_RE.test(url.trim())) return res.status(400).json({ error: 'Lien YouTube tsy marina.' });
  if (!LANGS[lang]) return res.status(400).json({ error: 'Safidio ny teny: mg, fr na en.' });
  const iv = Number(interval) > 0 ? Number(interval) : 5;

  // Fafana daholo ny output taloha isaky ny manomboka job vaovao
  clearOutputDir();
  jobs.clear();

  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, status: 'queued', logs: [], items: [], info: null, note: '', error: null };
  jobs.set(id, job);

  queue = queue.then(async () => {
    job.status = 'running';
    try {
      const r = await runPipeline({ url: url.trim(), lang, interval: iv, quality, root: path.join(OUT, id) }, {
        log: m => { job.logs.push(m); console.log(`[${id}] ${m}`); },
        info: i => (job.info = i),
        item: it => job.items.push({ ...it, imageUrl: `/files/${id}/${it.image}`, image: it.image }),
      });
      job.note = r.note;
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
      console.error(`[${id}]`, e.message);
    }
  });
  res.json({ id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tsy hita.' });
  res.json(job);
});

app.get('/api/jobs/:id/pdf', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).send('PDF mbola tsy vonona.');
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); }
  catch (_) { return res.status(500).send('Tsy hita ny pdfkit. Alefaso: npm install'); }

  const dir = path.join(OUT, job.id);
  const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true });
  const filename = `${(job.info && job.info.id) || job.id}_frames_transcript.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // Lohateny fotsiny (tsy asiana video ID)
  doc.fontSize(16).fillColor('#111').text(job.info.title || 'YouTube transcript', { align: 'center' });
  doc.moveDown(1);

  job.items.forEach((x, idx) => {
    if (idx > 0) doc.addPage();

    const pageTop = doc.y;
    const maxImgW = 515;
    const maxImgH = 320;
    let imgBottom = pageTop;

    // Sary — apetraka amin'ny toerana voafetra, avy eo ampiasaina ny haavony tena izy
    const imagePath = path.join(dir, 'images', path.basename(x.image || ''));
    if (fs.existsSync(imagePath)) {
      try {
        const img = doc.openImage(imagePath);
        const scale = Math.min(maxImgW / img.width, maxImgH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        const xPos = (doc.page.width - w) / 2; // center
        doc.image(img, xPos, pageTop, { width: w, height: h });
        imgBottom = pageTop + h + 12; // 12pt elanelana
      } catch (e) { /* sary tsy azo nasiana */ }
    }

    // Soratra eo ambanin'ny sary (tsy mifanindry)
    doc.y = imgBottom;
    doc.fontSize(11).fillColor('#111').text(x.text || '(tsy misy soratra)', {
      width: 515,
      lineGap: 3,
      align: 'left',
    });
  });
  doc.end();
});

app.get('/api/jobs/:id/zip', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'Tsy vonona ny zip.' });
  const dir = path.join(OUT, job.id);
  res.attachment(`${(job.info && job.info.id) || job.id}_frames_transcript.zip`);
  const z = archiver('zip', { zlib: { level: 6 } });
  z.on('error', e => res.status(500).end(e.message));
  z.pipe(res);
  z.glob('**/*', { cwd: dir, ignore: ['_tmp/**'] });
  z.append(buildReport(job), { name: 'report.html' });
  z.finalize();
});

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildReport(job) {
  // Tsy asiana timestamp "00:30:00 → 00:35:00"
  return `<!doctype html><html><meta charset="utf-8"><title>${esc(job.info.title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
.c{border:1px solid #ddd;border-radius:10px;padding:1rem;margin:1.2rem 0}
img{max-width:100%;border-radius:6px;display:block;margin-bottom:.8rem}
.n{color:#a60}
</style>
<h1>${esc(job.info.title)}</h1>
${job.note ? `<p class="n">${esc(job.note)}</p>` : ''}
${job.items.map(x => `<div class="c"><img src="${esc(x.image)}"><p>${esc(x.text)}</p></div>`).join('\n')}
</html>`;
}

app.listen(PORT, () => console.log(`Mandeha: http://localhost:${PORT}`));
