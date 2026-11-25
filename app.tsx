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

/** Read-only marker above the composer of a thread running in Code Mode. */
function CodeModeBanner() {
  const { scope } = useComposer();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const rpc = useRpc<typeof rpcContract>();
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);
  // The wrapper records the actual mode only when the session launches, and
  // it cannot publish events: poll (bounded) until a state is recorded.
  useEffect(() => {
    if (threadId === null) return;
    let stale = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      rpc.call("isCodeMode", { threadId }).then(
        ({ codeMode, recorded }) => {
          if (stale) return;
          setShownFor(codeMode ? threadId : null);
          if (!recorded && polls++ < 60) timer = setTimeout(load, 2000);
        },
        () => !stale && setShownFor(null),
      );
    };
    load();
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [rpc, threadId, changes]);
  useRealtime("code-mode-changed", () => setChanges((n) => n + 1));
  if (threadId === null || shownFor !== threadId) return null;
  return (
    <div
      title="This thread runs in Claude Code's experimental Code Mode"
      className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
    >
      <Icon name="Code" className="size-3" />
      Claude Code Mode
    </div>
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
