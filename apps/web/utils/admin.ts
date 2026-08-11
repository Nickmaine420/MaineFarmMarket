export const ADMIN_EMAILS = ["contactacontractorllc@gmail.com"] as const;

export const isAdminEmail = (email: string | null | undefined) =>
  ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase() as (typeof ADMIN_EMAILS)[number]);
