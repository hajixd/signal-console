"use client";

import { useState, useTransition } from "react";

type TestAlertResult = {
  error?: string;
  ok: boolean;
  status: "sent" | "skipped" | "failed";
};

type TestAlertButtonProps = {
  channelLabel?: string;
  disabled?: boolean;
  sendTestAlert: () => Promise<TestAlertResult>;
};

function labelForState(state: "idle" | "sent" | "failed" | "skipped", isPending: boolean, channelLabel: string): string {
  if (isPending) return `Sending ${channelLabel}...`;
  if (state === "sent") return `${channelLabel} Sent`;
  if (state === "failed") return `${channelLabel} Failed`;
  if (state === "skipped") return `${channelLabel} Unavailable`;
  return `Test ${channelLabel}`;
}

export default function TestAlertButton({ channelLabel = "Telegram", disabled = false, sendTestAlert }: TestAlertButtonProps) {
  const [status, setStatus] = useState<"idle" | "sent" | "failed" | "skipped">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await sendTestAlert();
        setStatus(result.status);
        setStatusMessage(result.error ?? (result.ok ? `${channelLabel} test alert sent.` : `${channelLabel} test alert did not send.`));
      } catch (error) {
        setStatus("failed");
        setStatusMessage(error instanceof Error ? error.message : `${channelLabel} test alert failed.`);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className="terminal-action"
        disabled={disabled || isPending}
        onClick={handleClick}
        title={statusMessage || `Send a test ${channelLabel} alert`}
      >
        {labelForState(status, isPending, channelLabel)}
      </button>
      <span className="sr-only" aria-live="polite">
        {statusMessage}
      </span>
    </>
  );
}
