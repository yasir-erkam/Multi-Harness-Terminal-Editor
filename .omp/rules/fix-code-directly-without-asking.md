---
name: fix-code-directly-without-asking
description: "Apply clear code fixes directly instead of asking confirmation through ask"
condition: "\"question\"\\s*:\\s*\"[^\"]*\\b([Ff]ix|[Pp]atch|[Rr]epair)\\b"
scope: "tool:ask"
---

Do not call `ask` to confirm whether you should fix or patch code. Inspect the relevant files, apply the fix directly with `edit` or `write`, and run the relevant checks to verify it. Reserve `ask` strictly for genuine architectural or product tradeoffs with multiple distinct options.