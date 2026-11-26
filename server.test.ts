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

const ownSpawn = {
  origin: "plugin" as const,
  originPluginId: "claude-code-mode",
  senderThreadId: "th_parent",
};

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ccm-"));
  writeFileSync(join(dir, "host-id"), "host_local\n");
  const spawn = vi.fn(async (_args: unknown) => ({ id: "th_new" }));
  const read = vi.fn(async (_args: unknown) => ({
    path: "/work/brief.md",
    content: "line one\nline two\n",
    contentEncoding: "utf8" as const,
    sizeBytes: 18,
    sha256: "x",
  }));
  const { bb, harness } = createFakePluginHost({
    pluginId: "claude-code-mode",
    dataDir: dir,
    sdk: {
      threads: {
        spawn,
        get: async () => makeThreadResponse({ environmentId: "env_1" }),
      },
      environments: { get: async () => ({ hostId: "host_cli" }) as never },
      files: { read },
    },
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
  return { exe, env, base, dispatch, harness, spawn, read };
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

  it("flags a thread spawned by this plugin, toggle off", async () => {
    const { env, dispatch } = await setup();
    await dispatch({ context: ownSpawn });
    expect(await env("th_1")).toHaveProperty("BB_CLAUDE_CODE_MODE", "1");
  });

  it.each([
    { context: { ...ownSpawn, originPluginId: "other-plugin" } },
    { context: { ...ownSpawn, origin: "cli" as const } },
    { context: ownSpawn, status: "idle" as const },
    { context: ownSpawn, model: "claude-sonnet-4-6" },
  ])("does not flag %o", async (overrides) => {
    const { env, dispatch } = await setup();
    await dispatch(overrides);
    expect(await env("th_1")).not.toHaveProperty("BB_CLAUDE_CODE_MODE");
  });

  it("spawns a plain-model thread from the CLI", async () => {
    const { harness, spawn } = await setup();
    const result = await harness.behavior.runCli(
      ["spawn", "--model", "claude-haiku-5-5", "--prompt", "hi", "--parent-self"],
      { threadId: "th_me", projectId: "proj_1" },
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: "th_new" });
    expect(spawn.mock.calls[0]![0]).toMatchObject({
      origin: "plugin",
      originPluginId: "claude-code-mode",
      providerId: "claude-code",
      model: "claude-haiku-5-5",
      prompt: "hi",
      projectId: "proj_1",
      parentThreadId: "th_me",
      senderThreadId: "th_me",
      environment: { type: "project-default" },
    });
  });

  it("builds a worktree environment on the server's machine", async () => {
    const { harness, spawn } = await setup();
    await harness.behavior.runCli(
      [
        "spawn", "--model", "claude-haiku-5-5", "--prompt", "hi", "--json",
        "--new-environment", "worktree", "--base-branch", "stage",
      ],
      { projectId: "proj_1" },
    );
    expect(spawn.mock.calls[0]![0]).toMatchObject({
      environment: {
        type: "host",
        hostId: "host_local",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "stage" },
        },
      },
    });
  });

  it("reads --prompt-file on the invoking thread's machine", async () => {
    const { harness, spawn, read } = await setup();
    const result = await harness.behavior.runCli(
      ["spawn", "--model", "claude-haiku-5-5", "--prompt-file", "brief.md"],
      { projectId: "proj_1", threadId: "th_me", cwd: "/work" },
    );
    expect(result.exitCode).toBe(0);
    expect(read).toHaveBeenCalledWith({
      path: "/work/brief.md",
      hostId: "host_cli",
    });
    expect(spawn.mock.calls[0]![0]).toMatchObject({
      prompt: "line one\nline two\n",
    });
  });

  it.each([
    [{ content: " \n" }, "is empty"],
    [{ sizeBytes: 256 * 1024 + 1 }, "larger than"],
    [{ contentEncoding: "base64" }, "not UTF-8"],
    [new Error("ENOENT"), "cannot read prompt file /work/brief.md: ENOENT"],
  ])("rejects a bad prompt file %o", async (bad, message) => {
    const { harness, spawn, read } = await setup();
    const good = await read({});
    read.mockImplementation(async () => {
      if (bad instanceof Error) throw bad;
      return { ...good, ...bad } as typeof good;
    });
    const result = await harness.behavior.runCli(
      ["spawn", "--model", "claude-haiku-5-5", "--prompt-file", "/work/brief.md"],
      { projectId: "proj_1" },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    [[], "exactly one of"],
    [["--prompt", "a", "--prompt-file", "/f"], "exactly one of"],
    [["--prompt-file", "-"], "stdin"],
    [["--prompt-file", "brief.md"], "absolute path"],
  ])("rejects prompt options %o", async (args, message) => {
    const { harness, spawn } = await setup();
    const result = await harness.behavior.runCli(
      ["spawn", "--model", "claude-haiku-5-5", ...args],
      { projectId: "proj_1" },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    [["--model", "claude-haiku-5-5-codemode"], "plain model id"],
    [["--model", "claude-sonnet-4-6"], "Code Mode needs"],
    [["--model", "claude-haiku-5-5", "--parent-self"], "BB_THREAD_ID"],
    [["--model", "claude-haiku-5-5", "--base-branch", "x"], "worktree"],
  ])("rejects %o", async (args, message) => {
    const { harness, spawn } = await setup();
    const result = await harness.behavior.runCli(
      ["spawn", "--prompt", "hi", ...args],
      { projectId: "proj_1" },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(spawn).not.toHaveBeenCalled();
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
