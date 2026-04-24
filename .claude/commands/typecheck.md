Run TypeScript type checking on the Vertex frontend to catch type errors before they cause Docker build failures.

Steps:
1. Run the type checker: `cd /home/user/Vertex/frontend && npx tsc --noEmit`
2. Report all errors found with file path and line number.
3. If errors are found, list them clearly and ask whether to fix them.
4. If no errors are found, confirm that the frontend type check passes and it is safe to commit.

Note: The Docker frontend build runs `tsc && vite build`. Any TypeScript error that fails `tsc --noEmit` will also fail the Docker build.
