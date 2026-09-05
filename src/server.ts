// src/server.ts
// Entry point — builds the app and starts listening.
// Like: public static void main() { SpringApplication.run(App.class, args); }

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { registerGracefulShutdown } from "./graceful-shutdown.js";

const config = loadConfig();
const app = await buildApp();

try {
  // host 0.0.0.0 needed for Docker (localhost only listens inside container)
  const listenOpts = process.env.NODE_ENV === "production"
    ? { port: config.port, host: "0.0.0.0" }
    : { port: config.port };
  const address = await app.listen(listenOpts);
  console.log(`RareBreed Player running at ${address}`);
  registerGracefulShutdown(app);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { config };
