// Tiny in-process event bus: server modules emit, the SSE endpoint in index.js fans out.
const listeners = new Set();
export function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(type, data) { for (const fn of listeners) { try { fn(type, data); } catch (e) { console.error('listener', e); } } }
