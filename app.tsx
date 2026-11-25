import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { PROVIDER_ID, supportsCodeMode } from "./lib/code-mode";
import type { rpcContract } from "./server";

/** Sticky preference: start new app-composed threads in Code Mode. */
function CodeModeToggle() {
  const { selection } = useComposer();
  const supported = supportsCodeMode(selection?.providerId, selection?.model);
  const rpc = useRpc<typeof rpcContract>();
  const [on, setOn] = useState<boolean | null>(null);
  const refetch = useCallback(() => {
    rpc.call("getToggle").then(
      (result) => setOn(result.on),
      () => setOn(null),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("code-mode-toggled", refetch);
  if (selection?.providerId !== PROVIDER_ID) return null;
  const pressed = supported && on === true;
  const label = supported
    ? `Claude Code Mode for new threads: ${on ? "on" : "off"}`
    : "Claude Code Mode needs a 5.5 or Fable 5.2 model";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // aria-disabled, not disabled: the tooltip must stay reachable.
      aria-disabled={!supported || on === null}
      onClick={() => {
        if (!supported || on === null) return;
        rpc.call("setToggle", { on: !on }).then(
          (result) => setOn(result.on),
          refetch,
        );
      }}
      className={`inline-flex h-8 items-center justify-center rounded-md px-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-40 ${
        pressed
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-state-hover"
      }`}
    >
      <Icon name="Code" className="size-4" />
    </button>
  );
}

/** Read-only marker above the composer of a thread started in Code Mode. */
function CodeModeBanner() {
  const { scope } = useComposer();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (threadId === null) return;
    rpc.call("isCodeMode", { threadId }).then(
      ({ codeMode }) => setShownFor(codeMode ? threadId : null),
      () => setShownFor(null),
    );
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime("code-mode-changed", refetch);
  if (threadId === null || shownFor !== threadId) return null;
  return (
    <div className="px-1 text-xs text-muted-foreground">Claude Code Mode</div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "code-mode-start",
    scopes: ["new-thread"],
    actions: [{ id: "toggle", component: CodeModeToggle }],
  });
  app.composer.customize({
    id: "code-mode-state",
    scopes: ["thread"],
    banners: [{ id: "state", chrome: "bare", component: CodeModeBanner }],
  });
});
