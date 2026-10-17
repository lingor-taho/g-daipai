// Submit and explicit admin deletion share the same per-product boundary.
const locks = new Map();
async function withProductSubmissionLock(productId, action) {
  const previous = locks.get(productId) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(productId, tail);
  await previous;
  try { return await action(); } finally {
    release();
    if (locks.get(productId) === tail) locks.delete(productId);
  }
}
module.exports = { withProductSubmissionLock };
