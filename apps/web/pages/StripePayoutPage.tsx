import { useLocation, useNavigate } from "react-router-dom";
import { startProducerStripeOnboarding } from "../lib/stripeConnectProducer";
import { useState } from "react";

export default function StripePayoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const isReturn = params.get("return") === "1";
  const isRefresh = params.get("refresh") === "1";
  const fromSetup = params.get("from") === "setup";
  const [errorMessage, setErrorMessage] = useState("");
  const [starting, setStarting] = useState(false);

  const start = async () => {
    try {
      setErrorMessage("");
      setStarting(true);
      await startProducerStripeOnboarding();
    } catch (error: any) {
      setErrorMessage(error?.message || "Stripe payout setup failed.");
      setStarting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#efe1b6] p-6">
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-7 shadow-lg">
        <div className="text-sm font-bold uppercase tracking-wide text-emerald-700">
          Optional producer payments
        </div>
        <h1 className="mt-2 text-3xl font-bold text-stone-900">Stripe payout setup</h1>
        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-900">
            {errorMessage}
          </p>
        )}

        {isReturn ? (
          <p className="mt-4 text-stone-700">
            Stripe returned you to Maine Farm Market. You may continue now; payout availability
            will depend on Stripe completing its account review.
          </p>
        ) : (
          <p className="mt-4 text-stone-700">
            Stripe Connect is optional. Set it up if you want eligible product payments routed
            through Stripe. You can also skip it and arrange payment directly with buyers.
          </p>
        )}

        {isRefresh && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900">
            The previous Stripe onboarding session expired. Start again when you are ready.
          </p>
        )}

        {!isReturn && (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white"
          >
            {starting
              ? "Opening Stripe…"
              : isRefresh
                ? "Restart optional Stripe setup"
                : "Set up Stripe payouts"}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            navigate(fromSetup || isReturn ? "/start-subscription" : "/producer", {
              replace: true,
            })
          }
          className="mt-3 w-full rounded-xl border border-stone-300 px-5 py-3 font-bold text-stone-800"
        >
          {isReturn ? "Continue" : "Skip for now"}
        </button>
      </section>
    </main>
  );
}
