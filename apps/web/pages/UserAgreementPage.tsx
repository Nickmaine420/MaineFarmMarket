import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { auth, db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { Navigate } from "react-router-dom";
import { hasAcceptedUserAgreement } from "../utils/agreements";

const AGREEMENT_TEXT = `
Maine Farm Market User Agreement

By using Maine Farm Market ("the platform"), you agree to the following terms:

1. Eligibility
You must be located in Maine to buy or sell on the platform. You represent that the information you provide is accurate.

2. Conduct
You will use the platform only for lawful purposes. You will not harass other users, post false or misleading information, or misuse the marketplace.

3. Transactions
Buyers and producers are responsible for their own transactions. The platform facilitates connections but is not a party to sales. Producers are responsible for product quality, fulfillment, and compliance with applicable laws.

4. Subscription
Access to the marketplace requires an active subscription. Fees are billed in advance. You may cancel in accordance with the subscription terms.

5. Privacy
We collect and use account and usage data as described in our privacy practices. By using the platform you consent to such collection and use.

6. Termination
We may suspend or terminate access for violation of these terms or for any other reason at our discretion.

7. Changes
We may update this agreement from time to time. Continued use after changes constitutes acceptance.

By clicking "Continue" you confirm that you have read and agree to this User Agreement.
`.trim();

export default function UserAgreementPage() {
  const { user, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyAccepted, setAlreadyAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    hasAcceptedUserAgreement(db, user.uid).then((result) => {
      if (!cancelled) setAlreadyAccepted(result);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  if (alreadyAccepted === true) return <Navigate to="/start-subscription" replace />;
  if (alreadyAccepted === null) return <div className="p-6">Loading…</div>;

  const handleContinue = async () => {
    if (!agreed || !auth.currentUser?.uid) return;
    setSubmitting(true);
    try {
      const uid = auth.currentUser.uid;
      await setDoc(
        doc(db, "users", uid),
        {
          acceptedUserAgreement: true,
          acceptedUserAgreementAt: serverTimestamp(),
          userAgreementAcceptedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await refreshProfile();
      navigate("/start-subscription", { replace: true });
    } catch (e) {
      console.error("User agreement accept failed:", e);
      alert("Could not save. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#efe1b6] flex flex-col items-center p-6">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-lg p-6 flex flex-col max-h-[90vh]">
        <h1 className="text-2xl font-bold text-stone-800 mb-4">User Agreement</h1>
        <p className="text-sm text-stone-600 mb-4">Please read and accept the agreement below to continue.</p>
        <div className="flex-1 min-h-0 overflow-y-auto border border-stone-200 rounded-lg p-4 mb-6 bg-stone-50">
          <pre className="whitespace-pre-wrap font-sans text-sm text-stone-700">{AGREEMENT_TEXT}</pre>
        </div>
        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="w-5 h-5 rounded border-stone-300"
          />
          <span className="font-medium text-stone-800">I agree</span>
        </label>
        <button
          onClick={handleContinue}
          disabled={!agreed || submitting}
          className="w-full py-3 rounded-xl font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: agreed && !submitting ? "#0f7a4a" : "#888" }}
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
