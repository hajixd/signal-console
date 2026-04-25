"use client";

import { useState, useTransition } from "react";

type TestTelegramAlertResult = {
  error?: string;
  ok: boolean;
  status: "sent" | "skipped" | "failed";
};

type TestAlertButtonProps = {
  disabled?: boolean;
  sendTestAlert: () => Promise<TestTelegramAlertResult>;
};

function labelForState(state: "idle" | "sent" | "failed" | "skipped", isPending: boolean): string {
  if (isPending) return "Sending...";
  if (state === "sent") return "Alert Sent";
  if (state === "failed") return "Alert Failed";
  if (state === "skipped") return "Alert Unavailable";
  return "Test Alert";
}

export default function TestAlertButton({ disabled = false, sendTestAlert }: TestAlertButtonProps) {
  const [status, setStatus] = useState<"idle" | "sent" | "failed" | "skipped">("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await sendTestAlert();
        setStatus(result.status);
        setStatusMessage(result.error ?? (result.ok ? "Telegram test alert sent." : "Telegram test alert did not send."));
      } catch (error) {
        setStatus("failed");
        setStatusMessage(error instanceof Error ? error.message : "Telegram test alert failed.");
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
        title={statusMessage || "Send a test Telegram alert"}
      >
        {labelForState(status, isPending)}
      </button>
      <span className="sr-only" aria-live="polite">
        {statusMessage}
      </span>
    </>
  );
}
