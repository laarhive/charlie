// src/cli/cliCompleter.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../..')
const configDir = path.resolve(projectRoot, 'config')

const splitTokens = function splitTokens(line) {
  const endsWithSpace = /\s$/.test(line)
  const tokens = line.trim().length ? line.trim().split(/\s+/g) : []

  if (endsWithSpace) {
    tokens.push('')
  }

  return tokens
}

const uniq = function uniq(list) {
  return Array.from(new Set(list))
}

const filterPrefix = function filterPrefix(options, prefix) {
  const p = String(prefix || '')
  return options.filter((o) => o.startsWith(p))
}

const listConfigFiles = function listConfigFiles(prefix) {
  try {
    const files = fs.readdirSync(configDir)
      .filter((f) => f.endsWith('.json') || f.endsWith('.json5'))

    return filterPrefix(files, prefix)
  } catch {
    return []
  }
}

const listDeviceIds = function listDeviceIds(getContext, prefix) {
  try {
    const ctx = getContext()
    const devices = Array.isArray(ctx?.config?.devices) ? ctx.config.devices : []
    const ids = devices.map((d) => d?.id).filter(Boolean)

    return filterPrefix(uniq(ids), prefix)
  } catch {
    return []
  }
}

const listBuses = function listBuses(getContext, prefix) {
  try {
    const ctx = getContext()
    const keys = ctx?.buses ? Object.keys(ctx.buses) : []
    const buses = uniq([...keys, 'all'])

    return filterPrefix(buses, prefix)
  } catch {
    return filterPrefix(['all'], prefix)
  }
}

const listZones = function listZones(getContext, prefix) {
  try {
    const ctx = getContext()

    const zoneKeys = ctx?.config?.zones ? Object.keys(ctx.config.zones) : null
    const zones = zoneKeys && zoneKeys.length ? zoneKeys : ['front', 'back']

    return filterPrefix(uniq(zones), prefix)
  } catch {
    return filterPrefix(['front', 'back'], prefix)
  }
}

/*
  Node types:
  - { options: string[] }               -> suggests options
  - { dynamic: (ctx, prefix) => [] }    -> suggests dynamic options
  - { children: { [token]: node }, options?: string[] } -> nested routing
  - { sequence: [node, node, ...] }     -> fixed positions by depth (e.g. presence <zone> <on|off>)
*/
const optionsNode = function optionsNode(options) {
  return { options: options || [] }
}

const dynamicNode = function dynamicNode(fn) {
  return { dynamic: fn }
}

const sequenceNode = function sequenceNode(nodes) {
  return { sequence: nodes || [] }
}

const childrenNode = function childrenNode(children, options) {
  const c = children || {}

  const computedOptions = Array.isArray(options) && options.length
    ? options
    : Object.keys(c)

  return { children: c, options: computedOptions }
}

const commandTree = childrenNode({
  help: optionsNode([]),
  exit: optionsNode([]),

  inject: optionsNode(['on', 'off', 'status']),

  tap: sequenceNode([
    dynamicNode((getContext, prefix) => listBuses(getContext, prefix)),
    optionsNode(['on', 'off', 'status']),
  ]),

  presence: sequenceNode([
    dynamicNode((getContext, prefix) => listZones(getContext, prefix)),
    optionsNode(['on', 'off']),
  ]),

  vibration: optionsNode(['low', 'high']),

  button: optionsNode(['short', 'long']),

  device: childrenNode({
    list: optionsNode([]),

    block: sequenceNode([
      dynamicNode((getContext, prefix) => listDeviceIds(getContext, prefix)),
    ]),

    unblock: sequenceNode([
      dynamicNode((getContext, prefix) => listDeviceIds(getContext, prefix)),
    ]),

    inject: sequenceNode([
      dynamicNode((getContext, prefix) => listDeviceIds(getContext, prefix)),
      optionsNode([
        '{"type":"press","ms":200}',
        'press',
        'press 200',
      ]),
    ]),
  }, ['list', 'block', 'unblock', 'inject']),

  driver: childrenNode({
    list: optionsNode([]),
    enable: sequenceNode([
      dynamicNode((getContext, prefix) => listDeviceIds(getContext, prefix)),
    ]),
    disable: sequenceNode([
      dynamicNode((getContext, prefix) => listDeviceIds(getContext, prefix)),
    ]),
  }, ['list', 'enable', 'disable']),

  clock: childrenNode({
    now: optionsNode([]),
    status: optionsNode([]),
    freeze: optionsNode([]),
    resume: optionsNode([]),
    set: sequenceNode([
      optionsNode(['YYYY-MM-DD']),
      optionsNode(['HH:MM']),
    ]),
  }, [
    'now',
    'status',
    'freeze',
    'resume',
    'set',
    '+100',
    '+500',
    '+1000',
    '+5000',
    '+60000',
  ]),

  core: childrenNode({
    state: optionsNode([]),
  }, ['state']),

  config: childrenNode({
    load: sequenceNode([
      dynamicNode((getContext, prefix) => listConfigFiles(prefix)),
    ]),
    print: optionsNode([]),
  }, ['load', 'print']),
})

const getNodeSuggestions = function getNodeSuggestions(node, getContext, prefix) {
  if (!node) {
    return []
  }

  if (node.dynamic) {
    return node.dynamic(getContext, prefix)
  }

  if (node.options) {
    return filterPrefix(node.options, prefix)
  }

  return []
}

const traverseForSuggestions = function traverseForSuggestions({ root, tokens, getContext }) {
  if (!root) {
    return []
  }

  const currentPrefix = tokens[tokens.length - 1] || ''
  const parts = tokens.slice(0, -1)

  let node = root

  if (node.sequence) {
    const idx = Math.max(0, parts.length - 1)
    const seqNode = node.sequence[idx] || null
    return getNodeSuggestions(seqNode, getContext, currentPrefix)
  }

  if (node.children) {
    if (parts.length === 0) {
      return getNodeSuggestions(node, getContext, currentPrefix)
    }

    const cmd = parts[0]
    const child = node.children[cmd]

    if (!child) {
      return getNodeSuggestions(node, getContext, currentPrefix)
    }

    if (child.sequence) {
      const seqIndex = Math.max(0, parts.length - 1)
      const seqNode = child.sequence[seqIndex] || null
      return getNodeSuggestions(seqNode, getContext, currentPrefix)
    }

    if (child.children) {
      if (parts.length === 1) {
        return getNodeSuggestions(child, getContext, currentPrefix)
      }

      const sub = parts[1]
      const subNode = child.children[sub]

      if (!subNode) {
        return getNodeSuggestions(child, getContext, currentPrefix)
      }

      if (subNode.sequence) {
        const seqIndex = Math.max(0, parts.length - 2)
        const seqNode = subNode.sequence[seqIndex] || null
        return getNodeSuggestions(seqNode, getContext, currentPrefix)
      }

      return []
    }

    return getNodeSuggestions(child, getContext, currentPrefix)
  }

  return []
}

/**
 * Creates a readline completer for the CLI.
 *
 * @param {object} args
 * @param {() => any} args.getContext Must return current app context
 */
export const makeCliCompleter = function makeCliCompleter({ getContext }) {
  return (line) => {
    const tokens = splitTokens(line)
    const suggestions = traverseForSuggestions({ root: commandTree, tokens, getContext })

    const current = tokens[tokens.length - 1] || ''
    const head = line.slice(0, line.length - current.length)

    const fullLineSuggestions = suggestions.map((s) => {
      const needsSpace = s.length > 0 && !s.endsWith(' ')
      return `${head}${s}${needsSpace ? ' ' : ''}`
    })

    return [fullLineSuggestions, line]
  }
}

export default makeCliCompleter
