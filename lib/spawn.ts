// `bb claude-code-mode spawn`: the non-UI opt-in. The thread is spawned by
// this plugin, so the dispatch hook recognises it and flags it before the
// first provider start; the model id stays plain.
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { PROVIDER_ID, supportsCodeMode } from "./code-mode";

export const PROMPT_FILE_MAX_BYTES = 256 * 1024;

const fail = (message: string): never => {
  throw new PluginCliError(message, { code: "invalid_input" });
};

/** Reads the file on the machine the command was run on, not blindly on the server's. */
async function readPromptFile(
  bb: BbPluginApi,
  file: string,
  { cwd, threadId }: { cwd?: string; threadId?: string },
): Promise<string> {
  if (file === "-") fail("--prompt-file - is not supported: plugin commands cannot read stdin; pass a file path");
  if (!isAbsolute(file) && !cwd) fail("--prompt-file needs an absolute path here");
  const path = resolve(cwd ?? "/", file);
  // Outside a bb thread the invoking machine is unknown: the server's is read.
  const environmentId = threadId ? (await bb.sdk.threads.get({ threadId })).environmentId : null;
  const hostId = environmentId
    ? (await bb.sdk.environments.get({ environmentId })).hostId
    : undefined;
  const result = await bb.sdk.files
    .read({ path, ...(hostId ? { hostId } : {}) })
    .catch((error: unknown) =>
      fail(`cannot read prompt file ${path}: ${error instanceof Error ? error.message : String(error)}`),
    );
  if (result.sizeBytes > PROMPT_FILE_MAX_BYTES) fail(`prompt file ${path} is larger than ${PROMPT_FILE_MAX_BYTES} bytes`);
  if (result.contentEncoding !== "utf8") fail(`prompt file ${path} is not UTF-8 text`);
  if (result.content.trim() === "") fail(`prompt file ${path} is empty`);
  return result.content;
}

export function registerSpawnCommand(bb: BbPluginApi): void {
  bb.cli.register(
    defineCli({
      name: "claude-code-mode",
      summary: "Start Claude Code threads in Code Mode",
      commands: {
        spawn: cliCommand({
          summary: "Spawn a Claude Code thread in Code Mode",
          options: {
            prompt: { type: "string", description: "First message (or --prompt-file)" },
            "prompt-file": { type: "string", description: "File with the first message, UTF-8, up to 256 KiB; stdin (-) is not supported" },
            model: { type: "string", required: true, description: "Plain model id, e.g. claude-sonnet-5-5" },
            project: { type: "string", description: "Project id (default: current)" },
            "parent-self": { type: "boolean", description: "Parent to the calling thread" },
            "parent-thread": { type: "string", description: "Parent thread id" },
            title: { type: "string", description: "Thread title" },
            "reasoning-level": { type: "string", description: "Reasoning level id" },
            "permission-mode": { type: "enum", values: ["accept-edits", "auto", "full"], description: "Permission mode" },
            environment: { type: "string", description: "Existing environment id" },
            "new-environment": { type: "enum", values: ["personal", "worktree"], description: "Create a fresh environment" },
            "base-branch": { type: "string", description: "Base branch for a new worktree" },
            json: { type: "boolean", description: "Print the created thread as JSON" },
          },
          async run({ options }, ctx) {
            const { model } = options;
            if (model.endsWith("-codemode")) fail("pass the plain model id, without -codemode");
            if (!supportsCodeMode(PROVIDER_ID, model)) fail("Code Mode needs a 5.5 or Fable 5.2 model");
            const projectId = options.project ?? ctx.projectId ?? fail("--project is required outside a bb thread");
            if (options["parent-self"] && options["parent-thread"]) fail("use --parent-self or --parent-thread, not both");
            if (options["parent-self"] && !ctx.threadId) fail("--parent-self requires BB_THREAD_ID");
            const parentThreadId = options["parent-self"] ? ctx.threadId : options["parent-thread"];
            const kind = options["new-environment"];
            const branch = options["base-branch"];
            if (kind && options.environment) fail("use --environment or --new-environment, not both");
            if (branch && kind !== "worktree") fail("--base-branch requires --new-environment worktree");
            // Code Mode runs only on the server's machine, so new environments go there.
            const hostId = kind
              ? (await readFile(join(bb.server.experimental_dataDir, "host-id"), "utf8")).trim()
              : "";
            const file = options["prompt-file"];
            if ((options.prompt === undefined) === (file === undefined)) fail("pass exactly one of --prompt or --prompt-file");
            const environment = options.environment
              ? { type: "reuse" as const, environmentId: options.environment }
              : kind
                ? {
                    type: "host" as const,
                    hostId,
                    workspace:
                      kind === "personal"
                        ? { type: "personal" as const }
                        : {
                            type: "managed-worktree" as const,
                            baseBranch: branch
                              ? { kind: "named" as const, name: branch }
                              : { kind: "default" as const },
                          },
                  }
                : { type: "project-default" as const };
            const thread = await bb.sdk.threads.spawn({
              origin: "plugin",
              originPluginId: bb.pluginId,
              providerId: PROVIDER_ID,
              model,
              prompt: file === undefined ? options.prompt! : await readPromptFile(bb, file, ctx),
              projectId,
              environment,
              ...(parentThreadId ? { parentThreadId } : {}),
              ...(ctx.threadId ? { senderThreadId: ctx.threadId } : {}),
              ...(options.title ? { title: options.title } : {}),
              ...(options["reasoning-level"] ? { reasoningLevel: options["reasoning-level"] } : {}),
              ...(options["permission-mode"] ? { permissionMode: options["permission-mode"] } : {}),
            });
            return { exitCode: 0, stdout: options.json ? JSON.stringify(thread) : thread.id };
          },
        }),
      },
    }),
  );
}
