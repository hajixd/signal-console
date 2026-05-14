"use client";

import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";

type AdminOnlyTextProps = {
  className?: string;
  fallback?: string;
  value: string;
};

export default function AdminOnlyText({ className = "", fallback = "Admin only", value }: AdminOnlyTextProps) {
  const isAdmin = useAutoTradeAdminMode();
  const classNames = [className, isAdmin ? "" : "adminOnlyMaskedText"].filter(Boolean).join(" ");

  return <span className={classNames}>{isAdmin ? value : fallback}</span>;
}
