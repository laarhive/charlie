// src/transport/http/httpIo.js
export const makeHttpIo = function makeHttpIo() {
  const json = (res, status, obj) => {
    const body = JSON.stringify(obj, null, 2)

    res.writeStatus(`${status}`)
    res.writeHeader('content-type', 'application/json; charset=utf-8')
    res.end(body)
  }

  const readJsonBody = (res, onDone) => {
    let buf = ''
    let aborted = false

    res.onAborted(() => {
      aborted = true
    })

    res.onData((ab, isLast) => {
      if (aborted) {
        return
      }

      buf += Buffer.from(ab).toString('utf8')

      if (!isLast) {
        return
      }

      let parsed = null

      try {
        parsed = buf ? JSON.parse(buf) : {}
      } catch (e) {
        json(res, 400, { ok: false, error: 'invalid_json' })
        return
      }

      onDone(parsed)
    })
  }

  return { json, readJsonBody }
}

export default makeHttpIo
