export function getBatchClientContext(storage = localStorage) {
  return { token: storage.getItem('token'), actingUserId: storage.getItem('actingUserId') || '' };
}
export function isBatchContextCurrent(context, storage = localStorage) {
  const current = getBatchClientContext(storage);
  return current.token === context.token && current.actingUserId === context.actingUserId;
}
export function getBatchScope(storage = localStorage) {
  return `${storage.getItem('username') || ''}:${storage.getItem('actingUserId') || 'self'}`;
}
// Keep uncertain enqueue requests stable across retries and reloads. Only the API processes rows.
export function createBatchRequestStore(storage, scope, createId) {
  const storageKey = `batchBidQueueRequests:v1:${scope}`;
  let requests;
  try { requests = JSON.parse(storage.getItem(storageKey) || '{}'); } catch (_) { requests = {}; }
  if (!requests || typeof requests !== 'object' || Array.isArray(requests)) requests = {};
  const persist = () => { try { storage.setItem(storageKey, JSON.stringify(requests)); } catch (_) {} };
  return {
    get(text) {
      const key = String(text).trim();
      if (!requests[key]) { requests[key] = createId(); persist(); }
      return requests[key];
    },
    settle(text) { delete requests[String(text).trim()]; persist(); }
  };
}
export function createBatchResultPoller({ fetchResults, onResults, isCurrent }) {
  let inFlight = null;
  return async function poll() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetchResults();
        if (isCurrent()) onResults(response.data?.data || []);
      } catch (_) {
        // Retry background network failures on the next poll without interrupting the user.
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
}
