<!-- docs/config/config-tasker.md -->
# Tasker Config (`config/core/tasker.json5`)

Resolved at: `config.core.tasker`

---

## TaskerConfig (exact keys)

Required:
- `baseUrl: string`
- `timeoutMs: number`
- `retries: number`
- `retryDelayMs: number`
- `token: { header: string, value: string }`

Example:

```js
{
  baseUrl: 'http://127.0.0.1:8787/tasker',
    timeoutMs: 2500,
    retries: 1,
    retryDelayMs: 300,
    token: { header: 'X-Tasker-Token', value: '...' }
}
```
