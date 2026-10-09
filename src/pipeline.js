'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LANGS = { mg: 'Malagasy', fr: 'Frantsay', en: 'Anglisy' };
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp_x86';
const YT_RE = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => reject(new Error(`Tsy mety ny "${cmd}" (${e.code || e.message}). Hamarino fa voapetraka ary ao amin'ny PATH.`)));
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} nirohotra (code ${code}): ${err.trim().split('\n').slice(-3).join(' ')}`)));
  });
}
const baseYt = () => ['--no-playlist', '--no-warnings', ...(process.env.YT_COOKIES ? ['--cookies', process.env.YT_COOKIES] : [])];
const pad = (n, l = 2) => String(n).padStart(l, '0');
const hms = s => { s = Math.floor(s); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

async function fetchSubs(url, lang, dir, tries = 5) {
  // Manandrana miaraka amin'ny sleep + backoff mba hisorohana 429
  for (let t = 1; t <= tries; t++) {
    try {
      // --sleep-requests sy --sleep-interval manampy amin'ny rate-limit
      await run(YTDLP, [
        ...baseYt(),
        '--skip-download',
        '--write-subs', '--write-auto-subs',
        '--sub-langs', lang,
        '--sub-format', 'json3',
        '--sleep-requests', '1',
        '--sleep-interval', '2',
        '--max-sleep-interval', '5',
        '-o', path.join(dir, '%(id)s.%(ext)s'),
        url
      ]);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('429') || msg.includes('Too Many Requests')) {
        const wait = 4000 * t + Math.random() * 2000;
        await sleep(wait);
        if (t === tries) throw e;
        continue;
      }
      if (t === tries) throw e;
    }
    // Mitady fichier .json3 (lang na lang-orig)
    const f = fs.readdirSync(dir).find(n =>
      n.endsWith(`.${lang}.json3`) ||
      n.endsWith(`.${lang}-orig.json3`) ||
      (n.includes(`.${lang}.`) && n.endsWith('.json3'))
    );
    if (f) return path.join(dir, f);
    await sleep(2000 * t);
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

// Fandikana fallback (endpoint Google Translate tsy ofisialy)
async function translateText(text, from, to) {
  if (!text.trim()) return '';
  const chunks = []; let cur = '';
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).length > 1500) { chunks.push(cur); cur = w; } else cur += (cur ? ' ' : '') + w;
  }
  if (cur) chunks.push(cur);
  const parts = [];
  for (const c of chunks) {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${from}&tl=${to}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'q=' + encodeURIComponent(c),
    });
    if (!res.ok) throw new Error('Translate HTTP ' + res.status);
    const data = await res.json();
    parts.push(data[0].map(x => x[0]).join(''));
  }
  return parts.join(' ');
}

/**
 * @param {{url,lang,interval,quality,root}} o  root = lahatahiry output an'ny job
 * @param {{log,info,item}} cb
 *
 * Fomba fiasa (araka ny fangatahana):
 * 1. Alaivo daholo aloha ny text transcription ny video (segs + optional translate)
 * 2. Soraty transcript_full.txt
 * 3. Zaraina amin'ny isany sary (time window) ny text
 * 4. Maka sary + manoratra frame_XXX.txt
 */
async function runPipeline(o, cb = {}) {
  const log = cb.log || (() => {});
  if (!YT_RE.test(o.url)) throw new Error('Lien YouTube tsy marina.');
  if (!LANGS[o.lang]) throw new Error('Teny tsy manan-kery (mg, fr, en).');
  const interval = o.interval > 0 ? o.interval : 5;
  const step = Math.round(interval * 60);
  const q = Math.min(Math.max(parseInt(o.quality, 10) || 480, 144), 1080);

  const imgDir = path.join(o.root, 'images'), txtDir = path.join(o.root, 'transcripts'), tmp = path.join(o.root, '_tmp');
  [imgDir, txtDir, tmp].forEach(d => fs.mkdirSync(d, { recursive: true }));

  log('Mamaky ny info an\'ny video...');
  const info = JSON.parse(await run(YTDLP, [...baseYt(), '-J', o.url]));
  if (!info.duration) throw new Error('Tsy hita ny faharetan\'ny video (live ve?).');
  const duration = info.duration;
  cb.info && cb.info({ id: info.id, title: info.title, duration, thumbnail: info.thumbnail || null });
  log(`${info.title} (${hms(duration)})`);

  // ========== 1) ALAIVO DAHOLO NY TEXT TRANSCRIPTION NY VIDEO ALOHA ==========
  log(`Maka transcript feno (${LANGS[o.lang]})...`);
  let segs = [], note = '', from = null;
  const avail = new Set([...Object.keys(info.subtitles || {}), ...Object.keys(info.automatic_captions || {})]);

  // Lisitra fanaovana andrana (target lang, avy eo source tsara indrindra, avy eo en)
  const tryLangs = [];
  if (avail.has(o.lang) || avail.has(o.lang + '-orig')) tryLangs.push(o.lang);
  const src = pickSourceLang(info);
  if (src && !tryLangs.includes(src) && !tryLangs.includes(src.replace('-orig', ''))) tryLangs.push(src);
  if (!tryLangs.includes('en') && (avail.has('en') || avail.has('en-orig') || avail.size)) tryLangs.push('en');
  // Farany: andramo ny lang voalohany na dia tsy ao amin'ny list aza
  if (!tryLangs.includes(o.lang)) tryLangs.unshift(o.lang);

  let file = null;
  let lastErr = null;
  for (const lang of tryLangs) {
    try {
      log(`Andrana subtitle: ${lang}...`);
      file = await fetchSubs(o.url, lang, tmp);
      if (file) {
        const base = lang.replace('-orig', '').split('-')[0];
        if (base !== o.lang) from = base;
        log(`Nahita subtitle: ${lang}`);
        break;
      }
    } catch (e) {
      lastErr = e;
      log(`Tsy lasa ${lang}: ${(e.message || '').slice(0, 120)}`);
      // Raha 429 dia miandry kely alohan'ny manandrana lang hafa
      if ((e.message || '').includes('429')) await sleep(5000 + Math.random() * 3000);
    }
  }

  if (file) {
    segs = parseJson3(file);
  } else {
    note = lastErr
      ? `Tsy azo ny transcript: ${lastErr.message}`
      : 'Tsy nahitana subtitle ny video; sary ihany no azo.';
    if ((lastErr && lastErr.message || '').includes('429')) {
      note += ' (Rate-limit YouTube. Andramo indray afaka 1-2 minitra, na apetraho YT_COOKIES=cookies.txt)';
    }
  }

  // Raha mila fandikana: mandika ny segment tsirairay aloha (transcript feno voalohany)
  if (from && segs.length) {
    note = `Nadika avy amin'ny teny "${from}" ho ${LANGS[o.lang]} (fandikana mandeha ho azy).`;
    log(`Mandika ny transcript feno (${segs.length} segment)...`);
    for (let i = 0; i < segs.length; i++) {
      try {
        segs[i].text = await translateText(segs[i].text, from, o.lang);
      } catch (e) {
        note += ` Tsy lasa ny fandikana segment #${i + 1}.`;
      }
      if ((i + 1) % 20 === 0) log(`  Fandikana: ${i + 1}/${segs.length}`);
    }
    log('Vita ny fandikana ny transcript feno.');
  }

  // Manoratra ny transcript feno miaraka amin'ny timestamp (ALOHAN'NY sary)
  const fullLines = segs.map(s => `[${hms(s.start)}] ${s.text}`);
  const fullTxt = fullLines.length
    ? fullLines.join('\n')
    : '(Tsy nisy transcript azo)';
  fs.writeFileSync(path.join(o.root, 'transcript_full.txt'), fullTxt, 'utf8');
  log(`Transcript feno voasoratra (${segs.length} andalana) → transcript_full.txt`);

  // ========== 2) ZARAINA AMIN'NY ISANY SARY MISY ==========
  const times = [];
  for (let t = 0; t < duration; t += step) times.push(t);

  // Manangona ny text mifanaraka amin'ny window [t, t+step)
  const texts = times.map((t) => {
    const end = Math.min(t + step, duration);
    const inWindow = segs.filter(s => s.start >= t && s.start < end);
    return inWindow.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  });

  // ========== 3) Video + sary ==========
  log('Mampidina ny video (ho an\'ny sary)...');
  const format = `bv*[height<=${q}]+ba/b[height<=${q}]/bv*+ba/b`;
  await run(YTDLP, [...baseYt(), '-f', format, '--merge-output-format', 'mp4',
    '-o', path.join(tmp, 'video.%(ext)s'), o.url]);
  const vf = fs.readdirSync(tmp).find(n => n.startsWith('video.') && !n.endsWith('.part'));
  if (!vf) throw new Error('Tsy hita ny video nalaina.');
  const vpath = path.join(tmp, vf);

  const ff = ffmpegPath(), items = [];
  for (let i = 0; i < times.length; i++) {
    const t = Math.min(times[i], Math.max(0, duration - 1));
    const n = pad(i + 1, 3);
    const imgName = `frame_${n}_${hms(times[i]).replace(/:/g, '-')}.jpg`;
    const r = spawnSync(ff, ['-y', '-ss', String(t), '-i', vpath, '-frames:v', '1', '-q:v', '2', path.join(imgDir, imgName)], { stdio: 'ignore' });
    if (r.status !== 0) { log(`! sary #${n} tsy lasa`); continue; }
    const text = texts[i] || '(tsy misy resaka amin\'ity fizarana ity)';
    const end = Math.min(times[i] + step, duration);
    fs.writeFileSync(path.join(txtDir, `frame_${n}.txt`), `[${hms(times[i])} - ${hms(end)}] (${LANGS[o.lang]})\n\n${text}\n`, 'utf8');
    const item = { n, start: times[i], end, startLabel: hms(times[i]), endLabel: hms(end), image: `images/${imgName}`, text };
    items.push(item);
    cb.item && cb.item(item);
    log(`Sary ${i + 1}/${times.length} vita`);
  }

  // Version by-scene (fanampiny)
  fs.writeFileSync(path.join(o.root, 'transcript_by_scene.txt'),
    items.map(x => `=== ${x.startLabel} - ${x.endLabel} ===\n${x.text}\n`).join('\n'), 'utf8');

  fs.writeFileSync(path.join(o.root, 'meta.json'), JSON.stringify({
    url: o.url, lang: o.lang, interval,
    info: { id: info.id, title: info.title, duration },
    note, items,
    transcriptSegments: segs.length
  }, null, 2));

  fs.rmSync(tmp, { recursive: true, force: true });
  return { info, items, note };
}

module.exports = { runPipeline, LANGS, YT_RE };
