// Mimics the old window.storage API on top of localStorage, so the
// component keeps the same call shape and the same keys:
// pulse-watchlist, pulse-last-scan, pulse-diamonds, pulse-finnhub-key.
export const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
};
