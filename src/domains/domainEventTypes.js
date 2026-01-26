// src/domains/domainEventTypes.js
export const domainEventTypes = Object.freeze({
  presence: Object.freeze({
    binary: 'presenceRaw:binary',
    targets: 'presenceRaw:targets',
    ld2450: 'presenceRaw:ld2450',
    ld2410: 'presenceRaw:ld2410',
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

export default domainEventTypes
