// src/routes/health.ts
// Replaces: Spring Actuator /actuator/health
// Docker HEALTHCHECK, K8s probes, and load balancers hit this endpoint

import type { FastifyInstance } from "fastify";

// Response shape — like Actuator's {"status":"UP","components":{...}}
interface HealthResponse {
  readonly status: "up" | "down";
  readonly uptime: number;
  readonly timestamp: string;
  readonly version: string;
  readonly memoryUsage: {
    readonly heapUsedMB: number;
    readonly heapTotalMB: number;
  };
}

/**
 * Registers the health check endpoint used by Docker and Kubernetes probes.
 *
 * @param app - Fastify instance to register the /health route on.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", (_request, reply) => {
    const mem = process.memoryUsage();

    const response: HealthResponse = {
      status: "up",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      memoryUsage: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      },
    };

    return reply.send(response);
  });
}
