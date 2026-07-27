import { useEffect, useState, type FormEvent } from "react";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useNavigate } from "../router";
import { isMaineZip } from "../utils/validation";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [mailingAddress, setMailingAddress] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const localDoneKey = user ? `buyer_onboarding_done_${user.uid}` : "";

  useEffect(() => {
    const run = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      // Firestore is authoritative; local state never bypasses account setup.
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        const data: any = snap.data();

        if (data?.buyerProfileComplete === true) {
          localStorage.setItem(localDoneKey, "true");
          navigate("/buyer", { replace: true });
          return;
        }

        setMailingAddress(data?.buyerAddress || "");
        setCity(data?.buyerCity || "");
        setZip(data?.buyerZip || "");
      }

      setLoading(false);
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;

    const trimmedZip = zip.trim();
    setErrorMessage("");
    if (!isMaineZip(trimmedZip)) {
      setErrorMessage("Please enter a valid Maine ZIP code.");
      return;
    }

    setSaving(true);
    try {
      const ref = doc(db, "users", user.uid);
      await setDoc(
        ref,
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
      navigate("/buyer", { replace: true });
    } catch (error) {
      console.error(error);
      setErrorMessage("We could not save your buyer profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div style={{ padding: 24 }}>
        <h2>Welcome to Maine Farm Market</h2>
        <p>Please sign in first.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 16, background: "#fff" }}>
        <h2 style={{ marginTop: 0 }}>Welcome to Maine Farm Market</h2>
        <p style={{ color: "#555" }}>
          Add your Maine location so producers can plan pickup or delivery. Your
          street address stays in your private account profile.
        </p>
        {errorMessage && (
          <div role="alert" style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#7f1d1d" }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
          <label style={{ fontWeight: 700 }}>Mailing Address</label>
          <input
            value={mailingAddress}
            onChange={(e) => setMailingAddress(e.target.value)}
            placeholder="123 Farm Way"
            autoComplete="street-address"
            style={{ padding: "12px 12px", borderRadius: 10, border: "1px solid #ddd" }}
            required
            disabled={saving}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
            <div>
              <label style={{ fontWeight: 700 }}>City/Town</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Portland"
                autoComplete="address-level2"
                style={{ padding: "12px 12px", borderRadius: 10, border: "1px solid #ddd", width: "100%" }}
                required
                disabled={saving}
              />
            </div>

            <div>
              <label style={{ fontWeight: 700 }}>State</label>
              <input
                value="Maine (ME)"
                readOnly
                style={{
                  padding: "12px 12px",
                  borderRadius: 10,
                  border: "1px solid #eee",
                  width: "100%",
                  background: "#fafafa",
                }}
              />
            </div>
          </div>

          <label style={{ fontWeight: 700 }}>Zip Code</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="04101"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            style={{ padding: "12px 12px", borderRadius: 10, border: "1px solid #ddd" }}
            required
            disabled={saving}
          />

          <button
            type="submit"
            disabled={saving}
            style={{
              marginTop: 6,
              padding: "14px 16px",
              borderRadius: 12,
              border: "none",
              background: "#111",
              color: "#fff",
              fontWeight: 900,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Verify and Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
