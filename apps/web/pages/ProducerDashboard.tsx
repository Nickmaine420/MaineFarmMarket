import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../App';
import { useSearchParams } from '../router';
import NewListingPage from './NewListingPage';
import FarmProfilePage from './FarmProfilePage';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
  deleteField,
  Timestamp,
} from 'firebase/firestore';
import { isNativeAndroidApp } from '../utils/platform';
import {
  googlePlaySubscriptionManagementUrl,
  GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID,
  PlayBilling,
} from '../services/playBilling';
import { activeProductDiscount, salePriceFromPercent } from '../utils/marketplaceFeatures';

type Product = {
  id: string;
  title?: string;
  department?: string;
  category?: string;
  tags?: string[];
  price?: number;
  unit?: string;
  quantityAvailable?: number;
  inStock?: boolean;
  producerUid?: string;
  producerId?: string;
  ownerId?: string;
  priceCents?: number;
  originalPrice?: number;
  originalPriceCents?: number;
  discountLabel?: string;
  discountEndsAt?: any;
  producerName?: string;
  imageUrl?: string;
  archived?: boolean;
  createdAt?: any;
};

type OrderItem = {
  productId?: string;
  title?: string;
  name?: string;
  price?: number;
  priceCents?: number;
  unit: string;
  qty: number;
};

type Fulfillment = {
  method?: "pickup" | "delivery";
  fulfillmentMethod?: "pickup" | "delivery";
  scheduledFor?: any;
  scheduledAt?: string | null;
  pickupDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  notes?: string;
  pickupPartner?: { producerId?: string; farmName?: string; city?: string; state?: string; phone?: string; hours?: string } | null;
  window?: { id?: string; label?: string; startTime?: string; endTime?: string };
};

type OrderDoc = {
  id: string;
  orderId?: string;
  orderGroupId?: string;
  producerUid?: string;
  producerName?: string;
  buyerUid?: string;
  buyerId?: string;
  buyerName?: string;
  buyerEmail?: string;
  items: OrderItem[];
  subtotal?: number;
  totalCents?: number;
  status: string;
  createdAt?: any;
  deliveryMethod?: string;
  scheduledAt?: string | null;
  pickupDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  notes?: string;
  fulfillment?: Fulfillment;
  paymentMode?: "direct" | "stripe";
  paymentStatus?: string;
  disputeStatus?: string;
};

function formatWhen(ts: any): string {
  const d =
    ts?.toDate?.() ||
    (typeof ts?.seconds === "number" ? new Date(ts.seconds * 1000) : null);
  if (!d) return "";
  return d.toLocaleString();
}

type ProducerView = 'overview' | 'products' | 'orders' | 'farm';

const producerViewFromQuery = (value: string | null): ProducerView =>
  value === 'products' || value === 'orders' || value === 'farm' || value === 'overview'
    ? value
    : 'overview';

const ProducerDashboard = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = producerViewFromQuery(searchParams.get('view'));
  const setView = (nextView: ProducerView) => setSearchParams({ view: nextView });
  const [creating, setCreating] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [editing, setEditing] = useState<Product | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editUnit, setEditUnit] = useState('each');
  const [editDiscountPercent, setEditDiscountPercent] = useState('');
  const [editDiscountLabel, setEditDiscountLabel] = useState('');
  const [editDiscountEndsAt, setEditDiscountEndsAt] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    { tone: "success" | "error" | "info"; message: string } | null
  >(null);

  useEffect(() => {
    if (!user) return;

    setLoadingProducts(true);
    const q = query(collection(db, 'products'), where('producerUid', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Product[];
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setProducts(list);
      setLoadingProducts(false);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    setLoadingOrders(true);
    const ordersRef = collection(db, 'producerOrders', user.uid, 'orders');
    const unsub = onSnapshot(ordersRef, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as OrderDoc[];
      list.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds ?? 0;
        return tb - ta;
      });
      setOrders(list);
      setLoadingOrders(false);
    });
    return () => unsub();
  }, [user]);

  const stats = useMemo(() => {
    const inStockCount = products.filter(p => p.inStock !== false).length;
    const newOrders = orders.filter((order) =>
      ["awaiting_payment", "paid", "pending", "new"].includes(order.status)
    ).length;
    return { total: products.length, inStockCount, newOrders };
  }, [products, orders]);

  const openEdit = (p: Product) => {
    const discount = activeProductDiscount(p);
    setEditing(p);
    setEditTitle(p.title || '');
    setEditPrice(String((p.originalPriceCents ?? p.priceCents ?? 0) / 100 || p.price || ''));
    setEditQty(String(p.quantityAvailable ?? ''));
    setEditUnit(p.unit || 'each');
    setEditDiscountPercent(discount ? String(discount.percent) : '');
    setEditDiscountLabel(p.discountLabel || '');
    const endDate = p.discountEndsAt?.toDate?.() || null;
    setEditDiscountEndsAt(endDate ? new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
  };

  const closeEdit = () => {
    setEditing(null);
    setSavingEdit(false);
  };

  const saveEdit = async () => {
    if (!user || !editing) return;
    const title = editTitle.trim();
    if (!title) {
      setNotice({ tone: "error", message: "Enter a product name." });
      return;
    }

    const priceNum = Number(editPrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setNotice({ tone: "error", message: "Enter a price greater than $0." });
      return;
    }
    const regularPriceCents = Math.round(priceNum * 100);
    const requestedDiscount = editDiscountPercent.trim() === '' ? 0 : Number(editDiscountPercent);
    if (!Number.isInteger(requestedDiscount) || requestedDiscount < 0 || requestedDiscount > 90) {
      setNotice({ tone: "error", message: "Discount must be a whole percentage from 1 to 90, or left blank." });
      return;
    }
    const salePriceCents = requestedDiscount > 0
      ? salePriceFromPercent(regularPriceCents, requestedDiscount)
      : regularPriceCents;
    if (salePriceCents == null) {
      setNotice({ tone: "error", message: "The discount could not be calculated." });
      return;
    }
    const discountEnd = editDiscountEndsAt ? new Date(editDiscountEndsAt) : null;
    if (discountEnd && (!Number.isFinite(discountEnd.getTime()) || discountEnd.getTime() <= Date.now())) {
      setNotice({ tone: "error", message: "Choose a discount end time in the future." });
      return;
    }

    const qtyNum = Number(editQty);
    if (!Number.isInteger(qtyNum) || qtyNum < 0) {
      setNotice({ tone: "error", message: "Quantity must be a whole number of 0 or more." });
      return;
    }

    try {
      setSavingEdit(true);
      await updateDoc(doc(db, 'products', editing.id), {
        title,
        price: salePriceCents / 100,
        priceCents: salePriceCents,
        originalPrice: requestedDiscount > 0 ? regularPriceCents / 100 : deleteField(),
        originalPriceCents: requestedDiscount > 0 ? regularPriceCents : deleteField(),
        discountLabel: requestedDiscount > 0 ? editDiscountLabel.trim() : deleteField(),
        discountEndsAt: requestedDiscount > 0 && discountEnd ? Timestamp.fromDate(discountEnd) : deleteField(),
        quantityAvailable: qtyNum,
        unit: editUnit,
        inStock: qtyNum > 0,
        archived: false,
        producerUid: user.uid,
        producerId: user.uid,
        ownerId: user.uid,
        updatedAt: serverTimestamp(),
      });
      setNotice({ tone: "success", message: "Listing updated." });
      closeEdit();
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", message: "Could not save the listing. Please try again." });
      setSavingEdit(false);
    }
  };

  const archiveListing = async (p: Product) => {
    try {
      await updateDoc(doc(db, "products", p.id), {
        producerUid: user?.uid,
        producerId: user?.uid,
        ownerId: user?.uid,
        priceCents: p.priceCents ?? Math.round(Number(p.price || 0) * 100),
        quantityAvailable: Math.max(0, Math.trunc(Number(p.quantityAvailable || 0))),
        archived: true,
        inStock: false,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setArchiveTarget(null);
      setNotice({
        tone: "success",
        message: `"${p.title || "Listing"}" was archived. Its data is preserved.`,
      });
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", message: "Could not archive the listing. Please try again." });
    }
  };

  const restoreListing = async (p: Product) => {
    try {
      await updateDoc(doc(db, "products", p.id), {
        producerUid: user?.uid,
        producerId: user?.uid,
        ownerId: user?.uid,
        priceCents: p.priceCents ?? Math.round(Number(p.price || 0) * 100),
        quantityAvailable: Math.max(0, Math.trunc(Number(p.quantityAvailable || 0))),
        archived: false,
        inStock: Number(p.quantityAvailable || 0) > 0,
        updatedAt: serverTimestamp(),
      });
      setNotice({ tone: "success", message: `"${p.title || "Listing"}" was restored.` });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: "Could not restore the listing. Please try again." });
    }
  };

  const setOrderStatus = async (orderId: string, status: string) => {
    if (!user) return;
    try {
      setPendingOrderId(orderId);
      const updateStatus = httpsCallable<
        { orderId: string; status: string },
        { orderId: string; producerStatus: string; orderStatus: string }
      >(functions, "updateProducerOrderStatus");
      await updateStatus({ orderId, status });
      setNotice({ tone: "success", message: `Order marked ${status.replaceAll("_", " ")}.` });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "error",
        message: e instanceof Error ? e.message : "Could not update the order.",
      });
    } finally {
      setPendingOrderId(null);
    }
  };

  const openProducerDispute = async (orderId: string) => {
    const reason = window.prompt(
      "Describe the order problem for Maine Farm Market support (at least 10 characters)."
    );
    if (!reason) return;
    try {
      setPendingOrderId(orderId);
      const openDispute = httpsCallable<
        { orderId: string; reason: string },
        { disputeId: string; status: string }
      >(functions, "openOrderDispute");
      await openDispute({ orderId, reason: reason.trim() });
      setNotice({ tone: "success", message: "The order problem was sent to support." });
    } catch (error: any) {
      setNotice({ tone: "error", message: error?.message || "Could not open the dispute." });
    } finally {
      setPendingOrderId(null);
    }
  };

  const [portalLoading, setPortalLoading] = useState(false);
  const openBillingPortal = async () => {
    try {
      setPortalLoading(true);
      if (user.subscriptionProvider === "google_play") {
        if (isNativeAndroidApp()) {
          await PlayBilling.openSubscriptionManagement({
            productId: GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID,
          });
        } else {
          window.location.assign(googlePlaySubscriptionManagementUrl());
        }
        return;
      }
      if (user.subscriptionProvider === "review") {
        setNotice({
          tone: "info",
          message:
            "This account has review access and does not have a paid subscription to manage.",
        });
        return;
      }

      // Stripe is also the safest fallback for older website subscriptions that
      // predate the provider field.
      const createPortalSession = httpsCallable<Record<string, never>, { url: string }>(
        functions,
        'createPortalSession'
      );
      const result = await createPortalSession({});
      const url = result?.data?.url;
      if (url) window.location.href = url;
      else setNotice({ tone: "error", message: "Could not open subscription management." });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "error",
        message: e instanceof Error ? e.message : "Could not open subscription management.",
      });
    } finally {
      setPortalLoading(false);
    }
  };

  const fulfillmentLine = (o: OrderDoc) => {
    const method =
      o.fulfillment?.method ??
      o.fulfillment?.fulfillmentMethod ??
      (o.deliveryMethod === "delivery" ? "delivery" : "pickup");
    const label = method === "delivery"
      ? "Delivery"
      : o.fulfillment?.pickupPartner?.farmName
        ? `Partner pickup at ${o.fulfillment.pickupPartner.farmName}`
        : "Pickup";

    let when = "";
    if (o.scheduledAt && String(o.scheduledAt).trim()) {
      const parsed = new Date(String(o.scheduledAt).trim());
      when = Number.isNaN(parsed.getTime()) ? String(o.scheduledAt).trim() : parsed.toLocaleString();
    } else if (o.pickupDate || o.pickupTime) {
      when = [o.pickupDate, o.pickupTime].filter(Boolean).join(" ");
    } else if (o.deliveryDate || o.deliveryTime) {
      when = [o.deliveryDate, o.deliveryTime].filter(Boolean).join(" ");
    } else if (o.fulfillment?.scheduledFor) {
      when = formatWhen(o.fulfillment.scheduledFor);
    } else if (o.fulfillment?.scheduledAt && String(o.fulfillment.scheduledAt).trim()) {
      const parsed = new Date(String(o.fulfillment.scheduledAt).trim());
      when = Number.isNaN(parsed.getTime())
        ? String(o.fulfillment.scheduledAt).trim()
        : parsed.toLocaleString();
    } else if (o.fulfillment?.window) {
      const w = o.fulfillment.window;
      if (w.label) when = w.label;
      else if (w.startTime || w.endTime) when = [w.startTime, w.endTime].filter(Boolean).join(" – ");
      else if (w.id) when = `Window: ${w.id}`;
    }
    if (!when) when = "Not specified";

    const partnerDetails = o.fulfillment?.pickupPartner
      ? [o.fulfillment.pickupPartner.city, o.fulfillment.pickupPartner.state, o.fulfillment.pickupPartner.phone]
          .filter(Boolean)
          .join(" · ")
      : "";
    const notes = [(o.fulfillment?.notes ?? o.notes ?? "").trim(), partnerDetails]
      .filter(Boolean)
      .join(" · ");
    return { label, when, notes };
  };

  const orderActions = (order: OrderDoc) => {
    const status = String(order.status || "").toLowerCase();
    const actions: Array<{ status: string; label: string; className: string }> = [];
    if (["awaiting_payment", "paid", "pending", "new"].includes(status)) {
      actions.push({
        status: "accepted",
        label: "Accept",
        className: "bg-stone-100 hover:bg-stone-200",
      });
    }
    if (status === "accepted") {
      actions.push({
        status: "ready",
        label: "Ready",
        className: "bg-green-100 text-green-800 hover:bg-green-200",
      });
    }
    if (status === "ready") {
      actions.push({
        status: "completed",
        label: "Complete",
        className: "bg-[#2f4a2e] text-white hover:opacity-90",
      });
    }
    if (
      order.paymentMode !== "stripe" &&
      ["awaiting_payment", "pending", "new", "accepted", "ready"].includes(status)
    ) {
      actions.push({
        status: "cancelled",
        label: "Cancel",
        className: "bg-red-100 text-red-800 hover:bg-red-200",
      });
    }
    return actions;
  };

  if (!user) return <div className="p-6">Please sign in.</div>;

  if (creating) return <NewListingPage onBack={() => setCreating(false)} />;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
        <div>
          <h2 className="text-4xl font-serif text-stone-800">Farm Manager</h2>
          <div className="text-stone-500 mt-1">Signed in as: {user.displayName || user.email}</div>
        </div>

        <div className="flex flex-wrap gap-3 justify-start sm:justify-end">
          <button
            onClick={() => setCreating(true)}
            className="min-h-12 flex-1 whitespace-nowrap rounded-xl bg-[#2f4a2e] px-6 py-3 font-bold text-white shadow-lg transition hover:opacity-90 sm:flex-none"
          >
            + New Listing
          </button>
          <button
            onClick={openBillingPortal}
            disabled={portalLoading}
            className="min-h-12 flex-1 whitespace-nowrap rounded-xl bg-stone-200 px-6 py-3 font-bold text-stone-800 transition hover:bg-stone-300 disabled:opacity-60 sm:flex-none"
          >
            {portalLoading ? 'Opening…' : 'Manage Subscription'}
          </button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          {notice.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div aria-label="Producer workspace" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:col-span-1 lg:block lg:space-y-2">
          <button aria-pressed={view === 'overview'} onClick={() => setView('overview')} className={`w-full text-left px-4 py-3 lg:px-6 lg:py-4 rounded-xl font-semibold transition ${view === 'overview' ? 'bg-green-100 text-green-800 shadow-sm' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>Dashboard</button>
          <button aria-pressed={view === 'products'} onClick={() => setView('products')} className={`w-full text-left px-4 py-3 lg:px-6 lg:py-4 rounded-xl font-semibold transition ${view === 'products' ? 'bg-green-100 text-green-800 shadow-sm' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>Products</button>
          <button aria-pressed={view === 'orders'} onClick={() => setView('orders')} className={`w-full text-left px-4 py-3 lg:px-6 lg:py-4 rounded-xl font-semibold transition ${view === 'orders' ? 'bg-green-100 text-green-800 shadow-sm' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>Orders {stats.newOrders > 0 ? `(${stats.newOrders})` : ''}</button>
          <button aria-pressed={view === 'farm'} onClick={() => setView('farm')} className={`w-full text-left px-4 py-3 lg:px-6 lg:py-4 rounded-xl font-semibold transition ${view === 'farm' ? 'bg-green-100 text-green-800 shadow-sm' : 'bg-white text-stone-600 hover:bg-stone-100'}`}>Farm Profile</button>
        </div>

        <div className="lg:col-span-3">
          {view === 'overview' && (
            <div className="bg-white rounded-2xl shadow p-8">
              <h3 className="text-2xl font-bold mb-4">Overview</h3>
              <div className="text-stone-700">Total listings: <b>{stats.total}</b></div>
              <div className="text-stone-700">In stock: <b>{stats.inStockCount}</b></div>
              <div className="text-stone-700">New orders: <b>{stats.newOrders}</b></div>
            </div>
          )}

          {view === 'farm' && <FarmProfilePage />}

          {view === 'products' && (
            <div className="bg-white rounded-2xl shadow p-8">
              <h3 className="text-2xl font-bold mb-4">Your Products</h3>

              {loadingProducts ? (
                <div className="text-stone-500">Loading your listings…</div>
              ) : products.length === 0 ? (
                <div className="text-stone-500">No products yet. Click <b>+ New Listing</b> to add your first one.</div>
              ) : (
                <div className="space-y-4">
                  {products.map((p) => (
                    // ✅ Key fix: stack on mobile to prevent cramping/overlap
                    <div key={p.id} className="border rounded-xl p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                      {/* ✅ Image becomes full-width on mobile so content has room */}
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.title || "Product"}
                          className="w-full sm:w-28 h-44 sm:h-20 object-cover rounded-lg border"
                        />
                      ) : (
                        <div
                          aria-label="No product photo"
                          className="grid h-44 w-full place-items-center rounded-lg border bg-stone-100 text-xs font-semibold text-stone-500 sm:h-20 sm:w-28"
                        >
                          No photo
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-stone-900 text-lg truncate">{p.title}</div>
                          {p.archived && (
                            <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold text-stone-700">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="text-stone-600">
                          {(p.department || 'Other')}{p.category ? ` • ${p.category}` : ''} • ${Number(p.price ?? 0).toFixed(2)} / {p.unit || 'each'} • Qty: {p.quantityAvailable ?? 0}
                        </div>
                        {activeProductDiscount(p) && <div className="mt-1 text-sm font-bold text-red-700">{activeProductDiscount(p)?.percent}% discount · regular ${(Number(p.originalPriceCents || 0) / 100).toFixed(2)}{p.discountLabel ? ` · ${p.discountLabel}` : ''}</div>}
                      </div>

                      {/* ✅ Buttons wrap and take full row on mobile (no overlap) */}
                      <div className="flex gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
                        <button
                          onClick={() => openEdit(p)}
                          className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 font-semibold flex-1 sm:flex-none min-w-[110px]"
                        >
                          Edit
                        </button>
                        {p.archived ? (
                          <button
                            onClick={() => restoreListing(p)}
                            className="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-900 hover:bg-emerald-200 font-semibold flex-1 sm:flex-none min-w-[110px]"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => setArchiveTarget(p)}
                            className="px-4 py-2 rounded-xl bg-amber-100 text-amber-900 hover:bg-amber-200 font-semibold flex-1 sm:flex-none min-w-[110px]"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === 'orders' && (
            <div className="bg-white rounded-2xl shadow p-8">
              <h3 className="text-2xl font-bold mb-4">Incoming Orders</h3>

              {loadingOrders ? (
                <div className="text-stone-500">Loading orders…</div>
              ) : orders.length === 0 ? (
                <div className="text-stone-500">No orders yet.</div>
              ) : (
                <div className="space-y-4">
                  {orders.map((o) => {
                    const f = fulfillmentLine(o);
                    const orderId = o.orderId ?? o.id;
                    const totalDisplay = o.totalCents != null ? (o.totalCents / 100).toFixed(2) : Number(o.subtotal || 0).toFixed(2);
                    return (
                      <div key={orderId} className="border rounded-xl p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-bold text-stone-900">Order • {(o.status || "pending").toUpperCase()}</div>
                            <div className="text-stone-600 text-sm">
                              Buyer: {o.buyerName || o.buyerId || "Buyer"} {o.buyerEmail ? `• ${o.buyerEmail}` : ""}
                            </div>
                            <div className="text-stone-600 text-sm">
                              Total: <b>${totalDisplay}</b>
                            </div>
                            {o.paymentMode === "direct" && (
                              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                Arrange payment directly with the buyer before fulfillment.
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {orderActions(o).map((action) => (
                              <button
                                key={action.status}
                                type="button"
                                onClick={() => setOrderStatus(orderId, action.status)}
                                disabled={pendingOrderId === orderId}
                                className={`px-3 py-2 rounded-xl font-semibold disabled:cursor-wait disabled:opacity-50 ${action.className}`}
                              >
                                {pendingOrderId === orderId ? "Updating…" : action.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => void openProducerDispute(orderId)}
                              disabled={pendingOrderId === orderId}
                              className="rounded-xl border border-stone-300 bg-white px-3 py-2 font-semibold disabled:opacity-50"
                            >
                              {o.disputeStatus === "open" ? "Dispute open" : "Report problem"}
                            </button>
                          </div>
                        </div>

                        {/* Fulfillment details */}
                        <div className="mt-4 border-t pt-3">
                          <div className="text-sm font-semibold mb-1">Fulfillment</div>
                          <div className="text-sm text-stone-700">
                            <b>{f.label}</b>
                            {f.when && f.when !== "Not specified" ? (
                              <span> • Scheduled: {f.when}</span>
                            ) : (
                              <span> • {f.when}</span>
                            )}
                          </div>
                          {f.notes ? (
                            <div className="text-sm text-stone-500 mt-1">Notes: {f.notes}</div>
                          ) : null}
                        </div>

                        <div className="mt-4 border-t pt-3">
                          <div className="text-sm font-semibold mb-2">Items</div>
                          <div className="space-y-2">
                            {(o.items || []).map((it: OrderItem, idx: number) => {
                              const name = it.title ?? it.name ?? "Item";
                              const price = it.price ?? (it.priceCents != null ? it.priceCents / 100 : 0);
                              const qty = it.qty ?? 1;
                              return (
                                <div key={idx} className="flex justify-between text-sm">
                                  <div className="text-stone-800">
                                    {name} <span className="text-stone-500">× {qty}</span>
                                  </div>
                                  <div className="text-stone-700">
                                    ${(Number(price) * qty).toFixed(2)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" role="presentation">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="edit-listing-title">
            <div className="flex items-center justify-between mb-4">
              <div id="edit-listing-title" className="text-xl font-bold">Edit Listing</div>
              <button type="button" onClick={closeEdit} aria-label="Close edit listing" className="text-stone-500 font-bold">×</button>
            </div>

            <label className="block text-sm font-semibold mb-1">Product name</label>
            <input className="border p-2 w-full mb-3 rounded" value={editTitle} onChange={e => setEditTitle(e.target.value)} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Unit</label>
                <select className="border p-2 w-full rounded" value={editUnit} onChange={e => setEditUnit(e.target.value)}>
                  <option value="each">each</option>
                  <option value="lb">lb</option>
                  <option value="dozen">dozen</option>
                  <option value="jar">jar</option>
                  <option value="bag">bag</option>
                  <option value="bunch">bunch</option>
                  <option value="pint">pint</option>
                  <option value="quart">quart</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Regular price</label>
                <input type="number" step="0.01" min="0" className="border p-2 w-full rounded" value={editPrice} onChange={e => setEditPrice(e.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Quantity</label>
                <input type="number" step="1" min="0" className="border p-2 w-full rounded" value={editQty} onChange={e => setEditQty(e.target.value)} />
              </div>
            </div>

            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
              <div className="font-bold text-orange-950">Optional discount</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold">Discount percent<input type="number" min="1" max="90" step="1" className="mt-1 w-full rounded border p-2 font-normal" value={editDiscountPercent} onChange={e => setEditDiscountPercent(e.target.value)} placeholder="20" /></label>
                <label className="text-sm font-semibold">Marketing label<input maxLength={80} className="mt-1 w-full rounded border p-2 font-normal" value={editDiscountLabel} onChange={e => setEditDiscountLabel(e.target.value)} placeholder="Weekend special" /></label>
                <label className="text-sm font-semibold sm:col-span-2">Discount ends (optional)<input type="datetime-local" className="mt-1 w-full rounded border p-2 font-normal" value={editDiscountEndsAt} onChange={e => setEditDiscountEndsAt(e.target.value)} /></label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={closeEdit} className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 font-semibold">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit} className="px-4 py-2 rounded-xl bg-[#2f4a2e] text-white hover:opacity-90 font-semibold disabled:opacity-60">
                {savingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-listing-title"
          >
            <h3 id="archive-listing-title" className="text-xl font-bold">
              Archive this listing?
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              “{archiveTarget.title || "This listing"}” will be hidden from buyers.
              Its product information and order history will be preserved, and you
              can restore it later.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchiveTarget(null)}
                className="rounded-xl bg-stone-100 px-4 py-2 font-semibold hover:bg-stone-200"
              >
                Keep active
              </button>
              <button
                type="button"
                onClick={() => archiveListing(archiveTarget)}
                className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700"
              >
                Archive listing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProducerDashboard;
