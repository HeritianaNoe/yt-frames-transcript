const $ = id => document.getElementById(id);
let timer = null, rendered = 0;

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  clearInterval(timer);
  $('go').disabled = true;
  $('result').hidden = true; $('items').innerHTML = ''; rendered = 0;
  $('status').hidden = false; $('spinner').className = '';
  $('state').textContent = 'Mandefa...'; $('state').className = ''; $('log').textContent = '';
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: $('url').value.trim(), lang: $('lang').value,
        interval: parseFloat($('interval').value), quality: $('quality').value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Hadisoana');
    poll(j.id);
    timer = setInterval(() => poll(j.id), 1500);
  } catch (err) { fail(err.message); }
});

function fail(msg) {
  clearInterval(timer);
  $('state').textContent = 'Hadisoana: ' + msg; $('state').className = 'err';
  $('spinner').className = 'stop'; $('go').disabled = false;
}

async function poll(id) {
  try {
    const job = await (await fetch('/api/jobs/' + id)).json();
    $('log').textContent = job.logs.join('\n');
    $('log').scrollTop = 1e9;
    $('state').textContent = { queued: 'Miandry filaharana...', running: 'Eo am-pikarakarana...', done: 'Vita!', error: 'Hadisoana' }[job.status];
    if (job.info) { $('title').textContent = job.info.title; $('result').hidden = false; }
    job.items.slice(rendered).forEach(addItem); rendered = job.items.length;
    if (job.status === 'done') {
      clearInterval(timer); $('go').disabled = false; $('spinner').className = 'stop';
      $('note').textContent = job.note || '';
      $('zip').href = `/api/jobs/${id}/zip`; $('zip').hidden = false;
      $('pdf').href = `/api/jobs/${id}/pdf`; $('pdf').hidden = false;
    } else if (job.status === 'error') fail(job.error);
    if (job.status !== 'done') { $('zip').hidden = true; $('pdf').hidden = true; }
  } catch (e) { /* mbola miandry */ }
}

function addItem(it) {
  const c = document.createElement('div'); c.className = 'card';
  const h = document.createElement('h3'); h.textContent = `${it.startLabel} → ${it.endLabel}`;
  const img = document.createElement('img'); img.src = it.imageUrl || it.image; img.loading = 'lazy';
  const p = document.createElement('p'); p.textContent = it.text;
  const b = document.createElement('button'); b.textContent = 'Adikao ny soratra';
  b.onclick = async () => { await navigator.clipboard.writeText(it.text); b.textContent = 'Voadika ✓'; setTimeout(() => (b.textContent = 'Adikao ny soratra'), 1500); };
  c.append(h, img, p, b); $('items').append(c);
}
