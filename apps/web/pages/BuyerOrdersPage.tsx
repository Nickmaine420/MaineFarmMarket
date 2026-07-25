import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase";
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
};

type ProducerInfo = {
  displayName?: string;
  town?: string;
  phone?: string;
};

export default function BuyerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [producerCache, setProducerCache] = useState<Record<string, ProducerInfo>>({});

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
        const userRef = doc(db, "users", producerId);
        try {
          const [farmSnap, userSnap] = await Promise.all([
            getDoc(farmRef),
            getDoc(userRef),
          ]);
          if (cancelled) return;
          const f = farmSnap.exists() ? (farmSnap.data() as any) : null;
          const u = userSnap.exists() ? (userSnap.data() as any) : null;
          const town = f
            ? [f.city, f.state].filter(Boolean).join(", ") || undefined
            : u?.address?.city
              ? [u.address.city, u.address?.state].filter(Boolean).join(", ") || undefined
              : undefined;
          cache[producerId] = {
            displayName: f?.farmName ?? f?.name ?? u?.displayName ?? undefined,
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
    if (o.scheduledAt) return String(o.scheduledAt);
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

  return (
    <div className="min-h-screen bg-[#efe1b8] px-4 pb-24">
      <div className="max-w-4xl mx-auto pt-6">
        <h1 className="text-2xl font-bold mb-4">Your Orders</h1>

        {loading && <div className="opacity-70">Loading…</div>}

        {errorMsg && (
          <div className="bg-white border rounded-xl p-3 text-sm">
            <div className="font-semibold mb-1">Orders couldn’t load</div>
            <div className="opacity-80">{errorMsg}</div>
            <div className="opacity-70 mt-2">
              If the message mentions “requires an index”, deploy the Firestore
              index (step 2 below).
            </div>
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

            return (
              <div key={o.id} className="bg-[#f4e7c8] border rounded-xl p-4">
                <div className="flex flex-wrap gap-2 items-center justify-between border-b pb-3">
                  <div className="font-bold">Order #{o.id.slice(-8)}</div>
                  <div className="text-sm">
                    <span className="font-semibold">Status:</span>{" "}
                    <span className="uppercase">{o.status || "Unknown"}</span>
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

                <div className="mt-3 pt-3 border-t flex justify-end">
                  <div className="font-bold">{formatMoney(totalCents)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
