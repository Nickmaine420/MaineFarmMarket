type AuthLikeError = {
  code?: unknown;
  message?: unknown;
};

export function getGoogleSignInErrorMessage(error: unknown): string {
  const authError = (error ?? {}) as AuthLikeError;
  const code = String(authError.code ?? "").toLowerCase();
  const message = String(authError.message ?? "").toLowerCase();
  const details = `${code} ${message}`;

  if (
    details.includes("popup-closed-by-user") ||
    details.includes("cancelled-popup-request") ||
    details.includes("canceled") ||
    details.includes("cancelled") ||
    details.includes("12501")
  ) {
    return "Google sign-in was canceled. Please try again when you’re ready.";
  }

  if (details.includes("popup-blocked")) {
    return "Your browser blocked the Google sign-in window. Allow pop-ups for Maine Farm Market and try again.";
  }

  if (
    details.includes("network-request-failed") ||
    details.includes("network error") ||
    details.includes("offline")
  ) {
    return "Google sign-in could not reach the network. Check your connection and try again.";
  }

  if (
    details.includes("unauthorized-domain") ||
    details.includes("operation-not-allowed") ||
    details.includes("developer_error") ||
    details.includes("developer error") ||
    /(^|\s)10(?::|\s|$)/.test(details)
  ) {
    return "Google sign-in is temporarily unavailable for this app. Please contact MaineFarmMarket@gmail.com.";
  }

  if (details.includes("account-exists-with-different-credential")) {
    return "An account already exists for this email with a different sign-in method. Contact MaineFarmMarket@gmail.com for help.";
  }

  return "We couldn’t sign you in with Google. Please try again. If it continues, contact MaineFarmMarket@gmail.com.";
}
