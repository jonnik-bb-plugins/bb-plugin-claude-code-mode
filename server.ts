// Claude Code Mode per thread. The dispatch hook flags a thread when its first
// message is human-typed in the app and the toolbar toggle is on; it
// stores the flag before bb starts the provider, and the env resolver passes it
// to the bundled wrapper CLI.
import { constants } from "node:fs";
import {
  access,
  chmod,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { PROVIDER_ID, supportsCodeMode } from "./lib/code-mode";

export const WRAPPER_NAME = "claude-code-mode-wrapper";
// Path installs load server.ts from the root; git installs load dist/server.js.
const WRAPPER_SOURCES = [`./bin/${WRAPPER_NAME}`, `../bin/${WRAPPER_NAME}`];

/** Copies the bundled wrapper into the plugin's data directory (stable across updates). */
async function installWrapper(dir: string): Promise<string> {
  let script: string | null = null;
  for (const source of WRAPPER_SOURCES) {
    script ??= await readFile(new URL(source, import.meta.url), "utf8").catch(
      () => null,
    );
  }
  if (script === null) throw new Error("bundled wrapper script not found");
  const target = join(dir, WRAPPER_NAME);
  // Rename into place so a running launch never reads a half-written script.
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, script);
  await chmod(temp, 0o755);
  await rename(temp, target);
  return target;
}

export const rpcContract = defineRpcContract({
  getToggle: {
    input: z.null(),
    output: z.object({ on: z.boolean() }),
  },
  setToggle: {
    input: z.object({ on: z.boolean() }),
    output: z.object({ on: z.boolean() }),
  },
  isCodeMode: {
    // The id names a state file, so no path characters.
    input: z.object({ threadId: z.string().regex(/^[A-Za-z0-9_-]+$/) }),
    output: z.object({ codeMode: z.boolean(), recorded: z.boolean() }),
  },
});

export const CHANGED = "code-mode-changed";
export const TOGGLED = "code-mode-toggled";
const TOGGLE_KEY = "toggle";
const key = (threadId: string) => `thread:${threadId}`;

export default async function plugin(bb: BbPluginApi) {
  // The directory of the plugin's own database: <dataDir>/plugins/<id>/.
  const wrapperPath = await installWrapper(
    dirname(bb.storage.database().name),
  ).catch((error: unknown) => {
    bb.log.warn(`Code Mode wrapper could not be installed: ${String(error)}`);
    return null;
  });

  // Written by the wrapper at each session launch: the mode actually used.
  const statePath = (threadId: string) =>
    wrapperPath === null
      ? null
      : join(dirname(wrapperPath), "threads", threadId);
  const readState = async (threadId: string) => {
    const path = statePath(threadId);
    if (path === null) return null;
    const state = await readFile(path, "utf8").catch(() => "");
    return state.trim() === "on" ? true : state.trim() === "off" ? false : null;
  };

  const isFlagged = async (threadId: string) =>
    (await bb.storage.kv.get<boolean>(key(threadId))) === true;

  const isToggleOn = async () =>
    (await bb.storage.kv.get<boolean>(TOGGLE_KEY)) === true;

  // Must be stored before the hook returns: bb builds the provider command next.
  const flag = async (threadId: string) => {
    await bb.storage.kv.set(key(threadId), true);
    bb.realtime.publish(CHANGED, { threadId });
  };

  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    // The sticky toggle applies only to a first message a human typed in the
    // app; agent, CLI, SDK, plugin spawns and forks are never affected.
    if (
      ctx.thread.status === "pending" &&
      ctx.thread.originKind !== "fork" &&
      ctx.attempt === "start-turn" &&
      ctx.origin === "app" &&
      ctx.initiator === "user" &&
      ctx.senderThreadId === null &&
      supportsCodeMode(ctx.thread.providerId, ctx.requestedExecution.model) &&
      (await isToggleOn())
    ) {
      await flag(ctx.thread.id);
    }
    return { action: "proceed" };
  });

  bb.providers.experimental_contributeEnv(
    PROVIDER_ID,
    async ({ threadId, hostId }) => {
      // The wrapper is a bash script that exists only on the server's machine.
      if (wrapperPath === null || process.platform === "win32") return [];
      const localHostId = await readFile(
        join(bb.server.experimental_dataDir, "host-id"),
        "utf8",
      ).catch(() => null);
      if (localHostId !== null && localHostId.trim() !== hostId) return [];
      try {
        await access(wrapperPath, constants.X_OK);
      } catch {
        bb.log.warn(`Code Mode wrapper is not executable: ${wrapperPath}`);
        return [];
      }
      // Every command gets the wrapper so resumes of Code Mode threads work.
      const env = [
        {
          name: "BB_CLAUDE_CODE_EXECUTABLE",
          value: wrapperPath,
          reason: "Run Claude Code through the Code Mode wrapper",
        },
      ];
      // Keep an executable the user configured for bb as the real CLI.
      const original = process.env.BB_CLAUDE_CODE_EXECUTABLE;
      if (original && original !== wrapperPath) {
        env.push({
          name: "BB_CLAUDE_CODE_MODE_REAL_BIN",
          value: original,
          reason: "The Claude Code executable configured before this plugin",
        });
      }
      if (threadId !== null) {
        env.push({
          name: "BB_CLAUDE_CODE_MODE_THREAD",
          value: threadId,
          reason: "Record whether this thread runs in Code Mode",
        });
      }
      if (threadId !== null && (await isFlagged(threadId))) {
        env.push({
          name: "BB_CLAUDE_CODE_MODE",
          value: "1",
          reason: "This thread was started in Claude Code Mode",
        });
      }
      return env;
    },
  );

  bb.rpc.register(rpcContract, {
    getToggle: async () => ({ on: await isToggleOn() }),
    setToggle: async ({ on }) => {
      await bb.storage.kv.set(TOGGLE_KEY, on);
      bb.realtime.publish(TOGGLED, { on });
      return { on };
    },
    isCodeMode: async ({ threadId }) => {
      const state = await readState(threadId);
      return {
        codeMode: state ?? (await isFlagged(threadId)),
        recorded: state !== null,
      };
    },
  });

  bb.events.on("thread.deleted", async ({ thread }) => {
    await bb.storage.kv.delete(key(thread.id));
    const path = statePath(thread.id);
    if (path !== null) await rm(path, { force: true });
  });
}
