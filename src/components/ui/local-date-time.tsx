"use client";

import { useEffect, useState } from "react";

type LocalDateTimeProps = {
  fallback?: string;
  value?: number | string;
};

type LocalDateTimeParts = {
  date: string;
  time: string;
};

function parseDateValue(value: number | string | undefined): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === 0 || (typeof value === "string" && value.startsWith("1970-01-01"))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatLocalDateTime(value: number | string | undefined, fallback = "--"): string {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric"
  }).format(date);
}

export function formatLocalDateTimeParts(value: number | string | undefined, fallback = "--"): LocalDateTimeParts | null {
  const date = parseDateValue(value);
  if (!date) return fallback === "--" ? null : { date: fallback, time: "" };
  return {
    date: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(date),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date)
  };
}

export default function LocalDateTime({ fallback = "--", value }: LocalDateTimeProps) {
  const [clientLabel, setClientLabel] = useState<string | null>(null);

  useEffect(() => {
    setClientLabel(formatLocalDateTime(value, fallback));
  }, [fallback, value]);

  return <span suppressHydrationWarning>{clientLabel ?? fallback}</span>;
}

export function LocalDateTimeStack({ fallback = "--", value }: LocalDateTimeProps) {
  const [clientParts, setClientParts] = useState<LocalDateTimeParts | null>(null);

  useEffect(() => {
    setClientParts(formatLocalDateTimeParts(value, fallback));
  }, [fallback, value]);

  if (!clientParts) return <span suppressHydrationWarning>{fallback}</span>;

  return (
    <span className="localDateTimeStack" suppressHydrationWarning>
      <span>{clientParts.date}</span>
      {clientParts.time ? <small>{clientParts.time}</small> : null}
    </span>
  );
}
