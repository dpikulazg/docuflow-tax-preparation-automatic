---
name: "README Documentation"
description: "Use when creating or updating README.md files, setup documentation, environment variables, prerequisites, or run commands in this Vite React Firebase project."
applyTo: "**/README.md"
---
# README Guidelines

- Keep setup instructions concise and task-oriented.
- Document Node.js as the prerequisite and use the repository's npm scripts from `package.json` rather than inventing commands.
- For local setup, document `npm install`, copying `.env.example` to `.env.local`, configuring the Gemini and Firebase variables, and running `npm run dev`.
- Link to `.env.example` when referring to environment variables; never place real credentials, API keys, or secret values in the README.
- Keep deployment and preview commands synchronized with the `build`, `preview`, and `deploy` scripts in `package.json` when documenting them.
- Prefer short numbered setup steps and fenced code blocks for multi-line command sequences.
- Update README instructions when package scripts, required environment variables, or project prerequisites change.
- Do not duplicate component behavior, Firebase schema details, or implementation commentary that belongs in source code or project configuration.
