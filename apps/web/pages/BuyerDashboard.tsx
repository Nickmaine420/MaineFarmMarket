import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../router";
import { auth, db } from "../firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useAuth } from "../App";

type AnyDoc = Record<string, any>;

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** ✅ Cart schema (matches CartPage + checkout payload expectations) */
type CartItem = {
  productId: string;
  name: string;
  unit?: string;
  qty: number;
  priceCents: number;
  producerId?: string;
  producerName?: string;
  imageUrl?: string;
};

type CartState = {
  items: CartItem[];
};

// Legacy keys (we will migrate once, then stop using these)
const CART_KEY = "mfm_cart";
const LEGACY_CART_KEY = "mfm_cart_items";
const BUYER_LOC_KEY = "mfm_buyer_location";

function dollarsToCents(price: any) {
  const n = Number(price || 0);
  return Math.round(n * 100);
}

function buildCartItemFromProduct(product: AnyDoc): CartItem {
  return {
    productId: String(product.id),
    name: String(product.name || product.title || "Item"),
    unit: String(product.unit || "each"),
    qty: 1,
    priceCents: dollarsToCents(product.price),
    producerId: product.producerId ? String(product.producerId) : "",
    producerName: product.producerName ? String(product.producerName) : "",
    imageUrl: product.photoUrl || product.imageUrl || product.image || "",
  };
}

/** Read local cart ONLY for migration */
function readLocalCartForMigration(): CartState {
  // New format: { items: [...] }
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.items && Array.isArray(parsed.items)) return { items: parsed.items };
    }
  } catch {
    // ignore
  }

  // Legacy array format
  try {
    const legacyRaw = localStorage.getItem(LEGACY_CART_KEY);
    if (!legacyRaw) return { items: [] };

    const legacyParsed = JSON.parse(legacyRaw);
    if (!Array.isArray(legacyParsed)) return { items: [] };

    const migrated: CartItem[] = legacyParsed
      .map((x: any) => {
        const p = x?.product || x;
        if (!p?.id) return null;
        const item = buildCartItemFromProduct({ ...p, id: p.id });
        item.qty = Number(x?.quantity || x?.qty || 1);
        return item;
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

export default function BuyerDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [products, setProducts] = useState<any[]>([]);
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [reportTarget, setReportTarget] = useState<AnyDoc | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [blockTarget, setBlockTarget] = useState<{
    product: AnyDoc;
    farm: AnyDoc | null;
  } | null>(null);
  const [buyerLoc, setBuyerLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [blockedProducerIds, setBlockedProducerIds] = useState<Set<string>>(new Set());

  // ✅ Firestore-synced cart
  const [cart, setCart] = useState<CartState>({ items: [] });

  const cartBarRef = useRef<HTMLDivElement>(null);
  const [cartBarHeight, setCartBarHeight] = useState(0);

  const didMigrateRef = useRef(false);

  useEffect(() => {
    // Load buyer location (still localStorage — that’s fine)
    const locRaw = localStorage.getItem(BUYER_LOC_KEY);
    setBuyerLoc(locRaw ? JSON.parse(locRaw) : null);
  }, []);

  useEffect(() => {
    let productsReady = false;
    let farmsReady = false;
    const markReady = () => {
      if (productsReady && farmsReady) setMarketLoading(false);
    };
    const fail = (error: unknown) => {
      console.error("Marketplace subscription failed:", error);
      setMarketError("The marketplace could not refresh. Check your connection and try again.");
      setMarketLoading(false);
    };
    const unsubscribeProducts = onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        setProducts(snapshot.docs.map((product) => ({ id: product.id, ...product.data() })));
        productsReady = true;
        setMarketError("");
        markReady();
      },
      fail
    );
    const unsubscribeFarms = onSnapshot(
      collection(db, "farms"),
      (snapshot) => {
        const next: Record<string, AnyDoc> = {};
        snapshot.docs.forEach((farm) => {
          next[farm.id] = { id: farm.id, ...farm.data() };
        });
        setFarms(next);
        farmsReady = true;
        setMarketError("");
        markReady();
      },
      fail
    );
    return () => {
      unsubscribeProducts();
      unsubscribeFarms();
    };
  }, []);

  useEffect(() => {
    let unsubscribeBlocked: null | (() => void) = null;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeBlocked?.();
      unsubscribeBlocked = null;
      if (!user) {
        setBlockedProducerIds(new Set());
        return;
      }
      unsubscribeBlocked = onSnapshot(
        collection(db, "users", user.uid, "blocked"),
        (snapshot) => {
          setBlockedProducerIds(new Set(snapshot.docs.map((blockedDoc) => blockedDoc.id)));
        }
      );
    });
    return () => {
      unsubscribeBlocked?.();
      unsubscribeAuth();
    };
  }, []);

  // ✅ Listen to Firestore cart in real time (drives bottom bar)
  useEffect(() => {
    let unsubCart: null | (() => void) = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubCart) {
        unsubCart();
        unsubCart = null;
      }

      if (!user) {
        setCart({ items: [] });
        clearLocalCartKeys();
        return;
      }

      const uid = user.uid;
      const cartRef = doc(db, "carts", uid);

      // One-time migration: localStorage -> Firestore (only if Firestore is empty)
      if (!didMigrateRef.current) {
        didMigrateRef.current = true;

        try {
          const snap = await getDoc(cartRef);
          const firestoreItems =
            snap.exists() && Array.isArray((snap.data() as any)?.items)
              ? (snap.data() as any).items
              : [];

          const local = readLocalCartForMigration();
          const localItems = Array.isArray(local.items) ? local.items : [];

          if (firestoreItems.length === 0 && localItems.length > 0) {
            await setDoc(
              cartRef,
              { items: localItems, updatedAt: serverTimestamp() },
              { merge: true }
            );
          }

          // Kill local keys so they never “ghost” the UI again
          clearLocalCartKeys();
        } catch (e) {
          console.warn("Cart migration failed:", e);
          clearLocalCartKeys();
        }
      }

      // Live Firestore cart subscription
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

  const enrichedProducts = useMemo(() => {
    const producerIdKey = (p: AnyDoc) => p.producerUid || p.producerId;
    const normalizedSearch = search.trim().toLowerCase();
    const list = products
      .filter((p) => {
        const producerId = String(producerIdKey(p) || "");
        const farm = producerId ? farms[producerId] : null;
        const searchable = [
          p.name,
          p.title,
          p.description,
          p.department,
          p.category,
          ...(Array.isArray(p.tags) ? p.tags : []),
          farm?.farmName,
          farm?.city,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const hasStock =
          p.archived !== true &&
          p.inStock !== false &&
          Number.isInteger(Number(p.quantityAvailable)) &&
          Number(p.quantityAvailable) > 0;
        const matchesDepartment =
          department === "all" || String(p.department || "Other") === department;
        const matchesFulfillment =
          fulfillmentFilter === "all" ||
          (fulfillmentFilter === "delivery"
            ? farm?.deliveryAvailable === true
            : farm?.pickupAvailable !== false);
        return (
          hasStock &&
          (!producerId || !blockedProducerIds.has(producerId)) &&
          (!normalizedSearch || searchable.includes(normalizedSearch)) &&
          matchesDepartment &&
          matchesFulfillment
        );
      })
      .map((p) => {
        const pid = producerIdKey(p);
        const farm = pid ? farms[pid] : null;
        const miles =
          buyerLoc && farm?.lat != null && farm?.lng != null
            ? haversineMiles(buyerLoc.lat, buyerLoc.lng, Number(farm.lat), Number(farm.lng))
            : null;
        return { product: p, farm, miles };
      });

    list.sort((a, b) => {
      if (a.miles == null && b.miles == null) return 0;
      if (a.miles == null) return 1;
      if (b.miles == null) return -1;
      return a.miles - b.miles;
    });

    return list;
  }, [
    products,
    farms,
    buyerLoc,
    blockedProducerIds,
    search,
    department,
    fulfillmentFilter,
  ]);

  const departments = useMemo(
    () =>
      [...new Set(products.map((product) => String(product.department || "Other")))].sort(),
    [products]
  );

  const cartCount = useMemo(() => {
    return cart.items.reduce((s, i) => s + Number(i.qty || 0), 0);
  }, [cart.items]);

  // Measure floating cart bar height when visible; update on resize so content padding stays correct
  useEffect(() => {
    if (cartCount === 0) {
      setCartBarHeight(0);
      return;
    }

    const measure = () => {
      const el = cartBarRef.current;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      setCartBarHeight(h);
    };

    measure();
    const t = setTimeout(measure, 150);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [cartCount]);

  const cartTotal = useMemo(() => {
    const cents = cart.items.reduce(
      (sum, it) => sum + Number(it.priceCents || 0) * Number(it.qty || 0),
      0
    );
    return cents / 100;
  }, [cart.items]);

  async function addToCart(product: AnyDoc) {
    const user = auth.currentUser;
    if (!user) {
      setNotice("Please sign in first.");
      return;
    }

    const uid = user.uid;
    const cartRef = doc(db, "carts", uid);
    const productRef = doc(db, "products", String(product.id));
    try {
      await runTransaction(db, async (transaction) => {
        const [cartSnapshot, productSnapshot] = await Promise.all([
          transaction.get(cartRef),
          transaction.get(productRef),
        ]);
        if (!productSnapshot.exists()) throw new Error("This listing is no longer available.");
        const currentProduct = { id: productSnapshot.id, ...productSnapshot.data() };
        const available = Number((currentProduct as AnyDoc).quantityAvailable);
        if (
          (currentProduct as AnyDoc).inStock === false ||
          (currentProduct as AnyDoc).archived === true ||
          !Number.isInteger(available) ||
          available < 1
        ) {
          throw new Error("This item is sold out.");
        }

        const item = buildCartItemFromProduct(currentProduct);
        const cartData = cartSnapshot.exists() ? cartSnapshot.data() : {};
        const existing: CartItem[] = Array.isArray((cartData as AnyDoc).items)
          ? ((cartData as AnyDoc).items as CartItem[])
          : [];
        const currentVersion = Number.isInteger((cartData as AnyDoc).cartVersion)
          ? Number((cartData as AnyDoc).cartVersion)
          : 0;
        const next = [...existing];
        const index = next.findIndex((entry) => entry.productId === item.productId);
        const nextQuantity =
          index >= 0 ? Number(next[index].qty || 0) + 1 : 1;
        if (nextQuantity > available) {
          throw new Error(`Only ${available} ${available === 1 ? "item is" : "items are"} available.`);
        }
        if (index >= 0) next[index] = { ...next[index], qty: nextQuantity };
        else next.push(item);
        transaction.set(
          cartRef,
          {
            items: next,
            cartVersion: currentVersion + 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });
      clearLocalCartKeys();
      setNotice(`${String(product.name || product.title || "Item")} added to your cart.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add this item.");
    }
  }

  async function submitListingReport() {
    const user = auth.currentUser;
    if (!user || !reportTarget || !reportReason.trim()) return;

    try {
      await addDoc(collection(db, "reports"), {
        reporterId: user.uid,
        type: "listing",
        listingId: String(reportTarget.id),
        reportedUserId: String(
          reportTarget.producerUid || reportTarget.producerId || ""
        ),
        reason: reportReason.trim().slice(0, 1000),
        status: "open",
        createdAt: serverTimestamp(),
      });
      setNotice("Report received. Thank you for helping keep the marketplace safe.");
      setReportTarget(null);
      setReportReason("");
    } catch (error) {
      console.error("Listing report failed:", error);
      setNotice("We could not submit the report. Please try again or contact support.");
    }
  }

  async function confirmBlockProducer() {
    const user = auth.currentUser;
    if (!user || !blockTarget) return;
    const { product, farm } = blockTarget;
    const producerId = String(product.producerUid || product.producerId || "");
    if (!producerId) {
      setNotice("This producer cannot be blocked right now.");
      return;
    }
    const displayName =
      farm?.farmName || farm?.name || product.producerName || "this producer";

    try {
      await setDoc(doc(db, "users", user.uid, "blocked", producerId), {
        blockedUserId: producerId,
        displayName: String(displayName).slice(0, 120),
        createdAt: serverTimestamp(),
      });
      setNotice(`${displayName} is now hidden. You can unblock them from Account.`);
      setBlockTarget(null);
    } catch (error) {
      console.error("Producer block failed:", error);
      setNotice("We could not block this producer. Please try again.");
    }
  }

  async function requestLocation() {
    setLocBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      );
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setBuyerLoc(loc);
      localStorage.setItem(BUYER_LOC_KEY, JSON.stringify(loc));
    } catch (e) {
      console.error(e);
      setNotice("Unable to get your location. Please allow location access in your browser.");
    } finally {
      setLocBusy(false);
    }
  }

  function clearLocation() {
    setBuyerLoc(null);
    localStorage.removeItem(BUYER_LOC_KEY);
  }

  return (
    <div className="min-h-screen bg-[#efe1b6]">
      <div
        className="max-w-5xl mx-auto px-4 py-8"
        style={
          cartCount > 0
            ? {
                paddingBottom: `calc(${cartBarHeight > 0 ? cartBarHeight : 80}px + 24px + env(safe-area-inset-bottom))`,
              }
            : undefined
        }
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#2c2c2c]">
              Fresh from Maine
            </h1>
            <div className="text-sm text-stone-700 mt-1">
              {buyerLoc ? (
                <>
                  Location set • Sorting by nearest farms{" "}
                  <button onClick={clearLocation} className="underline ml-2">
                    Clear
                  </button>
                </>
              ) : (
                "Set your location to sort by nearest farm."
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={requestLocation}
              disabled={locBusy}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              {locBusy ? "Locating..." : "Set My Location"}
            </button>

            <button
              onClick={() => navigate("/buyer/orders")}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              My Orders
            </button>

            <button
              onClick={() => logout()}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              Sign Out
            </button>
          </div>
        </div>

        {notice && (
          <div
            className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
            role="status"
          >
            <span>{notice}</span>
            <button
              type="button"
              className="font-bold"
              aria-label="Dismiss message"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}

        <section
          className="mt-6 grid gap-3 rounded-2xl border border-stone-200 bg-white/80 p-4 shadow-sm sm:grid-cols-3"
          aria-label="Marketplace filters"
        >
          <label className="text-sm font-bold text-stone-700">
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tomatoes, eggs, Waterville…"
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-normal"
            />
          </label>
          <label className="text-sm font-bold text-stone-700">
            Department
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-normal"
            >
              <option value="all">All departments</option>
              {departments.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-stone-700">
            Fulfillment
            <select
              value={fulfillmentFilter}
              onChange={(event) => setFulfillmentFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-normal"
            >
              <option value="all">Pickup or delivery</option>
              <option value="pickup">Pickup available</option>
              <option value="delivery">Delivery available</option>
            </select>
          </label>
        </section>

        {marketLoading && (
          <div className="mt-8 rounded-2xl bg-white p-8 text-center text-stone-600">
            Loading fresh Maine listings…
          </div>
        )}
        {marketError && (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900" role="alert">
            {marketError}
          </div>
        )}
        {!marketLoading && !marketError && enrichedProducts.length === 0 && (
          <div className="mt-8 rounded-2xl bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-stone-900">No matching products yet</h2>
            <p className="mt-2 text-stone-600">
              Try clearing a filter, or check back as Maine producers add fresh inventory.
            </p>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {enrichedProducts.map(({ product, farm, miles }) => (
            <div key={product.id} className="bg-white rounded-2xl overflow-hidden shadow">
              {product.photoUrl || product.imageUrl || product.image ? (
                <img
                  src={product.photoUrl || product.imageUrl || product.image}
                  alt={product.name || product.title || "Product"}
                  className="w-full h-56 object-cover"
                />
              ) : (
                <div className="w-full h-56 bg-stone-200" />
              )}

              <div className="p-4">
                <div className="text-xs text-stone-500 font-semibold">
                  {farm?.farmName || farm?.name || product.producerName || "Maine Farm"}
                </div>
                <div className="text-xs text-stone-400 space-y-0.5">
                  {(farm?.city || farm?.state || product.producerTown) && (
                    <div>
                      {farm?.city || farm?.state
                        ? [farm?.city, farm?.state].filter(Boolean).join(", ")
                        : product.producerTown}
                    </div>
                  )}
                  {(farm?.phone || product.producerPhone) && (
                    <div>
                      <a
                        href={`tel:${farm?.phone || product.producerPhone}`}
                        className="text-stone-500 hover:text-stone-700"
                      >
                        {farm?.phone || product.producerPhone}
                      </a>
                    </div>
                  )}
                  {miles != null ? (
                    <div>{miles.toFixed(1)} miles away</div>
                  ) : farm ? null : (
                    <div>Location not set</div>
                  )}
                </div>

                <div className="mt-2 text-xl font-extrabold text-stone-900">
                  {product.name || product.title}
                </div>

                {product.description ? (
                  <div className="text-sm text-stone-600 mt-1 line-clamp-2">{product.description}</div>
                ) : null}

                <div className="mt-2 text-sm text-gray-600">
                  ${Number(product.price || 0).toFixed(2)} / {product.unit || "each"}
                </div>

                <div className="mt-3 flex gap-2 flex-wrap">
                  {farm?.pickupAvailable !== false && (
                    <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                      Pickup
                    </span>
                  )}
                  {farm?.deliveryAvailable === true && (
                    <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                      Delivery
                    </span>
                  )}
                  <span className="text-xs font-bold bg-stone-100 text-stone-700 px-2 py-1 rounded-full">
                    {Number(product.quantityAvailable)} available
                  </span>
                </div>

                <button
                  onClick={() => addToCart(product)}
                  className="mt-4 w-full bg-[#23412c] text-white py-3 rounded-lg font-bold"
                >
                  Add to Cart
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReportTarget(product);
                      setReportReason("");
                    }}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900"
                  >
                    Report listing
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlockTarget({ product, farm })}
                    className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-bold text-stone-800"
                  >
                    Block producer
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Floating cart bar: fixed, does not affect layout; only the bar captures clicks */}
        {cartCount > 0 ? (
          <div
            className="fixed left-0 right-0 bottom-0 z-[50] flex justify-center px-4 pointer-events-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div
              ref={cartBarRef}
              className="bg-[#23412c] text-white rounded-t-2xl shadow-lg px-5 py-4 flex items-center gap-4 max-w-4xl w-full justify-between pointer-events-auto"
            >
              <div className="text-sm font-semibold">
                {cartCount} item{cartCount === 1 ? "" : "s"} • ${cartTotal.toFixed(2)}
              </div>
              <button
                onClick={() => navigate("/cart")}
                className="bg-[#d47a2a] px-4 py-2 rounded-full font-bold whitespace-nowrap"
              >
                View Cart
              </button>
            </div>
          </div>
        ) : null}

        {reportTarget && (
          <div
            className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-listing-title"
          >
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
              <h2 id="report-listing-title" className="text-xl font-bold">
                Report listing
              </h2>
              <p className="mt-2 text-sm text-stone-600">
                Explain the safety or policy concern. Do not include passwords or card information.
              </p>
              <textarea
                autoFocus
                maxLength={1000}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                className="mt-4 min-h-32 w-full rounded-xl border border-stone-300 p-3"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-stone-100 px-4 py-2 font-bold"
                  onClick={() => setReportTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!reportReason.trim()}
                  className="rounded-xl bg-amber-700 px-4 py-2 font-bold text-white disabled:opacity-50"
                  onClick={submitListingReport}
                >
                  Submit report
                </button>
              </div>
            </div>
          </div>
        )}

        {blockTarget && (
          <div
            className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="block-producer-title"
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <h2 id="block-producer-title" className="text-xl font-bold">
                Block this producer?
              </h2>
              <p className="mt-2 text-stone-600">
                Their listings will be hidden. You can unblock them from Account and safety.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-stone-100 px-4 py-2 font-bold"
                  onClick={() => setBlockTarget(null)}
                >
                  Keep visible
                </button>
                <button
                  type="button"
                  className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white"
                  onClick={confirmBlockProducer}
                >
                  Block producer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
