# Plan

- Resolve Re:ZERO Rem warnings for sidebar bridge integration.
- Remove remaining `getSnapshot` dependency from bridge binding.
- Keep `state$` as the connected-sidebar source of truth and use dataset only when the bridge is absent.
- Preserve sidebar workspace across same-subject rebinds; clear stale workspace for new subjects.
- Verify with bridge-focused Bun tests and full `bun run check`.
