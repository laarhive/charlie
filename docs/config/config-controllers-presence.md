<!-- docs/config/config-controllers-presence.md -->
# Presence Controller Config (`config/controllers-presence.json5`)

Controls how presence domain inputs become semantic main-bus events.

---

## Exact keys (current)

Required:
- `enabled: boolean`

Optional:
- `params: { debounceMs: number }`

---

## Example

```js
{
  enabled: true,
  params: { debounceMs: 250 }
}
```
