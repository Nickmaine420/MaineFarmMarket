import React from "react";
import { Link, useNavigate } from "../router";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

  const goBack = () => {
    const routeDepth = Number(
      window.history.state?.maineFarmMarketDepth ?? 0
    );
    if (routeDepth > 0) {
      window.history.back();
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <main className="min-h-screen bg-[#efe1b6] px-4 py-6 sm:px-6 sm:py-10">
      <div
        aria-label="Privacy page navigation"
        className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-3"
      >
        <button
          type="button"
          aria-label="Back"
          onClick={goBack}
          className="min-h-11 rounded-xl border border-emerald-900 bg-white px-4 py-2 font-bold text-emerald-950 shadow-sm"
        >
          &larr; Back
        </button>
        <Link
          to="/"
          className="min-h-11 rounded-xl bg-emerald-900 px-4 py-2.5 font-bold text-white shadow-sm"
        >
          Maine Farm Market home
        </Link>
      </div>

      <article className="mx-auto max-w-4xl rounded-2xl bg-white p-6 shadow-lg sm:p-10">
        <h1 className="text-3xl font-extrabold leading-tight text-emerald-950 sm:text-4xl">
          Maine Farm Market Privacy Policy
        </h1>
        <p className="mt-2 text-stone-600">Effective July 26, 2026</p>
        <p className="mt-5 leading-7 text-stone-700">
          Maine Farm Market is operated by CAC-USA Developers LLC (in formation).
          This policy explains how the Maine Farm Market website and Android app
          collect, use, disclose, retain, and delete information.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Information we collect</h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-stone-700">
          <li>Google sign-in information, including name, email address, and account identifier.</li>
          <li>Buyer profile and fulfillment information, such as mailing address, Maine city, and ZIP code.</li>
          <li>Producer information, including farm or business name, phone number, location, description, payment preference, and onboarding status.</li>
          <li>Marketplace content, including product listings, descriptions, prices, quantities, images, farm profiles, reports, and blocked-account choices.</li>
          <li>Cart, order, fulfillment, payment-status, subscription, customer-support, security, and transaction records.</li>
          <li>
            Precise device location only when you choose &ldquo;Set My Location.&rdquo; It is used
            to sort nearby farms and is stored in local app or browser storage, not published
            to other users. Producer-supplied farm locations may be displayed publicly.
          </li>
        </ul>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">How we use information</h2>
        <p className="mt-3 leading-7 text-stone-700">
          We use information to authenticate users; create and administer buyer and producer
          accounts; show marketplace listings; calculate nearby farms; process and document
          orders; provide optional Stripe product payments; manage producer subscriptions;
          prevent fraud and misuse; respond to support requests; enforce marketplace rules;
          and comply with legal, tax, safety, and accounting obligations.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Service providers and disclosure</h2>
        <p className="mt-3 leading-7 text-stone-700">
          We use Google Firebase for authentication, hosting, database, file storage, and
          server functions. Google Play processes producer subscriptions purchased in the
          Android app. Stripe processes producer subscriptions purchased on the website and
          optional marketplace payments. These providers process information under their
          own terms and privacy practices. We do not sell personal information or use it
          for third-party behavioral advertising.
        </p>
        <p className="mt-3 leading-7 text-stone-700">
          Marketplace information that a producer publishes&mdash;such as farm name, product
          listings, product images, general location, and pickup contact details&mdash;may be
          visible to signed-in buyers. We may disclose information when required by law or
          reasonably necessary to protect users, investigate misuse, or enforce our rules.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Data security and retention</h2>
        <p className="mt-3 leading-7 text-stone-700">
          Data is encrypted in transit. Access is limited using authentication and database
          security rules. No system can guarantee absolute security. Profile and marketplace
          data is kept while an account is active. After deletion, most account data is
          removed promptly and within 30 days. Transaction, fraud-prevention, tax, payment,
          safety, and legal records may be retained for up to seven years or longer when
          required by law. Service providers may retain records under their own policies.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Your choices and account deletion</h2>
        <p className="mt-3 leading-7 text-stone-700">
          You may change profile and listing information in the service, clear locally
          stored location data, report listings, block producers, and manage optional Stripe
          services. Producer subscriptions can be managed through the billing provider used
          to purchase them, including Google Play subscription settings on Android. To
          delete an account, open <strong>Account and safety</strong> in the app and choose
          <strong> Permanently delete my account</strong>, or follow the instructions on our{" "}
          <a className="font-bold text-emerald-800 underline" href="/delete-account.html">
            account deletion page
          </a>.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Children</h2>
        <p className="mt-3 leading-7 text-stone-700">
          The marketplace is intended for a general audience aged 13 and older and is not
          directed to children under 13. A parent or guardian who believes a child supplied
          personal information may contact us to request its removal.
        </p>

        <h2 className="mt-8 text-2xl font-bold text-emerald-950">Contact us</h2>
        <p className="mt-3 leading-7 text-stone-700">
          Email{" "}
          <a className="font-bold text-emerald-800 underline" href="mailto:mainefarmmarket@gmail.com">
            mainefarmmarket@gmail.com
          </a>, call{" "}
          <a className="font-bold text-emerald-800 underline" href="tel:+12074314518">
            207-431-4518
          </a>, or visit{" "}
          <a className="font-bold text-emerald-800 underline" href="https://mainefarmmarket.com">
            mainefarmmarket.com
          </a>.
        </p>

        <div className="mt-10 border-t border-stone-200 pt-6">
          <button
            type="button"
            aria-label="Return to the app"
            onClick={goBack}
            className="min-h-11 w-full rounded-xl bg-emerald-900 px-5 py-3 font-bold text-white sm:w-auto"
          >
            &larr; Return to the app
          </button>
        </div>
      </article>
    </main>
  );
}
