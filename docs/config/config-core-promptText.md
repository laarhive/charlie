<!-- docs/config/config-promptText.md -->
# Prompt Text Config (`config/core/promptText.json5`)

Resolved at: `config.core.promptText`

---

## PromptTextConfig (exact keys)

Required:
- `base: string`
- `modes: Record<string,string>`
- `openers: Record<string,string>`

Example:

```js
{
  base: 'You are Charlie.',
    modes: {
    'mode.front.any': 'Mode: invite passersby.'
  },
  openers: {
    'opener.front.any': 'Generate one short friendly Romanian opener (max 12 words).'
  }
}
```
