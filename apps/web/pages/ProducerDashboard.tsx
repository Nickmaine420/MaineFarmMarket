import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../App';
import NewListingPage from './NewListingPage';
import FarmProfilePage from './FarmProfilePage';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  onSnapshot,
  query,
  where,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

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
  producerName?: string;
  imageUrl?: string;
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
};

function formatWhen(ts: any): string {
  const d =
    ts?.toDate?.() ||
    (typeof ts?.seconds === "number" ? new Date(ts.seconds * 1000) : null);
  if (!d) return "";
  return d.toLocaleString();
}

const ProducerDashboard = () => {
  const { user, logout } = useAuth();
  const [view, setView] = useState<'overview' | 'products' | 'orders' | 'farm'>('products');
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
  const [savingEdit, setSavingEdit] = useState(false);

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
    const newOrders = orders.filter(o => o.status === 'pending' || o.status === 'new').length;
    return { total: products.length, inStockCount, newOrders };
  }, [products, orders]);

  const openEdit = (p: Product) => {
    setEditing(p);
    setEditTitle(p.title || '');
    setEditPrice(String(p.price ?? ''));
    setEditQty(String(p.quantityAvailable ?? ''));
    setEditUnit(p.unit || 'each');
  };

  const closeEdit = () => {
    setEditing(null);
    setSavingEdit(false);
  };

  const saveEdit = async () => {
    if (!user || !editing) return;
    const title = editTitle.trim();
    if (!title) return alert("Enter a product name.");

    const priceNum = Number(editPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) return alert("Enter a valid price.");

    const qtyNum = Number(editQty);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) return alert("Enter a valid quantity.");

    try {
      setSavingEdit(true);
      await updateDoc(doc(db, 'products', editing.id), {
        title,
        price: priceNum,
        quantityAvailable: qtyNum,
        unit: editUnit,
        inStock: qtyNum > 0,
        updatedAt: serverTimestamp(),
      });
      closeEdit();
    } catch (e) {
      console.error(e);
      alert("Could not save changes — check console");
      setSavingEdit(false);
    }
  };

  const deleteListing = async (p: Product) => {
    if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'products', p.id));
    } catch (e) {
      console.error(e);
      alert("Could not delete — check console");
    }
  };

  const setOrderStatus = async (orderId: string, status: string) => {
    if (!user) return;
    try {
      const producerOrderRef = doc(db, 'producerOrders', user.uid, 'orders', orderId);
      await updateDoc(producerOrderRef, { status, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      alert("Could not update order — check console");
    }
  };

  const [portalLoading, setPortalLoading] = useState(false);
  const openBillingPortal = async () => {
    try {
      setPortalLoading(true);
      const createPortalSession = httpsCallable<Record<string, never>, { url: string }>(
        functions,
        'createPortalSession'
      );
      const result = await createPortalSession({});
      const url = result?.data?.url;
      if (url) window.location.href = url;
      else alert('Could not open subscription management.');
    } catch (e: unknown) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Could not open subscription management.');
    } finally {
      setPortalLoading(false);
    }
  };

  const fulfillmentLine = (o: OrderDoc) => {
    const method =
      o.fulfillment?.method ??
      o.fulfillment?.fulfillmentMethod ??
      (o.deliveryMethod === "delivery" ? "delivery" : "pickup");
    const label = method === "delivery" ? "Delivery" : "Pickup";

    let when = "";
    if (o.scheduledAt && String(o.scheduledAt).trim()) {
      when = String(o.scheduledAt).trim();
    } else if (o.pickupDate || o.pickupTime) {
      when = [o.pickupDate, o.pickupTime].filter(Boolean).join(" ");
    } else if (o.deliveryDate || o.deliveryTime) {
      when = [o.deliveryDate, o.deliveryTime].filter(Boolean).join(" ");
    } else if (o.fulfillment?.scheduledFor) {
      when = formatWhen(o.fulfillment.scheduledFor);
    } else if (o.fulfillment?.scheduledAt && String(o.fulfillment.scheduledAt).trim()) {
      when = String(o.fulfillment.scheduledAt).trim();
    } else if (o.fulfillment?.window) {
      const w = o.fulfillment.window;
      if (w.label) when = w.label;
      else if (w.startTime || w.endTime) when = [w.startTime, w.endTime].filter(Boolean).join(" – ");
      else if (w.id) when = `Window: ${w.id}`;
    }
    if (!when) when = "Not specified";

    const notes = (o.fulfillment?.notes ?? o.notes ?? "").trim();
    return { label, when, notes };
  };

  if (!user) return <div className="p-6">Please sign in.</div>;

  if (creating) return <NewListingPage onBack={() => setCreating(false)} />;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* ✅ Mobile-safe header: stacks on small screens */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
        <div>
          <h2 className="text-4xl font-serif text-stone-800">Farm Manager</h2>
          <div className="text-stone-500 mt-1">Signed in as: {user.displayName || user.email}</div>
        </div>

        {/* ✅ Wraps buttons instead of overflowing */}
        <div className="flex flex-wrap gap-3 justify-start sm:justify-end">
          <button
            onClick={() => setCreating(true)}
            className="bg-[#2f4a2e] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-lg"
          >
            + New Listing
          </button>
          <button
            onClick={openBillingPortal}
            disabled={portalLoading}
            className="bg-stone-200 text-stone-800 px-6 py-3 rounded-xl font-bold hover:bg-stone-300 transition disabled:opacity-60"
          >
            {portalLoading ? 'Opening…' : 'Cancel Subscription'}
          </button>
          <button
            onClick={logout}
            className="bg-stone-200 text-stone-800 px-6 py-3 rounded-xl font-bold hover:bg-stone-300 transition"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-2">
          <button onClick={() => setView('overview')} className={`w-full text-left px-6 py-4 rounded-xl font-semibold transition ${view === 'overview' ? 'bg-green-100 text-green-800' : 'text-stone-600 hover:bg-stone-100'}`}>Dashboard</button>
          <button onClick={() => setView('products')} className={`w-full text-left px-6 py-4 rounded-xl font-semibold transition ${view === 'products' ? 'bg-green-100 text-green-800' : 'text-stone-600 hover:bg-stone-100'}`}>Products</button>
          <button onClick={() => setView('orders')} className={`w-full text-left px-6 py-4 rounded-xl font-semibold transition ${view === 'orders' ? 'bg-green-100 text-green-800' : 'text-stone-600 hover:bg-stone-100'}`}>Orders {stats.newOrders > 0 ? `(${stats.newOrders})` : ''}</button>
          <button onClick={() => setView('farm')} className={`w-full text-left px-6 py-4 rounded-xl font-semibold transition ${view === 'farm' ? 'bg-green-100 text-green-800' : 'text-stone-600 hover:bg-stone-100'}`}>Farm Profile</button>
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
                      <img
                        src={p.imageUrl || "https://via.placeholder.com/120x90?text=No+Photo"}
                        alt={p.title || "Product"}
                        className="w-full sm:w-28 h-44 sm:h-20 object-cover rounded-lg border"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-stone-900 text-lg truncate">{p.title}</div>
                        <div className="text-stone-600">
                          {(p.department || 'Other')}{p.category ? ` • ${p.category}` : ''} • ${Number(p.price ?? 0).toFixed(2)} / {p.unit || 'each'} • Qty: {p.quantityAvailable ?? 0}
                        </div>
                      </div>

                      {/* ✅ Buttons wrap and take full row on mobile (no overlap) */}
                      <div className="flex gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
                        <button
                          onClick={() => openEdit(p)}
                          className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 font-semibold flex-1 sm:flex-none min-w-[110px]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteListing(p)}
                          className="px-4 py-2 rounded-xl bg-red-100 text-red-800 hover:bg-red-200 font-semibold flex-1 sm:flex-none min-w-[110px]"
                        >
                          Delete
                        </button>
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
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button onClick={() => setOrderStatus(orderId, "accepted")} className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 font-semibold">Accept</button>
                            <button onClick={() => setOrderStatus(orderId, "ready")} className="px-3 py-2 rounded-xl bg-green-100 text-green-800 hover:bg-green-200 font-semibold">Ready</button>
                            <button onClick={() => setOrderStatus(orderId, "completed")} className="px-3 py-2 rounded-xl bg-[#2f4a2e] text-white hover:opacity-90 font-semibold">Complete</button>
                            <button onClick={() => setOrderStatus(orderId, "cancelled")} className="px-3 py-2 rounded-xl bg-red-100 text-red-800 hover:bg-red-200 font-semibold">Cancel</button>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xl font-bold">Edit Listing</div>
              <button onClick={closeEdit} className="text-stone-500 font-bold">✕</button>
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
                <label className="block text-sm font-semibold mb-1">Price</label>
                <input type="number" step="0.01" min="0" className="border p-2 w-full rounded" value={editPrice} onChange={e => setEditPrice(e.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Quantity</label>
                <input type="number" step="1" min="0" className="border p-2 w-full rounded" value={editQty} onChange={e => setEditQty(e.target.value)} />
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
    </div>
  );
};

export default ProducerDashboard;
