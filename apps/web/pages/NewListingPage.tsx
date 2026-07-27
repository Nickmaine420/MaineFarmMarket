import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../App";
import { auth, db, storage } from "../firebase";
import { collection, addDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { toPriceCents, toWholeQuantity } from "../utils/validation";

const PRODUCER_PROFILE_PATH = "users"; // canonical: users/{uid}

function parseTags(raw: string) {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

// ✅ Dropdown options (simple + clear)
const DEPARTMENTS = [
  "Produce",
  "Meat",
  "Dairy",
  "Baked Goods",
  "Pantry",
  "Beverages",
  "Eggs",
  "Honey & Maple",
  "Seafood",
  "Prepared Foods",
  "Flowers & Plants",
  "Other",
];

const CATEGORIES = [
  "Vegetables",
  "Fruit",
  "Herbs",
  "Eggs",
  "Milk",
  "Cheese",
  "Yogurt",
  "Beef",
  "Pork",
  "Chicken",
  "Fish",
  "Bread",
  "Pastries",
  "Jam / Jelly",
  "Pickles",
  "Maple Syrup",
  "Honey",
  "Flowers",
  "Plants",
  "Other",
];

const UNITS = [
  "each",
  "lb",
  "oz",
  "bunch",
  "bag",
  "box",
  "dozen",
  "pint",
  "quart",
  "gallon",
  "jar",
  "bottle",
];

export default function NewListingPage({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [description, setDescription] = useState("");

  const [unit, setUnit] = useState("each");
  const [price, setPrice] = useState(""); // string input
  const [quantityAvailable, setQuantityAvailable] = useState("");

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);
  const imagePreview = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : ""),
    [imageFile]
  );

  useEffect(
    () => () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    },
    [imagePreview]
  );

  const formatPriceToTwoDecimals = () => {
    // keep it friendly: only format if it's a valid number
    const n = Number(price);
    if (Number.isFinite(n) && n >= 0) {
      setPrice(n.toFixed(2));
    }
  };

  const onCreate = async () => {
    setNotice(null);
    const uid = auth.currentUser?.uid ?? null;
    if (!uid) {
      setNotice({ tone: "error", message: "You must be signed in." });
      return;
    }

    const priceCents = toPriceCents(price);
    const qtyNum = toWholeQuantity(quantityAvailable);

    if (!title.trim()) {
      setNotice({ tone: "error", message: "Please enter a product name." });
      return;
    }
    if (title.trim().length > 120) {
      setNotice({ tone: "error", message: "Product name must be 120 characters or less." });
      return;
    }
    if (priceCents == null) {
      setNotice({ tone: "error", message: "Enter a price greater than $0." });
      return;
    }
    if (qtyNum == null) {
      setNotice({ tone: "error", message: "Quantity must be a whole number of 0 or more." });
      return;
    }
    if (imageFile) {
      const allowedTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
      ]);
      if (!allowedTypes.has(imageFile.type)) {
        setNotice({ tone: "error", message: "Use a JPEG, PNG, WebP, HEIC, or HEIF image." });
        return;
      }
      if (imageFile.size > 8 * 1024 * 1024) {
        setNotice({ tone: "error", message: "Product photos must be 8 MB or smaller." });
        return;
      }
    }

    const priceNum = priceCents / 100;

    setSubmitting(true);
    const formData = {
      title: title.trim(),
      department: department || "Other",
      category: category || "Other",
      unit,
      priceNum,
      qtyNum,
      hasImage: !!imageFile,
    };

    const producerRef = doc(db, PRODUCER_PROFILE_PATH, uid);
    try {
      const producerSnap = await getDoc(producerRef);
      const producerData = producerSnap.exists() ? (producerSnap.data() as any) : null;

      if (!producerSnap.exists() || !producerData) {
        const email = auth.currentUser?.email ?? "";
        const displayName = auth.currentUser?.displayName ?? "";
        await setDoc(
          producerRef,
          {
            uid,
            email,
            displayName: displayName || email || "Producer",
            role: "producer",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setNotice({
          tone: "error",
          message:
            "Your producer profile was created. Complete the Farm Profile section before publishing a listing.",
        });
        setSubmitting(false);
        return;
      }

      let producerName = producerData.displayName || auth.currentUser?.displayName || "Maine Farm";
      let producerTown = "";
      let producerPhone = "";
      const farmSnap = await getDoc(doc(db, "farms", uid));
      const farmData = farmSnap.exists() ? (farmSnap.data() as any) : null;
      if (farmData) {
        producerName = farmData.farmName || farmData.name || producerName;
        producerTown = [farmData.city, farmData.state].filter(Boolean).join(", ");
        producerPhone = farmData.phone || "";
      }
      if (!producerTown && producerData.address?.city) {
        producerTown = [producerData.address.city, producerData.address?.state].filter(Boolean).join(", ");
      }

      const missing: string[] = [];
      if (!producerName || !String(producerName).trim()) missing.push("name (Farm Profile or display name)");
      if (!producerTown || !String(producerTown).trim()) missing.push("town / city (Farm Profile)");
      if (!producerPhone || !String(producerPhone).trim()) missing.push("phone (Farm Profile)");
      if (missing.length > 0) {
        setNotice({
          tone: "error",
          message: `Complete your Farm Profile before publishing. Missing: ${missing.join(", ")}.`,
        });
        setSubmitting(false);
        return;
      }

      let imageUrl = "";

      if (imageFile) {
        const safeName = imageFile.name.replace(/\s+/g, "_");
        const storageRef = ref(storage, `products/${uid}/${Date.now()}_${safeName}`);
        await uploadBytes(storageRef, imageFile);
        imageUrl = await getDownloadURL(storageRef);
      }

      const productData = {
        title: formData.title,
        department: formData.department,
        category: formData.category,
        description: description.trim(),
        tags: parseTags(tagsInput),
        unit: formData.unit,
        price: priceNum,
        priceCents,
        quantityAvailable: qtyNum,
        inStock: qtyNum > 0,
        producerUid: uid,
        producerId: uid,
        ownerId: uid,
        producerName,
        producerTown: producerTown || undefined,
        producerPhone: producerPhone || undefined,
        imageUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, "products"), productData);

      setNotice({ tone: "success", message: "Listing created." });
      onBack();
    } catch (err: any) {
      const currentUserUid = auth.currentUser?.uid ?? null;
      const producerDocPath = `${PRODUCER_PROFILE_PATH}/${uid}`;
      let producerDocExists = false;
      let producerKeyFields: Record<string, unknown> = {};

      try {
        const producerSnap = await getDoc(doc(db, PRODUCER_PROFILE_PATH, uid));
        producerDocExists = producerSnap.exists();
        if (producerSnap.exists()) {
          const d = producerSnap.data() as any;
          producerKeyFields = {
            role: d?.role ?? "(missing)",
            producerId: d?.producerId ?? "(missing)",
            ownerId: d?.ownerId ?? "(missing)",
            subscriptionStatus: d?.subscription?.status ?? "(missing)",
            producerTermsVersion: d?.producerTerms?.version ?? "(missing)",
            producerOnboardingComplete: d?.producerOnboarding?.completed === true,
          };
        }
      } catch (profileErr) {
        producerKeyFields = { profileCheckError: String(profileErr) };
      }

      const diagnostics = {
        errCode: err?.code,
        errMessage: err?.message,
        errDetails: err?.details ?? "(none)",
        currentUserUid,
        producerDocPath,
        producerDocExists,
        producerKeyFields,
      };
      console.error("Create listing failed", {
        uid,
        producerId: uid,
        formData,
        err,
        ...diagnostics,
      });

      const msg = (() => {
        if (!err) return "Unknown error.";
        if (!producerDocExists) return "Producer profile missing — onboarding incomplete.";
        if (err?.code === "permission-denied") return "Permission denied — producer profile or rules mismatch.";
        if (err?.code && typeof err.message === "string") {
          if (err.code === "failed-precondition") return err.message || "Precondition failed.";
          if (err.code === "unauthenticated") return "Please sign in again.";
          return `${err.code}: ${err.message}`;
        }
        if (typeof err.message === "string") return err.message;
        return String(err);
      })();
      setNotice({ tone: "error", message: `Could not create the listing: ${msg}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-lg">
      <h2 className="text-2xl font-bold mb-2">Create Listing</h2>
      <p className="mb-5 text-sm text-stone-600">
        Give buyers a clear description, current inventory, and an accurate photo.
        Prohibited and age-restricted goods may not be listed.
      </p>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {notice.message}
        </div>
      )}

      <label className="block text-sm font-semibold mb-1">Product name</label>
      <input
        placeholder="Product name"
        className="border p-2 w-full mb-3 rounded"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
      />

      <label className="block text-sm font-semibold mb-1">Description</label>
      <textarea
        placeholder="Describe quality, variety, size, ingredients, or other useful details."
        className="min-h-28 w-full rounded border p-2 mb-3"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />

      {/* ✅ Department dropdown */}
      <label className="block text-sm font-semibold mb-1">Department</label>
      <select
        className="border p-2 w-full mb-3 rounded bg-white"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
      >
        <option value="">Select a department…</option>
        {DEPARTMENTS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      {/* ✅ Category dropdown */}
      <label className="block text-sm font-semibold mb-1">Category</label>
      <select
        className="border p-2 w-full mb-3 rounded bg-white"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="">Select a category…</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <label className="block text-sm font-semibold mb-1">Tags (comma-separated)</label>
      <input
        placeholder="organic, local, heirloom..."
        className="border p-2 w-full mb-3 rounded"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          {/* ✅ Unit dropdown */}
          <label className="block text-sm font-semibold mb-1">Unit</label>
          <select
            className="border p-2 w-full mb-3 rounded bg-white"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div>
          {/* ✅ Price placeholder clarity */}
          <label className="block text-sm font-semibold mb-1">Price ($)</label>
          <input
            placeholder="$00.00"
            type="number"
            min="0.01"
            step="0.01"
            className="border p-2 w-full mb-3 rounded"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={formatPriceToTwoDecimals}
            inputMode="decimal"
          />
        </div>
      </div>

      <label className="block text-sm font-semibold mb-1">Quantity available</label>
      <input
        placeholder="e.g. 20"
        type="number"
        min="0"
        step="1"
        className="border p-2 w-full mb-3 rounded"
        value={quantityAvailable}
        onChange={(e) => setQuantityAvailable(e.target.value)}
        inputMode="numeric"
      />

      <label className="block text-sm font-semibold mb-1">Image (optional)</label>
      <input
        type="file"
        className="border p-2 w-full mb-4 rounded"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
      />
      {imagePreview && (
        <img
          src={imagePreview}
          alt="New listing preview"
          className="mb-4 h-56 w-full rounded-xl border object-cover"
        />
      )}

      <button
        onClick={onCreate}
        disabled={submitting}
        className="w-full py-3 rounded text-white font-bold"
        style={{ background: submitting ? "#888" : "#0f7a4a" }}
      >
        {submitting ? "Creating…" : "Create Listing"}
      </button>

      <button onClick={onBack} className="w-full mt-3 py-2 rounded border" disabled={submitting}>
        Back
      </button>
    </div>
  );
}
