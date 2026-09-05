// src/routes/auth.ts
// Replaces: LoginController.java
// Now with Zod validation (like @Valid on @RequestBody)

import type { FastifyInstance } from "fastify";
import { LoginBodySchema } from "../schemas.js";

/**
 * Registers authentication routes: login page, login POST, and logout.
 *
 * @param app - Fastify instance to register routes on.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /auth/login — serves the login page
  app.get("/login", (_request, reply) => {
    return reply.sendFile("login.html");
  });

  // POST /auth/login — validates then checks credentials
  // Java: public ResponseEntity<?> login(@Valid @RequestBody LoginRequest body)
  app.post(
    "/login",
    {
      schema: {
        description: "Authenticate user with credentials",
        tags: ["auth"],
        body: {
          type: "object",
          properties: {
            username: { type: "string", minLength: 1, maxLength: 50 },
            password: { type: "string", minLength: 1, maxLength: 100 },
          },
          required: ["username", "password"],
        },
        response: {
          200: {
            type: "object",
            properties: { success: { type: "boolean" } },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          401: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    (request, reply) => {
    // safeParse = like BindingResult — doesn't throw, returns success/failure
    const result = LoginBodySchema.safeParse(request.body);

    if (!result.success) {
      // 400 with structured errors (like MethodArgumentNotValidException)
      return reply.status(400).send({
        error: "Validation failed",
        details: result.error.issues,
      });
    }

    // result.data is validated AND typed — safe to use
    const { username, password } = result.data;

    // Credentials come from env (APP_USERNAME / APP_PASSWORD). Placeholder
    // defaults are used only for local dev; set real values in .env / the
    // mesh-injected env so no credential lives in source.
    const expectedUser = process.env.APP_USERNAME ?? "admin";
    const expectedPass = process.env.APP_PASSWORD ?? "changeme";
    if (username === expectedUser && password === expectedPass) {
      return reply
        .setCookie("auth", "true", { path: "/", httpOnly: true })
        .send({ success: true });
    }

    return reply.status(401).send({ error: "Invalid credentials" });
  });

  // GET /auth/logout
  app.get("/logout", (_request, reply) => {
    return reply
      .setCookie("auth", "", { path: "/", httpOnly: true, maxAge: 0 })
      .redirect("/auth/login");
  });
}
