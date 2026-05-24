export const DEFAULT_DEDUPE_WINDOW_MS = 1000;

export function createDedupedRunner({
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms)
} = {}) {
  const entries = new Map();

  return function runDeduped(key, fn, windowMs = DEFAULT_DEDUPE_WINDOW_MS) {
    const current = entries.get(key);
    if (current && now() - current.startedAt < windowMs) {
      return current.promise;
    }

    const startedAt = now();
    const promise = Promise.resolve().then(fn);
    const entry = { startedAt, promise };
    entries.set(key, entry);

    schedule(() => {
      if (entries.get(key) === entry) entries.delete(key);
    }, windowMs);

    return promise;
  };
}

export const runDeduped = createDedupedRunner();
