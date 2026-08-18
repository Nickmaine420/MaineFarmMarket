import React, { useEffect, useState } from "react";
import { useAuth } from "../App";
import { db, storage } from "../firebase";
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { hasUsPhoneNumber, isMaineZip } from "../utils/validation";
import { MAX_PRODUCER_PROFILE_PHOTOS } from "@mfm/shared";

type ProfilePhoto = { url: string; alt: string; uploadedAt?: string };

type FarmDoc = {
  producerUid: string;
  farmName: string;
  phone: string;
  city: string;
  state: string;
  zip: string;
  hours: string;
  pickupAvailable: boolean;
  deliveryAvailable: boolean;
  deliveryNotes: string;
  description?: string;
  photos?: ProfilePhoto[];
  archivedPhotos?: ProfilePhoto[];
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
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ProfilePhoto[]>([]);
  const [archivedPhotos, setArchivedPhotos] = useState<ProfilePhoto[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoAlt, setPhotoAlt] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [notice, setNotice] = useState<
    { tone: "success" | "error" | "info"; message: string } | null
  >(null);

  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        setLoading(true);
        const [snap, userSnap] = await Promise.all([
          getDoc(doc(db, "farms", user.uid)),
          getDoc(doc(db, "users", user.uid)),
        ]);
        const privateProfile = userSnap.exists()
          ? (userSnap.data() as any)?.producerPrivate || {}
          : {};
        if (snap.exists()) {
          const d = snap.data() as FarmDoc;
          setFarmName(d.farmName || user.displayName || "Maine Farm");
          setPhone(d.phone || "");
          setAddressLine1(
            privateProfile.addressLine1 ||
              (d as FarmDoc & { addressLine1?: string }).addressLine1 ||
              ""
          );
          setCity(d.city || "");
          setState("ME");
          setZip(d.zip || "");
          setHours(d.hours || "");
          setPickupAvailable(d.pickupAvailable ?? true);
          setDeliveryAvailable(d.deliveryAvailable ?? false);
          setDeliveryNotes(d.deliveryNotes || "");
          setDescription(d.description || "");
          setPhotos(Array.isArray(d.photos) ? d.photos.slice(0, MAX_PRODUCER_PROFILE_PHOTOS) : []);
          setArchivedPhotos(Array.isArray(d.archivedPhotos) ? d.archivedPhotos : []);
          setLat(
            typeof privateProfile.exactLocation?.lat === "number"
              ? privateProfile.exactLocation.lat
              : typeof d.lat === "number"
                ? d.lat
                : null
          );
          setLng(
            typeof privateProfile.exactLocation?.lng === "number"
              ? privateProfile.exactLocation.lng
              : typeof d.lng === "number"
                ? d.lng
                : null
          );
        } else {
          setFarmName(user.displayName || "Maine Farm");
          setAddressLine1(privateProfile.addressLine1 || "");
        }
      } catch (error) {
        console.error(error);
        setNotice({ tone: "error", message: "Could not load the farm profile." });
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setNotice({ tone: "error", message: "Location is not supported on this device." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setNotice({
          tone: "info",
          message: "Location added. Buyers will only see an approximate location.",
        });
      },
      (err) => {
        console.error(err);
        setNotice({
          tone: "error",
          message: "Could not get your location. Check the app or browser permission.",
        });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const save = async () => {
    if (!user) return;
    setNotice(null);
    if (!farmName.trim()) {
      setNotice({ tone: "error", message: "Please enter your farm name." });
      return;
    }
    if (!city.trim()) {
      setNotice({ tone: "error", message: "Please enter your city." });
      return;
    }
    if (!isMaineZip(zip)) {
      setNotice({ tone: "error", message: "Enter a valid Maine ZIP code." });
      return;
    }
    if (!hasUsPhoneNumber(phone)) {
      setNotice({ tone: "error", message: "Enter a phone number buyers can use for fulfillment." });
      return;
    }
    if (!pickupAvailable && !deliveryAvailable) {
      setNotice({ tone: "error", message: "Choose pickup, delivery, or both." });
      return;
    }

    try {
      setSaving(true);
      const ref = doc(db, "farms", user.uid);
      const publicLat = lat == null ? null : Number(lat.toFixed(3));
      const publicLng = lng == null ? null : Number(lng.toFixed(3));
      const payload = {
        producerUid: user.uid,
        farmName: farmName.trim(),
        phone: phone.trim(),
        addressLine1: deleteField(),
        city: city.trim(),
        state: "ME",
        zip: zip.trim(),
        hours: hours.trim(),
        pickupAvailable,
        deliveryAvailable,
        deliveryNotes: deliveryNotes.trim(),
        description: description.trim(),
        photos,
        archivedPhotos,
        lat: publicLat,
        lng: publicLng,
        updatedAt: serverTimestamp(),
      };
      await setDoc(
        doc(db, "users", user.uid),
        {
          producerPrivate: {
            addressLine1: addressLine1.trim(),
            exactLocation: lat == null || lng == null ? null : { lat, lng },
            updatedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );
      await setDoc(ref, payload, { merge: true });
      setNotice({ tone: "success", message: "Farm profile saved." });
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", message: "Could not save the farm profile. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const uploadProfilePhoto = async () => {
    if (!user || !photoFile) return;
    if (photos.length >= MAX_PRODUCER_PROFILE_PHOTOS) {
      setNotice({ tone: "error", message: `A public profile can show up to ${MAX_PRODUCER_PROFILE_PHOTOS} photos.` });
      return;
    }
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    if (!allowedTypes.has(photoFile.type) || photoFile.size > 8 * 1024 * 1024) {
      setNotice({ tone: "error", message: "Use a JPEG, PNG, WebP, HEIC, or HEIF image that is 8 MB or smaller." });
      return;
    }
    try {
      setUploadingPhoto(true);
      const safeName = photoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const photoRef = ref(storage, `producerProfiles/${user.uid}/${Date.now()}_${safeName}`);
      await uploadBytes(photoRef, photoFile);
      const url = await getDownloadURL(photoRef);
      const nextPhotos = [...photos, { url, alt: photoAlt.trim() || `${farmName} profile photo`, uploadedAt: new Date().toISOString() }];
      await setDoc(doc(db, "farms", user.uid), { photos: nextPhotos, archivedPhotos, updatedAt: serverTimestamp() }, { merge: true });
      setPhotos(nextPhotos);
      setPhotoFile(null);
      setPhotoAlt("");
      setNotice({ tone: "success", message: "Profile photo uploaded." });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: "The profile photo could not be uploaded." });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const hideProfilePhoto = async (photo: ProfilePhoto) => {
    if (!user) return;
    const nextPhotos = photos.filter((candidate) => candidate.url !== photo.url);
    const nextArchived = [...archivedPhotos.filter((candidate) => candidate.url !== photo.url), photo].slice(-24);
    try {
      await setDoc(doc(db, "farms", user.uid), { photos: nextPhotos, archivedPhotos: nextArchived, updatedAt: serverTimestamp() }, { merge: true });
      setPhotos(nextPhotos);
      setArchivedPhotos(nextArchived);
      setNotice({ tone: "info", message: "Photo hidden from the public profile and preserved in the archive." });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: "The photo could not be hidden." });
    }
  };

  const restoreProfilePhoto = async (photo: ProfilePhoto) => {
    if (!user || photos.length >= MAX_PRODUCER_PROFILE_PHOTOS) return;
    const nextPhotos = [...photos, photo];
    const nextArchived = archivedPhotos.filter((candidate) => candidate.url !== photo.url);
    try {
      await setDoc(doc(db, "farms", user.uid), { photos: nextPhotos, archivedPhotos: nextArchived, updatedAt: serverTimestamp() }, { merge: true });
      setPhotos(nextPhotos);
      setArchivedPhotos(nextArchived);
      setNotice({ tone: "success", message: "Photo restored to the public profile." });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: "The photo could not be restored." });
    }
  };

  if (!user) return <div className="p-6">Please sign in.</div>;

  return (
    <div className="bg-white rounded-2xl shadow p-8">
      <h3 className="text-2xl font-bold mb-4">Farm Profile</h3>
      <p className="mb-4 text-sm text-stone-600">
        City, phone, fulfillment options, and an approximate map location are shown
        to buyers. Your street address is kept in your private account profile.
      </p>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
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

      {loading ? (
        <div className="text-stone-500">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold mb-1">Farm name</label>
              <input autoComplete="organization" className="border p-2 w-full rounded" value={farmName} onChange={e=>setFarmName(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Phone (for pickup/contact)</label>
              <input type="tel" autoComplete="tel" className="border p-2 w-full rounded" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="207-555-1234" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Private street address (optional)</label>
              <input autoComplete="street-address" className="border p-2 w-full rounded" value={addressLine1} onChange={e=>setAddressLine1(e.target.value)} placeholder="123 Farm Rd" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">City</label>
              <input autoComplete="address-level2" className="border p-2 w-full rounded" value={city} onChange={e=>setCity(e.target.value)} placeholder="Waterville" />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">State</label>
              <input readOnly aria-readonly="true" className="border bg-stone-100 p-2 w-full rounded" value={state} />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">ZIP</label>
              <input inputMode="numeric" autoComplete="postal-code" maxLength={10} className="border p-2 w-full rounded" value={zip} onChange={e=>setZip(e.target.value)} placeholder="04901" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Hours (pickup / call hours)</label>
              <textarea className="border p-2 w-full rounded" value={hours} onChange={e=>setHours(e.target.value)} placeholder="Mon–Fri 9am–5pm, Sat 10am–2pm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-1">Public producer story</label>
              <textarea maxLength={2000} className="min-h-32 border p-3 w-full rounded" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Tell buyers about your farm, homestead, products, and practices." />
              <div className="mt-1 text-xs text-stone-500">{description.length}/2,000 characters</div>
            </div>
          </div>

          <section className="mt-6 rounded-2xl border p-5">
            <h4 className="text-xl font-bold">Public profile photos</h4>
            <p className="mt-1 text-sm text-stone-600">Add up to {MAX_PRODUCER_PROFILE_PHOTOS} photos. Hidden photos are archived rather than deleted.</p>
            {photos.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{photos.map((photo, index) => <div key={photo.url} className="overflow-hidden rounded-xl border bg-white"><img src={photo.url} alt={photo.alt || `Profile photo ${index + 1}`} className="h-36 w-full object-cover" /><div className="p-2"><div className="truncate text-xs text-stone-600">{photo.alt}</div><button type="button" onClick={() => hideProfilePhoto(photo)} className="mt-2 text-xs font-bold text-amber-800 underline">Hide and archive</button></div></div>)}</div>}
            {photos.length < MAX_PRODUCER_PROFILE_PHOTOS && <div className="mt-4 grid gap-3 rounded-xl bg-stone-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-sm font-bold">Photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm font-normal" /></label><label className="text-sm font-bold">Photo description<input value={photoAlt} maxLength={160} onChange={(event) => setPhotoAlt(event.target.value)} className="mt-1 w-full rounded-lg border p-2 font-normal" placeholder="Farm stand in summer" /></label><button type="button" disabled={!photoFile || uploadingPhoto} onClick={uploadProfilePhoto} className="rounded-xl bg-emerald-900 px-4 py-2 font-bold text-white disabled:opacity-50">{uploadingPhoto ? "Uploading…" : "Add photo"}</button></div>}
            {archivedPhotos.length > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm font-bold">Archived photos ({archivedPhotos.length})</summary><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">{archivedPhotos.map((photo) => <div key={photo.url} className="rounded-xl border p-2"><img src={photo.url} alt={photo.alt} className="h-24 w-full rounded-lg object-cover opacity-70" /><button type="button" disabled={photos.length >= MAX_PRODUCER_PROFILE_PHOTOS} onClick={() => restoreProfilePhoto(photo)} className="mt-2 text-xs font-bold text-emerald-800 underline disabled:opacity-40">Restore</button></div>)}</div></details>}
          </section>

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
