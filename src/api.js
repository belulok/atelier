// All server calls. The Mistral API key never reaches the browser - voice and AI
// go through the server only.
export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export function subscribe(onState, onEvent) {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => { try { onState(JSON.parse(e.data)); } catch {} });
  es.addEventListener('event', (e) => { try { onEvent(JSON.parse(e.data)); } catch {} });
  es.onerror = () => {};
  return () => es.close();
}

export async function uploadAudio(blob, filename = 'voice.webm') {
  const fd = new FormData();
  fd.append('file', blob, filename);
  const res = await fetch('/api/voice/stt', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
