// src/transport/serveStaticFiles.js
import path from 'node:path'
import fs from 'node:fs'
import mime from 'mime-types'

export const serveStaticFiles = (res, req, { publicRoot, log, me }) => {
  const url = req.getUrl()

  let aborted = false
  res.onAborted(() => {
    aborted = true
  })

  const endText = (status, text, extraHeaders = null) => {
    if (aborted) {
      return
    }

    res.cork(() => {
      res.writeStatus(`${status}`)
      res.writeHeader('content-type', 'text/plain; charset=utf-8')

      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.writeHeader(k, v)
        }
      }

      res.end(text)
    })
  }

  const serveBuf = (status, filePath, content) => {
    if (aborted) {
      return
    }

    const mimeType = mime.lookup(filePath) || 'application/octet-stream'

    res.cork(() => {
      res.writeStatus(`${status}`)
      res.writeHeader('content-type', mimeType)
      res.end(content)
    })
  }

  const safeResolve = (root, urlPath) => {
    const rootResolved = path.resolve(root) + path.sep
    const resolved = path.resolve(root, '.' + urlPath)

    if (!resolved.startsWith(rootResolved)) {
      return null
    }

    return resolved
  }

  let filePath = null

  if (path.extname(url) === '') {
    const indexPath = safeResolve(publicRoot, path.join(url, 'index.html'))
    if (!indexPath) {
      endText(403, '403')
      return
    }

    if (fs.existsSync(indexPath) && url.at(-1) !== '/') {
      log?.notice?.('web_static_301', { me, url })
      endText(301, '', { location: `${url}/` })
      return
    }

    filePath = indexPath
  } else {
    const resolved = safeResolve(publicRoot, url)
    if (!resolved) {
      endText(403, '403')
      return
    }

    filePath = resolved
  }

  try {
    const content = fs.readFileSync(filePath)
    log?.notice?.('web_static_200', { me, url, filePath })
    serveBuf(200, filePath, content)
  } catch (e) {
    log?.notice?.('web_static_404', { me, url })
    endText(404, '404: File not found')
  }
}

export default serveStaticFiles
