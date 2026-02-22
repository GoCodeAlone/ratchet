---
name: Debugging
description: Systematic debugging and root cause analysis methodology
category: development
required_tools: [file_read, shell_exec]
---
## Debugging Methodology

When diagnosing bugs, follow a disciplined process to find root causes efficiently:

1. **Reproduce the issue first** — Confirm you can reproduce the bug with a minimal, consistent test case. If you cannot reproduce it, gather more information before proceeding.

2. **Gather evidence** — Collect logs, stack traces, error messages, and environment details. Look for patterns in when the bug occurs versus when it does not.

3. **Narrow the scope** — Use binary search to isolate the failing code path. Comment out sections, add logging, or bisect commits to pinpoint where the bug was introduced.

4. **Form a hypothesis** — Based on evidence, state a specific theory about the root cause. A good hypothesis is testable and falsifiable.

5. **Test the hypothesis** — Make targeted changes to validate your hypothesis. Change one thing at a time to maintain control.

6. **Inspect state** — Use `file_read` to examine config files and `shell_exec` to run diagnostic commands, inspect process state, or query databases.

7. **Fix the root cause** — Address the underlying issue, not just the symptom. Patching symptoms leads to recurring bugs.

8. **Verify the fix** — Confirm the original reproduction case no longer fails and that no regressions were introduced.

9. **Document the finding** — Record what the bug was, why it occurred, and how it was fixed to help future debugging efforts.
