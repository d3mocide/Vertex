Run all validation checks required before committing to the Vertex repository. These checks prevent Docker build failures and catch syntax errors early.

Run the following checks in order and report the result of each:

**1. TypeScript type check** (frontend Docker build will fail if this fails)
```
cd /home/user/Vertex/frontend && npx tsc --noEmit
```

**2. Docker Compose config validation** (catches YAML syntax errors and invalid references)
```
cd /home/user/Vertex && docker compose config --quiet
```

**3. Python syntax check on staged files** (catches syntax errors in modified Python files)
```
cd /home/user/Vertex && git diff --cached --name-only | grep '\.py$' | xargs -r python3 -m py_compile
```
If there are no staged Python files, skip this step and note that.

**Reporting:**
- List PASS or FAIL for each check.
- For any failure, show the full error output.
- Do NOT proceed with committing if any check fails.
- If all checks pass, confirm it is safe to commit.
