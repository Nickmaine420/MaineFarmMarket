import { doc, getDoc } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

/**
 * Single source of truth: has this user accepted the one-time user agreement?
 * Reads the current and legacy agreement fields from users/{uid}.
 */
export async function hasAcceptedUserAgreement(
  db: Firestore,
  uid: string
): Promise<boolean> {
  if (!uid) return false;
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? snap.data() : null;
  return Boolean(
    data?.userAgreementAcceptedAt ||
      data?.acceptedUserAgreementAt ||
      data?.acceptedUserAgreement === true
  );
}
