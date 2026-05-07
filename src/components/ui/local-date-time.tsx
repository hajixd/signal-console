"use client";

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
  return <span suppressHydrationWarning>{formatLocalDateTime(value, fallback)}</span>;
}
