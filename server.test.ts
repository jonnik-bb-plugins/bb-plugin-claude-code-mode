import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { MessageDispatchHookContext } from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PREFIXES } from "./lib/code-mode";
import plugin, { WRAPPER_NAME } from "./server";

const SOURCE = new URL(`./bin/${WRAPPER_NAME}`, import.meta.url);

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ccm-"));
  writeFileSync(join(dir, "host-id"), "host_local\n");
  const { bb, harness } = createFakePluginHost({
    pluginId: "claude-code-mode",
    dataDir: dir,
  });
  await plugin(bb);
  const exe = join(dirname(bb.storage.database().name), WRAPPER_NAME);
  const env = async (threadId: string | null, hostId = "host_local") =>
    Object.fromEntries(
      (
        await harness.behavior.resolveProviderEnv("claude-code", {
          threadId,
          projectId: null,
          hostId,
        })
      ).map((entry) => [entry.name, entry.value]),
    );
  const dispatch = async (
    overrides: {
      status?: "pending" | "idle";
      providerId?: string;
      model?: string;
      context?: Partial<MessageDispatchHookContext>;
    } = {},
  ) => {
    const hook = harness.inspection.registrations.hooks["message.dispatch"]!;
    const base = makeMessageDispatchHookContext();
    return hook({
      ...base,
      thread: makeThreadResponse({
        id: "th_1",
        status: overrides.status ?? "pending",
        providerId: overrides.providerId ?? "claude-code",
      }),
      requestedExecution: {
        ...base.requestedExecution,
        model: overrides.model ?? "claude-sonnet-5-5",
      },
      origin: "app",
      ...overrides.context,
    });
  };
  const base = (threadId: string) => ({
    BB_CLAUDE_CODE_EXECUTABLE: exe,
    BB_CLAUDE_CODE_MODE_THREAD: threadId,
  });
  return { exe, env, base, dispatch, harness };
}

describe("claude-code-mode", () => {
  beforeEach(() => vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("gives every command the wrapper, and the flag only to flagged threads", async () => {
    const { exe, env, base, dispatch, harness } = await setup();
    await harness.behavior.callRpc("setToggle", { on: true });
    expect(await env("th_1")).toEqual(base("th_1"));
    expect(await dispatch()).toEqual({ action: "proceed" });
    // Visible as soon as the hook has answered, i.e. before the first start.
    expect(await env("th_1")).toEqual({
      ...base("th_1"),
      BB_CLAUDE_CODE_MODE: "1",
    });
    expect(await env("th_2")).toEqual(base("th_2"));
    expect(await env(null)).toEqual({ BB_CLAUDE_CODE_EXECUTABLE: exe });
  });

  it("flags a human first message only while the toggle is on", async () => {
    const { env, dispatch, harness } = await setup();
    await dispatch();
    expect(await env("th_1")).not.toHaveProperty("BB_CLAUDE_CODE_MODE");
    await harness.behavior.callRpc("setToggle", { on: true });
    expect(await harness.behavior.callRpc("getToggle", null)).toEqual({
      on: true,
    });
    expect(await dispatch()).toEqual({ action: "proceed" });
    expect(await env("th_1")).toHaveProperty("BB_CLAUDE_CODE_MODE", "1");
  });

  it.each([
    { context: { initiator: "agent" as const } },
    { context: { senderThreadId: "th_parent" } },
    { context: { origin: "cli" as const } },
    { context: { origin: "sdk" as const } },
    { context: { origin: "plugin" as const } },
    { context: { origin: null } },
    { context: { attempt: "join-turn" as const } },
    { status: "idle" as const },
    { providerId: "codex" },
    { model: "claude-sonnet-4-6" },
  ])("toggle on leaves %o alone", async (overrides) => {
    const { env, dispatch, harness } = await setup();
    await harness.behavior.callRpc("setToggle", { on: true });
    expect(await dispatch(overrides)).toEqual({
      action: "proceed",
    });
    expect(await env("th_1")).not.toHaveProperty("BB_CLAUDE_CODE_MODE");
  });

  it("toggle on leaves forks alone", async () => {
    const { env, dispatch, harness } = await setup();
    await harness.behavior.callRpc("setToggle", { on: true });
    await dispatch({
      context: {
        thread: makeThreadResponse({
          id: "th_1",
          status: "pending",
          providerId: "claude-code",
          originKind: "fork",
        }),
      },
    });
    expect(await env("th_1")).not.toHaveProperty("BB_CLAUDE_CODE_MODE");
  });

  it("installs the bundled wrapper as an executable", async () => {
    const { exe } = await setup();
    accessSync(exe, constants.X_OK);
    expect(readFileSync(exe, "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });

  it("passes on the user's original executable", async () => {
    const { exe, env, base } = await setup();
    vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", "/opt/my/claude");
    expect(await env("th_1")).toEqual({
      ...base("th_1"),
      BB_CLAUDE_CODE_MODE_REAL_BIN: "/opt/my/claude",
    });
    vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", exe);
    expect(await env("th_1")).toEqual(base("th_1"));
  });

  it("contributes nothing on another machine or without the wrapper", async () => {
    const { exe, env } = await setup();
    expect(await env("th_1", "host_remote")).toEqual({});
    chmodSync(exe, 0o644);
    expect(await env("th_1")).toEqual({});
  });

  it("reports the mode the wrapper recorded, else the flag", async () => {
    const { exe, dispatch, harness } = await setup();
    const read = (threadId: string) =>
      harness.behavior.callRpc("isCodeMode", { threadId });
    const record = (state: string) =>
      writeFileSync(join(dirname(exe), "threads", "th_1"), `${state}\n`);
    expect(await read("th_1")).toEqual({ codeMode: false, recorded: false });
    await harness.behavior.callRpc("setToggle", { on: true });
    await dispatch();
    expect(await read("th_1")).toEqual({ codeMode: true, recorded: false });
    mkdirSync(join(dirname(exe), "threads"));
    record("off"); // flagged, but the request did not take effect
    expect(await read("th_1")).toEqual({ codeMode: false, recorded: true });
    record("on");
    expect(await read("th_1")).toEqual({ codeMode: true, recorded: true });
    writeFileSync(join(dirname(exe), "threads", "th_2"), "on\n"); // unflagged
    expect(await read("th_2")).toEqual({ codeMode: true, recorded: true });
  });

  it("lists the same capable models as the wrapper", () => {
    const script = readFileSync(SOURCE, "utf8");
    for (const prefix of MODEL_PREFIXES) expect(script).toContain(`${prefix}*`);
  });
});
