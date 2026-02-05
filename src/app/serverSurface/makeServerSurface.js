// src/app/serverSurface/makeServerSurface.js
import BusStream from '../../transport/ws/busStream.js'
import makeServerApi from './makeServerApi.js'

export const makeServerSurface = function makeServerSurface({
                                                              logger,
                                                              buses,
                                                              config,
                                                              deviceManager,
                                                              core,
                                                              clock,
                                                              mode,
                                                            }) {
  const api = makeServerApi({ buses, config, deviceManager, core, clock, mode })
  const streamHub = new BusStream({ logger, buses })

  const dispose = () => {
    try {
      streamHub.dispose()
    } catch (e) {
      // ignore
    }
  }

  return {
    api,
    streamHub,
    dispose,
  }
}

export default makeServerSurface
