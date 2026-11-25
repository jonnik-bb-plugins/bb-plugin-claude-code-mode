// Shared by server.ts and app.tsx.
export const PROVIDER_ID = "claude-code";

// Mirrors the capable-model list in bin/claude-code-mode-wrapper
// (server.test.ts checks every prefix still appears there).
export const MODEL_PREFIXES = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-2",
];

export function supportsCodeMode(
  providerId: string | null | undefined,
  model: string | null | undefined,
): boolean {
  return (
    providerId === PROVIDER_ID &&
    MODEL_PREFIXES.some((prefix) => model?.startsWith(prefix))
  );
}
