import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
    // Only needed for `prisma migrate diff --from-migrations` (CI drift
    // check) and for `migrate dev` against datasources that can't create a
    // scratch DB on the fly. Undefined in normal local dev is fine.
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
