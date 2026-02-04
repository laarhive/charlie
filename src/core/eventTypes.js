// src/core/eventTypes.js
export const eventTypes = Object.freeze({
  presence: Object.freeze({
    targets: 'presence:targets',
    enter: 'presence:enter',
    exit: 'presence:exit',
  }),

  vibration: Object.freeze({
    hit: 'vibration:hit',
  }),

  button: Object.freeze({
    press: 'button:press',
  }),

  tasker: Object.freeze({
    req: 'tasker:req',
    res: 'tasker:res',
    err: 'tasker:err',
  }),

  time: Object.freeze({
    armingExpired: 'time:armingExpired',
    exitConfirmExpired: 'time:exitConfirmExpired',
    cooldownExpired: 'time:cooldownExpired',
  }),

  conversation: Object.freeze({
    started: 'conv:started',
    ended: 'conv:ended',
    turn: 'conv:turn',
    idle: 'conv:idle',
  }),

  system: Object.freeze({
    // Hardware / system health events (GPIO, disk, temp, network, etc.)
    hardware: 'system:hardware',
  }),
})

export default eventTypes
