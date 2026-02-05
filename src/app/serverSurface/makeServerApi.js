// src/app/serverSurface/makeServerApi.js
import eventTypes from '../../core/eventTypes.js'

export const makeServerApi = function makeServerApi({ buses, config, deviceManager, core, clock, mode }) {
  const getConfig = () => {
    return config || {}
  }

  const taskerSimStart = (body) => {
    buses.tasker.publish({
      type: eventTypes.tasker.req,
      ts: Date.now(),
      source: 'taskerSimServer',
      payload: { direction: 'inbound', action: 'start', body },
    })
  }

  const taskerSimStop = (body) => {
    buses.tasker.publish({
      type: eventTypes.tasker.req,
      ts: Date.now(),
      source: 'taskerSimServer',
      payload: { direction: 'inbound', action: 'stop', body },
    })
  }

  const testPublish = ({ bus, event }) => {
    const busName = String(bus || '').trim()
    const target = buses?.[busName]

    if (!busName || !target || typeof target.publish !== 'function') {
      const err = new Error('BUS_NOT_FOUND')
      err.code = 'BUS_NOT_FOUND'
      throw err
    }

    if (!event || typeof event !== 'object') {
      const err = new Error('BAD_EVENT')
      err.code = 'BAD_EVENT'
      throw err
    }

    const normalized = {
      type: event?.type,
      ts: typeof event?.ts === 'number' ? event.ts : Date.now(),
      source: event?.source || 'testHook',
      payload: event?.payload ?? {},
    }

    if (!normalized.type) {
      const err = new Error('MISSING_TYPE')
      err.code = 'MISSING_TYPE'
      throw err
    }

    target.publish(normalized)
  }

  return {
    getConfig,
    taskerSimStart,
    taskerSimStop,
    testPublish,
  }
}

export default makeServerApi
