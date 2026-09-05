// src/graceful-shutdown.ts
// Replaces: @PreDestroy + JVM shutdown hooks
// Without this, kill signals drop active connections instantly

import type { FastifyInstance } from "fastify";

/**
 * Registers SIGTERM and SIGINT handlers for graceful shutdown.
 * Drains in-flight connections before exiting the process.
 *
 * @param app - The Fastify server instance to shut down on signal.
 */
export function registerGracefulShutdown(app: FastifyInstance): void {
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // app.close() = Spring's graceful shutdown:
      // 1. Stop accepting new connections
      // 2. Drain in-flight requests
      // 3. Run onClose hooks (like @PreDestroy methods)
      await app.close();
      app.log.info("Server closed cleanly");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  // SIGTERM = Docker/K8s stop signal
  // SIGINT  = Ctrl+C in terminal
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
