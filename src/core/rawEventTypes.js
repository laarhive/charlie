// src/core/rawEventTypes.js
export const rawEventTypes = Object.freeze({
  presence: Object.freeze({
    binary: 'presenceRaw:binary',
    targets: 'presenceRaw:targets',
  }),

  vibration: Object.freeze({
    hit: 'vibrationRaw:hit',
    sample: 'vibrationRaw:sample',
  }),

  button: Object.freeze({
    edge: 'buttonRaw:edge',
    level: 'buttonRaw:level',
  }),
})

export default rawEventTypes
