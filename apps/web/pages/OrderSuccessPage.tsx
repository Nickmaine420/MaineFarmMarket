import React from "react";
import { useNavigate, useSearchParams } from "../router";

export default function OrderSuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orderId = String(params.get("orderId") || "").trim();

  return (
    <main className="min-h-[70vh] bg-[#efe1b6] p-6">
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-7 text-center shadow-lg">
        <div
          aria-hidden="true"
          className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl text-emerald-800"
        >
          &#10003;
        </div>
        <h1 className="mt-5 text-3xl font-extrabold text-stone-900">
          Checkout complete
        </h1>
        <p className="mt-3 leading-7 text-stone-700">
          Your payment was submitted successfully. Maine Farm Market may need a
          moment to finish updating the order before it appears in your order list.
        </p>
        {orderId && (
          <p className="mt-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Order reference: <span className="font-bold">{orderId}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => navigate("/buyer/orders", { replace: true })}
          className="mt-6 w-full rounded-xl bg-emerald-800 px-5 py-3 font-bold text-white"
        >
          View my orders
        </button>
        <button
          type="button"
          onClick={() => navigate("/buyer", { replace: true })}
          className="mt-3 w-full rounded-xl border border-stone-300 px-5 py-3 font-bold text-stone-800"
        >
          Continue shopping
        </button>
      </section>
    </main>
  );
}
