export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const USER_ACTIVE_EVENT = 'g-daipai-user-active';

let lastActivityAt = Date.now();
let listenersInstalled = false;

export function isUserIdle(now = Date.now()) {
  return now - lastActivityAt >= IDLE_TIMEOUT_MS;
}

export function markUserActive(now = Date.now()) {
  const wasIdle = isUserIdle(now);
  lastActivityAt = now;
  if (wasIdle) {
    window.dispatchEvent(new CustomEvent(USER_ACTIVE_EVENT));
  }
}

export function installUserActivityListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  const options = { passive: true };
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown', 'focus'].forEach(eventName => {
    window.addEventListener(eventName, () => markUserActive(), options);
  });
}
