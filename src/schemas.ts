// src/schemas.ts
// Replaces: Bean Validation annotated DTOs (@NotNull, @Size, @URL)
// Zod defines runtime validation AND infers TypeScript types from one source

import { z } from "zod/v4";

// Login request body
// Java: public class LoginRequest {
//   @NotNull @Size(min=1, max=50) String username;
//   @NotNull @Size(min=1, max=100) String password;
// }
export const LoginBodySchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
});

// z.infer extracts the TS type from the schema — single source of truth
export type LoginBody = z.infer<typeof LoginBodySchema>;

// Proxy query params
// Java: @QueryValue @NotNull @URL String url
export const ProxyQuerySchema = z.object({
  url: z.url(),
});

export type ProxyQuery = z.infer<typeof ProxyQuerySchema>;
