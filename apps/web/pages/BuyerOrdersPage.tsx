import React, { useEffect, useMemo, useState } from "react";
import { auth, db, functions } from "../firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { useNavigate } from "../router";
import { formatMarketplaceLabel } from "../utils/display";

function formatMoney(cents: number) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatTimestamp(ts: any): string {
  if (!ts) return "Not available";
  try {
    if (ts && typeof ts.toDate === "function") return ts.toDate().toLocaleString();
    if (ts && typeof ts.seconds === "number") return new Date(ts.seconds * 1000).toLocaleString();
    if (ts instanceof Date) return ts.toLocaleString();
    if (typeof ts === "number") return new Date(ts).toLocaleString();
  } catch {
    // ignore
  }
  return "Not available";
}

type OrderItem = {
  name: string;
  title?: string;
  qty: number;
  unit?: string;
  priceCents: number;
  lineTotalCents?: number;
  lineSubtotal?: number;
  producerId?: string;
  producerName?: string;
  producerTown?: string;
  producerPhone?: string;
};

type PerProducerEntry = {
  fulfillmentMethod?: "pickup" | "delivery";
  window?: { id?: string; label?: string; startTime?: string; endTime?: string };
  scheduledAt?: string;
  pickupPartner?: { producerId?: string; farmName?: string; city?: string; state?: string; phone?: string; hours?: string } | null;
};

type Order = {
  id: string;
  status?: string;
  subtotalCents?: number;
  totalCents?: number;
  processingFeeCents?: number;
  items?: OrderItem[];
  itemsSnapshot?: OrderItem[];
  itemsPaidSnapshot?: any[];
  perProducer?: Record<string, PerProducerEntry>;
  scheduledAt?: string | null;
  pickupDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  createdAt?: any;
  paidAt?: any;
  updatedAt?: any;
  paymentMode?: "direct" | "stripe";
  paymentStatus?: string;
  producerStatuses?: Record<string, { status?: string }>;
  reservationExpiresAt?: any;
  disputeStatus?: string;
};

type ProducerInfo = {
  displayName?: string;
  town?: string;
  phone?: string;
};

export default function BuyerOrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [producerCache, setProducerCache] = useState<Record<string, ProducerInfo>>({});
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [disputeOrderId, setDisputeOrderId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

  useEffect(() => {
    let unsubOrders: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubOrders) {
        unsubOrders();
        unsubOrders = null;
      }

      setErrorMsg(null);

      if (!user) {
        setOrders([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const q = query(
        collection(db, "orders"),
        where("buyerId", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      unsubOrders = onSnapshot(
        q,
        (snap) => {
          const rows: Order[] = snap.docs.map((d) => {
            const data = d.data() as any;
            const pricing = data.pricing || {};
            const totalCents =
              pricing.totalCents ??
              data.totalCents ??
              data.stripe?.amountTotal ??
              data.total ??
              data.amountTotal ??
              data.amount_total ??
              data.orderTotal ??
              null;
            const subtotalCents =
              pricing.subtotalCents ?? data.subtotalCents ?? null;
            const processingFeeCents =
              pricing.processingFeeCents ?? data.processingFeeCents ?? null;

            const rawItems =
              data.itemsSnapshot ??
              data.items ??
              data.lineItems ??
              data.cartItems ??
              data.products ??
              [];
            const items: OrderItem[] = Array.isArray(rawItems)
              ? rawItems.map((it: any) => {
                  const name = it.name ?? it.title ?? "Item";
                  const qty = Math.max(1, Number(it.qty ?? 1));
                  const priceCentsFinal =
                    typeof it.priceCents === "number"
                      ? it.priceCents
                      : typeof it.price === "number"
                        ? Math.round(it.price * 100)
                        : 0;
                  const lineTotal =
                    it.lineSubtotal ??
                    it.lineTotalCents ??
                    priceCentsFinal * qty;
                  return {
                    name: String(name),
                    title: it.title,
                    qty,
                    unit: it.unit,
                    priceCents: priceCentsFinal,
                    lineTotalCents: typeof lineTotal === "number" ? lineTotal : priceCentsFinal * qty,
                    lineSubtotal: it.lineSubtotal,
                    producerId: it.producerId,
                    producerName: it.producerName,
                    producerTown: it.producerTown,
                    producerPhone: it.producerPhone,
                  };
                })
              : [];

            return {
              id: d.id,
              status: data.status ?? "unknown",
              subtotalCents: subtotalCents ?? 0,
              totalCents: totalCents ?? 0,
              processingFeeCents: processingFeeCents ?? null,
              items,
              itemsSnapshot: data.itemsSnapshot,
              itemsPaidSnapshot: Array.isArray(data.itemsPaidSnapshot) ? data.itemsPaidSnapshot : [],
              perProducer: data.perProducer || {},
              scheduledAt: data.scheduledAt ?? null,
              pickupDate: data.pickupDate,
              pickupTime: data.pickupTime,
              deliveryDate: data.deliveryDate,
              deliveryTime: data.deliveryTime,
              createdAt: data.createdAt,
              paidAt: data.paidAt,
              updatedAt: data.updatedAt,
              paymentMode: data.paymentMode,
              paymentStatus: data.paymentStatus,
              producerStatuses: data.producerStatuses || {},
              reservationExpiresAt: data.reservationExpiresAt,
              disputeStatus: data.disputeStatus,
            };
          });

          setOrders(rows);
          setLoading(false);
        },
        (err) => {
          console.error("Orders snapshot error:", err);
          setErrorMsg(err?.message || "Failed to load orders.");
          setLoading(false);
        }
      );
    });

    return () => {
      if (unsubOrders) unsubOrders();
      unsubAuth();
    };
  }, []);

  const uniqueProducerIds = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      (o.items || []).forEach((it) => {
        if (it.producerId) set.add(it.producerId);
      });
    });
    return [...set];
  }, [orders]);

  useEffect(() => {
    if (uniqueProducerIds.length === 0) return;

    let cancelled = false;
    const cache: Record<string, ProducerInfo> = {};

    Promise.all(
      uniqueProducerIds.map(async (producerId) => {
        if (cancelled) return;
        const farmRef = doc(db, "farms", producerId);
        try {
          const farmSnap = await getDoc(farmRef);
          if (cancelled) return;
          const f = farmSnap.exists() ? (farmSnap.data() as any) : null;
          const town = f
            ? [f.city, f.state].filter(Boolean).join(", ") || undefined
            : undefined;
          cache[producerId] = {
            displayName: f?.farmName ?? f?.name ?? undefined,
            town: town || undefined,
            phone: f?.phone ?? undefined,
          };
        } catch {
          // ignore
        }
      })
    ).then(() => {
      if (!cancelled) setProducerCache((prev) => ({ ...prev, ...cache }));
    });

    return () => {
      cancelled = true;
    };
  }, [uniqueProducerIds.join(",")]);

  const empty = useMemo(
    () => !loading && !errorMsg && orders.length === 0,
    [loading, errorMsg, orders.length]
  );

  function getProducerInfo(producerId: string | undefined, item: OrderItem): ProducerInfo | null {
    if (!producerId) return null;
    const cached = producerCache[producerId];
    if (cached) return cached;
    if (item.producerName || item.producerTown || item.producerPhone) {
      return {
        displayName: item.producerName,
        town: item.producerTown,
        phone: item.producerPhone,
      };
    }
    return null;
  }

  function getOrderTotal(o: Order): number {
    if (o.totalCents != null && o.totalCents > 0) return o.totalCents;
    const pricing = (o as any).pricing;
    if (pricing?.totalCents) return pricing.totalCents;
    const items = o.items || [];
    const subtotal = items.reduce(
      (sum, it) => sum + (it.lineTotalCents ?? it.priceCents * (it.qty || 1)),
      0
    );
    return subtotal;
  }

  function getScheduleDisplay(o: Order): string {
    if (o.scheduledAt) {
      const parsed = new Date(o.scheduledAt);
      if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
    }
    const parts: string[] = [];
    if (o.pickupDate || o.deliveryDate) {
      parts.push(o.pickupDate || o.deliveryDate || "");
      if (o.pickupTime || o.deliveryTime) parts.push(o.pickupTime || o.deliveryTime || "");
    }
    const perProducer = o.perProducer || {};
    const methods = Object.values(perProducer).map(
      (p) => p?.fulfillmentMethod ?? "pickup"
    );
    const uniq = [...new Set(methods)];
    if (uniq.length) {
      const method = uniq[0];
      if (!parts.length) return method === "delivery" ? "Delivery" : "Pickup";
    }
    if (parts.length) return parts.join(" ");
    return "Not available";
  }

  function getFulfillmentMethod(o: Order): "pickup" | "delivery" | string {
    const perProducer = o.perProducer || {};
    const methods = Object.values(perProducer).map(
      (p) => p?.fulfillmentMethod ?? "pickup"
    );
    const uniq = [...new Set(methods)];
    if (uniq.length) return uniq[0];
    return "Not available";
  }

  function canCancelOrder(order: Order) {
    if (order.paymentMode !== "direct") return false;
    if (!["awaiting_payment", "pending", "pending_payment", "new"].includes(String(order.status))) {
      return false;
    }
    return !Object.values(order.producerStatuses || {}).some((entry) =>
      ["accepted", "ready", "completed"].includes(String(entry?.status || ""))
    );
  }

  async function cancelDirectOrder(orderId: string) {
    try {
      setPendingOrderId(orderId);
      setNotice(null);
      const cancelOrder = httpsCallable<{ orderId: string }, { status: string }>(
        functions,
        "cancelBuyerDirectOrder"
      );
      await cancelOrder({ orderId });
      setNotice({ tone: "success", message: "Order cancelled and reserved inventory released." });
    } catch (error: any) {
      setNotice({
        tone: "error",
        message: error?.message || "The order could not be cancelled.",
      });
    } finally {
      setPendingOrderId(null);
    }
  }

  async function submitDispute() {
    if (!disputeOrderId) return;
    try {
      setPendingOrderId(disputeOrderId);
      const openDispute = httpsCallable<
        { orderId: string; reason: string },
        { disputeId: string; status: string }
      >(functions, "openOrderDispute");
      await openDispute({ orderId: disputeOrderId, reason: disputeReason.trim() });
      setNotice({
        tone: "success",
        message: "Your order problem was sent to Maine Farm Market support.",
      });
      setDisputeOrderId(null);
      setDisputeReason("");
    } catch (error: any) {
      setNotice({ tone: "error", message: error?.message || "Could not open the dispute." });
    } finally {
      setPendingOrderId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#efe1b8] px-4 pb-24">
      <div className="max-w-4xl mx-auto pt-6">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/buyer")}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-50"
          >
            Back to market
          </button>
          <h1 className="text-2xl font-bold">Your Orders</h1>
        </div>

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              notice.tone === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {notice.message}
          </div>
        )}

        {loading && <div className="opacity-70">Loading…</div>}

        {errorMsg && (
          <div className="bg-white border rounded-xl p-3 text-sm">
            <div className="font-semibold mb-1">Orders couldn’t load</div>
            <div className="opacity-80">{errorMsg}</div>
            <div className="opacity-70 mt-2">Please try again in a moment.</div>
          </div>
        )}

        {empty && <div className="opacity-70">No orders yet.</div>}

        <div className="space-y-4 mt-4">
          {orders.map((o) => {
            const items = (o.items && o.items.length ? o.items : []) as OrderItem[];
            const totalCents = getOrderTotal(o);
            const createdLabel = formatTimestamp(o.createdAt ?? o.paidAt ?? o.updatedAt);
            const scheduleDisplay = getScheduleDisplay(o);
            const fulfillmentMethod = getFulfillmentMethod(o);
            const partnerPickups = (Object.values(o.perProducer || {}) as PerProducerEntry[])
              .map((entry) => entry.pickupPartner)
              .filter(Boolean) as NonNullable<PerProducerEntry["pickupPartner"]>[];

            return (
              <div key={o.id} className="bg-[#f4e7c8] border rounded-xl p-4">
                <div className="flex flex-wrap gap-2 items-center justify-between border-b pb-3">
                  <div className="font-bold">Order #{o.id.slice(-8)}</div>
                  <div className="text-sm">
                    <span className="font-semibold">Status:</span>{" "}
                    <span>{formatMarketplaceLabel(o.status)}</span>
                  </div>
                </div>

                <div className="mt-3 text-sm text-stone-600">
                  <div>Order placed: {createdLabel}</div>
                  <div className="mt-0.5">
                    {String(fulfillmentMethod).toLowerCase() === "delivery"
                      ? "Delivery"
                      : "Pickup"}
                    {scheduleDisplay && scheduleDisplay !== "Not available"
                      ? ` • ${scheduleDisplay}`
                      : ""}
                  </div>
                  {partnerPickups.map((partner, index) => (
                    <div key={`${partner.producerId || partner.farmName}-${index}`} className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-950">
                      Partner pickup: <strong>{partner.farmName || "Producer partner"}</strong>
                      {[partner.city, partner.state].filter(Boolean).length > 0 ? ` · ${[partner.city, partner.state].filter(Boolean).join(", ")}` : ""}
                      {partner.phone ? <a href={`tel:${partner.phone}`} className="ml-2 font-bold underline">{partner.phone}</a> : null}
                    </div>
                  ))}
                  {o.paymentMode === "direct" && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                      Payment is arranged directly with each producer. Confirm the
                      amount and accepted payment method before pickup or delivery.
                      {o.reservationExpiresAt && o.status === "awaiting_payment" ? (
                        <div className="mt-1 text-xs font-semibold">
                          Producer acceptance deadline: {formatTimestamp(o.reservationExpiresAt)}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {items.length ? (
                    items.map((it, idx) => {
                      const line =
                        it.lineTotalCents ??
                        (it.priceCents || 0) * (it.qty || 1);
                      const producer =
                        getProducerInfo(it.producerId, it) ||
                        (it.producerName
                          ? {
                              displayName: it.producerName,
                              town: it.producerTown,
                              phone: it.producerPhone,
                            }
                          : null);
                      const producerLabel = producer
                        ? [
                            producer.displayName || "Producer",
                            producer.town,
                          ]
                          .filter(Boolean)
                          .join(" • ") || "Not available"
                        : it.producerName
                          ? it.producerName
                          : "Not available";

                      return (
                        <div
                          key={idx}
                          className="flex items-start justify-between border-t pt-2"
                        >
                          <div>
                            <div className="font-semibold">
                              {it.name || it.title || "Item"}
                            </div>
                            <div className="text-xs opacity-70">
                              Qty: {it.qty}
                              {it.unit ? ` • ${it.unit}` : ""}
                            </div>
                            <div className="text-xs opacity-70">
                              {formatMoney(it.priceCents)} each
                            </div>
                            <div className="text-xs text-stone-500 mt-0.5">
                              {producerLabel}
                              {producer?.phone ? (
                                <>
                                  {" • "}
                                  <a
                                    href={`tel:${producer.phone}`}
                                    className="underline"
                                  >
                                    {producer.phone}
                                  </a>
                                </>
                              ) : null}
                            </div>
                            {it.producerId &&
                              o.producerStatuses?.[it.producerId]?.status && (
                              <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                                Producer status:{" "}
                                {formatMarketplaceLabel(o.producerStatuses[it.producerId].status)}
                              </div>
                            )}
                          </div>
                          <div className="font-semibold text-right">
                            {formatMoney(line)}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-stone-500 text-sm border-t pt-2">
                      No items listed.
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {canCancelOrder(o) && (
                      <button
                        type="button"
                        disabled={pendingOrderId === o.id}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Cancel this direct-payment order and release its reserved inventory?"
                            )
                          ) {
                            void cancelDirectOrder(o.id);
                          }
                        }}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                      >
                        {pendingOrderId === o.id ? "Cancelling..." : "Cancel order"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDisputeOrderId(o.id);
                        setDisputeReason("");
                      }}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold"
                    >
                      {o.disputeStatus === "open" ? "Add dispute details" : "Report a problem"}
                    </button>
                  </div>
                  <div className="font-bold">{formatMoney(totalCents)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {disputeOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="dispute-title">
            <h2 id="dispute-title" className="text-xl font-bold">Report an order problem</h2>
            <p className="mt-2 text-sm text-stone-600">
              Explain what happened. Maine Farm Market support will review the order and contact the involved accounts when needed.
            </p>
            <textarea
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              maxLength={2000}
              rows={6}
              className="mt-4 w-full rounded-xl border border-stone-300 p-3"
              placeholder="Describe the problem (at least 10 characters)"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDisputeOrderId(null)} className="rounded-lg bg-stone-100 px-4 py-2 font-semibold">
                Close
              </button>
              <button
                type="button"
                disabled={disputeReason.trim().length < 10 || pendingOrderId === disputeOrderId}
                onClick={() => void submitDispute()}
                className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Submit problem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
