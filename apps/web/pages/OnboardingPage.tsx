import { useEffect, useState, type FormEvent } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "../App";
import { auth, db } from "../firebase";
import { useNavigate } from "../router";
import { isMaineZip } from "../utils/validation";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [mailingAddress, setMailingAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const localDoneKey = user ? `buyer_onboarding_done_${user.uid}` : "";

  useEffect(() => {
    let active = true;

    const run = async () => {
      if (!user) {
        if (active) setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage("");
      try {
        // Firestore is authoritative; local state never bypasses account setup.
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!active) return;

        if (snap.exists()) {
          const data: any = snap.data();
          if (data?.buyerProfileComplete === true) {
            localStorage.setItem(localDoneKey, "true");
            await refreshProfile();
            navigate("/buyer", { replace: true });
            return;
          }

          setMailingAddress(data?.buyerAddress || "");
          setCity(data?.buyerCity || "");
          setZip(data?.buyerZip || "");
        }
      } catch (error) {
        console.error("Buyer profile load failed:", error);
        if (active) {
          setErrorMessage(
            "We could not load your profile. Check your connection and try again."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
    // refreshProfile and navigate are stable for the lifetime of this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, loadAttempt]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    const trimmedZip = zip.trim();
    setErrorMessage("");
    if (!isMaineZip(trimmedZip)) {
      setErrorMessage("Please enter a valid Maine ZIP code.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          buyerAddress: mailingAddress.trim(),
          buyerCity: city.trim(),
          buyerZip: trimmedZip,
          buyerState: "ME",
          buyerProfileComplete: true,
        },
        { merge: true }
      );

      localStorage.setItem(localDoneKey, "true");
      // Refresh Auth context before routing. ProtectedRoute otherwise sees the
      // old buyerProfileComplete=false value and sends the buyer back here.
      await refreshProfile();
      navigate("/buyer", { replace: true });
    } catch (error) {
      console.error("Buyer profile save failed:", error);
      setErrorMessage("We could not save your buyer profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <main className="grid min-h-[55vh] place-items-center px-5 text-center">
        <div>
          <h1 className="text-2xl font-extrabold">Welcome to Maine Farm Market</h1>
          <p className="mt-2 text-stone-600">Please sign in first.</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="grid min-h-[55vh] place-items-center bg-[#efe1b6] px-5 text-center">
        <div role="status" aria-live="polite">
          <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-emerald-800/20 border-t-emerald-800" />
          <p className="mt-4 font-semibold text-stone-700">Loading your buyer setup…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#efe1b6] px-4 py-8 sm:py-12">
      <section className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-xl shadow-stone-900/5">
        <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-4">
          <p className="text-sm font-bold uppercase tracking-wide text-emerald-800">
            Buyer setup · About 1 minute
          </p>
        </div>

        <div className="p-6 sm:p-8">
          <h1 className="text-3xl font-extrabold text-stone-900">
            Welcome to Maine Farm Market
          </h1>
          <p className="mt-3 leading-7 text-stone-600">
            Add your Maine location so producers can plan pickup or delivery. Your
            street address stays in your private account profile.
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            >
              {errorMessage}
              {!saving && (
                <button
                  type="button"
                  className="ml-2 font-bold underline"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            <label className="text-sm font-bold text-stone-800">
              Mailing address
              <input
                value={mailingAddress}
                onChange={(event) => setMailingAddress(event.target.value)}
                placeholder="123 Farm Way"
                autoComplete="street-address"
                className="mt-1 w-full rounded-xl border border-stone-300 px-4 py-3 font-normal"
                required
                disabled={saving}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <label className="text-sm font-bold text-stone-800">
                City or town
                <input
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Waterville"
                  autoComplete="address-level2"
                  className="mt-1 w-full rounded-xl border border-stone-300 px-4 py-3 font-normal"
                  required
                  disabled={saving}
                />
              </label>

              <label className="text-sm font-bold text-stone-800">
                State
                <input
                  value="Maine (ME)"
                  readOnly
                  className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 font-normal text-stone-600"
                />
              </label>
            </div>

            <label className="text-sm font-bold text-stone-800">
              ZIP code
              <input
                value={zip}
                onChange={(event) => setZip(event.target.value)}
                placeholder="04901"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={10}
                className="mt-1 w-full rounded-xl border border-stone-300 px-4 py-3 font-normal"
                required
                disabled={saving}
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="mt-2 min-h-12 rounded-xl bg-emerald-800 px-5 py-3 font-extrabold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save and start shopping"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
