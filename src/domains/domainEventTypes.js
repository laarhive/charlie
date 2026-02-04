// src/domains/domainEventTypes.js
export const domainEventTypes = Object.freeze({
  presence: Object.freeze({
    // raw
    binary: 'presenceRaw:binary',
    targets: 'presenceRaw:targets',
    ld2450: 'presenceRaw:ld2450',
    ld2410: 'presenceRaw:ld2410',

    // derived/internal (presenceInternal bus)
    ld2450Tracks: 'presence:ld2450Tracks',
    ld2410Stable: 'presence:ld2410Stable',
    calibrationStatus: 'presence:calibrationStatus',
  }),

  vibration: Object.freeze({
    hit: 'vibrationRaw:hit',
    sample: 'vibrationRaw:sample',
  }),

  button: Object.freeze({
    edge: 'buttonRaw:edge',
    level: 'buttonRaw:level',
  }),

  led: Object.freeze({
    command: 'ledRaw:command',
  }),
})

export default domainEventTypes
