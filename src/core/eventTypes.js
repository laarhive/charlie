// src/core/eventTypes.js
export const eventTypes = Object.freeze({
  presence: Object.freeze({
    enter: 'presence:enter',
    exit: 'presence:exit',
  }),

  vibration: Object.freeze({
    hit: 'vibration:hit',
  }),

  button: Object.freeze({
    press: 'button:press',
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
})

export default eventTypes
