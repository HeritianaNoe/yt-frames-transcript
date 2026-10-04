#!/usr/bin/env node
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LANGS = { mg: 'Malagasy', fr: 'Frantsay', en: 'Anglisy' };

// ---------- Args ----------
function parseArgs(argv) {
  const o = { url: null, lang: null, interval: 5, out: 'output', quality: 480, keepVideo: false, cookies: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-l' || a === '--lang') o.lang = argv[++i];
    else if (a === '-i' || a === '--interval') o.interval = parseFloat(argv[++i]);
    else if (a === '-o' || a === '--out') o.out = argv[++i];
    else if (a === '-q' || a === '--quality') o.quality = parseInt(argv[++i], 10);
    else if (a === '--cookies') o.cookies = argv[++i];
    else if (a === '--keep-video') o.keepVideo = true;
    else if (a === '-h' || a === '--help') { help(); process.exit(0); }
    else if (!a.startsWith('-')) o.url = a;
  }
  return o;
}
function help() {
  console.log(`Fampiasana:
  node src/index.js <youtube-url> --lang mg|fr|en [options]

Options:
  -l, --lang        mg (Malagasy) | fr (Frantsay) | en (Anglisy)
  -i, --interval    minitra isaky ny sary (default 5)
  -o, --out         lahatahiry output (default ./output)
  -q, --quality     haavon'ny video halaina (default 480)
      --cookies     fichier cookies.txt (raha voasakana ny YouTube)
      --keep-video  tazomy ny video nalaina`);
}
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); }));
}

// ---------- Process helpers ----------
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp_x86';
function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}
function run(cmd, args, { show = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', show ? 'inherit' : 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    if (!show) p.stderr.on('data', d => (err += d));
    p.on('error', e => reject(new Error(`Tsy mety ny "${cmd}": ${e.message}. Hamarino fa voapetraka izy.`)));
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} nirohotra (code ${code})\n${err}`)));
  });
}
const baseYt = (o) => ['--no-playlist', '--no-warnings', ...(o.cookies ? ['--cookies', o.cookies] : [])];

// ---------- Subtitles ----------
function pickSourceLang(info) {
  const manual = Object.keys(info.subtitles || {}).filter(k => k !== 'live_chat');
  const auto = Object.keys(info.automatic_captions || {});
  const vl = info.language;
  if (vl && manual.includes(vl)) return vl;
  if (manual.length) return manual[0];
  const orig = auto.find(k => k.endsWith('-orig'));
  if (orig) return orig;
  if (vl && auto.includes(vl)) return vl;
  if (auto.includes('en')) return 'en';
  return auto[0] || null;
}

async function fetchSubs(url, lang, dir, o, tries = 3) {
  for (let t = 1; t <= tries; t++) {
    try {
      await run(YTDLP, [...baseYt(o), '--skip-download', '--write-subs', '--write-auto-subs',
        '--sub-langs', lang, '--sub-format', 'json3', '-o', path.join(dir, '%(id)s.%(ext)s'), url]);
    } catch (e) { if (t === tries) throw e; }
    const f = fs.readdirSync(dir).find(n => n.endsWith(`.${lang}.json3`));
    if (f) return path.join(dir, f);
    await new Promise(r => setTimeout(r, 1500 * t)); // 429 ? andraso kely
  }
  return null;
}

function parseJson3(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const segs = [];
  for (const ev of j.events || []) {
    if (!ev.segs) continue;
    const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (text) segs.push({ start: (ev.tStartMs || 0) / 1000, text });
  }
  return segs;
}

// ---------- Translation (fallback, endpoint tsy ofisialy) ----------
async function translateText(text, from, to) {
  if (!text.trim()) return '';
  const chunks = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).length > 1500) { chunks.push(cur); cur = w; } else cur += (cur ? ' ' : '') + w;
  }
  if (cur) chunks.push(cur);
  const outParts = [];
  for (const c of chunks) {
    const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + from + '&tl=' + to, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'q=' + encodeURIComponent(c),
    });
    if (!res.ok) throw new Error('Translate HTTP ' + res.status);
    const data = await res.json();
    outParts.push(data[0].map(x => x[0]).join(''));
  }
  return outParts.join(' ');
}

// ---------- Utils ----------
const pad = (n, l = 2) => String(n).padStart(l, '0');
function hms(sec) { sec = Math.floor(sec); return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`; }
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.url) o.url = await ask('Lien YouTube: ');
  if (!o.lang) o.lang = (await ask('Teny transcript (mg = Malagasy, fr = Frantsay, en = Anglisy): ')).toLowerCase();
  if (!LANGS[o.lang]) { console.error('Teny tsy manan-kery. Safidio: mg, fr, en'); process.exit(1); }
  if (!(o.interval > 0)) o.interval = 5;
  const step = Math.round(o.interval * 60);

  console.log('› Mamaky ny info an\'ny video...');
  const info = JSON.parse(await run(YTDLP, [...baseYt(o), '-J', o.url]));
  const id = info.id, duration = info.duration;
  if (!duration) throw new Error('Tsy hita ny faharetan\'ny video (live?).');
  console.log(`  ${info.title} (${hms(duration)})`);

  const root = path.resolve(o.out, id);
  const imgDir = path.join(root, 'images'), txtDir = path.join(root, 'transcripts'), tmp = path.join(root, '_tmp');
  [imgDir, txtDir, tmp].forEach(d => fs.mkdirSync(d, { recursive: true }));

  // 1) Transcript
  console.log(`› Transcript (${LANGS[o.lang]})...`);
  let segs = [], note = '';
  const avail = new Set([...Object.keys(info.subtitles || {}), ...Object.keys(info.automatic_captions || {})]);
  try {
    let file = null, translateFrom = null;
    if (avail.has(o.lang)) file = await fetchSubs(o.url, o.lang, tmp, o);
    if (!file) {
      const src = pickSourceLang(info);
      if (src) {
        file = await fetchSubs(o.url, src, tmp, o);
        if (file && src.replace('-orig', '') !== o.lang) translateFrom = src.replace('-orig', '').split('-')[0];
      }
    }
    if (file) segs = parseJson3(file);
    else note = 'Tsy nahitana subtitle ny video.';
    if (segs.length && translateFrom) {
      note = `Nadika avy amin'ny teny "${translateFrom}" ho ${LANGS[o.lang]} (fandikana mandeha ho azy).`;
      segs.__from = translateFrom;
    }
  } catch (e) { note = 'Tsy azo ny transcript: ' + e.message.split('\n')[0]; }

  // 2) Bucket isaky ny interval
  const times = [];
  for (let t = 0; t < duration; t += step) times.push(t);
  const buckets = times.map(() => []);
  for (const s of segs) {
    const idx = Math.min(Math.floor(s.start / step), buckets.length - 1);
    buckets[idx].push(s.text);
  }
  let texts = buckets.map(b => b.join(' ').replace(/\s+/g, ' ').trim());
  if (segs.__from) {
    console.log('› Mandika...');
    for (let i = 0; i < texts.length; i++) {
      try { texts[i] = await translateText(texts[i], segs.__from, o.lang); }
      catch (e) { note += ` (Tsy lasa ny fandikana ny sary #${i + 1}: ${e.message})`; }
    }
  }

  // 3) Video + frames
  console.log('› Mampidina ny video...');
  const q = o.quality;
  const format = `bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`;
  await run(YTDLP, [...baseYt(o), '-f', format, '--merge-output-format', 'mp4',
    '-o', path.join(tmp, 'video.%(ext)s'), o.url], { show: true });
  const vfile = fs.readdirSync(tmp).find(n => n.startsWith('video.') && !n.endsWith('.part'));
  if (!vfile) throw new Error('Tsy hita ny video nalaina.');
  const vpath = path.join(tmp, vfile);

  console.log('› Maka ny sary...');
  const ff = ffmpegPath();
  const items = [];
  for (let i = 0; i < times.length; i++) {
    const t = Math.min(times[i], Math.max(0, duration - 1));
    const n = pad(i + 1, 3);
    const imgName = `frame_${n}_${hms(times[i]).replace(/:/g, '-')}.jpg`;
    const r = spawnSync(ff, ['-y', '-ss', String(t), '-i', vpath, '-frames:v', '1', '-q:v', '2', path.join(imgDir, imgName)], { stdio: 'ignore' });
    if (r.status !== 0) { console.warn(`  ! sary #${n} tsy lasa`); continue; }
    const txtName = `frame_${n}.txt`;
    const body = texts[i] || '(tsy misy resaka amin\'ity fizarana ity)';
    fs.writeFileSync(path.join(txtDir, txtName),
      `[${hms(times[i])} - ${hms(Math.min(times[i] + step, duration))}] (${LANGS[o.lang]})\n\n${body}\n`, 'utf8');
    items.push({ i, n, t: times[i], end: Math.min(times[i] + step, duration), imgName, txtName, text: body });
    console.log(`  ✓ ${imgName}`);
  }

  // 4) Rapport
  fs.writeFileSync(path.join(root, 'transcript_full.txt'),
    items.map(x => `=== ${hms(x.t)} - ${hms(x.end)} ===\n${x.text}\n`).join('\n'), 'utf8');
  const html = `<!doctype html><html lang="${o.lang}"><meta charset="utf-8"><title>${esc(info.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
.card{border:1px solid #ddd;border-radius:10px;padding:1rem;margin:1.2rem 0}img{max-width:100%;border-radius:6px}
h3{margin:.2rem 0 .6rem}.note{color:#a60}</style>
<h1>${esc(info.title)}</h1><p>${esc(o.url)} · ${LANGS[o.lang]}</p>${note ? `<p class="note">${esc(note)}</p>` : ''}
${items.map(x => `<div class="card"><h3>${hms(x.t)} → ${hms(x.end)}</h3><img src="images/${x.imgName}"><p>${esc(x.text)}</p></div>`).join('\n')}</html>`;
  fs.writeFileSync(path.join(root, 'report.html'), html, 'utf8');

  if (!o.keepVideo) fs.rmSync(tmp, { recursive: true, force: true });
  if (note) console.log('Fanamarihana:', note);
  console.log(`\nVita! Jereo: ${root}`);
}

main().catch(e => { console.error('Hadisoana:', e.message); process.exit(1); });
