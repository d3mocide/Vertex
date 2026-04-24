Append a new entry to TASK_LOG.md describing the work just completed in this session.

Steps:
1. Read the current contents of `/home/user/Vertex/TASK_LOG.md`.
2. Determine today's date.
3. Write a new entry at the top of the log (below the header, above existing entries) using this format:

```
## YYYY-MM-DD — <one-line summary of what was done>

- <bullet point describing a specific change, file affected, and why>
- <bullet point for each significant change>
- **Motivation**: <brief explanation of why this work was done>
```

4. Keep bullet points concise and factual — what changed, which files, why it matters.
5. Do not duplicate information already in the most recent entry if this is a continuation of the same session's work — instead append bullets to the existing entry for today.

The task log is the primary record for future agents to understand what has changed recently without reading full git history.
