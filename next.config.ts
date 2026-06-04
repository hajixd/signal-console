import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["firebase-admin", "gcp-metadata", "google-auth-library"],
  outputFileTracingExcludes: {
    "/*": [
      "./.git/**",
      "./.local/**",
      "./backtest-engine/**",
      "./cache/**",
      "./data/**",
      "./docs/**",
      "./Research/backups/**",
      "./Research/promotions/**",
      "./Research/scripts/**",
      "./Research/sources/**",
      "./Research/strategies/**",
      "./strategy/research_summary.csv",
      "./strategy/tuning_summary.csv"
    ]
  },
  outputFileTracingIncludes: {
    "/*": [
      "./cache/backtest-manifest.json",
      "./cache/backtest-summary.json",
      "./cache/live-data-tails.json",
      "./strategy/**/backtest_trades.csv",
      "./node_modules/@google-cloud/**",
      "./node_modules/firebase-admin/**",
      "./node_modules/gaxios/**",
      "./node_modules/gcp-metadata/**",
      "./node_modules/google-auth-library/**",
      "./node_modules/google-logging-utils/**",
      "./node_modules/gtoken/**",
      "./node_modules/https-proxy-agent/**",
      "./node_modules/jwa/**",
      "./node_modules/jws/**",
      "./node_modules/next/dist/server/**"
    ]
  }
};

export default nextConfig;
