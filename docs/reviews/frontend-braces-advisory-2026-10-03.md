# Frontend `braces` advisory (GHSA-vfj7-8cjw-p6xm)

**Review date:** 2026-10-03
**Scope:** `frontend/package-lock.json`, reported by `npm audit` as 5 high-severity findings.

## Outcome

Risk accepted for now; no change made. All five findings share one root cause, no patched release exists, and the code never reaches production.

## Evidence

| Check | Result |
|---|---|
| Advisory | `braces` through 3.0.3: recursive AST walkers (`parse`, `expand`, `compile`) have no depth limit, so a deeply nested brace pattern raises an uncaught `RangeError` and terminates the Node.js process. CVSS 8.7. **Patched versions: none.** |
| Latest releases | `braces` 3.0.3 is the newest published version; `micromatch` 4.0.8 and `fast-glob` 3.3.3 (both depend on it) are also current. |
| Dependency path | `tailwindcss` 3.4.19 → `chokidar` 3.x / `fast-glob` → `micromatch` → `braces`. The lock marks `braces` as `dev: true`. |
| Production dependencies | `npm audit --omit=dev`: **0 vulnerabilities**. |
| What ships | The Dockerfile builds in a Node stage and copies only `dist/` into the nginx image, so none of this code is in the runtime image. |
| Attack surface | The only inputs are the glob patterns in `tailwind.config.js` (`content`), which are authored in this repository. The worst case is a crashed local or CI build. |

`npm audit fix` cannot help (no patched version), and `npm audit fix --force` proposes Tailwind 4.3.3, a major upgrade.

## Decision

- Keep Tailwind 3.4.19. The Tailwind 4 upgrade was already rejected in `dependabot-2026-09-29.md` (#170) because the production build fails until the PostCSS plugin, stylesheet directives and configuration are migrated together, and Dependabot is configured to skip Tailwind major updates.
- Do not suppress the finding with an override or a fork: replacing `braces` with an unreviewed package would add supply-chain risk to remove a build-time-only one.

## Revisit when

1. a patched `braces` (or a `micromatch` / `fast-glob` / `chokidar` release that drops it) is published: update the lock and re-run the audits below; or
2. the Tailwind 4 migration is scheduled: it removes `chokidar`, `fast-glob` and `micromatch` from the build graph. That work needs a visual regression pass because every screen uses the design-system tokens.

## Re-checking

```bash
cd frontend
npm audit --omit=dev      # must stay at 0 vulnerabilities
npm audit                 # currently the 5 findings above, one root cause
npm ls braces
```
