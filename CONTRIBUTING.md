# Contributing

Thanks for helping improve the client.

## Local checks

Use Node.js 22.13 or newer and pnpm 12.18.0. Install dependencies with `pnpm install`, then run:

```sh
pnpm lint
pnpm typecheck
```

Pull requests should describe the public feature behavior being changed and include any corresponding catalog contract changes. Never add credentials or private catalog data to fixtures, logs, or documentation.

## Changes

- Keep provider-specific message formats in catalog data and generic runtime behavior in this package.
- Keep public feature support explicitly allowlisted by the server API.
- Update the README when changing the exported API or subscription behavior.
