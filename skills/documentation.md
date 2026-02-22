---
name: Documentation
description: Technical documentation writing standards and process
category: communication
required_tools: [file_read, file_write]
---
## Documentation Standards

When writing technical documentation, follow these principles:

1. **Know your audience** — Determine whether you are writing for developers, operators, or end users. Adjust vocabulary and assumed knowledge accordingly.

2. **Start with context** — Explain what the thing is and why it exists before explaining how to use it. A one-sentence summary at the top saves readers time.

3. **Use examples liberally** — Show concrete examples for every non-trivial concept. Examples are often more useful than prose descriptions.

4. **Structure for scanning** — Use headers, bullet points, and code blocks so readers can find what they need without reading everything.

5. **Document the "why"** — Explain design decisions, constraints, and trade-offs. Future maintainers need to understand intent, not just behavior.

6. **Keep docs close to code** — Store documentation next to the code it describes. Docs that drift from code become misleading.

7. **Use file_read to audit existing docs** — Before writing new docs, read existing documentation to maintain consistency and avoid duplication.

8. **Write with file_write** — Save documentation to the appropriate file. Use Markdown for developer docs, plain text for operational runbooks.

9. **Update on change** — Whenever you modify behavior, update the corresponding documentation in the same commit or PR.

10. **Verify links and references** — Check that all links, file paths, and cross-references are accurate and point to the correct locations.
