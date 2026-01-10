# Completion Protocol

When you finish investigating an issue, you MUST write your findings to `liftie/.last-result.json`:

```json
{
  "timestamp": "2024-01-15T14:30:00Z",
  "status": "fixed" | "needs_help" | "not_an_issue",
  "summary": "One sentence describing what you found and did",
  "root_cause": "What caused the issue (if determined)",
  "actions_taken": ["list", "of", "actions"],
  "learned": "Optional: new knowledge to add to context.md"
}
```

## Status meanings

- **"fixed"**: You identified and resolved the problem
- **"needs_help"**: You couldn't fix it, human intervention needed
- **"not_an_issue"**: Expected behavior (resort closed, off-season, etc.)

## IMPORTANT

Always write this file before finishing your investigation.

## Example

```json
{
  "timestamp": "2024-01-15T14:30:00Z",
  "status": "fixed",
  "summary": "Restarted lift-scraper PM2 process after it crashed due to memory",
  "root_cause": "Memory leak in vail-lift-scraper causing OOM",
  "actions_taken": [
    "Checked PM2 logs",
    "Found OOM error",
    "Restarted lift-scraper process"
  ],
  "learned": "Vail lift scraper has memory leak - may need investigation"
}
```
