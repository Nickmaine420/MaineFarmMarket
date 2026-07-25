import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db, functions } from "../firebase";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

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

  const [products, setProducts] = useState<any[]>([]);
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [buyerLoc, setBuyerLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);

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
    (async () => {
      const ps = await getDocs(collection(db, "products"));
      const pList = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProducts(pList);

      const fs = await getDocs(collection(db, "farms"));
      const fMap: Record<string, AnyDoc> = {};
      fs.docs.forEach((d) => (fMap[d.id] = { id: d.id, ...d.data() }));
      setFarms(fMap);
    })();
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
    const list = products.map((p) => {
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
  }, [products, farms, buyerLoc]);

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
      alert("Please sign in first.");
      return;
    }

    const uid = user.uid;
    const cartRef = doc(db, "carts", uid);

    const item = buildCartItemFromProduct(product);

    // Read current items once, then write back updated items (and bump cartVersion)
    const snap = await getDoc(cartRef);
    const snapData = (snap.exists() ? (snap.data() as any) : {}) || {};
    const existing: CartItem[] = Array.isArray(snapData.items) ? (snapData.items as CartItem[]) : [];
    const currentVersion =
      typeof snapData.cartVersion === "number" && Number.isFinite(snapData.cartVersion)
        ? snapData.cartVersion
        : 0;
    const nextVersion = currentVersion + 1;

    const next = [...existing];
    const idx = next.findIndex((x) => x.productId === item.productId);

    if (idx >= 0) {
      next[idx] = { ...next[idx], qty: Number(next[idx].qty || 1) + 1 };
    } else {
      next.push(item);
    }

    await setDoc(
      cartRef,
      { items: next, cartVersion: nextVersion, updatedAt: serverTimestamp() },
      { merge: true }
    );

    // Ensure legacy local cart cannot “ghost” the count bar
    clearLocalCartKeys();
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
      alert("Unable to get your location. Please allow location access in your browser.");
    } finally {
      setLocBusy(false);
    }
  }

  function clearLocation() {
    setBuyerLoc(null);
    localStorage.removeItem(BUYER_LOC_KEY);
  }

  const [portalLoading, setPortalLoading] = useState(false);
  const openBillingPortal = async () => {
    try {
      setPortalLoading(true);
      const createPortalSession = httpsCallable<Record<string, never>, { url: string }>(
        functions,
        "createPortalSession"
      );
      const result = await createPortalSession({});
      const url = result?.data?.url;
      if (url) window.location.href = url;
      else alert("Could not open subscription management.");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Could not open subscription management.");
    } finally {
      setPortalLoading(false);
    }
  };

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
            <h1 className="text-4xl font-extrabold text-[#2c2c2c]">Fresh from Maine</h1>
            <div className="text-sm text-stone-700 mt-1">
              Location set • Sorting by nearest farms{" "}
              <button onClick={clearLocation} className="underline ml-2">
                Clear
              </button>
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
              onClick={() => navigate("/orders")}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              My Orders
            </button>

            <button
              onClick={openBillingPortal}
              disabled={portalLoading}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              {portalLoading ? "Opening…" : "Cancel Subscription"}
            </button>

            <button
              onClick={() => navigate("/")}
              className="bg-white px-4 py-2 rounded-full font-bold border border-stone-200"
            >
              Logout
            </button>
          </div>
        </div>

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
                  {product.deliveryAvailable ? (
                    <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                      Delivery
                    </span>
                  ) : (
                    <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-1 rounded-full">
                      Pickup
                    </span>
                  )}
                </div>

                <button
                  onClick={() => addToCart(product)}
                  className="mt-4 w-full bg-[#23412c] text-white py-3 rounded-lg font-bold"
                >
                  Add to Cart
                </button>
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
      </div>
    </div>
  );
}