"use client";

import { useTransition } from "react";
import type { ChallengeRules } from "@/lib/challenge";

type ChallengeRulesFormProps = {
  readOnly?: boolean;
  rules: ChallengeRules;
  onApply: (rules: ChallengeRules) => void;
};

function formNumber(formData: FormData, key: string, fallback: number, min = 0): number {
  const parsed = Number(formData.get(key));
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

function rulesFromForm(formData: FormData, fallback: ChallengeRules): ChallengeRules {
  return {
    startingBalance: formNumber(formData, "accountSize", fallback.startingBalance, 1),
    profitTarget: formNumber(formData, "profitTarget", fallback.profitTarget, 1),
    maximumLossLimit: formNumber(formData, "maxLoss", fallback.maximumLossLimit),
    dailyLossLimit: formNumber(formData, "dailyLoss", fallback.dailyLossLimit),
    dailyProfitLock: formNumber(formData, "dailyLock", fallback.dailyProfitLock),
    dailyLossStop: formNumber(formData, "dailyStop", fallback.dailyLossStop)
  };
}

export default function ChallengeRulesForm({ readOnly = false, rules, onApply }: ChallengeRulesFormProps) {
  const [isPending, startTransition] = useTransition();

  function applyRules(formData: FormData) {
    if (readOnly) return;
    const nextRules = rulesFromForm(formData, rules);
    startTransition(() => {
      onApply(nextRules);
    });
  }

  return (
    <form
      className={`challenge-rule-form${readOnly ? " isAccessRestricted adminOnlyRestrictedSurface" : ""}`}
      aria-disabled={readOnly}
      onSubmit={(event) => {
        event.preventDefault();
        applyRules(new FormData(event.currentTarget));
      }}
    >
      <label>
        <span>Account size</span>
        <input type="number" min="1000" step="1000" name="accountSize" defaultValue={rules.startingBalance} disabled={readOnly} />
      </label>
      <label>
        <span>Profit target</span>
        <input type="number" min="100" step="100" name="profitTarget" defaultValue={rules.profitTarget} disabled={readOnly} />
      </label>
      <label>
        <span>Max loss</span>
        <input type="number" min="0" step="100" name="maxLoss" defaultValue={rules.maximumLossLimit} disabled={readOnly} />
      </label>
      <label>
        <span>Daily loss</span>
        <input type="number" min="0" step="100" name="dailyLoss" defaultValue={rules.dailyLossLimit} disabled={readOnly} />
      </label>
      <label>
        <span>Daily lock</span>
        <input type="number" min="0" step="100" name="dailyLock" defaultValue={rules.dailyProfitLock} disabled={readOnly} />
      </label>
      <label>
        <span>Daily stop</span>
        <input type="number" min="0" step="100" name="dailyStop" defaultValue={rules.dailyLossStop} disabled={readOnly} />
      </label>
      <button
        type="button"
        disabled={isPending || readOnly}
        onClick={(event) => {
          if (event.currentTarget.form) {
            applyRules(new FormData(event.currentTarget.form));
          }
        }}
      >
        {readOnly ? "Admin only" : isPending ? "Applying" : "Apply"}
      </button>
    </form>
  );
}
