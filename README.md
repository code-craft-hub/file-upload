# File Upload

A clean-architecture file upload module with two storage providers, **Postgres** (Drizzle + postgres.js, tuned for minimal storage cost) and **ImageKit**, and a Liquid Glass (iOS 26/27) UI.

Everything portable lives in [`src/modules/file-upload`](src/modules/file-upload). Its README covers the architecture, the Postgres storage design, the HTTP API, and how to port it.

## Run it

```bash
pnpm install
cp .env.example .env.local    # set DATABASE_URL and/or IMAGEKIT_PRIVATE_KEY
pnpm db:migrate               # creates the file_upload schema
pnpm dev                      # http://localhost:3000
```

## Scripts

| Script | Does |
| --- | --- |
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm test` | Unit, contract and HTTP tests. Set `TEST_DATABASE_URL` to a disposable database to include the Postgres integration suite. |
| `pnpm typecheck` / `lint` | `tsc` / ESLint |
| `pnpm db:generate` | Generate a migration after editing `schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the tables |

## Layout

```
src/
├── app/                      Next.js: page + thin route files (one re-export each)
└── modules/file-upload/      the portable module
    ├── domain/               entities, rules, errors (no dependencies)
    ├── application/          use cases + ports
    ├── infrastructure/       postgres/, imagekit/, sharp/, memory/
    ├── http/                 framework-agnostic Request → Response handlers
    ├── composition/          env → adapters → use cases
    ├── ui/                   React + self-contained Liquid Glass CSS
    └── testing/              shared provider contract suite
```
