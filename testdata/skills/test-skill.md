---
name: "Code Review Checklist"
description: "A structured checklist for reviewing code changes for quality, correctness, and style."
category: "development"
required_tools: ["code_review", "code_complexity"]
---

When reviewing code, follow this checklist:

1. **Correctness**: Does the code do what it claims? Are edge cases handled?
2. **Style**: Does the code follow project conventions and formatting standards?
3. **Complexity**: Are functions appropriately sized? Use `code_complexity` to identify hotspots.
4. **Tests**: Are there sufficient tests covering new functionality?
5. **Documentation**: Are public APIs and non-obvious logic commented?

Use `code_review` to scan for lint issues, then `code_complexity` to identify functions over the threshold.
Report findings with severity (blocker/warning/info) and suggested fixes.
