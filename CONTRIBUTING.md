# Contributing

Copyright 2026 hoodbroskillson. MIT.

## Setup

Node 20+ (see `.nvmrc`). Use the scripts in package.json: install, test (Vitest coverage), lint (`tsc --noEmit`), build.

Coverage must stay at or above 90%. CI runs Node 20 and 22 on Ubuntu, Windows, and macOS.

## Rules

- No runtime dependencies; argv is parsed in-tree.
- Do not add network, MCP, or API-key features.
- Errors must name file / table / column / line when known.
- Ambiguous table selection must refuse (exit 4), never first-match.
- Tests must include a check that a mutation leaves surrounding bytes identical.

## Commits

Author: hoodbroskillson / hoodbroskillson@users.noreply.github.com.
Do not put other personal names in LICENSE, README, commits, or source.

## Release

Package version may be 1.0.0 while CHANGELOG still lists Unreleased until a git tag exists. Publishing is done by GitHub Actions trusted publishing, not from a laptop.
