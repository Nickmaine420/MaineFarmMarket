import React, { useEffect, useState } from "react";
import { useAuth } from "../App";
import { db } from "../firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

type FarmDoc = {
  producerUid: string;
  farmName: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  hours: string;
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
  deliveryNotes: string;
  lat: number | null;
  lng: number | null;
  updatedAt?: any;
};

export default function FarmProfilePage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [farmName, setFarmName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("ME");
  const [zip, setZip] = useState("");
  const [hours, setHours] = useState("");
  const [pickupAvailable, setPickupAvailable] = useState(true);
  const [deliveryAvailable, setDeliveryAvailable] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        setLoading(true);
        const ref = doc(db, "farms", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const d = snap.data() as FarmDoc;
          setFarmName(d.farmName || user.displayName || "Maine Farm");
          setPhone(d.phone || "");
          setAddressLine1(d.addressLine1 || "");
          setCity(d.city || "");
          setState(d.state || "ME");
          setZip(d.zip || "");
          setHours(d.hours || "");
          setPickupAvailable(d.pickupAvailable ?? true);
          setDeliveryAvailable(d.deliveryAvailable ?? false);
          setDeliveryNotes(d.deliveryNotes || "");
          setLat(typeof d.lat === "number" ? d.lat : null);
          setLng(typeof d.lng === "number" ? d.lng : null);
        } else {
          setFarmName(user.displayName || "Maine Farm");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported on this device/browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
      },
      (err) => {
        console.error(err);
        alert("Could not get your location. Check browser permissions.");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const save = async () => {
    if (!user) return;
    if (!farmName.trim()) return alert("Please enter your farm name.");
    if (!city.trim()) return alert("Please enter your city.");
    if (!state.trim()) return alert("Please enter your state (ME).");

    try {
      setSaving(true);
      const ref = doc(db, "farms", user.uid);
      const payload: FarmDoc = {
        producerUid: user.uid,
        farmName: farmName.trim(),
        phone: phone.trim(),
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: state.trim().toUpperCase(),
        zip: zip.trim(),
        hours: hours.trim(),
        pickupAvailable,
        deliveryAvailable,
        deliveryNotes: deliveryNotes.trim(),
        lat,
        lng,
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, payload, { merge: true });
      alert("Farm profile saved.");
    } catch (e) {
      console.error(e);
      alert("Could not save farm profile — check console");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <div className="p-6">Please sign in.</div>;

  return (
    <div className="bg-white rounded-2xl shadow p-8">
      <h3 className="text-2xl font-bold mb-4">Farm Profile</h3>

      {loading ? (
        <div className="text-stone-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Farm name</label>
              <input className="border p-2 w-full rounded" value={farmName} onChange={e=>setFarmName(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Phone (for pickup/contact)</label>
              <input className="border p-2 w-full rounded" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="207-555-1234" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Address (optional)</label>
              <input className="border p-2 w-full rounded" value={addressLine1} onChange={e=>setAddressLine1(e.target.value)} placeholder="123 Farm Rd" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">City</label>
              <input className="border p-2 w-full rounded" value={city} onChange={e=>setCity(e.target.value)} placeholder="Waterville" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">State</label>
              <input className="border p-2 w-full rounded" value={state} onChange={e=>setState(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">ZIP</label>
              <input className="border p-2 w-full rounded" value={zip} onChange={e=>setZip(e.target.value)} placeholder="04901" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Hours (pickup / call hours)</label>
              <textarea className="border p-2 w-full rounded" value={hours} onChange={e=>setHours(e.target.value)} placeholder="Mon–Fri 9am–5pm, Sat 10am–2pm" />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-4">
              <div className="font-bold mb-2">Location for distance sorting</div>
              <div className="text-sm text-stone-600 mb-3">
                Add coordinates so buyers can see “miles away” and get nearest farms first.
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Lat</label>
                  <input
                    className="border p-2 w-full rounded"
                    value={lat ?? ""}
                    onChange={e => setLat(e.target.value === "" ? null : Number(e.target.value))}
                    placeholder="44.5520"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Lng</label>
                  <input
                    className="border p-2 w-full rounded"
                    value={lng ?? ""}
                    onChange={e => setLng(e.target.value === "" ? null : Number(e.target.value))}
                    placeholder="-69.6317"
                  />
                </div>
              </div>

              <button onClick={useMyLocation} className="mt-3 px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 font-semibold">
                Use my current location
              </button>
            </div>

            <div className="border rounded-xl p-4">
              <div className="font-bold mb-2">Fulfillment options</div>

              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={pickupAvailable} onChange={e=>setPickupAvailable(e.target.checked)} />
                <span className="font-semibold">Pickup available</span>
              </label>

              <label className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={deliveryAvailable} onChange={e=>setDeliveryAvailable(e.target.checked)} />
                <span className="font-semibold">Delivery available</span>
              </label>

              <label className="block text-sm font-semibold mb-1">Delivery notes (optional)</label>
              <textarea
                className="border p-2 w-full rounded"
                value={deliveryNotes}
                onChange={e=>setDeliveryNotes(e.target.value)}
                placeholder="Delivery days/area, minimum order, etc."
              />
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-3 rounded-xl bg-[#2f4a2e] text-white font-bold disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Farm Profile"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
