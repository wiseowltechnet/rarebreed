// src/logger.ts
// Replaces: logback.xml / logback-spring.xml
// Pino is already built into Fastify — we just configure output format
//
// Dev:  human-readable colored lines (like Logback PatternLayout)
// Prod: raw JSON (like Logstash JSON encoder — ELK/Datadog/Splunk ready)

import type { FastifyServerOptions } from "fastify";

// Return type is narrowed to exclude undefined — satisfies exactOptionalPropertyTypes
type LoggerConfig = Exclude<FastifyServerOptions["logger"], undefined>;

/**
 * Returns environment-aware Pino logger configuration.
 * Development: pretty-printed colored output. Production: raw JSON for log aggregators.
 *
 * @returns Logger config object suitable for Fastify constructor.
 */
export function getLoggerConfig(): LoggerConfig {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    // Prod: JSON output, INFO level (default Pino behavior)
    return { level: "info" };
  }

  // Dev: pretty-printed, colored, DEBUG level
  return {
    level: "debug",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  };
}
