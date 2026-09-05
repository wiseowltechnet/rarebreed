// src/config.ts
// Replaces: @ConfigurationProperties + @Validated + fail-fast on missing config
// In production: crashes at boot if env vars are missing (like Spring Boot)
// In development: uses defaults for quick iteration

import { z } from "zod/v4";

// Environment schema — like @ConfigurationProperties with Bean Validation
// z.coerce.number() converts string "3000" → number 3000 (like Spring type conversion)
const EnvSchema = z.object({
  // No real credentials in source. These dev "defaults" are placeholders only;
  // the real IPTV username/password/server come from environment variables
  // (.env locally, mesh-injected env on Dragon). Never commit real creds.
  PORT: z.coerce.number().default(3000),
  IPTV_USERNAME: z.string().min(1).default("your-username"),
  IPTV_PASSWORD: z.string().min(1).default("your-password"),
  IPTV_SERVER: z.url().default("http://your-iptv-server:8080"),
});

// App-level typed config (what the rest of the app uses)
interface IptvConfig {
  readonly username: string;
  readonly password: string;
  readonly server: string;
}

interface AppConfig {
  readonly port: number;
  readonly iptv: IptvConfig;
}

/**
 * Loads application configuration from environment variables.
 * In development: uses sensible defaults. In production: fails fast if vars are missing.
 *
 * @returns Validated application configuration with IPTV credentials and server port.
 * @throws Error when NODE_ENV=production and required environment variables are missing.
 */
export function loadConfig(): AppConfig {
  const isProduction = process.env.NODE_ENV === "production";

  // In production: strip defaults, require all values
  // Like Spring profiles: dev has defaults, prod requires explicit config
  const schema = isProduction
    ? z.object({
        PORT: z.coerce.number(),
        IPTV_USERNAME: z.string().min(1),
        IPTV_PASSWORD: z.string().min(1),
        IPTV_SERVER: z.url(),
      })
    : EnvSchema;

  const result = schema.safeParse(process.env);

  if (!result.success) {
    // Fail-fast: crash with clear message (like Spring's BeanCreationException)
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `\n❌ Missing or invalid environment variables:\n${issues}\n\nSet them in .env or as system env vars.\n`,
    );
  }

  const env = result.data;

  return {
    port: env.PORT,
    iptv: {
      username: env.IPTV_USERNAME,
      password: env.IPTV_PASSWORD,
      server: env.IPTV_SERVER,
    },
  };
}

export type { AppConfig, IptvConfig };
