// public/bus/bus.js
;(() => {
  const statusEl = document.getElementById('status')
  const logEl = document.getElementById('log')
  const connectBtn = document.getElementById('connectBtn')
  const clearBtn = document.getElementById('clearBtn')

  const busCks = Array.from(document.querySelectorAll('.busCk'))
  const timeWindowEl = document.getElementById('timeWindow')
  const textFilterEl = document.getElementById('textFilter')
  const maxLinesEl = document.getElementById('maxLines')

  let ws = null
  let closedByUser = true
  let attempt = 0
  let reconnectTimer = null
  let currentUrl = null

  let entries = []

  const nowMs = () => Date.now()

  const setStatus = (text) => {
    statusEl.textContent = text
  }

  const setConnectedUi = ({ connected }) => {
    connectBtn.textContent = connected ? 'Disconnect' : 'Connect'
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const backoffMs = () => {
    const min = 250
    const max = 10_000
    const exp = Math.min(max, min * Math.pow(2, attempt))
    const jitter = exp * 0.25 * (Math.random() * 2 - 1)
    return Math.max(min, Math.floor(exp + jitter))
  }

  const scheduleReconnect = () => {
    if (closedByUser) {
      return
    }

    if (!currentUrl) {
      return
    }

    clearReconnectTimer()
    const ms = backoffMs()
    setStatus(`reconnecting in ${ms}ms`)

    reconnectTimer = setTimeout(() => {
      attempt += 1
      openWs(currentUrl)
    }, ms)
  }

  const getSelectedBuses = () => {
    return busCks
      .filter((ck) => ck.checked)
      .map((ck) => ck.value)
  }

  const computeWsUrl = () => {
    const buses = getSelectedBuses()
    if (!buses.length) {
      return null
    }

    const isHttps = location.protocol === 'https:'
    const wsProto = isHttps ? 'wss:' : 'ws:'
    const base = `${wsProto}//${location.host}/ws`

    const qs = buses.map((b) => encodeURIComponent(b)).join('&')
    return `${base}?${qs}`
  }

  const getTimeWindowMs = () => {
    const seconds = Number(timeWindowEl.value || 0)
    if (!seconds) {
      return 0
    }

    return seconds * 1000
  }

  const getMaxLines = () => {
    const n = Number(maxLinesEl.value || 500)
    return Number.isFinite(n) && n > 0 ? n : 500
  }

  const normalizeFilterText = () => {
    return (textFilterEl.value || '').trim().toLowerCase()
  }

  const entryMatchesFilters = (entry) => {
    const windowMs = getTimeWindowMs()
    if (windowMs) {
      const minTs = nowMs() - windowMs
      if (entry.ts < minTs) {
        return false
      }
    }

    const ft = normalizeFilterText()
    if (!ft) {
      return true
    }

    return entry.searchText.includes(ft)
  }

  const render = () => {
    const maxLines = getMaxLines()

    const visible = []
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]
      if (entryMatchesFilters(e)) {
        visible.push(e.line)
        if (visible.length >= maxLines) {
          break
        }
      }
    }

    visible.reverse()
    logEl.textContent = visible.join('\n') + (visible.length ? '\n' : '')
    logEl.scrollTop = logEl.scrollHeight
  }

  const pushLine = ({ ts, line, searchText }) => {
    entries.push({ ts, line, searchText })

    const hardCap = Math.max(5000, getMaxLines() * 10)
    if (entries.length > hardCap) {
      entries = entries.slice(entries.length - hardCap)
    }

    render()
  }

  const safeCloseWs = () => {
    if (!ws) {
      return
    }

    const socket = ws
    ws = null

    try {
      socket.close()
    } catch (e) {
      // ignore
    }
  }

  const openWs = (url) => {
    if (!url) {
      return
    }

    currentUrl = url
    closedByUser = false
    clearReconnectTimer()

    safeCloseWs()

    setStatus('connecting')
    setConnectedUi({ connected: false })

    pushLine({
      ts: nowMs(),
      line: `[client] connect ${url}`,
      searchText: `[client] connect ${url}`.toLowerCase(),
    })

    const socket = new WebSocket(url)
    ws = socket

    socket.addEventListener('open', () => {
      if (ws !== socket) {
        return
      }

      attempt = 0
      setStatus('connected')
      setConnectedUi({ connected: true })

      pushLine({
        ts: nowMs(),
        line: '[client] connected',
        searchText: '[client] connected',
      })
    })

    socket.addEventListener('close', () => {
      if (ws !== socket) {
        return
      }

      ws = null
      setStatus('disconnected')
      setConnectedUi({ connected: false })

      pushLine({
        ts: nowMs(),
        line: closedByUser ? '[client] disconnected (manual)' : '[client] disconnected',
        searchText: closedByUser ? '[client] disconnected (manual)' : '[client] disconnected',
      })

      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      if (ws !== socket) {
        return
      }

      pushLine({
        ts: nowMs(),
        line: '[client] ws error',
        searchText: '[client] ws error',
      })
    })

    socket.addEventListener('message', (ev) => {
      if (ws !== socket) {
        return
      }

      let msg = null
      try {
        msg = JSON.parse(ev.data)
      } catch (e) {
        return
      }

      if (msg.type === 'ws:welcome') {
        const line = `[server] welcome ${JSON.stringify(msg.payload)}`
        pushLine({ ts: nowMs(), line, searchText: line.toLowerCase() })
        return
      }

      if (msg.type === 'bus.event') {
        const { bus, event } = msg.payload || {}
        const eventTs = Number(event?.ts)
        const ts = Number.isFinite(eventTs) ? eventTs : nowMs()

        const payloadStr = JSON.stringify(event?.payload || {})
        const typeStr = event?.type || ''
        const sourceStr = event?.source || ''

        const line = `[${bus}] ${typeStr} ${event?.ts || ''} ${sourceStr} ${payloadStr}`
        const searchText = `${bus} ${typeStr} ${sourceStr} ${payloadStr}`.toLowerCase()

        pushLine({ ts, line, searchText })
        return
      }

      const line = `[server] ${JSON.stringify(msg)}`
      pushLine({ ts: nowMs(), line, searchText: line.toLowerCase() })
    })
  }

  const disconnect = ({ manual, reason }) => {
    closedByUser = Boolean(manual)
    clearReconnectTimer()

    safeCloseWs()

    setStatus('disconnected')
    setConnectedUi({ connected: false })

    if (manual) {
      pushLine({
        ts: nowMs(),
        line: '[client] manual disconnect',
        searchText: '[client] manual disconnect',
      })
      return
    }

    if (reason) {
      const line = `[client] disconnected (${reason})`
      pushLine({
        ts: nowMs(),
        line,
        searchText: line.toLowerCase(),
      })
    }
  }

  const connect = () => {
    const url = computeWsUrl()
    if (!url) {
      disconnect({ manual: false, reason: 'no buses selected' })
      return
    }

    openWs(url)
  }

  connectBtn.addEventListener('click', () => {
    if (ws) {
      disconnect({ manual: true })
      return
    }

    connect()
  })

  clearBtn.addEventListener('click', () => {
    entries = []
    logEl.textContent = ''
  })

  busCks.forEach((ck) => {
    ck.addEventListener('change', () => {
      // manual disconnect (or never connected) => checkbox changes do nothing
      if (closedByUser) {
        return
      }

      const url = computeWsUrl()
      if (!url) {
        disconnect({ manual: false, reason: 'no buses selected' })
        return
      }

      openWs(url)
    })
  })

  timeWindowEl.addEventListener('change', () => render())
  maxLinesEl.addEventListener('change', () => render())
  textFilterEl.addEventListener('input', () => render())

  setStatus('disconnected')
  setConnectedUi({ connected: false })
})()
