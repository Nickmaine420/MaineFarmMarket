import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { Link, useSearchParams } from "../router";
import { activeProductDiscount, effectiveProductPriceCents } from "../utils/marketplaceFeatures";

type AnyDoc = Record<string, any>;
const toDate = (value: any) => value?.toDate?.() || new Date((value?.seconds || 0) * 1000 || value);

export default function PublicProducerProfilePage() {
  const [params] = useSearchParams();
  const producerId = params.get("producerId") || "";
  const [farm, setFarm] = useState<AnyDoc | null>(null);
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [products, setProducts] = useState<AnyDoc[]>([]);
  const [publishedEvents, setPublishedEvents] = useState<AnyDoc[]>([]);
  const [attendingEventIds, setAttendingEventIds] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<AnyDoc[]>([]);
  const [partnerships, setPartnerships] = useState<AnyDoc[]>([]);
  const [farmLoaded, setFarmLoaded] = useState(false);
  const [publishedEventsLoaded, setPublishedEventsLoaded] = useState(false);
  const [attendanceLoaded, setAttendanceLoaded] = useState(false);

  useEffect(() => {
    setFarmLoaded(false);
    setPublishedEventsLoaded(false);
    setAttendanceLoaded(false);
    setFarm(null);
    setPublishedEvents([]);
    setAttendingEventIds([]);
    if (!producerId) {
      setFarmLoaded(true);
      setPublishedEventsLoaded(true);
      setAttendanceLoaded(true);
      return;
    }
    const unsubscribeFarms = onSnapshot(collection(db, "farms"), (snapshot) => {
      const next = Object.fromEntries(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
      setFarms(next);
      setFarm(next[producerId] || null);
      setFarmLoaded(true);
    });
    const unsubscribeProducts = onSnapshot(
      query(collection(db, "products"), where("producerUid", "==", producerId)),
      (snapshot) => setProducts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    );
    const unsubscribeRecommendations = onSnapshot(
      query(collection(db, "producerRecommendations"), where("producerId", "==", producerId)),
      (snapshot) => setRecommendations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    );
    const unsubscribePartnerships = onSnapshot(
      query(
        collection(db, "producerPartnerships"),
        where("memberIds", "array-contains", producerId),
        where("status", "==", "accepted")
      ),
      (snapshot) => setPartnerships(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    );
    const unsubscribePublishedEvents = onSnapshot(
      query(collection(db, "events"), where("status", "==", "published")),
      (snapshot) => {
        setPublishedEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setPublishedEventsLoaded(true);
      },
      (error) => {
        console.error("Published producer events could not be refreshed", error);
        setPublishedEventsLoaded(true);
      }
    );
    const unsubscribeAttendance = onSnapshot(
      query(collectionGroup(db, "attendees"), where("producerId", "==", producerId)),
      (snapshot) => {
        setAttendingEventIds(
          snapshot.docs
            .map((attendee) => attendee.ref.parent.parent?.id || "")
            .filter(Boolean)
        );
        setAttendanceLoaded(true);
      },
      (error) => {
        console.error("Producer event attendance could not be refreshed", error);
        setAttendanceLoaded(true);
      }
    );
    return () => {
      unsubscribeFarms();
      unsubscribeProducts();
      unsubscribeRecommendations();
      unsubscribePartnerships();
      unsubscribePublishedEvents();
      unsubscribeAttendance();
    };
  }, [producerId]);

  const visibleProducts = products.filter((product) => product.archived !== true && product.inStock !== false);
  const acceptedPartners = partnerships.filter((partnership) => partnership.status === "accepted");
  const attendingEventIdSet = useMemo(
    () => new Set(attendingEventIds),
    [attendingEventIds]
  );
  const upcomingEvents = publishedEvents
    .filter((event) => attendingEventIdSet.has(event.id))
    .filter((event) => toDate(event.endAt).getTime() >= Date.now())
    .sort((first, second) => toDate(first.startAt).getTime() - toDate(second.startAt).getTime());
  const recommendedFarms = useMemo(
    () => recommendations.map((item) => ({ recommendation: item, farm: farms[item.recommendedProducerId] })).filter((item) => item.farm),
    [farms, recommendations]
  );

  if (!producerId) return <main className="min-h-screen bg-[#f6f0dd] p-8 text-center"><h1 className="text-2xl font-bold">Producer not selected</h1><Link to="/buyer" className="mt-4 inline-block underline">Return to the market</Link></main>;
  if (!farmLoaded || !publishedEventsLoaded || !attendanceLoaded) return <main className="min-h-screen bg-[#f6f0dd] p-8 text-center">Loading producer profile…</main>;
  if (!farm) return <main className="min-h-screen bg-[#f6f0dd] p-8 text-center"><h1 className="text-2xl font-bold">Producer profile unavailable</h1><p className="mt-2 text-stone-600">This producer has not published a farm profile yet.</p><Link to="/buyer" className="mt-4 inline-block underline">Return to the market</Link></main>;

  return (
    <main className="min-h-screen bg-[#f6f0dd] pb-12">
      <section className="bg-[#173f32] px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl"><p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Public producer profile</p><div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><h1 className="text-4xl font-serif sm:text-5xl">{farm.farmName}</h1><p className="mt-2 text-emerald-50">{[farm.city, farm.state].filter(Boolean).join(", ")}</p></div><div className="flex flex-wrap gap-2"><Link to={`/events?producer=${encodeURIComponent(producerId)}`} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white">Events</Link>{farm.promoPageEnabled && <Link to="/promotions" className="rounded-xl bg-white px-5 py-3 font-bold text-emerald-950">Promotions</Link>}</div></div></div>
      </section>
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">About {farm.farmName}</h2><p className="mt-3 whitespace-pre-line text-stone-600">{farm.description || "This producer has not added a public story yet."}</p>{farm.hours && <p className="mt-4 text-sm"><strong>Hours:</strong> {farm.hours}</p>}<div className="mt-4 flex flex-wrap gap-2">{farm.pickupAvailable && <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">Pickup</span>}{farm.deliveryAvailable && <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-900">Delivery</span>}</div></div>
          <div className="rounded-2xl bg-white p-6 shadow"><h2 className="text-lg font-bold">Contact and location</h2><p className="mt-3 text-stone-600">{[farm.city, farm.state, farm.zip].filter(Boolean).join(", ")}</p>{farm.phone && <a href={`tel:${farm.phone}`} className="mt-3 block font-bold text-emerald-800 underline">{farm.phone}</a>}{farm.deliveryNotes && <p className="mt-4 text-sm text-stone-600">{farm.deliveryNotes}</p>}</div>
        </section>

        {Array.isArray(farm.photos) && farm.photos.length > 0 && <section><h2 className="text-3xl font-serif">Photos</h2><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{farm.photos.map((photo: AnyDoc, index: number) => <img key={`${photo.url}-${index}`} src={photo.url} alt={photo.alt || `${farm.farmName} photo ${index + 1}`} className="h-48 w-full rounded-2xl object-cover shadow sm:h-64" />)}</div></section>}

        <section><h2 className="text-3xl font-serif">Products</h2>{visibleProducts.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">No products are currently available.</p> : <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{visibleProducts.map((product) => { const discount = activeProductDiscount(product); return <article key={product.id} className="overflow-hidden rounded-2xl bg-white shadow">{product.imageUrl ? <img src={product.imageUrl} alt={product.title} className="h-48 w-full object-cover" /> : <div className="h-48 bg-stone-200" />}<div className="p-5">{discount && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-800">{discount.percent}% OFF</span>}<h3 className="mt-2 text-xl font-bold">{product.title}</h3><p className="mt-2 text-sm text-stone-600">{product.description}</p><div className="mt-3 font-black text-emerald-900">${(effectiveProductPriceCents(product) / 100).toFixed(2)} / {product.unit || "each"}{discount && <span className="ml-2 text-sm font-normal text-stone-400 line-through">${(discount.originalPriceCents / 100).toFixed(2)}</span>}</div><Link to="/buyer" className="mt-4 inline-block rounded-xl bg-emerald-900 px-4 py-2 font-bold text-white">Shop in market</Link></div></article>;})}</div>}</section>

        <section><div className="flex items-center justify-between gap-3"><h2 className="text-3xl font-serif">Upcoming events</h2><Link to={`/events?producer=${encodeURIComponent(producerId)}`} className="font-bold text-emerald-800 underline">All events</Link></div>{upcomingEvents.length === 0 ? <p className="mt-4 rounded-2xl bg-white p-6 text-stone-600">No upcoming appearances are listed.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{upcomingEvents.slice(0, 4).map((event) => <article key={event.id} className="rounded-2xl bg-white p-5 shadow"><div className="text-sm font-bold text-orange-700">{toDate(event.startAt).toLocaleString()}</div><h3 className="mt-1 text-xl font-bold">{event.title}</h3><p className="mt-2 text-stone-600">{event.venueName} · {event.city}</p></article>)}</div>}</section>

        {recommendedFarms.length > 0 && <section><h2 className="text-3xl font-serif">Producers we recommend</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{recommendedFarms.map(({ recommendation, farm: recommended }) => <article key={recommendation.id} className="rounded-2xl bg-white p-5 shadow"><h3 className="text-xl font-bold">{recommended.farmName}</h3>{recommendation.note && <p className="mt-2 text-stone-600">“{recommendation.note}”</p>}<Link to={`/producer-profile?producerId=${encodeURIComponent(recommended.id)}`} className="mt-3 inline-block font-bold text-emerald-800 underline">View producer</Link></article>)}</div></section>}

        {acceptedPartners.length > 0 && <section><h2 className="text-3xl font-serif">Pickup and delivery partners</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{acceptedPartners.map((partnership) => { const partnerId = partnership.memberIds.find((id: string) => id !== producerId); const partner = farms[partnerId]; return <article key={partnership.id} className="rounded-2xl border border-emerald-200 bg-white p-5 shadow"><h3 className="text-xl font-bold">{partner?.farmName || "Producer partner"}</h3><div className="mt-2 flex gap-2">{partnership.pickupEnabled && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold">Shared pickup</span>}{partnership.deliveryEnabled && <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold">Delivery support</span>}</div>{partnership.publicNote && <p className="mt-3 text-stone-600">{partnership.publicNote}</p>}{partnerId && <Link to={`/producer-profile?producerId=${encodeURIComponent(partnerId)}`} className="mt-3 inline-block font-bold text-emerald-800 underline">View partner</Link>}</article>;})}</div></section>}
      </div>
    </main>
  );
}
