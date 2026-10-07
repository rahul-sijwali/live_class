# What and why

<!-- One paragraph: the problem, the change, and why this approach. -->

## Design notes (HLD / LLD)

<!-- Packages and modules touched, data flow, failure modes, invariants preserved
     (CLAUDE.md §14). Skip for trivial changes and say so. -->

## Test evidence

<!-- Which suites ran (`pnpm check`, `pnpm test:e2e`), what was covered, anything only
     reviewed by reading. Screenshots or a short recording for UI changes. -->

## Checklist (CLAUDE.md §15)

- [ ] `pnpm check` is green locally
- [ ] E2E run for sync or UI changes
- [ ] Doc blocks on every export with `@param {Type} name` and `@returns {Type}`
- [ ] Security checklist considered for boundary changes (CLAUDE.md §8)
- [ ] `live_class.md` updated (modules, functions, routes, tables, env vars, decisions, statuses, changelog)
- [ ] Commit messages explain why

## Risk and rollback

<!-- What could break, who notices, how to revert (config flip, redeploy, migration?). -->
