import { useState } from "react";
import { Navigate, useNavigate } from "../router";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { PRODUCER_TERMS_SECTIONS, PRODUCER_TERMS_TITLE, PRODUCER_TERMS_VERSION } from "@mfm/shared";
import { useAuth } from "../App";
import { db } from "../firebase";

export default function ProducerTermsPage() {
  const { user, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedSafetyPromise, setAcceptedSafetyPromise] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  if (
    user.producerTermsVersion === PRODUCER_TERMS_VERSION &&
    user.producerTermsAcceptedAt
  ) {
    return <Navigate to="/producer/setup" replace />;
  }

  const accept = async () => {
    if (!acceptedTerms || !acceptedSafetyPromise || saving) return;
    setErrorMessage("");
    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          role: "producer",
          producerTerms: {
            accepted: true,
            version: PRODUCER_TERMS_VERSION,
            acceptedAt: serverTimestamp(),
            acceptedByUid: user.uid,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await refreshProfile();
      navigate("/producer/setup", { replace: true });
    } catch (error) {
      console.error("Producer terms acceptance failed:", error);
      setErrorMessage("We could not record your acceptance. Please try again.");
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#efe1b6] p-4 md:p-8">
      <section className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <div className="mb-5">
          <div className="text-sm font-bold uppercase tracking-wide text-emerald-700">
            Producer signup · Step 1 of 2
          </div>
          <h1 className="mt-2 text-3xl font-bold text-stone-900">{PRODUCER_TERMS_TITLE}</h1>
          <p className="mt-2 text-sm text-stone-600">Terms version {PRODUCER_TERMS_VERSION}</p>
        </div>
        {errorMessage && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorMessage}
          </div>
        )}

        <div className="max-h-[52vh] space-y-5 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-5">
          {PRODUCER_TERMS_SECTIONS.map((section, index) => (
            <section key={section.heading}>
              <h2 className="font-bold text-stone-900">
                {index + 1}. {section.heading}
              </h2>
              <p className="mt-1 leading-6 text-stone-700">{section.body}</p>
            </section>
          ))}
          <p className="border-t border-stone-200 pt-4 text-sm text-stone-600">
            These terms establish marketplace rules and do not replace the licenses, permits,
            insurance, legal advice, or regulatory guidance that may apply to your goods or business.
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
            />
            <span className="text-stone-800">
              I have read and agree to the Maine Farm Market Producer Terms and Safety Agreement.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={acceptedSafetyPromise}
              onChange={(event) => setAcceptedSafetyPromise(event.target.checked)}
            />
            <span className="font-medium text-stone-900">
              I verify that I will not use this marketplace illegally, recklessly, dangerously,
              deceptively, manipulatively, or harmfully.
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={accept}
          disabled={!acceptedTerms || !acceptedSafetyPromise || saving}
          className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Recording acceptance…" : "Accept and set up producer account"}
        </button>
      </section>
    </main>
  );
}
