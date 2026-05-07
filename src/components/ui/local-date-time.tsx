"use client";

import { useEffect, useState } from "react";

type LocalDateTimeProps = {
  fallback?: string;
  value?: number | string;
};

export function formatLocalDateTime(value: number | string | undefined, fallback = "--"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === 0 || (typeof value === "string" && value.startsWith("1970-01-01"))) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric"
  }).format(date);
}

export default function LocalDateTime({ fallback = "--", value }: LocalDateTimeProps) {
  const [clientLabel, setClientLabel] = useState<string | null>(null);

  useEffect(() => {
    setClientLabel(formatLocalDateTime(value, fallback));
  }, [fallback, value]);

  return <span suppressHydrationWarning>{clientLabel ?? fallback}</span>;
}
