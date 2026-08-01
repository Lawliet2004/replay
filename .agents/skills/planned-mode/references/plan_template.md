# [Goal Description]

Provide a brief description of the problem, any background context, and what the change accomplishes.

## User Review Required

Document anything that requires user review or feedback, for example, breaking changes or significant design decisions. Use GitHub alerts (`> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) to highlight critical items.

## Open Questions

Any clarifying or design questions for the user that will impact the implementation plan. Use GitHub alerts to highlight critical items.

## Proposed Changes

Group files by component (e.g., package, feature area, dependency layer) and order logically (dependencies first). Separate components with horizontal rules for visual clarity.

### [Component Name]

Summary of what will change in this component, separated by files. For specific files, use `[NEW]`, `[MODIFY]`, and `[DELETE]` to demarcate file status:

#### [MODIFY] [file basename](file:///absolute/path/to/modifiedfile)
#### [NEW] [file basename](file:///absolute/path/to/newfile)
#### [DELETE] [file basename](file:///absolute/path/to/deletedfile)

## Verification Plan

Summary of how you will verify that your changes have the desired effects.

### Automated Tests
- The commands of any automated tests you'll run.

### Manual Verification
- Steps for verifying UI changes, API endpoints, or manual workflows.
