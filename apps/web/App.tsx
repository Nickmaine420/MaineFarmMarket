import React, { useState, createContext, useContext, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate, useSearchParams } from './router';
import { UserRole, UserProfile, SubscriptionStatus } from './types';

import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import BuyerDashboard from './pages/BuyerDashboard';
import ProducerDashboard from './pages/ProducerDashboard';
import ProducerOnboardingPage from './pages/ProducerOnboardingPage';
import ProducerTermsPage from './pages/ProducerTermsPage';
import StripePayoutPage from './pages/StripePayoutPage';
import UserAgreementPage from './pages/UserAgreementPage';
import CartPage from './pages/CartPage';
import BuyerOrdersPage from "./pages/BuyerOrdersPage";
import ContactPage from "./pages/ContactPage";
import AccountPage from "./pages/AccountPage";
import OrderSuccessPage from "./pages/OrderSuccessPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import { isAdminEmail } from "./utils/admin";

import { auth, db, functions, isFirebaseEmulatorMode } from './firebase';
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { PRODUCER_TERMS_VERSION } from '@mfm/shared';
import { isNativeAndroidApp } from './utils/platform';
import {
  GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID,
  obfuscatePlayAccountId,
  PlayBilling,
  PlayPurchase,
  PlaySubscriptionDetails,
} from './services/playBilling';

// --- Auth Context ---
type AuthContextType = {
  user: UserProfile | null;
  loading: boolean;
  login: (role?: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// --- Auth Provider ---
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const normalizeSubscriptionStatus = (value: unknown): SubscriptionStatus => {
    const normalized = String(value || "").toLowerCase();
    if (["active", "trialing", "paid"].includes(normalized)) return SubscriptionStatus.ACTIVE;
    if (normalized === "past_due") return SubscriptionStatus.PAST_DUE;
    if (["inactive", "canceled", "cancelled", "unpaid"].includes(normalized)) {
      return SubscriptionStatus.INACTIVE;
    }
    return SubscriptionStatus.NONE;
  };

  const createOrLoadUserProfile = async (firebaseUser: any): Promise<UserProfile> => {
    const userRef = doc(db, 'users', firebaseUser.uid);
    const snap = await getDoc(userRef);
    const intendedRole = sessionStorage.getItem("mfm_intent_role");
    const fallbackRole =
      intendedRole === UserRole.PRODUCER ? UserRole.PRODUCER : UserRole.BUYER;

    if (snap.exists()) {
      const data = snap.data() as any;
      const role = data.role ?? fallbackRole;
      if (!data.role) {
        await setDoc(userRef, { role, updatedAt: serverTimestamp() }, { merge: true });
      }
      return {
        uid: firebaseUser.uid,
        email: firebaseUser.email ?? null,
        displayName: firebaseUser.displayName ?? null,
        role,
        buyerProfileComplete: data.buyerProfileComplete === true,
        subscriptionStatus: normalizeSubscriptionStatus(
          data.subscription?.status ?? data.subscriptionStatus
        ),
        subscriptionProvider: data.subscription?.provider ?? null,
        userAgreementAcceptedAt:
          data.userAgreementAcceptedAt ??
          data.acceptedUserAgreementAt ??
          (data.acceptedUserAgreement === true ? true : null),
        producerTermsVersion: data.producerTerms?.version ?? null,
        producerTermsAcceptedAt: data.producerTerms?.acceptedAt ?? null,
        producerOnboardingComplete: data.producerOnboarding?.completed === true,
        producerPaymentPreference: data.producerOnboarding?.paymentPreference ?? null,
        hasStripeConnectAccount: Boolean(
          data.stripeConnectAccountId || data.stripeAccountId
        ),
      };
    }

    const newProfile: UserProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? null,
      displayName: firebaseUser.displayName ?? null,
      role: fallbackRole,
      buyerProfileComplete: false,
      subscriptionStatus: SubscriptionStatus.NONE,
      subscriptionProvider: null,
      userAgreementAcceptedAt: null,
      producerTermsVersion: null,
      producerTermsAcceptedAt: null,
      producerOnboardingComplete: false,
      producerPaymentPreference: null,
      hasStripeConnectAccount: false,
    };

    await setDoc(userRef, {
      role: newProfile.role,
      buyerProfileComplete: false,
      userAgreementAcceptedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return newProfile;
  };

  const refreshProfile = async () => {
    if (!auth.currentUser) {
      setUser(null);
      return;
    }
    setUser(await createOrLoadUserProfile(auth.currentUser));
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        setLoading(true);
        if (!firebaseUser) {
          setUser(null);
          return;
        }
        const profile = await createOrLoadUserProfile(firebaseUser);
        setUser(profile);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const login = async (role?: UserRole) => {
    if (role) sessionStorage.setItem("mfm_intent_role", role);
    setLoading(true);
    try {
      let firebaseUser;
      if (isFirebaseEmulatorMode) {
        const email =
          role === UserRole.PRODUCER
            ? "producer-test@mainefarmmarket.local"
            : "buyer-test@mainefarmmarket.local";
        const result = await signInWithEmailAndPassword(
          auth,
          email,
          "MfmEmulatorTest2026!"
        );
        firebaseUser = result.user;
      } else if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle({
          skipNativeAuth: true,
          // The Credential Manager path can fail before showing the account
          // chooser on some Play-installed Samsung builds. Use the plugin's
          // Google Play Services flow, which is supported across our Android
          // device range and still returns the ID token needed by Firebase JS.
          useCredentialManager: false,
        });
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("Google Sign-In did not return an ID token.");
        const credential = GoogleAuthProvider.credential(
          idToken,
          result.credential?.accessToken
        );
        const resultCredential = await signInWithCredential(auth, credential);
        firebaseUser = resultCredential.user;
      } else {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        firebaseUser = result.user;
      }

      // Route only after the newly authenticated user's Firestore profile is
      // ready, avoiding a first-login loading screen race.
      const profile = await createOrLoadUserProfile(firebaseUser);
      setUser(profile);
    } catch (error) {
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    if (Capacitor.isNativePlatform()) {
      await FirebaseAuthentication.signOut().catch(() => undefined);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

type ProtectedRouteProps = {
  children: React.ReactNode;
  role?: UserRole;
  requireBuyerReady?: boolean;
  requireProducerTerms?: boolean;
  requireProducerSetup?: boolean;
  requireProducerSubscription?: boolean;
};

// Enforces the same account milestones used by the subscription gate so a
// bookmarked URL cannot bypass agreements, setup, or producer billing.
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  role,
  requireBuyerReady = false,
  requireProducerTerms = false,
  requireProducerSetup = false,
  requireProducerSubscription = false,
}) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-stone-600">
        Loading your Maine Farm Market account…
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (role && user.role !== role) {
    return <Navigate to="/start-subscription" replace />;
  }
  if (requireBuyerReady && user.role === UserRole.BUYER) {
    if (!user.userAgreementAcceptedAt) {
      return <Navigate to="/agreement" replace />;
    }
    if (!user.buyerProfileComplete) {
      return <Navigate to="/onboarding" replace />;
    }
  }
  if (
    (requireProducerTerms || requireProducerSetup || requireProducerSubscription) &&
    user.role === UserRole.PRODUCER
  ) {
    if (
      user.producerTermsVersion !== PRODUCER_TERMS_VERSION ||
      !user.producerTermsAcceptedAt
    ) {
      return <Navigate to="/producer/terms" replace />;
    }
    if (
      (requireProducerSetup || requireProducerSubscription) &&
      !user.producerOnboardingComplete
    ) {
      return <Navigate to="/producer/setup" replace />;
    }
    if (
      requireProducerSubscription &&
      user.subscriptionStatus !== SubscriptionStatus.ACTIVE
    ) {
      return <Navigate to="/start-subscription" replace />;
    }
  }

  return <>{children}</>;
};

// --- Subscription Gate (auto-routes based on subscription state) ---
const StartSubscription: React.FC = () => {
  const { user, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [nativeSubscriptionRequired, setNativeSubscriptionRequired] = useState(false);
  const [nativeSubscription, setNativeSubscription] =
    useState<PlaySubscriptionDetails | null>(null);
  const [nativeLoading, setNativeLoading] = useState(false);
  const [nativePurchaseLoading, setNativePurchaseLoading] = useState(false);
  const [nativeMessage, setNativeMessage] = useState("");
  const [checkoutError, setCheckoutError] = useState("");

  const verifyNativePurchase = async (purchase: PlayPurchase) => {
    if (purchase.purchaseState === 2) {
      setNativeMessage(
        "Google Play is still processing this purchase. Access will begin after payment is confirmed."
      );
      return false;
    }
    if (purchase.purchaseState !== 1) return false;

    const verifyGooglePlaySubscription = httpsCallable<
      { purchaseToken: string },
      { active: boolean; status: string }
    >(functions, "verifyGooglePlaySubscription");
    const result = await verifyGooglePlaySubscription({
      purchaseToken: purchase.purchaseToken,
    });
    await refreshProfile();
    return result.data.active === true;
  };

  const restoreNativeSubscription = async () => {
    const result = await PlayBilling.querySubscriptions();
    const purchase = result.purchases.find((candidate) =>
      candidate.productIds.includes(GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID)
    );
    if (purchase && (await verifyNativePurchase(purchase))) {
      navigate("/producer", { replace: true });
      return true;
    }

    const refreshGooglePlaySubscription = httpsCallable<
      Record<string, never>,
      { active: boolean; status: string }
    >(functions, "refreshGooglePlaySubscription");
    const refreshed = await refreshGooglePlaySubscription({});
    if (refreshed.data.active) {
      await refreshProfile();
      navigate("/producer", { replace: true });
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (loading || ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      if (!user) {
        navigate("/", { replace: true });
        return;
      }

      if (user.role === UserRole.BUYER) {
        if (!user.userAgreementAcceptedAt) {
          navigate("/agreement", { replace: true });
          return;
        }
        if (!user.buyerProfileComplete) {
          navigate("/onboarding", { replace: true });
          return;
        }
        navigate("/buyer", { replace: true });
        return;
      }

      if (user.role === UserRole.PRODUCER) {
        if (
          user.producerTermsVersion !== PRODUCER_TERMS_VERSION ||
          !user.producerTermsAcceptedAt
        ) {
          navigate("/producer/terms", { replace: true });
          return;
        }
        if (!user.producerOnboardingComplete) {
          navigate("/producer/setup", { replace: true });
          return;
        }
      }

      if (user.subscriptionStatus === SubscriptionStatus.ACTIVE) {
        navigate(user.role === UserRole.PRODUCER ? "/producer" : "/buyer", {
          replace: true,
        });
        return;
      }

      if (isNativeAndroidApp()) {
        setNativeSubscriptionRequired(true);
        setNativeLoading(true);
        try {
          if (await restoreNativeSubscription()) return;
          const details = await PlayBilling.getSubscription({
            productId: GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID,
          });
          setNativeSubscription(details);
        } catch (error: any) {
          console.error("Google Play subscription check failed:", error);
          setCheckoutError(
            error?.message || "Google Play could not check the subscription."
          );
        } finally {
          setNativeLoading(false);
        }
        return;
      }

      try {
        const createCheckoutSession = httpsCallable(functions, "createCheckoutSession");
        const result = await createCheckoutSession({ role: user.role });
        const url = (result.data as { url?: string })?.url;
        if (!url) throw new Error("Stripe checkout did not return a URL.");
        window.location.assign(url);
      } catch (error: any) {
        console.error("Subscription checkout failed:", error);
        setCheckoutError(error?.message || "Subscription checkout could not be started.");
      }
    };

    void run();
  }, [user, loading, navigate, refreshProfile]);

  const purchaseNativeSubscription = async () => {
    if (!user || nativePurchaseLoading) return;
    setCheckoutError("");
    setNativeMessage("");
    setNativePurchaseLoading(true);
    try {
      const purchase = await PlayBilling.purchaseSubscription({
        productId: GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID,
        obfuscatedAccountId: await obfuscatePlayAccountId(user.uid),
      });
      if (await verifyNativePurchase(purchase)) {
        navigate("/producer", { replace: true });
      }
    } catch (error: any) {
      if (error?.code !== "PLAY_BILLING_CANCELED") {
        console.error("Google Play purchase failed:", error);
        setCheckoutError(
          error?.message || "Google Play could not complete the subscription."
        );
      }
    } finally {
      setNativePurchaseLoading(false);
    }
  };

  const manuallyRestoreNativeSubscription = async () => {
    if (nativePurchaseLoading) return;
    setCheckoutError("");
    setNativeMessage("");
    setNativePurchaseLoading(true);
    try {
      if (!(await restoreNativeSubscription())) {
        setNativeMessage(
          "No active Maine Farm Market producer subscription was found on this Google Play account."
        );
      }
    } catch (error: any) {
      console.error("Google Play restore failed:", error);
      setCheckoutError(
        error?.message || "Google Play could not restore the subscription."
      );
    } finally {
      setNativePurchaseLoading(false);
    }
  };

  if (nativeSubscriptionRequired) {
    return (
      <main className="min-h-[70vh] bg-[#efe1b6] p-6">
        <section className="mx-auto max-w-xl rounded-2xl bg-white p-7 shadow-lg">
          <h1 className="text-center text-2xl font-bold text-stone-900">
            Producer selling subscription
          </h1>
          <p className="mt-3 text-stone-700">
            A subscription is required to publish and manage products as a producer.
            Buyer access and ordering remain free.
          </p>
          {nativeLoading ? (
            <p className="mt-6 text-center font-semibold text-stone-700">
              Checking Google Play…
            </p>
          ) : (
            <>
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-bold text-emerald-950">
                  Maine Farm Market Producer
                </p>
                <p className="mt-1 text-xl font-extrabold text-emerald-900">
                  {nativeSubscription?.formattedPrice
                    ? `${nativeSubscription.formattedPrice} per month`
                    : "Monthly price shown by Google Play"}
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
                  <li>Create and manage marketplace listings.</li>
                  <li>Receive and manage buyer orders.</li>
                  <li>Maintain your public farm or producer profile.</li>
                </ul>
              </div>

              <p className="mt-4 text-sm leading-6 text-stone-600">
                Payment is charged to your Google Play account when you confirm.
                This monthly subscription automatically renews unless canceled.
                You can cancel at any time in Google Play subscription settings;
                cancellation normally takes effect at the end of the paid period.
              </p>

              {checkoutError && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  {checkoutError}
                </p>
              )}
              {nativeMessage && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {nativeMessage}
                </p>
              )}

              <button
                type="button"
                onClick={purchaseNativeSubscription}
                disabled={
                  nativePurchaseLoading || nativeSubscription?.available !== true
                }
                className="mt-5 w-full rounded-xl bg-emerald-800 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {nativePurchaseLoading
                  ? "Contacting Google Play…"
                  : "Subscribe with Google Play"}
              </button>
              <button
                type="button"
                onClick={manuallyRestoreNativeSubscription}
                disabled={nativePurchaseLoading}
                className="mt-3 w-full rounded-xl bg-stone-100 px-5 py-3 font-bold text-stone-800 disabled:opacity-50"
              >
                Restore subscription
              </button>

              {nativeSubscription?.available === false && (
                <p className="mt-3 text-center text-sm text-stone-600">
                  This subscription is not available from Google Play yet. Please
                  try again later.
                </p>
              )}
            </>
          )}
        </section>
      </main>
    );
  }

  if (checkoutError) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-bold">Checkout unavailable</h1>
        <p className="mt-2 text-red-700">{checkoutError}</p>
        <button
          type="button"
          className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  return <div className="p-6">Checking your access…</div>;
};

// --- Subscribe Success (after Stripe returns) ---
const SubscribeSuccess: React.FC = () => {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    // Optional: you could read session_id to verify, but your webhook should set status.
    // const sessionId = params.get("session_id");

    if (!user) return;

    // Give webhook a moment, then push user to start-subscription which gates properly
    const t = setTimeout(async () => {
      await refreshProfile();
      navigate("/start-subscription", { replace: true });
    }, 1200);

    return () => clearTimeout(t);
  }, [user, navigate, params, refreshProfile]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-extrabold text-stone-900">Success!</h1>
      <p className="text-stone-700 mt-2">
        Your subscription is being activated. Sending you to your dashboard…
      </p>
    </div>
  );
};

// --- Subscribe Cancel ---
const SubscribeCancel: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-extrabold text-stone-900">Checkout canceled</h1>
      <p className="text-stone-700 mt-2">
        No worries — you can try again any time.
      </p>
      <Link to="/start-subscription" className="inline-block mt-4 text-emerald-700 font-bold hover:text-emerald-800">
        Try checkout again
      </Link>
    </div>
  );
};

// --- Header ---
const Header = () => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white/70 backdrop-blur border-b border-stone-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="shrink-0">
          <img src="/mfm-logo.png" alt="Maine Farm Market" className="h-14 md:h-16 w-auto object-contain" />
        </Link>

        <div className="flex flex-1 flex-wrap justify-end items-center gap-3">
          <div className="flex items-center gap-3">
            <Link to="/contact" className="text-sm font-bold text-emerald-700 hover:text-emerald-800">
              Contact
            </Link>
            <a href="/privacy.html" className="text-sm font-bold text-emerald-700 hover:text-emerald-800">
              Privacy
            </a>
          </div>

          {user ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-sm font-medium text-stone-700">
                {user.displayName || user.email}
              </span>

              <Link
                to="/account"
                className="text-sm font-bold text-emerald-700 hover:text-emerald-800"
              >
                Account
              </Link>

              {isAdminEmail(user.email) && (
                <Link
                  to="/admin"
                  className="text-sm font-bold text-amber-700 hover:text-amber-800"
                >
                  Administration
                </Link>
              )}

              {user.role === UserRole.PRODUCER && (
                <Link
                  to="/producer/payouts"
                  className="text-sm font-bold text-emerald-700 hover:text-emerald-800"
                >
                  Optional Stripe payouts
                </Link>
              )}

              <button onClick={logout} className="text-sm text-red-700 font-bold hover:text-red-800">
                Sign Out
              </button>
            </div>
          ) : (
            <Link to="/" className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Header />

        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <AccountPage />
              </ProtectedRoute>
            }
          />

          {/* NEW: Auto-checkout gate replaces SubscriptionPage */}
          <Route
            path="/start-subscription"
            element={
              <ProtectedRoute>
                <StartSubscription />
              </ProtectedRoute>
            }
          />

          <Route
            path="/onboarding"
            element={
              <ProtectedRoute role={UserRole.BUYER}>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/agreement"
            element={
              <ProtectedRoute role={UserRole.BUYER}>
                <UserAgreementPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/subscribe-success"
            element={
              <ProtectedRoute role={UserRole.PRODUCER}>
                <SubscribeSuccess />
              </ProtectedRoute>
            }
          />

          <Route path="/subscribe-cancel" element={<SubscribeCancel />} />

          <Route
            path="/buyer"
            element={
              <ProtectedRoute role={UserRole.BUYER} requireBuyerReady>
                <BuyerDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/buyer/orders"
            element={
              <ProtectedRoute role={UserRole.BUYER} requireBuyerReady>
                <BuyerOrdersPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/order-success"
            element={
              <ProtectedRoute role={UserRole.BUYER} requireBuyerReady>
                <OrderSuccessPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer"
            element={
              <ProtectedRoute
                role={UserRole.PRODUCER}
                requireProducerSubscription
              >
                <ProducerDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer/terms"
            element={
              <ProtectedRoute role={UserRole.PRODUCER}>
                <ProducerTermsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer/setup"
            element={
              <ProtectedRoute role={UserRole.PRODUCER} requireProducerTerms>
                <ProducerOnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer/onboarding"
            element={<Navigate to="/producer/setup" replace />}
          />

          <Route
            path="/producer/payouts"
            element={
              <ProtectedRoute
                role={UserRole.PRODUCER}
                requireProducerSetup
              >
                <StripePayoutPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/cart"
            element={
              <ProtectedRoute role={UserRole.BUYER} requireBuyerReady>
                <CartPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
