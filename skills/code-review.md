---
name: Code Review
description: Systematic code review methodology for correctness, security, and maintainability
category: development
required_tools: [file_read, git_diff]
---
## Code Review Process

When reviewing code, follow these steps systematically:

1. **Understand the context** — Read the PR description, linked issues, and any relevant documentation before looking at diffs.

2. **Review the diff first** — Use `git_diff` to get a high-level view of what changed. Look for the overall scope and intent.

3. **Check correctness** — Verify that the logic is correct, edge cases are handled, and error conditions are properly managed.

4. **Identify security issues** — Look for injection vulnerabilities (SQL, command, XSS), improper input validation, secrets in code, and insecure defaults.

5. **Assess test coverage** — Confirm that new code has tests and that existing tests are not broken or weakened.

6. **Evaluate readability** — Code should be self-explanatory. Flag overly complex logic, missing comments on non-obvious decisions, and misleading names.

7. **Check for performance** — Identify N+1 queries, unnecessary allocations, and blocking operations in hot paths.

8. **Provide actionable feedback** — Every comment should explain the problem and suggest a fix. Distinguish blockers from suggestions.

9. **Approve only when ready** — Do not approve code with unresolved blocking issues. Request changes and follow up.
