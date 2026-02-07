// src/conversation/taskerConversationAdapter.js
import eventTypes from '../core/eventTypes.js'
import { makeStreamKey } from '../core/eventBus.js'
import { busIds } from '../app/buses.js'

/**
 * TaskerConversationAdapter posts to Tasker endpoints:
 * - POST {baseUrl}/start
 * - POST {baseUrl}/stop
 *
 * Publishes observability events to buses.tasker:
 * - tasker:req / tasker:res / tasker:err
 *
 * @example
 * const adapter = new TaskerConversationAdapter({ logger, taskerBus, config })
 * await adapter.startConversation({ requestId: 'abc', prompt: '...' })
 */
export class TaskerConversationAdapter {
  #logger
  #taskerBus
  #config

  constructor({ logger, taskerBus, config }) {
    this.#logger = logger
    this.#taskerBus = taskerBus
    this.#config = config
  }

  get streamKeyWho() { return 'taskerConversationAdapter' }

  async startConversation(payload) {
    return await this.#post('start', payload)
  }

  async stopConversation(payload) {
    return await this.#post('stop', payload)
  }

  async #post(action, payload) {
    const cfg = this.#config?.tasker || {}
    const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/g, '')
    const url = `${baseUrl}/${action}`
    const timeoutMs = Number(cfg.timeoutMs ?? 2000)

    const headers = {
      'content-type': 'application/json',
    }

    if (cfg.token?.header && cfg.token?.value) {
      headers[String(cfg.token.header)] = String(cfg.token.value)
    }

    const requestId = payload?.requestId || null
    const started = Date.now()

    this.#taskerBus.publish({
      type: eventTypes.tasker.req,
      ts: started,
      source: 'taskerClient',
      streamKey: makeStreamKey({
        who: this.streamKeyWho,
        what: eventTypes.tasker.req,
        where: busIds.tasker,
      }),
      payload: {
        direction: 'outbound',
        action,
        requestId,
        url,
        bodyPreview: this.#previewBody(payload),
      },
    })

    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      })

      const durationMs = Date.now() - started

      this.#taskerBus.publish({
        type: eventTypes.tasker.res,
        ts: Date.now(),
        source: 'taskerClient',
        streamKey: makeStreamKey({
          who: this.streamKeyWho,
          what: eventTypes.tasker.res,
          where: busIds.tasker,
        }),
        payload: {
          action,
          requestId,
          url,
          statusCode: res.status,
          durationMs,
        },
      })

      return { ok: res.ok, status: res.status }
    } catch (e) {
      const durationMs = Date.now() - started

      this.#taskerBus.publish({
        type: eventTypes.tasker.err,
        ts: Date.now(),
        source: 'taskerClient',
        streamKey: makeStreamKey({
          who: this.streamKeyWho,
          what: eventTypes.tasker.err,
          where: busIds.tasker,
        }),
        payload: {
          action,
          requestId,
          url,
          durationMs,
          error: String(e?.message || e),
        },
      })

      return { ok: false, error: String(e?.message || e) }
    } finally {
      clearTimeout(t)
    }
  }

  /* concise */
  #previewBody(payload) {
    const prompt = typeof payload?.prompt === 'string' ? payload.prompt : null
    const preview = prompt ? prompt.slice(0, 120) : null
    const promptLength = prompt ? prompt.length : 0

    return { promptLength, promptPreview: preview }
  }
}

export default TaskerConversationAdapter
