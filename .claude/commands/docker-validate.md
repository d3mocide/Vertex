Validate the Vertex Docker Compose configuration for syntax errors and invalid references.

Steps:
1. Run: `cd /home/user/Vertex && docker compose config --quiet`
2. If validation passes, confirm the Docker Compose configuration is valid.
3. If validation fails, show the full error output and identify which file and section contains the error.

Common issues to look for:
- Undefined environment variables referenced with `${VAR}` syntax
- Invalid service names in `depends_on` or network references
- Missing required fields
- YAML indentation errors
