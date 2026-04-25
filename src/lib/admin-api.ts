export function adminApiSecret(): string | undefined {
  return process.env.APP_ADMIN_SECRET ?? process.env.CRON_SECRET;
}

export function isAdminAuthorized(request: Request): boolean {
  const secret = adminApiSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
