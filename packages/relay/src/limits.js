/** Tiny in-memory sliding-window rate limiter. */

export class RateLimiter {
  /**
   * @param {{ enabled?: boolean, now?: () => number }} [options]
   */
  constructor(options = {}) {
    this.enabled = options.enabled ?? true
    this.now = options.now ?? Date.now
    /** @type {Map<string, { startedAt: number, count: number }>} */
    this.windows = new Map()
    this.sweep = setInterval(() => this.#sweep(), 60_000)
    this.sweep.unref?.()
  }

  /**
   * @param {string} key
   * @param {number} limit
   * @param {number} windowMs
   */
  allow(key, limit, windowMs) {
    if (!this.enabled) return true
    const now = this.now()
    const current = this.windows.get(key)
    if (current === undefined || now - current.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 })
      return true
    }
    if (current.count >= limit) return false
    current.count += 1
    return true
  }

  #sweep() {
    const now = this.now()
    for (const [key, window] of this.windows) {
      if (now - window.startedAt > 10 * 60_000) this.windows.delete(key)
    }
  }

  close() {
    clearInterval(this.sweep)
    this.windows.clear()
  }
}
