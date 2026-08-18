import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useAuth } from "../App";
import { db } from "../firebase";
import { Link, useSearchParams } from "../router";
import { UserRole } from "../types";
import { milesBetween, monthCalendarCells } from "../utils/marketplaceFeatures";
import { getCurrentCoordinates } from "../utils/location";

type AnyDoc = Record<string, any>;
type EventWithAttendees = AnyDoc & {
  id: string;
  attendeeIds: string[];
  attendeeNames: string[];
};

const BUYER_LOCATION_KEY = "mfm_buyer_location";

const toDate = (value: any) => {
  if (value?.toDate) return value.toDate() as Date;
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  return new Date(value);
};

const eventDayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export default function EventsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [events, setEvents] = useState<EventWithAttendees[]>([]);
  const [farms, setFarms] = useState<Record<string, AnyDoc>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState("all");
  const [producer, setProducer] = useState(searchParams.get("producer") || "all");
  const [sort, setSort] = useState<"date" | "distance">("date");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(() => {
    try {
      const value = localStorage.getItem(BUYER_LOCATION_KEY);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  });
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1)
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [attendanceBusy, setAttendanceBusy] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeFarms = onSnapshot(collection(db, "farms"), (snapshot) => {
      setFarms(
        Object.fromEntries(snapshot.docs.map((farm) => [farm.id, { id: farm.id, ...farm.data() }]))
      );
    });
    const eventsQuery = query(collection(db, "events"), where("status", "==", "published"));
    const unsubscribeEvents = onSnapshot(
      eventsQuery,
      async (snapshot) => {
        try {
          const rows = await Promise.all(
            snapshot.docs.map(async (eventDoc) => {
              const attendees = await getDocs(collection(db, "events", eventDoc.id, "attendees"));
              return {
                id: eventDoc.id,
                ...eventDoc.data(),
                attendeeIds: attendees.docs.map((attendee) => attendee.id),
                attendeeNames: attendees.docs.map(
                  (attendee) => String(attendee.data().farmName || "Maine producer")
                ),
              } as EventWithAttendees;
            })
          );
          rows.sort((first, second) => toDate(first.startAt).getTime() - toDate(second.startAt).getTime());
          setEvents(rows);
          setLoading(false);
        } catch (error) {
          console.error(error);
          setNotice("Events could not be refreshed. Please try again.");
          setLoading(false);
        }
      },
      (error) => {
        console.error(error);
        setNotice("Events could not be refreshed. Please try again.");
        setLoading(false);
      }
    );
    const unsubscribeAttendees = onSnapshot(
      collectionGroup(db, "attendees"),
      (snapshot) => {
        const byEvent = new Map<string, { ids: string[]; names: string[] }>();
        snapshot.docs.forEach((attendee) => {
          const eventId = attendee.ref.parent.parent?.id;
          if (!eventId) return;
          const group = byEvent.get(eventId) || { ids: [], names: [] };
          group.ids.push(attendee.id);
          group.names.push(String(attendee.data().farmName || "Maine producer"));
          byEvent.set(eventId, group);
        });
        setEvents((current) =>
          current.map((event) => {
            const attendees = byEvent.get(event.id) || { ids: [], names: [] };
            return {
              ...event,
              attendeeIds: attendees.ids,
              attendeeNames: attendees.names,
            };
          })
        );
      },
      (error) => console.error("Event attendance could not be refreshed", error)
    );
    return () => {
      unsubscribeFarms();
      unsubscribeEvents();
      unsubscribeAttendees();
    };
  }, []);

  useEffect(() => {
    const requestedProducer = searchParams.get("producer") || "all";
    setProducer(requestedProducer);
  }, [searchParams]);

  const categories = useMemo(
    () =>
      [...new Set(events.flatMap((event) => (Array.isArray(event.categories) ? event.categories : [])))].sort(),
    [events]
  );

  const attendingProducers = useMemo(() => {
    const ids = new Set(events.flatMap((event) => event.attendeeIds));
    return [...ids]
      .map((id) => ({ id, name: farms[id]?.farmName || "Maine producer" }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [events, farms]);

  const filteredEvents = useMemo(() => {
    const currentTime = Date.now();
    const list = events
      .filter((event) => toDate(event.endAt).getTime() >= currentTime)
      .filter((event) => category === "all" || event.categories?.includes(category))
      .filter((event) => producer === "all" || event.attendeeIds.includes(producer))
      .filter((event) => !selectedDay || eventDayKey(toDate(event.startAt)) === selectedDay)
      .map((event) => ({
        ...event,
        miles:
          location && typeof event.lat === "number" && typeof event.lng === "number"
            ? milesBetween(location, { lat: event.lat, lng: event.lng })
            : null,
      }));
    list.sort((first, second) => {
      if (sort === "distance") {
        return (first.miles ?? Number.POSITIVE_INFINITY) - (second.miles ?? Number.POSITIVE_INFINITY);
      }
      return toDate(first.startAt).getTime() - toDate(second.startAt).getTime();
    });
    return list;
  }, [category, events, location, producer, selectedDay, sort]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, number>();
    events.forEach((event) => {
      const start = toDate(event.startAt);
      if (
        start.getFullYear() === calendarMonth.getFullYear() &&
        start.getMonth() === calendarMonth.getMonth()
      ) {
        const key = eventDayKey(start);
        map.set(key, (map.get(key) || 0) + 1);
      }
    });
    return map;
  }, [calendarMonth, events]);

  const setProducerFilter = (value: string) => {
    setProducer(value);
    const next: Record<string, string> = {};
    if (value !== "all") next.producer = value;
    setSearchParams(next);
  };

  const useLocation = async () => {
    try {
      setNotice("Requesting your location…");
      const next = await getCurrentCoordinates();
      setLocation(next);
      localStorage.setItem(BUYER_LOCATION_KEY, JSON.stringify(next));
      setSort("distance");
      setNotice("Events are now sorted from nearest to farthest.");
    } catch (error) {
      console.error(error);
      setNotice("Allow location access in Android Settings to sort events by distance.");
    }
  };

  const toggleAttendance = async (event: EventWithAttendees) => {
    if (!user || user.role !== UserRole.PRODUCER) return;
    try {
      setAttendanceBusy(event.id);
      const attendeeRef = doc(db, "events", event.id, "attendees", user.uid);
      if (event.attendeeIds.includes(user.uid)) {
        await deleteDoc(attendeeRef);
        setEvents((current) =>
          current.map((entry) =>
            entry.id === event.id
              ? {
                  ...entry,
                  attendeeIds: entry.attendeeIds.filter((id) => id !== user.uid),
                  attendeeNames: entry.attendeeNames.filter(
                    (_, index) => entry.attendeeIds[index] !== user.uid
                  ),
                }
              : entry
          )
        );
        setNotice("You are no longer listed as attending this event.");
      } else {
        const farmName = farms[user.uid]?.farmName || user.displayName || "Maine producer";
        await setDoc(attendeeRef, {
          producerId: user.uid,
          farmName,
          joinedAt: serverTimestamp(),
        });
        setEvents((current) =>
          current.map((entry) =>
            entry.id === event.id
              ? {
                  ...entry,
                  attendeeIds: [...entry.attendeeIds, user.uid],
                  attendeeNames: [...entry.attendeeNames, farmName],
                }
              : entry
          )
        );
        setNotice("Your producer profile is now listed as attending.");
      }
    } catch (error) {
      console.error(error);
      setNotice("Attendance could not be updated.");
    } finally {
      setAttendanceBusy(null);
    }
  };

  const calendarCells = monthCalendarCells(calendarMonth.getFullYear(), calendarMonth.getMonth());

  return (
    <main className="min-h-screen bg-[#f6f0dd] px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-3xl bg-[#173f32] p-6 text-white shadow-lg sm:p-9">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">Community calendar</p>
          <h1 className="mt-2 text-4xl font-serif sm:text-5xl">Maine market events</h1>
          <p className="mt-3 max-w-3xl text-emerald-50">
            Find markets, farm days, seasonal gatherings, and the producers attending them.
          </p>
        </div>

        {notice && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950">{notice}</div>}

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <aside className="space-y-5">
            <div className="rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between gap-3">
                <button aria-label="Previous month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} className="rounded-lg bg-stone-100 px-3 py-2 font-bold">‹</button>
                <h2 className="font-bold">{calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
                <button aria-label="Next month" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} className="rounded-lg bg-stone-100 px-3 py-2 font-bold">›</button>
              </div>
              <div className="mt-4 grid grid-cols-7 text-center text-xs font-bold text-stone-500">
                {['S','M','T','W','T','F','S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
                {calendarCells.map((day, index) => {
                  const key = day == null ? `blank-${index}` : `${calendarMonth.getFullYear()}-${calendarMonth.getMonth()}-${day}`;
                  const count = day == null ? 0 : eventsByDay.get(key) || 0;
                  return day == null ? <span key={key} /> : (
                    <button key={key} onClick={() => setSelectedDay(selectedDay === key ? null : key)} aria-pressed={selectedDay === key} className={`relative min-h-10 rounded-lg text-sm font-semibold ${selectedDay === key ? 'bg-emerald-800 text-white' : count ? 'bg-emerald-100 text-emerald-950' : 'hover:bg-stone-100'}`}>
                      {day}{count > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-500" />}
                    </button>
                  );
                })}
              </div>
              {selectedDay && <button onClick={() => setSelectedDay(null)} className="mt-3 text-sm font-bold text-emerald-800 underline">Show every upcoming date</button>}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow">
              <h2 className="text-lg font-bold">Filter events</h2>
              <label className="mt-4 block text-sm font-bold">Goods or category
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal">
                  <option value="all">All goods</option>
                  {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="mt-4 block text-sm font-bold">Producer
                <select value={producer} onChange={(event) => setProducerFilter(event.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal">
                  <option value="all">All producers</option>
                  {attendingProducers.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
                </select>
              </label>
              <label className="mt-4 block text-sm font-bold">Sort
                <select value={sort} onChange={(event) => setSort(event.target.value as "date" | "distance")} className="mt-1 w-full rounded-xl border p-3 font-normal">
                  <option value="date">Soonest first</option>
                  <option value="distance">Nearest to farthest</option>
                </select>
              </label>
              <button onClick={useLocation} className="mt-4 w-full rounded-xl bg-stone-100 px-4 py-3 font-bold">Use my location</button>
            </div>
          </aside>

          <section aria-live="polite">
            {loading ? <div className="rounded-2xl bg-white p-8 text-center text-stone-600">Loading upcoming events…</div> : filteredEvents.length === 0 ? (
              <div className="rounded-2xl bg-white p-8 text-center"><h2 className="text-xl font-bold">No matching events</h2><p className="mt-2 text-stone-600">Try another date or filter.</p></div>
            ) : (
              <div className="space-y-5">
                {filteredEvents.map((event) => {
                  const start = toDate(event.startAt);
                  const end = toDate(event.endAt);
                  const attending = Boolean(user && event.attendeeIds.includes(user.uid));
                  return (
                    <article key={event.id} className="overflow-hidden rounded-2xl bg-white shadow">
                      <div className="grid sm:grid-cols-[8rem_1fr]">
                        <div className="bg-[#d47a2a] p-5 text-center text-white">
                          <div className="text-sm font-bold uppercase">{start.toLocaleDateString(undefined, { month: "short" })}</div>
                          <div className="text-4xl font-black">{start.getDate()}</div>
                          <div className="text-sm">{start.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        </div>
                        <div className="p-5 sm:p-6">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div><h2 className="text-2xl font-bold text-stone-900">{event.title}</h2><p className="mt-1 font-semibold text-emerald-900">{event.venueName}</p></div>
                            {event.miles != null && <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-900">{event.miles.toFixed(1)} miles</span>}
                          </div>
                          <p className="mt-3 text-stone-600">{event.description}</p>
                          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                            <div><dt className="font-bold">Date and time</dt><dd>{start.toLocaleString()} – {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</dd></div>
                            <div><dt className="font-bold">Location</dt><dd>{[event.address, event.city, event.state, event.zip].filter(Boolean).join(", ")}</dd></div>
                          </dl>
                          <div className="mt-4 flex flex-wrap gap-2">{(event.categories || []).map((value: string) => <span key={value} className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold">{value}</span>)}</div>
                          <div className="mt-4"><div className="text-sm font-bold">Producers attending</div><div className="mt-2 flex flex-wrap gap-2">{event.attendeeIds.map((id: string, index: number) => <Link key={id} to={`/producer-profile?producerId=${encodeURIComponent(id)}`} className="rounded-full border border-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-900">{event.attendeeNames[index] || farms[id]?.farmName || "Producer"}</Link>)}</div></div>
                          {user?.role === UserRole.PRODUCER && <button disabled={attendanceBusy === event.id} onClick={() => toggleAttendance(event)} className={`mt-5 rounded-xl px-4 py-2 font-bold ${attending ? 'bg-stone-100 text-stone-800' : 'bg-emerald-900 text-white'} disabled:opacity-50`}>{attendanceBusy === event.id ? 'Updating…' : attending ? 'Stop attending' : 'Attend this event'}</button>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
