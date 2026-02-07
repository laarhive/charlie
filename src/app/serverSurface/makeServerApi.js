// src/app/serverSurface/makeServerApi.js
import eventTypes from '../../core/eventTypes.js'
import { makeStreamKey } from '../../core/eventBus.js'
import { busIds } from '../buses.js'

export const makeServerApi = function makeServerApi({
                                                      buses,
                                                      config,
                                                      deviceManager,
                                                      core,
                                                      clock,
                                                      mode,
                                                      recordingService,
                                                    }) {
  const getConfig = () => {
    return config || {}
  }

  const taskerSimStart = (body) => {
    buses.tasker.publish({
      type: eventTypes.tasker.req,
      ts: Date.now(),
      source: 'taskerSimServer',
      streamKey: makeStreamKey({
        who: 'taskerSimServer',
        what: eventTypes.tasker.req,
        where: busIds.tasker,
      }),
      payload: { direction: 'inbound', action: 'start', body },
    })
  }

  const taskerSimStop = (body) => {
    buses.tasker.publish({
      type: eventTypes.tasker.req,
      ts: Date.now(),
      source: 'taskerSimServer',
      streamKey: makeStreamKey({
        who: 'taskerSimServer',
        what: eventTypes.tasker.req,
        where: busIds.tasker,
      }),
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
      streamKey: makeStreamKey({
        who: 'makeServerApi.testHook',
        what: event?.type || 'makeServerApi.testHook.event',
        where: busName,
      }),
      payload: event?.payload ?? {},
    }

    if (!normalized.type) {
      const err = new Error('MISSING_TYPE')
      err.code = 'MISSING_TYPE'
      throw err
    }

    target.publish(normalized)
  }

  const recording = async (body) => {
    if (!recordingService?.handle) {
      const err = new Error('RECORDING_SERVICE_MISSING')
      err.code = 'INTERNAL_ERROR'
      throw err
    }

    return await recordingService.handle({
      op: body?.op,
      params: body?.params,
    })
  }

  return {
    getConfig,
    taskerSimStart,
    taskerSimStop,
    testPublish,
    recording,
  }
}

export default makeServerApi
