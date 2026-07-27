import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { PRODUCER_TERMS_VERSION } from "@mfm/shared";
import { useAuth } from "../App";
import { db } from "../firebase";
import { hasUsPhoneNumber, isMaineZip } from "../utils/validation";

type PaymentPreference = "direct" | "stripe";

export default function ProducerOnboardingPage() {
  const { user, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [farmName, setFarmName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [description, setDescription] = useState("");
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>("direct");
  const [pickupAvailable, setPickupAvailable] = useState(true);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [legacyAddressLine1, setLegacyAddressLine1] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, "farms", user.uid))
      .then((snapshot) => {
        if (cancelled) return;
        const data = snapshot.exists() ? snapshot.data() : {};
        setFarmName(String(data.farmName || user.displayName || ""));
        setPhone(String(data.phone || ""));
        setCity(String(data.city || ""));
        setZip(String(data.zip || ""));
        setDescription(String(data.description || ""));
        setPickupAvailable(data.pickupAvailable !== false);
        setDeliveryAvailable(data.deliveryAvailable === true);
        setLegacyAddressLine1(String(data.addressLine1 || ""));
        setPaymentPreference(
          data.paymentPreference === "stripe" ||
            user.producerPaymentPreference === "stripe" ||
            user.hasStripeConnectAccount
            ? "stripe"
            : "direct"
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingProfile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || loadingProfile) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  if (
    user.producerTermsVersion !== PRODUCER_TERMS_VERSION ||
    !user.producerTermsAcceptedAt
  ) {
    return <Navigate to="/producer/terms" replace />;
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    if (!farmName.trim() || !city.trim()) {
      setErrorMessage("Provide your farm or business name and Maine city or town.");
      return;
    }
    if (!hasUsPhoneNumber(phone)) {
      setErrorMessage("Enter a phone number buyers can use for pickup or delivery.");
      return;
    }
    if (!isMaineZip(zip)) {
      setErrorMessage("Enter a valid Maine ZIP code.");
      return;
    }
    if (!pickupAvailable && !deliveryAvailable) {
      setErrorMessage("Choose pickup, delivery, or both.");
      return;
    }

    setSaving(true);
    try {
      const completedAt = serverTimestamp();
      await setDoc(
          doc(db, "users", user.uid),
          {
            role: "producer",
            producerOnboarding: {
              completed: true,
              completedAt,
              paymentPreference,
            },
            ...(legacyAddressLine1
              ? { producerPrivate: { addressLine1: legacyAddressLine1 } }
              : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      await setDoc(
          doc(db, "farms", user.uid),
          {
            producerUid: user.uid,
            farmName: farmName.trim(),
            phone: phone.trim(),
            city: city.trim(),
            state: "ME",
            zip: zip.trim(),
            description: description.trim(),
            addressLine1: deleteField(),
            paymentPreference,
            acceptsStripePayments:
              paymentPreference === "stripe" && user.hasStripeConnectAccount === true,
            pickupAvailable,
            deliveryAvailable,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      await refreshProfile();
      navigate(
        paymentPreference === "stripe"
          ? "/producer/payouts?from=setup"
          : "/start-subscription",
        { replace: true }
      );
    } catch (error) {
      console.error("Producer setup failed:", error);
      setErrorMessage("We could not save your producer account. Please try again.");
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#efe1b6] p-4 md:p-8">
      <form
        onSubmit={save}
        className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8"
      >
        <div className="text-sm font-bold uppercase tracking-wide text-emerald-700">
          Producer signup · Step 2 of 2
        </div>
        <h1 className="mt-2 text-3xl font-bold text-stone-900">Set up your producer account</h1>
        <p className="mt-2 text-stone-600">
          Tell buyers who you are and choose how you want to handle product payments.
        </p>
        {errorMessage && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-stone-800">Farm or business name</span>
            <input
              value={farmName}
              onChange={(event) => setFarmName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 p-3"
              autoComplete="organization"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-800">Phone</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 p-3"
              type="tel"
              autoComplete="tel"
              required
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-stone-800">Maine ZIP code</span>
            <input
              value={zip}
              onChange={(event) => setZip(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 p-3"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={10}
              required
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-stone-800">Maine city or town</span>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-300 p-3"
              autoComplete="address-level2"
              required
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-stone-800">About your operation</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 min-h-28 w-full rounded-lg border border-stone-300 p-3"
              placeholder="What do you grow, raise, make, or produce?"
              maxLength={1000}
            />
          </label>
        </div>

        <fieldset className="mt-7">
          <legend className="font-bold text-stone-900">Fulfillment options</legend>
          <p className="mt-1 text-sm text-stone-600">
            Select every option you currently offer. You can change these later.
          </p>
          <label className="mt-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={pickupAvailable}
              onChange={(event) => setPickupAvailable(event.target.checked)}
            />
            <span>Buyer pickup</span>
          </label>
          <label className="mt-3 flex items-center gap-3">
            <input
              type="checkbox"
              checked={deliveryAvailable}
              onChange={(event) => setDeliveryAvailable(event.target.checked)}
            />
            <span>Producer delivery</span>
          </label>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="font-bold text-stone-900">How will buyers pay for your goods?</legend>
          <p className="mt-1 text-sm text-stone-600">
            This choice is separate from your Maine Farm Market access subscription.
          </p>
          <label className="mt-4 flex cursor-pointer gap-3 rounded-xl border border-stone-200 p-4">
            <input
              type="radio"
              name="paymentPreference"
              value="direct"
              checked={paymentPreference === "direct"}
              onChange={() => setPaymentPreference("direct")}
              className="mt-1"
            />
            <span>
              <strong className="block text-stone-900">Direct payment — no Stripe account</strong>
              <span className="text-sm text-stone-600">
                Arrange payment directly with the buyer, such as at pickup or delivery.
              </span>
            </span>
          </label>
          <label className="mt-3 flex cursor-pointer gap-3 rounded-xl border border-stone-200 p-4">
            <input
              type="radio"
              name="paymentPreference"
              value="stripe"
              checked={paymentPreference === "stripe"}
              onChange={() => setPaymentPreference("stripe")}
              className="mt-1"
            />
            <span>
              <strong className="block text-stone-900">Optional Stripe payouts</strong>
              <span className="text-sm text-stone-600">
                Set up a Stripe Connect account after saving. You may skip or change this later.
              </span>
            </span>
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={saving}
          className="mt-7 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving account…" : "Save producer account and continue"}
        </button>
      </form>
    </main>
  );
}
