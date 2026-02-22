---
name: Testing
description: Test design, implementation, and execution strategy
category: development
required_tools: [file_read, file_write, shell_exec]
---
## Testing Strategy

When writing and running tests, follow this disciplined approach:

1. **Understand what to test** — Use `file_read` to review the code under test before writing tests. Identify the public interface, key behaviors, and edge cases.

2. **Write tests before fixing bugs** — Always write a failing test that reproduces a bug before fixing it. This ensures the fix actually works and prevents regression.

3. **Test behavior, not implementation** — Tests should verify observable outputs for given inputs, not internal implementation details. This allows refactoring without breaking tests.

4. **Follow AAA pattern** — Structure each test with Arrange (set up state), Act (call the code), and Assert (verify results).

5. **Cover edge cases** — Test empty inputs, boundary values, error conditions, and concurrent access in addition to the happy path.

6. **Use table-driven tests** — Group related test cases in a table to reduce boilerplate and make it easy to add new cases.

7. **Keep tests independent** — Each test should set up and tear down its own state. Tests that depend on execution order are fragile.

8. **Run tests with race detection** — Use `shell_exec` to run tests with `-race` flag when testing concurrent code to catch data races early.

9. **Check test coverage** — Run coverage reports and identify untested critical paths. Do not aim for 100% coverage blindly, but ensure all important behaviors are tested.

10. **Clean up test artifacts** — Use `file_write` to create temporary test fixtures and ensure they are cleaned up after tests complete.
