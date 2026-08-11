import React, { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../App";
import { isAdminEmail } from "../utils/admin";

type AdminReport = {
  id: string;
  status?: string;
  listingId?: string;
  reportedUserId?: string;
  reason?: string;
  createdAt?: number;
};

type AdminDispute = {
  id: string;
  orderId?: string;
  openedByRole?: string;
  reason?: string;
  status?: string;
  resolution?: string;
  updatedAt?: number;
};

type AdminOrder = {
  id: string;
  status?: string;
  paymentMode?: string;
  paymentStatus?: string;
  disputeStatus?: string | null;
  totalCents?: number;
  refundedCents?: number;
  createdAt?: number;
};

type DashboardData = {
  reports: AdminReport[];
  disputes: AdminDispute[];
  orders: AdminOrder[];
};

const money = (cents = 0) =>
  (Number(cents) / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });

const date = (value?: number) =>
  value ? new Date(value).toLocaleString() : "Not available";

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const getDashboard = httpsCallable<Record<string, never>, DashboardData>(
        functions,
        "getAdminDashboard"
      );
      const response = await getDashboard({});
      setData(response.data);
    } catch (err: any) {
      setError(err?.message || "Could not load administration data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user || !isAdminEmail(user.email)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
          This account is not authorized to use Maine Farm Market administration.
        </div>
      </main>
    );
  }

  async function resolveReport(reportId: string, status: "resolved" | "dismissed") {
    try {
      setPending(reportId);
      const call = httpsCallable(functions, "resolveAdminReport");
      await call({ reportId, status, resolution: resolutionNotes[reportId] || "Reviewed" });
      setMessage(`Report ${status}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not update the report.");
    } finally {
      setPending(null);
    }
  }

  async function resolveDispute(disputeId: string, status: "resolved" | "dismissed") {
    const resolution = (resolutionNotes[disputeId] || "").trim();
    if (resolution.length < 3) {
      setError("Enter a resolution note before closing a dispute.");
      return;
    }
    try {
      setPending(disputeId);
      const call = httpsCallable(functions, "resolveAdminDispute");
      await call({ disputeId, status, resolution });
      setMessage(`Dispute ${status}.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not update the dispute.");
    } finally {
      setPending(null);
    }
  }

  async function refundOrder(order: AdminOrder) {
    const remaining = Math.max(0, Number(order.totalCents || 0) - Number(order.refundedCents || 0));
    const amountText = (refundAmounts[order.id] || "").trim();
    const amountCents = amountText ? Math.round(Number(amountText) * 100) : remaining;
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > remaining) {
      setError("Enter a refund amount no greater than the remaining order total.");
      return;
    }
    if (!window.confirm(`Refund ${money(amountCents)} for order ${order.id}?`)) return;
    try {
      setPending(order.id);
      const call = httpsCallable(functions, "refundMarketplaceOrder");
      const response: any = await call({
        orderId: order.id,
        amountCents,
        requestId:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}_${order.id}`,
      });
      setMessage(
        response.data?.status === "succeeded"
          ? `Refunded ${money(amountCents)} for order ${order.id}.`
          : `Refund request for ${money(amountCents)} is ${response.data?.status || "pending"}. The dashboard will update when Stripe finishes processing it.`
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not refund the order.");
    } finally {
      setPending(null);
    }
  }

  async function reconcileSubscriptions() {
    try {
      setPending("reconcile");
      const call = httpsCallable<Record<string, never>, { inspected: number; updated: number }>(
        functions,
        "reconcileProducerSubscriptions"
      );
      const response = await call({});
      setMessage(
        `Subscription reconciliation inspected ${response.data.inspected} and corrected ${response.data.updated} producer account(s).`
      );
    } catch (err: any) {
      setError(err?.message || "Could not reconcile subscriptions.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-stone-900">Marketplace Administration</h1>
          <p className="mt-1 text-sm text-stone-600">Reports, disputes, refunds, and subscription integrity.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void reconcileSubscriptions()} disabled={pending === "reconcile"} className="rounded-xl bg-amber-100 px-4 py-2 font-semibold text-amber-900 disabled:opacity-50">
            Reconcile subscriptions
          </button>
          <button onClick={() => void load()} className="rounded-xl bg-stone-200 px-4 py-2 font-semibold">Refresh</button>
        </div>
      </div>

      {message && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{message}</div>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">{error}</div>}
      {loading && <div className="mt-8 text-stone-600">Loading administration data...</div>}

      {!loading && data && (
        <div className="mt-8 grid gap-8 xl:grid-cols-2">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Open disputes</h2>
            <div className="mt-4 space-y-4">
              {data.disputes.filter((item) => item.status === "open").length === 0 && <p className="text-stone-500">No open disputes.</p>}
              {data.disputes.filter((item) => item.status === "open").map((item) => (
                <article key={item.id} className="rounded-xl border p-4">
                  <div className="font-semibold">Order {item.orderId || "unknown"}</div>
                  <div className="text-xs text-stone-500">Opened by {item.openedByRole || "member"} · {date(item.updatedAt)}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{item.reason}</p>
                  <textarea value={resolutionNotes[item.id] || ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-3 w-full rounded-lg border p-2 text-sm" placeholder="Resolution note" />
                  <div className="mt-3 flex gap-2">
                    <button disabled={pending === item.id} onClick={() => void resolveDispute(item.id, "resolved")} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Resolve</button>
                    <button disabled={pending === item.id} onClick={() => void resolveDispute(item.id, "dismissed")} className="rounded-lg bg-stone-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">Dismiss</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Open listing reports</h2>
            <div className="mt-4 space-y-4">
              {data.reports.filter((item) => item.status === "open").length === 0 && <p className="text-stone-500">No open reports.</p>}
              {data.reports.filter((item) => item.status === "open").map((item) => (
                <article key={item.id} className="rounded-xl border p-4">
                  <div className="font-semibold">Listing {item.listingId}</div>
                  <div className="text-xs text-stone-500">Reported producer {item.reportedUserId} · {date(item.createdAt)}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{item.reason}</p>
                  <input value={resolutionNotes[item.id] || ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="mt-3 w-full rounded-lg border p-2 text-sm" placeholder="Review note (optional)" />
                  <div className="mt-3 flex gap-2">
                    <button disabled={pending === item.id} onClick={() => void resolveReport(item.id, "resolved")} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Resolve</button>
                    <button disabled={pending === item.id} onClick={() => void resolveReport(item.id, "dismissed")} className="rounded-lg bg-stone-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">Dismiss</button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm xl:col-span-2">
            <h2 className="text-xl font-bold">Recent orders and refunds</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {data.orders.map((order) => {
                const remaining = Math.max(0, Number(order.totalCents || 0) - Number(order.refundedCents || 0));
                const refundable = order.paymentMode === "stripe" && remaining > 0 && !["pending", "pending_payment"].includes(String(order.paymentStatus));
                return (
                  <article key={order.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Order {order.id}</div>
                        <div className="text-xs text-stone-500">{date(order.createdAt)}</div>
                      </div>
                      <div className="text-right text-sm font-semibold">{money(order.totalCents)}</div>
                    </div>
                    <div className="mt-2 text-sm text-stone-700">{order.status} · {order.paymentMode} · {order.paymentStatus}</div>
                    {order.refundedCents ? <div className="mt-1 text-sm text-amber-800">Refunded: {money(order.refundedCents)}</div> : null}
                    {refundable && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <input type="number" min="0.01" max={(remaining / 100).toFixed(2)} step="0.01" value={refundAmounts[order.id] || ""} onChange={(event) => setRefundAmounts((current) => ({ ...current, [order.id]: event.target.value }))} className="w-36 rounded-lg border p-2 text-sm" placeholder={`Full ${money(remaining)}`} />
                        <button disabled={pending === order.id} onClick={() => void refundOrder(order)} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Issue refund</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
