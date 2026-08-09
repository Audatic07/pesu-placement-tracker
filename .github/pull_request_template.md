<!--
Thanks for working on this. The checklist is short on purpose — everything in
it has broken here at least once.
-->

## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- Especially if you rejected a more obvious implementation, say what and why.
     The codebase's comments are written that way and yours should match. -->

## Checks

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] If this touches submission, analytics or moderation:
      `npm run demo:9998 -- --reset` passes. It is the integration suite and it
      catches things unit tests structurally cannot.

## Privacy

- [ ] No new aggregate bypasses `lib/privacy/gate.ts`, and nothing unwraps a
      `Suppressible<T>` with a cast.
- [ ] No new path stores, logs or forwards a PESU password.
- [ ] No real student data appears in this diff, in a fixture, or in a test.

<!-- If any box above does not apply, delete it rather than ticking it. -->
