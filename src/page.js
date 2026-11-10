/** Single-file page: record in the browser (phone or desktop), upload a file or paste text. */
export const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voice Note to Tasks</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --ink:#18202b; --muted:#5f6b7a; --line:#e2e6eb; --accent:#2557d6; --high:#c62828; --med:#b7791f; --low:#6b7785; }
  @media (prefers-color-scheme: dark) { :root { --bg:#11151b; --card:#1a2029; --ink:#e8edf3; --muted:#9aa6b4; --line:#2a323d; --accent:#6f9bff; --high:#ff6b6b; --med:#f0b44c; --low:#8d99a8; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:820px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:22px; margin:0 0 4px; } .sub { color:var(--muted); margin:0 0 20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  button, .btn { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:10px 16px; font:inherit; cursor:pointer; }
  button.secondary { background:transparent; color:var(--accent); border:1px solid var(--line); }
  button:disabled { opacity:.5; cursor:default; }
  #rec.on { background:var(--high); }
  textarea, input[type=text], input[type=date], input[type=password] { width:100%; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:9px; font:inherit; }
  textarea { min-height:90px; }
  label { font-size:13px; color:var(--muted); display:block; margin:10px 0 4px; }
  .status { color:var(--muted); margin-top:10px; min-height:1.5em; }
  .task { border-top:1px solid var(--line); padding:10px 0; display:flex; gap:10px; }
  .task:first-child { border-top:0; }
  .pill { font-size:11px; font-weight:700; border-radius:999px; padding:2px 8px; border:1px solid currentColor; height:fit-content; white-space:nowrap; }
  .high { color:var(--high); } .medium { color:var(--med); } .low { color:var(--low); }
  .meta { color:var(--muted); font-size:13px; } .quote { color:var(--muted); font-size:13px; font-style:italic; }
  h2 { font-size:16px; margin:16px 0 6px; } ul { margin:4px 0; padding-left:20px; }
  pre { white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; }
  code { font-size:12px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Voice note → task list</h1>
  <p class="sub">Record or upload a voice note. You get a summary, every action item with owner, due date and priority, and messages ready to send to each person.</p>

  <div class="card">
    <div class="row">
      <button id="rec">● Record</button>
      <span id="timer" class="meta"></span>
      <label class="btn secondary" style="margin:0;color:var(--accent);border:1px solid var(--line);background:transparent">Upload file<input id="file" type="file" accept="audio/*,video/*,.txt,.vtt,.srt,.json,.md" hidden></label>
    </div>
    <label for="text">…or paste a transcript / dictated text</label>
    <textarea id="text" placeholder="Okay, quick brain dump. Sarah, I need the proposal by Thursday..."></textarea>
    <div class="row" style="margin-top:10px">
      <div style="flex:1;min-width:150px"><label for="date">Recorded on</label><input id="date" type="date"></div>
      <div style="flex:1;min-width:150px"><label for="token">API token (if set)</label><input id="token" type="password" autocomplete="off"></div>
    </div>
    <div class="row" style="margin-top:12px"><button id="go">Extract tasks</button></div>
    <div id="status" class="status"></div>
  </div>
  <div id="out"></div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
$('date').value = new Date().toLocaleDateString('en-CA');
try { $('token').value = localStorage.getItem('vt-token') || ''; } catch {}
let blob = null, rec = null, chunks = [], t0 = 0, tick = null;

$('rec').onclick = async () => {
  if (rec && rec.state === 'recording') { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); clearInterval(tick); blob = new Blob(chunks, { type: rec.mimeType }); $('rec').classList.remove('on'); $('rec').textContent = '● Record again'; $('status').textContent = 'Recording ready (' + Math.round(blob.size/1024) + ' KB). Press "Extract tasks".'; };
    rec.start(1000); t0 = Date.now(); $('rec').classList.add('on'); $('rec').textContent = '■ Stop';
    tick = setInterval(() => { const s = Math.floor((Date.now()-t0)/1000); $('timer').textContent = Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }, 500);
  } catch (e) { $('status').textContent = 'Microphone not available: ' + e.message; }
};
$('file').onchange = () => { blob = null; if ($('file').files[0]) $('status').textContent = 'Selected ' + $('file').files[0].name; };

$('go').onclick = async () => {
  const token = $('token').value.trim();
  try { localStorage.setItem('vt-token', token); } catch {}
  const headers = token ? { authorization: 'Bearer ' + token } : {};
  let body;
  const f = $('file').files[0];
  if (blob || f) {
    body = new FormData();
    if (blob) body.append('file', blob, 'browser-recording' + (blob.type.includes('mp4') ? '.m4a' : blob.type.includes('ogg') ? '.ogg' : '.webm'));
    else body.append('file', f, f.name);
    body.append('date', $('date').value);
  } else if ($('text').value.trim()) {
    body = JSON.stringify({ text: $('text').value, date: $('date').value });
    headers['content-type'] = 'application/json';
  } else { $('status').textContent = 'Record, upload or paste something first.'; return; }
  $('go').disabled = true; $('status').textContent = 'Transcribing and extracting tasks… (long notes take up to a minute)';
  try {
    const res = await fetch('/api/notes', { method: 'POST', headers, body });
    const data = await res.json();
    if (res.status === 202) { $('status').textContent = data.message; return; }
    if (!res.ok) throw new Error(data.error || res.statusText);
    $('status').textContent = 'Done: ' + data.stats.tasks + ' tasks (' + data.analysis_engine + ').';
    render(data);
  } catch (e) { $('status').textContent = 'Error: ' + e.message; }
  finally { $('go').disabled = false; }
};

function render(n) {
  const groups = [['Your tasks', n.tasks.filter((t) => t.owner_type === 'self')]];
  for (const o of [...new Set(n.tasks.filter((t) => t.owner_type === 'delegate').map((t) => t.owner))]) groups.push(['Delegated to ' + o, n.tasks.filter((t) => t.owner_type === 'delegate' && t.owner === o)]);
  groups.push(['Team', n.tasks.filter((t) => t.owner_type === 'team')], ['Unassigned', n.tasks.filter((t) => t.owner_type === 'unassigned')]);
  const list = (title, arr, f) => arr && arr.length ? '<h2>' + title + '</h2><ul>' + arr.map((x) => '<li>' + esc(f ? f(x) : x) + '</li>').join('') + '</ul>' : '';
  $('out').innerHTML = '<div class="card"><h1>' + esc(n.title) + '</h1>' + (n.warnings || []).map((w) => '<p class="meta">⚠ ' + esc(w) + '</p>').join('') + '<p>' + esc(n.summary) + '</p></div>' +
    groups.filter((g) => g[1].length).map(([label, tasks]) => '<div class="card"><h2 style="margin-top:0">' + esc(label) + '</h2>' + tasks.map((t) =>
      '<div class="task"><span class="pill ' + t.priority + '">' + t.priority.toUpperCase() + '</span><div><b>' + esc(t.title) + '</b> <code>' + t.id + '</code><div class="meta">' +
      [t.due_date ? 'due ' + t.due_date + (t.due_phrase ? ' (“' + esc(t.due_phrase) + '”)' : '') : '', t.category.replace(/_/g, ' '), t.timestamp ? 'at ' + t.timestamp : ''].filter(Boolean).join(' · ') + '</div>' +
      (t.details ? '<div>' + esc(t.details) + '</div>' : '') + (t.source_quote ? '<div class="quote">“' + esc(t.source_quote) + '”</div>' : '') + '</div></div>').join('') + '</div>').join('') +
    '<div class="card">' + list('Decisions', n.decisions, (d) => d.decision) + list('Open questions', n.open_questions) + list('Risks', n.risks) + list('Ideas', n.ideas) +
    (n.delegations.length ? '<h2>Ready-to-send messages</h2>' + n.delegations.map((d) => '<p><b>To ' + esc(d.owner) + '</b></p><pre>' + esc(d.message) + '</pre>').join('') : '') + '</div>';
}
</script>
</body>
</html>`;
