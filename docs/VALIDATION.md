# Via Helvetica Validation

This document records important manual and regression checks that complement
`npm run build`. Update it when user-visible behavior or validation scope changes.

## Build

```bash
npm run build
```

The command must complete without TypeScript or Vite build errors.

## Route creation and snap mode

1. With no editable route, activate route creation. The snap button must be
   enabled and shown as active before any waypoint is placed.
2. Disable snapping before the first click. The first waypoint must remain at
   the clicked position, and the next waypoint must be joined by a straight
   segment.
3. Start another empty route. Snapping must be enabled again by default. With
   snapping left active, the first waypoint should snap to nearby swissTLM3D
   geometry when coverage is available.
4. Leave and re-enter creation while an editable route still exists. The current
   snap choice must be preserved.
5. During an active routing request, the snap button must remain temporarily
   disabled and become available again when the request finishes. When snapping
   is active, the disabled button must stay blue and use the standard arrow
   cursor rather than appearing switched off.
6. With snapping disabled, moving a waypoint must rebuild its affected sections
   as straight lines, and deleting an intermediate waypoint must connect its two
   neighbours directly.
7. Repeat waypoint movement and deletion with snapping enabled. Affected
   sections should follow the network when routing succeeds and fall back to a
   straight connector when it does not.
