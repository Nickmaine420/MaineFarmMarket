import React, { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { producerPartnershipId } from "@mfm/shared";
import { useAuth } from "../App";
import { db } from "../firebase";
import { Link } from "../router";
import { isMaineZip } from "../utils/validation";

type AnyDoc = Record<string, any>;
type GrowthTab = "promo" | "events" | "network";
const toDateTimeLocal = (date: Date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
};
const fromTimestamp = (value: any) => value?.toDate?.() || new Date(value);

export default function ProducerGrowthPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<GrowthTab>("promo");
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [promotions, setPromotions] = useState<AnyDoc[]>([]);
  const [events, setEvents] = useState<AnyDoc[]>([]);
  const [recommendations, setRecommendations] = useState<AnyDoc[]>([]);
  const [partnerships, setPartnerships] = useState<AnyDoc[]>([]);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const ownFarm = user ? farms[user.uid] : null;
  const otherFarms = useMemo(
    () => (Object.values(farms) as AnyDoc[]).filter((farm) => farm.id !== user?.uid).sort((a, b) => String(a.farmName).localeCompare(String(b.farmName))),
    [farms, user]
  );

  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoHeadline, setPromoHeadline] = useState("");
  const [promoDescription, setPromoDescription] = useState("");
  const [dealTitle, setDealTitle] = useState("");
  const [dealDescription, setDealDescription] = useState("");
  const [dealKind, setDealKind] = useState<"deal" | "announcement">("deal");
  const [dealStartsAt, setDealStartsAt] = useState(() => toDateTimeLocal(new Date()));
  const [dealEndsAt, setDealEndsAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 7 * 86_400_000)));

  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventVenue, setEventVenue] = useState("");
  const [eventAddress, setEventAddress] = useState("");
  const [eventCity, setEventCity] = useState("");
  const [eventZip, setEventZip] = useState("");
  const [eventCategories, setEventCategories] = useState("");
  const [eventStartAt, setEventStartAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 86_400_000)));
  const [eventEndAt, setEventEndAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 90_000_000)));
  const [eventLat, setEventLat] = useState("");
  const [eventLng, setEventLng] = useState("");

  const [recommendedProducerId, setRecommendedProducerId] = useState("");
  const [recommendationNote, setRecommendationNote] = useState("");
  const [partnerProducerId, setPartnerProducerId] = useState("");
  const [partnerPickup, setPartnerPickup] = useState(true);
  const [partnerDelivery, setPartnerDelivery] = useState(false);
  const [partnerNote, setPartnerNote] = useState("");

  useEffect(() => {
    if (!user) return;
    const unsubscribers = [
      onSnapshot(collection(db, "farms"), (snapshot) => {
        const next = Object.fromEntries(snapshot.docs.map((farm) => [farm.id, { id: farm.id, ...farm.data() }]));
        setFarms(next);
      }),
      onSnapshot(query(collection(db, "promotions"), where("producerId", "==", user.uid)), (snapshot) => setPromotions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))),
      onSnapshot(query(collection(db, "events"), where("hostProducerId", "==", user.uid)), (snapshot) => setEvents((snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AnyDoc[]).sort((a, b) => fromTimestamp(a.startAt).getTime() - fromTimestamp(b.startAt).getTime()))),
      onSnapshot(query(collection(db, "producerRecommendations"), where("producerId", "==", user.uid)), (snapshot) => setRecommendations(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))),
      onSnapshot(query(collection(db, "producerPartnerships"), where("memberIds", "array-contains", user.uid)), (snapshot) => setPartnerships(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [user]);

  useEffect(() => {
    if (!ownFarm) return;
    setPromoEnabled(ownFarm.promoPageEnabled === true);
    setPromoHeadline(ownFarm.promoHeadline || "");
    setPromoDescription(ownFarm.promoDescription || "");
    setEventCity((current) => current || ownFarm.city || "");
    setEventZip((current) => current || ownFarm.zip || "");
    setEventLat((current) => current || (typeof ownFarm.lat === "number" ? String(ownFarm.lat) : ""));
    setEventLng((current) => current || (typeof ownFarm.lng === "number" ? String(ownFarm.lng) : ""));
  }, [ownFarm]);

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    try {
      setSaving(true);
      setNotice(null);
      await action();
      setNotice({ tone: "success", message: successMessage });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: "That change could not be saved. Check the information and try again." });
    } finally {
      setSaving(false);
    }
  };

  const savePromoPage = async () => {
    if (!user || !ownFarm) return;
    if (promoHeadline.trim().length > 160 || promoDescription.trim().length > 1000) {
      setNotice({ tone: "error", message: "Keep the headline under 160 characters and description under 1,000." });
      return;
    }
    await runAction(
      () => setDoc(doc(db, "farms", user.uid), { promoPageEnabled: promoEnabled, promoHeadline: promoHeadline.trim(), promoDescription: promoDescription.trim(), updatedAt: serverTimestamp() }, { merge: true }),
      promoEnabled ? "Your producer promotion page is live." : "Your promotion page is hidden; its content remains saved."
    );
  };

  const createDeal = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !dealTitle.trim() || !dealDescription.trim()) return;
    const startsAt = new Date(dealStartsAt);
    const endsAt = new Date(dealEndsAt);
    if (!Number.isFinite(startsAt.getTime()) || endsAt <= startsAt) {
      setNotice({ tone: "error", message: "Choose a deal end time after its start time." });
      return;
    }
    await runAction(async () => {
      await addDoc(collection(db, "promotions"), { producerId: user.uid, title: dealTitle.trim(), description: dealDescription.trim(), kind: dealKind, startsAt: Timestamp.fromDate(startsAt), endsAt: Timestamp.fromDate(endsAt), active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setDealTitle("");
      setDealDescription("");
    }, "Your custom promotion is scheduled.");
  };

  const createEvent = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !ownFarm) return;
    const startsAt = new Date(eventStartAt);
    const endsAt = new Date(eventEndAt);
    const latitude = eventLat.trim() === "" ? null : Number(eventLat);
    const longitude = eventLng.trim() === "" ? null : Number(eventLng);
    const categories = [...new Set(eventCategories.split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 12);
    if (!eventTitle.trim() || !eventVenue.trim() || !eventCity.trim() || !isMaineZip(eventZip)) {
      setNotice({ tone: "error", message: "Add an event title, venue, Maine city, and valid ZIP code." });
      return;
    }
    if (!Number.isFinite(startsAt.getTime()) || endsAt <= startsAt) {
      setNotice({ tone: "error", message: "Choose an event end time after its start time." });
      return;
    }
    if (
      (latitude == null) !== (longitude == null)
      || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
      || (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
    ) {
      setNotice({ tone: "error", message: "Enter both valid map coordinates, or leave both blank." });
      return;
    }
    await runAction(async () => {
      const created = await addDoc(collection(db, "events"), {
        hostProducerId: user.uid,
        title: eventTitle.trim(),
        description: eventDescription.trim(),
        venueName: eventVenue.trim(),
        address: eventAddress.trim(),
        city: eventCity.trim(),
        state: "ME",
        zip: eventZip.trim(),
        lat: latitude,
        lng: longitude,
        categories,
        startAt: Timestamp.fromDate(startsAt),
        endAt: Timestamp.fromDate(endsAt),
        status: "published",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, "events", created.id, "attendees", user.uid), { producerId: user.uid, farmName: ownFarm.farmName, joinedAt: serverTimestamp() });
      setEventTitle("");
      setEventDescription("");
      setEventVenue("");
      setEventAddress("");
      setEventCategories("");
    }, "The event is published and your farm is listed as attending.");
  };

  const recommendProducer = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !recommendedProducerId) return;
    const id = `${user.uid}__${recommendedProducerId}`;
    await runAction(async () => {
      await setDoc(doc(db, "producerRecommendations", id), { producerId: user.uid, recommendedProducerId, note: recommendationNote.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      setRecommendedProducerId("");
      setRecommendationNote("");
    }, "Your recommendation is now public.");
  };

  const requestPartnership = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !partnerProducerId || (!partnerPickup && !partnerDelivery)) return;
    const id = producerPartnershipId(user.uid, partnerProducerId);
    const memberIds = [user.uid, partnerProducerId].sort();
    await runAction(async () => {
      await setDoc(doc(db, "producerPartnerships", id), { memberIds, requestedBy: user.uid, status: "pending", pickupEnabled: partnerPickup, deliveryEnabled: partnerDelivery, publicNote: partnerNote.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setPartnerProducerId("");
      setPartnerNote("");
    }, "Partnership request sent. It becomes public only after the other producer accepts.");
  };

  if (!user) return <main className="p-8">Please sign in.</main>;

  return (
    <main className="min-h-screen bg-[#f6f0dd] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl bg-[#173f32] p-7 text-white shadow-lg sm:p-10"><p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Producer growth tools</p><h1 className="mt-2 text-4xl font-serif">Promote, gather, and partner</h1><p className="mt-3 max-w-3xl text-emerald-50">Publish deals and events, support trusted Maine producers, and create mutual fulfillment partnerships.</p></div>
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-white p-2 shadow">{([['promo','Promotions'],['events','Events'],['network','Network']] as [GrowthTab,string][]).map(([value, label]) => <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value} className={`rounded-xl px-3 py-3 font-bold ${tab === value ? 'bg-emerald-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>{label}</button>)}</div>
        {notice && <div role={notice.tone === "error" ? "alert" : "status"} className={`mt-5 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>{notice.message}</div>}

        {tab === "promo" && <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Your promotion page</h2><p className="mt-2 text-sm text-stone-600">Opt in to the shared Promotions page. Your information remains saved if you temporarily hide it.</p><label className="mt-5 flex items-center gap-3 rounded-xl bg-orange-50 p-4 font-bold"><input type="checkbox" checked={promoEnabled} onChange={(event) => setPromoEnabled(event.target.checked)} />Feature my producer page</label><label className="mt-4 block text-sm font-bold">Promotion headline<input value={promoHeadline} maxLength={160} onChange={(event) => setPromoHeadline(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Seasonal harvest specials" /></label><label className="mt-4 block text-sm font-bold">Introduction<textarea value={promoDescription} maxLength={1000} onChange={(event) => setPromoDescription(event.target.value)} className="mt-1 min-h-32 w-full rounded-xl border p-3 font-normal" placeholder="Tell buyers what is new this season." /></label><button disabled={saving || !ownFarm} onClick={savePromoPage} className="mt-4 rounded-xl bg-emerald-900 px-5 py-3 font-bold text-white disabled:opacity-50">Save promotion page</button>{promoEnabled && <Link to="/promotions" className="ml-3 inline-block font-bold text-emerald-800 underline">Preview page</Link>}</section>
          <section className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Create a custom deal</h2><form onSubmit={createDeal}><label className="mt-4 block text-sm font-bold">Title<input required maxLength={160} value={dealTitle} onChange={(event) => setDealTitle(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Weekend bundle deal" /></label><label className="mt-4 block text-sm font-bold">Details<textarea required maxLength={2000} value={dealDescription} onChange={(event) => setDealDescription(event.target.value)} className="mt-1 min-h-28 w-full rounded-xl border p-3 font-normal" /></label><label className="mt-4 block text-sm font-bold">Type<select value={dealKind} onChange={(event) => setDealKind(event.target.value as "deal" | "announcement")} className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="deal">Deal</option><option value="announcement">Announcement</option></select></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Starts<input type="datetime-local" required value={dealStartsAt} onChange={(event) => setDealStartsAt(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Ends<input type="datetime-local" required value={dealEndsAt} onChange={(event) => setDealEndsAt(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label></div><button disabled={saving} className="mt-4 rounded-xl bg-orange-600 px-5 py-3 font-bold text-white disabled:opacity-50">Publish deal</button></form></section>
          <section className="rounded-2xl bg-white p-6 shadow lg:col-span-2"><h2 className="text-2xl font-bold">Scheduled promotions</h2>{promotions.length === 0 ? <p className="mt-3 text-stone-600">No custom promotions yet.</p> : <div className="mt-4 grid gap-3 md:grid-cols-2">{promotions.map((promotion) => <article key={promotion.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{promotion.title}</h3><p className="mt-1 text-sm text-stone-600">{promotion.description}</p><p className="mt-2 text-xs text-stone-500">{fromTimestamp(promotion.startsAt).toLocaleString()} – {fromTimestamp(promotion.endsAt).toLocaleString()}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${promotion.active ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-600'}`}>{promotion.active ? 'Active' : 'Hidden'}</span></div><button onClick={() => runAction(() => updateDoc(doc(db, 'promotions', promotion.id), { active: !promotion.active, updatedAt: serverTimestamp() }), promotion.active ? 'Promotion hidden and preserved.' : 'Promotion restored.')} className="mt-3 text-sm font-bold text-emerald-800 underline">{promotion.active ? 'Hide promotion' : 'Restore promotion'}</button></article>)}</div>}</section>
        </div>}

        {tab === "events" && <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Publish an event</h2><form onSubmit={createEvent}><label className="mt-4 block text-sm font-bold">Event name<input required maxLength={160} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="mt-4 block text-sm font-bold">Description<textarea maxLength={3000} value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} className="mt-1 min-h-28 w-full rounded-xl border p-3 font-normal" /></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Venue<input required maxLength={160} value={eventVenue} onChange={(event) => setEventVenue(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Public address<input maxLength={240} value={eventAddress} onChange={(event) => setEventAddress(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">City<input required value={eventCity} onChange={(event) => setEventCity(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Maine ZIP<input required value={eventZip} onChange={(event) => setEventZip(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Starts<input type="datetime-local" required value={eventStartAt} onChange={(event) => setEventStartAt(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label><label className="text-sm font-bold">Ends<input type="datetime-local" required value={eventEndAt} onChange={(event) => setEventEndAt(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" /></label></div><label className="mt-4 block text-sm font-bold">Goods/categories (comma separated)<input value={eventCategories} onChange={(event) => setEventCategories(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Produce, Baked Goods, Honey" /></label><details className="mt-4 rounded-xl bg-stone-50 p-4"><summary className="cursor-pointer font-bold">Map coordinates</summary><div className="mt-3 grid grid-cols-2 gap-3"><input aria-label="Event latitude" value={eventLat} onChange={(event) => setEventLat(event.target.value)} className="rounded-xl border p-3" placeholder="Latitude" /><input aria-label="Event longitude" value={eventLng} onChange={(event) => setEventLng(event.target.value)} className="rounded-xl border p-3" placeholder="Longitude" /></div></details><button disabled={saving || !ownFarm} className="mt-4 rounded-xl bg-emerald-900 px-5 py-3 font-bold text-white disabled:opacity-50">Publish event</button></form></section>
          <section className="rounded-2xl bg-white p-6 shadow"><div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-bold">Your events</h2><Link to="/events" className="text-sm font-bold text-emerald-800 underline">Full calendar</Link></div>{events.length === 0 ? <p className="mt-4 text-stone-600">No events published yet.</p> : <div className="mt-4 space-y-3">{events.map((item) => <article key={item.id} className="rounded-xl border p-4"><span className={`rounded-full px-2 py-1 text-xs font-bold ${item.status === 'published' ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>{item.status}</span><h3 className="mt-2 font-bold">{item.title}</h3><p className="mt-1 text-sm text-stone-600">{fromTimestamp(item.startAt).toLocaleString()} · {item.venueName}</p>{item.status === 'published' && <button onClick={() => runAction(() => updateDoc(doc(db, 'events', item.id), { status: 'cancelled', updatedAt: serverTimestamp() }), 'Event cancelled and preserved in your history.')} className="mt-3 text-sm font-bold text-red-700 underline">Cancel event</button>}</article>)}</div>}</section>
        </div>}

        {tab === "network" && <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Recommend a producer</h2><p className="mt-2 text-sm text-stone-600">Recommendations appear publicly on your producer profile.</p><form onSubmit={recommendProducer}><label className="mt-4 block text-sm font-bold">Producer<select required value={recommendedProducerId} onChange={(event) => setRecommendedProducerId(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="">Choose a producer</option>{otherFarms.filter((farm) => !recommendations.some((item) => item.recommendedProducerId === farm.id)).map((farm) => <option key={farm.id} value={farm.id}>{farm.farmName}</option>)}</select></label><label className="mt-4 block text-sm font-bold">Why you recommend them<textarea maxLength={500} value={recommendationNote} onChange={(event) => setRecommendationNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border p-3 font-normal" /></label><button disabled={saving} className="mt-4 rounded-xl bg-emerald-900 px-5 py-3 font-bold text-white disabled:opacity-50">Publish recommendation</button></form><div className="mt-5 space-y-2">{recommendations.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 p-3"><div><div className="font-bold">{farms[item.recommendedProducerId]?.farmName || 'Producer'}</div><div className="text-sm text-stone-600">{item.note}</div></div><button onClick={() => runAction(() => deleteDoc(doc(db, 'producerRecommendations', item.id)), 'Recommendation removed.')} className="text-sm font-bold text-red-700 underline">Remove</button></div>)}</div></section>
          <section className="rounded-2xl bg-white p-6 shadow"><h2 className="text-2xl font-bold">Request a partnership</h2><p className="mt-2 text-sm text-stone-600">The other producer must accept. Accepted pickup partners can be selected by buyers during checkout.</p><form onSubmit={requestPartnership}><label className="mt-4 block text-sm font-bold">Producer<select required value={partnerProducerId} onChange={(event) => setPartnerProducerId(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal"><option value="">Choose a producer</option>{otherFarms.filter((farm) => !partnerships.some((item) => item.memberIds?.includes(farm.id) && !['declined','cancelled'].includes(item.status))).map((farm) => <option key={farm.id} value={farm.id}>{farm.farmName}</option>)}</select></label><div className="mt-4 flex flex-wrap gap-4"><label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={partnerPickup} onChange={(event) => setPartnerPickup(event.target.checked)} />Shared pickup</label><label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={partnerDelivery} onChange={(event) => setPartnerDelivery(event.target.checked)} />Delivery support</label></div><label className="mt-4 block text-sm font-bold">Public partnership note<textarea maxLength={500} value={partnerNote} onChange={(event) => setPartnerNote(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border p-3 font-normal" /></label><button disabled={saving || (!partnerPickup && !partnerDelivery)} className="mt-4 rounded-xl bg-orange-600 px-5 py-3 font-bold text-white disabled:opacity-50">Send request</button></form></section>
          <section className="rounded-2xl bg-white p-6 shadow lg:col-span-2"><h2 className="text-2xl font-bold">Partnerships and requests</h2>{partnerships.length === 0 ? <p className="mt-3 text-stone-600">No partnership requests yet.</p> : <div className="mt-4 grid gap-4 md:grid-cols-2">{partnerships.map((item) => { const partnerId = item.memberIds.find((id: string) => id !== user.uid); const incoming = item.status === 'pending' && item.requestedBy !== user.uid; return <article key={item.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{farms[partnerId]?.farmName || 'Producer partner'}</h3><p className="mt-1 text-sm text-stone-600">{item.publicNote}</p></div><span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-bold">{item.status}</span></div><div className="mt-3 flex gap-2 text-xs font-bold">{item.pickupEnabled && <span className="rounded-full bg-emerald-100 px-2 py-1">Pickup</span>}{item.deliveryEnabled && <span className="rounded-full bg-orange-100 px-2 py-1">Delivery</span>}</div>{incoming && <div className="mt-4 flex gap-2"><button onClick={() => runAction(() => updateDoc(doc(db, 'producerPartnerships', item.id), { status: 'accepted', updatedAt: serverTimestamp() }), 'Partnership accepted and now public.')} className="rounded-lg bg-emerald-900 px-3 py-2 font-bold text-white">Accept</button><button onClick={() => runAction(() => updateDoc(doc(db, 'producerPartnerships', item.id), { status: 'declined', updatedAt: serverTimestamp() }), 'Partnership declined.')} className="rounded-lg bg-stone-100 px-3 py-2 font-bold">Decline</button></div>}{item.status === 'accepted' && <button onClick={() => runAction(() => updateDoc(doc(db, 'producerPartnerships', item.id), { status: 'cancelled', updatedAt: serverTimestamp() }), 'Partnership ended and preserved in history.')} className="mt-4 text-sm font-bold text-red-700 underline">End partnership</button>}{item.status === 'pending' && item.requestedBy === user.uid && <button onClick={() => runAction(() => updateDoc(doc(db, 'producerPartnerships', item.id), { status: 'cancelled', updatedAt: serverTimestamp() }), 'Partnership request cancelled.')} className="mt-4 text-sm font-bold text-red-700 underline">Cancel request</button>}</article>;})}</div>}</section>
        </div>}
      </div>
    </main>
  );
}
