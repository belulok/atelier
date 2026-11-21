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

// Voxtral STT. The server reads the raw request body as the audio file, so send the
// blob itself (not multipart form data) with its own content type.
export async function uploadAudio(blob) {
  const res = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
  if (!res.ok) {
    const err = new Error((await res.text()) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
