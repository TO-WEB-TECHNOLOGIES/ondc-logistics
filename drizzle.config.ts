import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.PSQL_URI ??
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/ondc_logistics",
  },
});
