// src/routes/ai.ts
// AI features powered by Ollama (local LLM — no cloud APIs, no data leaves your machine).
//
// Features:
//   1. "What's happening?" — captures video frame, sends to llava vision model
//   2. Smart search — natural language search ("find comedies with good ratings")
//   3. Content summary — summarize what a show is about
//
// Requires: Ollama running locally with llava and a text model pulled.

import type { FastifyInstance } from "fastify";

const OLLAMA_BASE = process.env.OLLAMA_URL ?? "http://localhost:11434";

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

/**
 * Registers AI-powered routes using local Ollama models.
 *
 * @param app - Fastify instance.
 */
export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // POST /ai/describe — describe a video frame (vision AI)
  // Body: { image: base64-encoded frame }
  // Uses llava model to describe what's happening in the image
  app.post<{ Body: { image: string; prompt?: string } }>(
    "/describe",
    async (request, reply) => {
      const { image, prompt } = request.body;

      if (!image) {
        return await reply.status(400).send({ error: "Missing image (base64)" });
      }

      const systemPrompt = prompt ??
        "Describe what is happening in this video frame. Be concise (2-3 sentences). " +
        "If you can identify the show/movie, mention it. Describe the scene, characters, and action.";

      try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llava:7b",
            prompt: systemPrompt,
            images: [image], // base64 image data
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          return await reply.status(502).send({ error: "Ollama returned " + String(response.status) });
        }

        const data = await response.json() as OllamaGenerateResponse;
        return await reply.send({ description: data.response });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "AI service unavailable";
        return await reply.status(502).send({ error: msg });
      }
    },
  );

  // POST /ai/search — smart natural language search
  // Body: { query: string, channels: string[] }
  // Uses text model to filter/rank channels based on natural language
  app.post<{ Body: { query: string; channels: string[] } }>(
    "/search",
    async (request, reply) => {
      const { query, channels } = request.body;

      if (!query || !channels || channels.length === 0) {
        return await reply.status(400).send({ error: "Missing query or channels" });
      }

      // Limit channels to avoid overwhelming the model
      const subset = channels.slice(0, 200);

      const prompt = `You are a TV/movie recommendation assistant. The user wants: "${query}"

Here are the available channels/shows (one per line):
${subset.join("\n")}

Return ONLY the names of shows that match what the user is looking for, one per line. No explanations, no numbering. If nothing matches, return "NONE".`;

      try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen2.5-coder:7b",
            prompt,
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          return await reply.send({ results: [] });
        }

        const data = await response.json() as OllamaGenerateResponse;
        const results = data.response
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l !== "NONE");

        return await reply.send({ results });
      } catch {
        return await reply.send({ results: [] });
      }
    },
  );

  // POST /ai/summarize — summarize a show/movie
  // Body: { name: string, overview?: string }
  app.post<{ Body: { name: string; overview?: string } }>(
    "/summarize",
    async (request, reply) => {
      const { name, overview } = request.body;

      if (!name) {
        return await reply.status(400).send({ error: "Missing name" });
      }

      const prompt = overview
        ? `Summarize this show/movie in 1-2 sentences for someone deciding whether to watch it:\n\nTitle: ${name}\nDescription: ${overview}`
        : `In 1-2 sentences, describe what the show/movie "${name}" is about. Be helpful for someone deciding whether to watch it.`;

      try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen2.5-coder:7b",
            prompt,
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          return await reply.send({ summary: "" });
        }

        const data = await response.json() as OllamaGenerateResponse;
        return await reply.send({ summary: data.response.trim() });
      } catch {
        return await reply.send({ summary: "" });
      }
    },
  );

  // POST /ai/caption — lightweight CC-style caption from a video frame
  // Optimized for speed: short prompt, low token limit, single sentence
  // Body: { image: base64-encoded frame }
  app.post<{ Body: { image: string } }>(
    "/caption",
    async (request, reply) => {
      const { image } = request.body;

      if (!image) {
        return await reply.status(400).send({ error: "Missing image (base64)" });
      }

      try {
        const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "llava:7b",
            prompt: "Describe this TV frame in one short sentence (max 15 words). Focus on who is speaking and what action is happening. No preamble.",
            images: [image],
            stream: false,
            options: {
              num_predict: 40, // limit output tokens for speed
              temperature: 0.3, // deterministic
            },
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          return await reply.status(502).send({ error: "Ollama returned " + String(response.status) });
        }

        const data = await response.json() as OllamaGenerateResponse;
        // Clean up response — take first sentence only
        const caption = data.response.split(/[.!?\n]/)[0]?.trim() ?? data.response.trim();
        return await reply.send({ caption });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "AI unavailable";
        return await reply.status(502).send({ error: msg });
      }
    },
  );

  // GET /ai/status — check if Ollama is available and which models are loaded
  app.get("/status", async (_request, reply) => {
    try {
      const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });

      if (!response.ok) {
        return await reply.send({ available: false, models: [] });
      }

      const data = await response.json() as { models: { name: string }[] };
      const models = data.models.map((m) => m.name);

      return await reply.send({
        available: true,
        models,
        hasVision: models.some((m) => m.includes("llava")),
        hasText: models.some((m) => m.includes("qwen") || m.includes("phi") || m.includes("llama")),
      });
    } catch {
      return await reply.send({ available: false, models: [] });
    }
  });
}
