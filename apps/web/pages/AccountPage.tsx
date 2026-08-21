import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "../router";
import { collection, deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../App";
import { db, functions } from "../firebase";

type BlockedAccount = {
  id: string;
  displayName?: string;
};

export default function AccountPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [blockedAccounts, setBlockedAccounts] = useState<BlockedAccount[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    return onSnapshot(collection(db, "users", user.uid, "blocked"), (snapshot) => {
      setBlockedAccounts(
        snapshot.docs.map((blockedDoc) => ({
          id: blockedDoc.id,
          ...(blockedDoc.data() as Omit<BlockedAccount, "id">),
        }))
      );
    });
  }, [user?.uid]);

  if (loading) return <main className="p-6">Loading...</main>;
  if (!user) return <Navigate to="/" replace />;

  const unblock = async (blockedUserId: string) => {
    await deleteDoc(doc(db, "users", user.uid, "blocked", blockedUserId));
  };

  const deleteAccount = async () => {
    if (confirmation !== "DELETE" || deleting) return;
    if (
      !window.confirm(
        "Permanently delete your Maine Farm Market account? This cannot be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    setErrorMessage("");
    try {
      const requestDeletion = httpsCallable<Record<string, never>, { deleted: boolean }>(
        functions,
        "deleteMyAccount"
      );
      await requestDeletion({});
      localStorage.removeItem("mfm_cart");
      localStorage.removeItem("mfm_cart_items");
      localStorage.removeItem("mfm_buyer_location");
      await logout().catch(() => undefined);
      navigate("/", { replace: true });
    } catch (error: any) {
      console.error("Account deletion failed:", error);
      setErrorMessage(
        error?.message ||
          "We could not delete your account. Contact mainefarmmarket@gmail.com for help."
      );
      setDeleting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#efe1b6] p-4 md:p-8">
      <section className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow">
          <h1 className="text-3xl font-bold text-stone-900">Account and safety</h1>
          <p className="mt-2 text-stone-700">{user.email}</p>
          <p className="mt-3 text-sm text-stone-600">
            Review your blocked accounts or permanently delete your Maine Farm Market
            account and associated profile data.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <h2 className="text-xl font-bold text-stone-900">Blocked producers</h2>
          {blockedAccounts.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">You have not blocked anyone.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {blockedAccounts.map((blocked) => (
                <li
                  key={blocked.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <span className="text-sm font-medium text-stone-800">
                    {blocked.displayName || "Blocked producer"}
                  </span>
                  <button
                    type="button"
                    onClick={() => unblock(blocked.id)}
                    className="rounded-lg bg-stone-100 px-3 py-2 text-sm font-bold text-stone-800"
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="group rounded-2xl border border-red-200 bg-white shadow">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-6 py-4 font-bold text-red-800 marker:content-none">
            <span>
              <span className="block text-xs uppercase tracking-wider text-stone-500">
                Danger zone
              </span>
              Account deletion options
            </span>
            <span aria-hidden="true" className="text-2xl transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="border-t border-red-100 px-6 pb-6 pt-5">
            <h2 className="text-xl font-bold text-red-800">Delete account</h2>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              Deletion removes your sign-in account, profile, cart, listings, farm profile,
              uploaded listing images, and blocked-account list. Producer subscriptions are
              canceled. Transaction, fraud-prevention, tax, and legal records may be retained
              for up to seven years and are disconnected from your public profile where
              practical.
            </p>
            {errorMessage && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                {errorMessage}
              </p>
            )}
            <label className="mt-4 block text-sm font-bold text-stone-900">
              Type DELETE to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-2 w-full rounded-lg border border-stone-300 p-3 font-normal"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              disabled={confirmation !== "DELETE" || deleting}
              onClick={deleteAccount}
              className="mt-4 w-full rounded-xl bg-red-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? "Deleting account..." : "Permanently delete my account"}
            </button>
            <p className="mt-4 text-xs text-stone-600">
              You can also request deletion at{" "}
              <a className="underline" href="mailto:mainefarmmarket@gmail.com">
                mainefarmmarket@gmail.com
              </a>
              .
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
