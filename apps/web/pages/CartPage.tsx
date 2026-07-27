import React, { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase";
import { useNavigate } from "../router";
import { doc, onSnapshot, runTransaction, serverTimestamp, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type CartItem = {
  id?: string;
  productId?: string;
  name: string;
  unit?: string;
  qty: number;
  priceCents: number;
  producerId?: string;
  producerName?: string;
  imageUrl?: string;
  quantityAvailable?: number;
};

type CartState = {
  items: CartItem[];
};

const CART_KEY = "mfm_cart"; // legacy local storage key
const LEGACY_CART_KEY = "mfm_cart_items"; // older legacy key

function formatMoney(cents: number) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Read localStorage cart ONCE for migration only
function readLocalCartForMigration(): CartState {
  // 1) New format: { items: [...] }
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.items && Array.isArray(parsed.items)) return { items: parsed.items };
    }
  } catch {
    // ignore
  }

  // 2) Legacy: an array
  try {
    const legacyRaw = localStorage.getItem(LEGACY_CART_KEY);
    if (!legacyRaw) return { items: [] };

    const legacy = JSON.parse(legacyRaw);
    if (!Array.isArray(legacy)) return { items: [] };

    const migrated: CartItem[] = legacy
      .map((x: any) => {
        const p = x?.product || x;
        if (!p) return null;

        const price = Number(p.price || 0);
        const priceCents = Math.round(price * 100);

        const productId = String(x?.productId || p.id || "");
        if (!productId) return null;

        return {
          productId,
          id: p.id ? String(p.id) : productId,
          name: String(p.name || p.title || "Item"),
          unit: String(p.unit || "each"),
          qty: Number(x?.quantity || x?.qty || 1),
          priceCents,
          producerId: p.producerId ? String(p.producerId) : "",
          producerName: p.producerName ? String(p.producerName) : "",
          imageUrl: p.photoUrl || p.imageUrl || p.image || "",
        } as CartItem;
      })
      .filter(Boolean) as CartItem[];

    return { items: migrated };
  } catch {
    return { items: [] };
  }
}

function clearLocalCartKeys() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify({ items: [] }));
    localStorage.removeItem(LEGACY_CART_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve producerId for cart items that are missing it by reading from products collection
 * (same source the backend uses in resolveProductsAndPricing).
 */
async function resolveProducerIdsForCartItems(
  items: CartItem[]
): Promise<CartItem[]> {
  const needResolution = items
    .map((it, i) => ({ item: it, index: i }))
    .filter(
      ({ item }) =>
        !item.producerId || item.producerId === "unknown" || item.producerId === ""
    );
  if (needResolution.length === 0) {
    return items.map((it) => ({ ...it }));
  }

  const productIdToProducerId: Record<string, string> = {};
  await Promise.all(
    needResolution.map(async ({ item }) => {
      const productId = item.productId || item.id;
      if (!productId) return;
      const ref = doc(db, "products", productId);
      const snap = await getDoc(ref);
      const p = snap.exists() ? (snap.data() as any) : null;
      const producerId = p?.producerId || p?.producerUid;
      if (producerId) productIdToProducerId[productId] = String(producerId);
    })
  );

  return items.map((it) => {
    const pid = it.productId || it.id;
    const resolved = pid ? productIdToProducerId[pid] : undefined;
    const producerId =
      it.producerId && it.producerId !== "unknown" && it.producerId !== ""
        ? it.producerId
        : (resolved || it.producerId || "");
    return { ...it, producerId };
  });
}

export default function CartPage() {
  const navigate = useNavigate();

  const [cart, setCart] = useState<CartState>({ items: [] });
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [scheduledDate, setScheduledDate] = useState<string>("");
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [farmOptions, setFarmOptions] = useState<
    Record<string, { pickupAvailable: boolean; deliveryAvailable: boolean; farmName: string }>
  >({});
  const [availability, setAvailability] = useState<Record<string, number>>({});

  const didMigrateRef = useRef(false);

  const totalCents = useMemo(() => {
    return cart.items.reduce((sum, it) => sum + Number(it.priceCents || 0) * Number(it.qty || 0), 0);
  }, [cart.items]);

  // Write cart to Firestore
  async function writeCart(uid: string, next: CartState) {
    const ref = doc(db, "carts", uid);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      const snapData = (snap.exists() ? (snap.data() as any) : {}) || {};
      const currentVersion =
        typeof snapData.cartVersion === "number" && Number.isFinite(snapData.cartVersion)
          ? snapData.cartVersion
          : 0;
      transaction.set(
        ref,
        {
          items: next.items,
          cartVersion: currentVersion + 1,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  useEffect(() => {
    let unsubCart: null | (() => void) = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Cleanup old listener
      if (unsubCart) {
        unsubCart();
        unsubCart = null;
      }

      if (!user) {
        setCart({ items: [] });
        return;
      }

      const uid = user.uid;
      const cartRef = doc(db, "carts", uid);

      // One-time migration (only if Firestore cart is empty)
      // This prevents losing carts that were previously in localStorage.
      if (!didMigrateRef.current) {
        didMigrateRef.current = true;

        try {
          const snap = await getDoc(cartRef);
          const firestoreItems = snap.exists() && Array.isArray((snap.data() as any)?.items)
            ? (snap.data() as any).items
            : [];

          const local = readLocalCartForMigration();
          const localItems = Array.isArray(local.items) ? local.items : [];

          // If Firestore is empty but localStorage has items, migrate them up.
          if (firestoreItems.length === 0 && localItems.length > 0) {
            await writeCart(uid, { items: localItems });
          }

          // Stop localStorage from ever “winning” again.
          clearLocalCartKeys();
        } catch (e) {
          console.warn("Cart migration check failed:", e);
          // Still clear local keys to avoid double-source issues
          clearLocalCartKeys();
        }
      }

      // Live sync cart from Firestore
      unsubCart = onSnapshot(
        cartRef,
        (snap) => {
          const data = snap.data() as any;
          const items = Array.isArray(data?.items) ? data.items : [];
          setCart({ items });
        },
        (err) => {
          console.error("Cart snapshot error:", err);
        }
      );
    });

    return () => {
      if (unsubCart) unsubCart();
      unsubAuth();
    };
  }, []);

  const productIdsKey = cart.items
    .map((item) => item.productId || item.id || "")
    .filter(Boolean)
    .sort()
    .join(",");
  const producerIdsKey = cart.items
    .map((item) => item.producerId || "")
    .filter(Boolean)
    .sort()
    .join(",");

  useEffect(() => {
    let cancelled = false;
    const productIds = Array.from(
      new Set<string>(productIdsKey.split(",").filter(Boolean))
    );
    const producerIds = Array.from(
      new Set<string>(producerIdsKey.split(",").filter(Boolean))
    );
    Promise.all([
      Promise.all(
        productIds.map(async (productId) => {
          const snapshot = await getDoc(doc(db, "products", productId));
          const product = snapshot.exists() ? snapshot.data() : null;
          return [
            productId,
            product?.inStock === false ? 0 : Number(product?.quantityAvailable || 0),
          ] as const;
        })
      ),
      Promise.all(
        producerIds.map(async (producerId) => {
          const snapshot = await getDoc(doc(db, "farms", producerId));
          const farm = snapshot.exists() ? snapshot.data() : {};
          return [
            producerId,
            {
              pickupAvailable: farm?.pickupAvailable !== false,
              deliveryAvailable: farm?.deliveryAvailable === true,
              farmName: String(farm?.farmName || "Producer"),
            },
          ] as const;
        })
      ),
    ])
      .then(([productEntries, farmEntries]) => {
        if (cancelled) return;
        setAvailability(Object.fromEntries(productEntries));
        setFarmOptions(Object.fromEntries(farmEntries));
      })
      .catch((error) => {
        console.error("Could not refresh cart availability:", error);
        if (!cancelled) setNotice("Could not refresh current inventory. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [productIdsKey, producerIdsKey]);

  const allPickupAvailable = useMemo(
    () =>
      Object.keys(farmOptions).length > 0 &&
      Object.keys(farmOptions).every(
        (producerId) => farmOptions[producerId].pickupAvailable
      ),
    [farmOptions]
  );
  const allDeliveryAvailable = useMemo(
    () =>
      Object.keys(farmOptions).length > 0 &&
      Object.keys(farmOptions).every(
        (producerId) => farmOptions[producerId].deliveryAvailable
      ),
    [farmOptions]
  );

  useEffect(() => {
    if (deliveryMethod === "delivery" && !allDeliveryAvailable && allPickupAvailable) {
      setDeliveryMethod("pickup");
    }
  }, [allDeliveryAvailable, allPickupAvailable, deliveryMethod]);

  function setQty(index: number, qty: number) {
    const user = auth.currentUser;
    if (!user) return;

    const productId = cart.items[index]?.productId || cart.items[index]?.id || "";
    const maximum = availability[productId] ?? 999;
    if (maximum < 1) {
      setNotice(`${cart.items[index]?.name || "This item"} is out of stock. Remove it to continue.`);
      return;
    }
    const safe = Math.min(maximum, Math.max(1, Math.trunc(Number(qty || 1))));
    const next = { items: cart.items.map((it, i) => (i === index ? { ...it, qty: safe } : it)) };
    setCart(next);
    writeCart(user.uid, next).catch((e) => console.error("writeCart(setQty) failed:", e));
  }

  function removeItem(index: number) {
    const user = auth.currentUser;
    if (!user) return;

    const next = { items: cart.items.filter((_, i) => i !== index) };
    setCart(next);
    writeCart(user.uid, next).catch((e) => console.error("writeCart(removeItem) failed:", e));
  }

  function clearCart() {
    const user = auth.currentUser;
    if (!user) return;

    const next = { items: [] };
    setCart(next);
    writeCart(user.uid, next).catch((e) => console.error("writeCart(clearCart) failed:", e));
  }

  const scheduledAt = useMemo(() => {
    if (scheduledDate && scheduledTime) {
      const [year, month, day] = scheduledDate.split("-").map(Number);
      const [hour, minute] = scheduledTime.split(":").map(Number);
      const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
      return Number.isFinite(localDate.getTime()) ? localDate.toISOString() : null;
    }
    return null;
  }, [scheduledDate, scheduledTime]);

  const minDate = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  const schedulingValidation = useMemo(() => {
    if (!scheduledDate?.trim() || !scheduledTime?.trim()) {
      return { valid: false, error: null as string | null };
    }
    const nowMs = Date.now();
    const pickupMinMs = nowMs + 60 * 60 * 1000;
    const deliveryMinMs = nowMs + 24 * 60 * 60 * 1000;
    const [y, m, day] = scheduledDate.split("-").map(Number);
    const [hour, min] = scheduledTime.split(":").map(Number);
    const selected = new Date(y, (m || 1) - 1, day, hour || 0, min || 0, 0, 0);
    const selectedMs = selected.getTime();
    if (deliveryMethod === "pickup") {
      if (!allPickupAvailable) {
        return {
          valid: false,
          error: "At least one producer in this cart does not offer pickup. Split the cart by fulfillment option.",
        };
      }
      if (selectedMs < pickupMinMs) {
        return {
          valid: false,
          error: "Pickup must be at least 1 hour from now. Please choose a later date or time.",
        };
      }
    } else {
      if (!allDeliveryAvailable) {
        return {
          valid: false,
          error: "At least one producer in this cart does not offer delivery. Split the cart by fulfillment option.",
        };
      }
      if (selectedMs < deliveryMinMs) {
        return {
          valid: false,
          error: "Delivery must be at least 24 hours from now. Please choose a later date or time.",
        };
      }
    }
    return { valid: true, error: null };
  }, [
    scheduledDate,
    scheduledTime,
    deliveryMethod,
    allPickupAvailable,
    allDeliveryAvailable,
  ]);

  const schedulingValid = schedulingValidation.valid;
  const schedulingError = schedulingValidation.error;

  const minDateForDelivery = (() => {
    const d = new Date();
    d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  async function startCheckout() {
    try {
      if (!cart.items.length) return;

      if (!scheduledDate?.trim() || !scheduledTime?.trim()) {
        setNotice(
          `Please select a ${deliveryMethod === "delivery" ? "delivery" : "pickup"} date and time.`
        );
        return;
      }
      if (!schedulingValid && schedulingError) {
        setNotice(schedulingError);
        return;
      }
      const unavailableItem = cart.items.find((item) => {
        const productId = item.productId || item.id || "";
        return (availability[productId] ?? 0) < Number(item.qty || 0);
      });
      if (unavailableItem) {
        setNotice(
          `${unavailableItem.name} no longer has the requested quantity. Adjust or remove it.`
        );
        return;
      }

      setIsLoading(true);

      const user = auth.currentUser;
      if (!user) return;

      const resolvedItems = await resolveProducerIdsForCartItems(cart.items);
      const missingProducerId = resolvedItems.find(
        (it) => !it.producerId || it.producerId === "unknown" || it.producerId === ""
      );
      if (missingProducerId) {
        const productId = missingProducerId.productId || missingProducerId.id || "(unknown id)";
        setNotice(
          `Cart item missing producer. Please remove "${missingProducerId.name || productId}" and add it again from the market.`
        );
        return;
      }

      const uniqueProducerIds = [
        ...new Set(resolvedItems.map((it) => it.producerId).filter(Boolean)),
      ] as string[];
      const perProducer: Record<
        string,
        { fulfillmentMethod: "pickup" | "delivery"; selectedWindowId: string }
      > = {};
      uniqueProducerIds.forEach((producerId) => {
        perProducer[producerId] = {
          fulfillmentMethod: deliveryMethod,
          selectedWindowId: "customer-selected",
        };
      });

      const createMarketplaceOrder = httpsCallable(
        functions,
        "createCartCheckoutSessionV2"
      );
      const result: any = await createMarketplaceOrder({
        idempotencyKey:
          typeof window.crypto?.randomUUID === "function"
            ? window.crypto.randomUUID()
            : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        items: resolvedItems.map((it) => ({
          productId: it.productId || it.id,
          qty: it.qty,
        })),
        perProducer,
        deliveryMethod,
        scheduledAt: scheduledAt || null,
        notes: notes || "",
      });
      const data = result?.data;
      if (data?.paymentMode === "direct" && data?.orderId) {
        navigate("/buyer/orders");
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setNotice("The order was created but no next step was returned.");
    } catch (e: any) {
      console.error(e);
      setNotice(
        e?.message ||
          "Unable to place the order. Refresh inventory and try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#efe1b6]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-extrabold text-[#2c2c2c]">Cart</h1>
          <div className="flex gap-2">
            <button onClick={() => navigate("/buyer")} className="bg-white px-4 py-2 rounded-lg font-bold">
              Back
            </button>
            <button onClick={clearCart} className="bg-white px-4 py-2 rounded-lg font-bold opacity-70">
              Clear cart
            </button>
          </div>
        </div>

        {notice && (
          <div
            className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              className="font-bold"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between">
            <div className="font-bold">Items ({cart.items.length})</div>
            <div className="font-extrabold">{formatMoney(totalCents)}</div>
          </div>

          {!cart.items.length ? (
            <div className="text-stone-600 mt-2">Your cart is empty.</div>
          ) : (
            <div className="mt-4 space-y-3">
              {cart.items.map((it, idx) => (
                <div key={idx} className="flex flex-col gap-4 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    {it.imageUrl ? (
                      <img
                        src={it.imageUrl}
                        alt=""
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-stone-100" />
                    )}
                    <div>
                      <div className="font-bold">{it.name}</div>
                      <div className="text-xs opacity-70">
                        {it.unit ? it.unit : "each"}
                        {it.producerName ? ` • ${it.producerName}` : ""}
                      </div>
                      <div className="text-sm font-semibold mt-1">{formatMoney(it.priceCents)}</div>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 bg-stone-100 rounded"
                        onClick={() => setQty(idx, Math.max(1, (it.qty || 1) - 1))}
                      >
                        –
                      </button>
                      <input
                        className="w-14 text-center border rounded px-2 py-1"
                        type="number"
                        min={1}
                        max={
                          availability[it.productId || it.id || ""] !== undefined
                            ? Math.max(1, availability[it.productId || it.id || ""])
                            : undefined
                        }
                        step={1}
                        value={it.qty}
                        onChange={(e) => setQty(idx, Number(e.target.value))}
                      />
                      <button
                        className="px-2 py-1 bg-stone-100 rounded disabled:opacity-40"
                        disabled={
                          Number(it.qty || 0) >=
                          (availability[it.productId || it.id || ""] ?? 999)
                        }
                        onClick={() => setQty(idx, (it.qty || 1) + 1)}
                      >
                        +
                      </button>
                    </div>

                    <button className="text-sm underline opacity-70" onClick={() => removeItem(idx)}>
                      Remove
                    </button>

                    <div className="font-bold">
                      {formatMoney(Number(it.priceCents || 0) * Number(it.qty || 0))}
                    </div>
                    {availability[it.productId || it.id || ""] !== undefined &&
                      availability[it.productId || it.id || ""] <
                        Number(it.qty || 0) && (
                      <div className="text-xs font-bold text-red-700">
                        Only {availability[it.productId || it.id || ""] ?? 0} available
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 border-t pt-4">
            <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
              Payment follows each producer's preference. If every producer in the cart
              accepts Stripe, you will continue to secure online checkout and see the
              card-processing fee before payment. Otherwise, place the order now and
              arrange payment directly at pickup or delivery. Maine Farm Market charges
              no platform commission on product sales.
            </p>
            <div className="font-bold mb-2">Delivery / Pickup</div>
            <div className="flex gap-2">
              <button
                onClick={() => setDeliveryMethod("pickup")}
                disabled={!allPickupAvailable}
                aria-pressed={deliveryMethod === "pickup"}
                className={`px-4 py-2 rounded-lg font-bold ${
                  deliveryMethod === "pickup" ? "bg-black text-white" : "bg-stone-100"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Pickup
              </button>
              <button
                onClick={() => setDeliveryMethod("delivery")}
                disabled={!allDeliveryAvailable}
                aria-pressed={deliveryMethod === "delivery"}
                className={`px-4 py-2 rounded-lg font-bold ${
                  deliveryMethod === "delivery" ? "bg-black text-white" : "bg-stone-100"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                Delivery
              </button>
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {deliveryMethod === "pickup"
                ? "Pickup must be scheduled at least 1 hour in advance."
                : "Delivery must be scheduled at least 24 hours in advance."}
            </p>
            {!allDeliveryAvailable && cart.items.length > 0 && (
              <p className="mt-2 text-sm text-amber-800">
                Delivery is unavailable because at least one producer in this cart only
                offers pickup.
              </p>
            )}

            <div className="mt-3">
              <div className="text-sm font-bold mb-1">
                {deliveryMethod === "delivery" ? "Delivery" : "Pickup"} date <span className="text-red-600">*</span>
              </div>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2"
                min={deliveryMethod === "pickup" ? minDate : minDateForDelivery}
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
              />
            </div>
            <div className="mt-3">
              <div className="text-sm font-bold mb-1">
                {deliveryMethod === "delivery" ? "Delivery" : "Pickup"} time <span className="text-red-600">*</span>
              </div>
              <input
                type="time"
                className="w-full border rounded-lg px-3 py-2"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                required
              />
              {schedulingError && (
                <p className="mt-1 text-sm text-red-600" role="alert">
                  {schedulingError}
                </p>
              )}
            </div>

            <div className="mt-3">
              <div className="text-sm font-bold mb-1">Notes (optional)</div>
              <textarea
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Any instructions…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button
              disabled={
                !cart.items.length ||
                isLoading ||
                !scheduledDate?.trim() ||
                !scheduledTime?.trim() ||
                !schedulingValid ||
                (deliveryMethod === "pickup"
                  ? !allPickupAvailable
                  : !allDeliveryAvailable)
              }
              onClick={startCheckout}
              className={`mt-4 w-full py-3 rounded-xl font-extrabold ${
                !cart.items.length ||
                isLoading ||
                !scheduledDate?.trim() ||
                !scheduledTime?.trim() ||
                !schedulingValid ||
                (deliveryMethod === "pickup"
                  ? !allPickupAvailable
                  : !allDeliveryAvailable)
                  ? "bg-stone-200"
                  : "bg-black text-white"
              }`}
            >
              {isLoading ? "Starting checkout…" : "Place Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
