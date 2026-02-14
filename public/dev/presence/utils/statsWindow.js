// public/dev/presence/utils/statsWindow.js
export default class StatsWindow {
  #maxN
  #values = []

  constructor({ maxN }) {
    this.#maxN = Number.isFinite(Number(maxN)) ? Number(maxN) : 200
  }

  push(value) {
    const v = Number(value)
    if (!Number.isFinite(v)) return

    this.#values.push(v)

    if (this.#values.length > this.#maxN) {
      this.#values.splice(0, this.#values.length - this.#maxN)
    }
  }

  max() {
    if (!this.#values.length) return null
    let m = this.#values[0]
    for (const v of this.#values) {
      if (v > m) m = v
    }
    return m
  }

  median() {
    if (!this.#values.length) return null
    const sorted = [...this.#values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) return sorted[mid]
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
}
