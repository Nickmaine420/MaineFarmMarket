import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "../router";
import { activeProductDiscount } from "../utils/marketplaceFeatures";

type AnyDoc = Record<string, any>;
const toMillis = (value: any) => value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : new Date(value).getTime());

export default function PromotionsPage() {
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [promotions, setPromotions] = useState<AnyDoc[]>([]);
  const [products, setProducts] = useState<AnyDoc[]>([]);
  const [events, setEvents] = useState<AnyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const readySources = new Set<string>();
    const markReady = (source: string) => {
      readySources.add(source);
      if (readySources.size === 4) setLoading(false);
    };
    const handleError = (source: string, error: unknown) => {
      console.error(`Promotion ${source} could not be refreshed`, error);
      setLoadError("Some promotion information could not be refreshed. Please reopen this page to try again.");
      markReady(source);
    };
    const subscriptions = [
      onSnapshot(collection(db, "farms"), (snapshot) => {
        setFarms(Object.fromEntries(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }])));
        markReady("farms");
      }, (error) => handleError("farms", error)),
      onSnapshot(query(collection(db, "promotions"), where("active", "==", true)), (snapshot) => {
        setPromotions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        markReady("promotions");
      }, (error) => handleError("promotions", error)),
      onSnapshot(collection(db, "products"), (snapshot) => {
        setProducts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        markReady("products");
      }, (error) => handleError("products", error)),
      onSnapshot(query(collection(db, "events"), where("status", "==", "published")), (snapshot) => {
        setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        markReady("events");
      }, (error) => handleError("events", error)),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, []);

  const participatingFarms = useMemo(
    () => (Object.values(farms) as AnyDoc[]).filter((farm) => farm.promoPageEnabled === true),
    [farms]
  );
  const participatingIds = useMemo(
    () => new Set(participatingFarms.map((farm) => farm.id)),
    [participatingFarms]
  );
  const now = Date.now();
  const activePromotions = promotions
    .filter((promotion) => promotion.active === true && participatingIds.has(promotion.producerId))
    .filter((promotion) => toMillis(promotion.startsAt) <= now && toMillis(promotion.endsAt) > now)
    .sort((first, second) => toMillis(first.endsAt) - toMillis(second.endsAt));
  const discountedProducts = products
    .map((product) => ({ product, discount: activeProductDiscount(product, now) }))
    .filter(({ product, discount }) => Boolean(discount) && participatingIds.has(product.producerId || product.producerUid))
    .filter(({ product }) => product.archived !== true && product.inStock !== false)
    .slice(0, 20);
  const upcomingEvents = events
    .filter((event) => participatingIds.has(event.hostProducerId) && toMillis(event.endAt) > now)
    .sort((first, second) => toMillis(first.startAt) - toMillis(second.startAt))
    .slice(0, 8);

  return (
    <main className="min-h-screen bg-[#f8f3e4] px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-400 p-7 text-white shadow-xl sm:p-12">
          <p className="text-sm font-black uppercase tracking-[0.2em]">Local specials</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-serif sm:text-6xl">Deals, events, and seasonal finds</h1>
          <p className="mt-4 max-w-2xl text-lg text-orange-50">A shared promotion space created by Maine Farm Market producers.</p>
        </section>

        {loadError && <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">{loadError}</div>}
        {loading ? <div className="mt-6 rounded-2xl bg-white p-8 text-center">Loading producer promotions…</div> : (
          <>
            <section className="mt-8">
              <div className="flex items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-wider text-orange-700">Featured producers</p><h2 className="text-3xl font-serif">Promotion pages</h2></div></div>
              {participatingFarms.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">Producer promotion pages will appear here as they opt in.</p> : (
                <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {participatingFarms.map((farm) => <article key={farm.id} className="mfm-deferred-card overflow-hidden rounded-2xl bg-white shadow">
                    {farm.photos?.[0]?.url ? <img src={farm.photos[0].url} alt={farm.photos[0].alt || farm.farmName} loading="lazy" decoding="async" className="h-44 w-full object-cover" /> : <div className="h-28 bg-emerald-900" />}
                    <div className="p-5"><h3 className="text-xl font-bold">{farm.promoHeadline || farm.farmName}</h3><p className="mt-2 text-sm text-stone-600">{farm.promoDescription || farm.description || `Fresh updates from ${farm.farmName}.`}</p><Link to={`/producer-profile?producerId=${encodeURIComponent(farm.id)}`} className="mt-4 inline-block rounded-xl bg-emerald-900 px-4 py-2 font-bold text-white">Visit producer</Link></div>
                  </article>)}
                </div>
              )}
            </section>

            <section className="mt-10"><h2 className="text-3xl font-serif">Current deals</h2>
              {activePromotions.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">No custom deals are active today.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{activePromotions.map((promotion) => <article key={promotion.id} className="rounded-2xl border-l-8 border-orange-500 bg-white p-5 shadow"><div className="text-xs font-bold uppercase text-orange-700">{promotion.kind}</div><h3 className="mt-1 text-xl font-bold">{promotion.title}</h3><p className="mt-2 text-stone-600">{promotion.description}</p><div className="mt-3 text-sm font-semibold">From <Link className="text-emerald-800 underline" to={`/producer-profile?producerId=${encodeURIComponent(promotion.producerId)}`}>{farms[promotion.producerId]?.farmName || "Maine producer"}</Link></div><div className="mt-1 text-xs text-stone-500">Through {new Date(toMillis(promotion.endsAt)).toLocaleString()}</div></article>)}</div>}
            </section>

            <section className="mt-10"><h2 className="text-3xl font-serif">Discounted products</h2>
              {discountedProducts.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">No product discounts are active right now.</p> : <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{discountedProducts.map(({ product, discount }) => <article key={product.id} className="overflow-hidden rounded-2xl bg-white shadow">{product.imageUrl ? <img src={product.imageUrl} alt={product.title} className="h-40 w-full object-cover" /> : <div className="h-40 bg-stone-200" />}<div className="p-4"><span className="rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-800">{discount?.percent}% OFF</span><h3 className="mt-3 font-bold">{product.title}</h3><div className="mt-2"><span className="font-black text-emerald-900">${((discount?.currentPriceCents || 0) / 100).toFixed(2)}</span><span className="ml-2 text-sm text-stone-400 line-through">${((discount?.originalPriceCents || 0) / 100).toFixed(2)}</span></div><Link to={`/producer-profile?producerId=${encodeURIComponent(product.producerId || product.producerUid)}`} className="mt-3 inline-block text-sm font-bold text-emerald-800 underline">{farms[product.producerId || product.producerUid]?.farmName || product.producerName}</Link></div></article>)}</div>}
            </section>

            <section className="mt-10"><div className="flex items-center justify-between gap-3"><h2 className="text-3xl font-serif">Upcoming events</h2><Link to="/events" className="font-bold text-emerald-800 underline">View full calendar</Link></div>
              {upcomingEvents.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">No featured events are currently scheduled.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{upcomingEvents.map((event) => <article key={event.id} className="rounded-2xl bg-white p-5 shadow"><div className="text-sm font-bold text-orange-700">{new Date(toMillis(event.startAt)).toLocaleString()}</div><h3 className="mt-1 text-xl font-bold">{event.title}</h3><p className="mt-2 text-stone-600">{event.venueName} · {[event.city, event.state].filter(Boolean).join(", ")}</p><Link to={`/events?producer=${encodeURIComponent(event.hostProducerId)}`} className="mt-3 inline-block font-bold text-emerald-800 underline">Event details</Link></article>)}</div>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
