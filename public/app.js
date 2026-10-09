const $ = id => document.getElementById(id);
let timer = null;

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  clearInterval(timer);
  $('go').disabled = true;
  $('result').hidden = true;
  $('status').hidden = false;
  $('spinner').className = '';
  $('state').textContent = 'Mandefa...';
  $('state').className = '';
  $('log').textContent = '';
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: $('url').value.trim(),
        lang: $('lang').value,
        interval: parseFloat($('interval').value),
        quality: $('quality').value,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Hadisoana');
    poll(j.id);
    timer = setInterval(() => poll(j.id), 1500);
  } catch (err) {
    fail(err.message);
  }
});

function fail(msg) {
  clearInterval(timer);
  $('state').textContent = 'Hadisoana: ' + msg;
  $('state').className = 'err';
  $('spinner').className = 'stop';
  $('go').disabled = false;
  $('result').hidden = true;
}

async function poll(id) {
  try {
    const job = await (await fetch('/api/jobs/' + id)).json();
    $('log').textContent = job.logs.join('\n');
    $('log').scrollTop = 1e9;
    $('state').textContent = {
      queued: 'Miandry filaharana...',
      running: 'Eo am-pikarakarana...',
      done: 'Vita!',
      error: 'Hadisoana',
    }[job.status] || job.status;

    if (job.status === 'done') {
      clearInterval(timer);
      $('go').disabled = false;
      $('spinner').className = 'stop';
      $('pdf').href = `/api/jobs/${id}/pdf`;
      $('zip').href = `/api/jobs/${id}/zip`;
      $('result').hidden = false;
    } else if (job.status === 'error') {
      fail(job.error);
    } else {
      $('result').hidden = true;
    }
  } catch (e) {
    /* mbola miandry */
  }
}
