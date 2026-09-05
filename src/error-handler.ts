// src/error-handler.ts
// Replaces: @ControllerAdvice + @ExceptionHandler
// Catches ALL unhandled errors across all routes — one place for error responses

import type { FastifyInstance, FastifyError } from "fastify";

// Consistent error response shape — like a shared ErrorResponse DTO
interface ErrorResponse {
  readonly error: string;
  readonly statusCode: number;
}

/**
 * Registers global error and 404 handlers on the Fastify instance.
 * Prevents stack trace leaks to clients and ensures consistent error response format.
 *
 * @param app - The Fastify server instance to attach handlers to.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  // Global error handler — like @ExceptionHandler(Exception.class)
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Log full error server-side (stack trace stays in logs, not in response)
    request.log.error(error);

    // Fastify attaches statusCode to known errors; default to 500
    const statusCode = error.statusCode ?? 500;

    // Never leak internals for 5xx; client errors are safe to show
    const message =
      statusCode >= 500 ? "Internal server error" : error.message;

    const response: ErrorResponse = { error: message, statusCode };
    return reply.status(statusCode).send(response);
  });
}
