import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { db, sqlClient } from "./index";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
await migrate(db, { migrationsFolder });
console.log("migrations applied");
await sqlClient.end();
