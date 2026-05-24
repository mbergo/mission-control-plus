```markdown
# mission-control-plus Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns, code style, and workflows used in the `mission-control-plus` repository. The codebase is written in TypeScript and does not rely on a specific framework. You'll learn conventions for file naming, import/export styles, commit messages, and testing patterns, as well as how to execute common workflows using suggested commands.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `missionControl.ts`, `userSettings.ts`

### Import Style
- Use **alias imports** to reference modules.
  - Example:
    ```typescript
    import { fetchData as getData } from './apiClient';
    ```

### Export Style
- Use **named exports** for functions, classes, or constants.
  - Example:
    ```typescript
    // In userSettings.ts
    export const defaultSettings = { theme: 'dark' };
    export function saveSettings(settings: object) { /* ... */ }
    ```

### Commit Patterns
- Commit messages are **freeform** and do not follow a strict prefix or type.
- Average commit message length: **79 characters**.
  - Example:  
    ```
    Improve error handling in missionControl module for edge cases
    ```

## Workflows

### Code Development
**Trigger:** When adding or updating features or bug fixes  
**Command:** `/dev`

1. Create or update TypeScript files using camelCase naming.
2. Use alias imports and named exports as per conventions.
3. Write clear, descriptive commit messages (no strict prefix required).
4. Run tests (see Testing Patterns).
5. Push changes to the repository.

### Testing
**Trigger:** When verifying code correctness  
**Command:** `/test`

1. Write test files matching the `*.test.*` pattern (e.g., `missionControl.test.ts`).
2. Use the project's preferred (unknown) testing framework.
3. Run tests to ensure all pass before committing changes.

## Testing Patterns

- **Test File Naming:**  
  Test files must include `.test.` in their filename, e.g., `missionControl.test.ts`.
- **Framework:**  
  The specific testing framework is not detected; check the repository for details.
- **Example Test File:**
  ```typescript
  // missionControl.test.ts
  import { missionControl } from './missionControl';

  describe('missionControl', () => {
    it('should initialize correctly', () => {
      expect(missionControl.init()).toBe(true);
    });
  });
  ```

## Commands
| Command | Purpose                                   |
|---------|-------------------------------------------|
| /dev    | Start a new development workflow          |
| /test   | Run all tests in the repository           |
```
