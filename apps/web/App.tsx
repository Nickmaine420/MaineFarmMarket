import React, { useState, createContext, useContext, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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

import { auth, db, functions } from './firebase';
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { PRODUCER_TERMS_VERSION } from '@mfm/shared';
import { isNativeAndroidApp } from './utils/platform';

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
        subscriptionStatus: normalizeSubscriptionStatus(
          data.subscription?.status ?? data.subscriptionStatus
        ),
        userAgreementAcceptedAt:
          data.userAgreementAcceptedAt ??
          data.acceptedUserAgreementAt ??
          (data.acceptedUserAgreement === true ? true : null),
        producerTermsVersion: data.producerTerms?.version ?? null,
        producerTermsAcceptedAt: data.producerTerms?.acceptedAt ?? null,
        producerOnboardingComplete: data.producerOnboarding?.completed === true,
        producerPaymentPreference: data.producerOnboarding?.paymentPreference ?? null,
      };
    }

    const newProfile: UserProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? null,
      displayName: firebaseUser.displayName ?? null,
      role: fallbackRole,
      subscriptionStatus: SubscriptionStatus.NONE,
      userAgreementAcceptedAt: null,
      producerTermsVersion: null,
      producerTermsAcceptedAt: null,
      producerOnboardingComplete: false,
      producerPaymentPreference: null,
    };

    await setDoc(userRef, {
      role: newProfile.role,
      subscriptionStatus: newProfile.subscriptionStatus,
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
    if (Capacitor.isNativePlatform()) {
      const result = await FirebaseAuthentication.signInWithGoogle({
        skipNativeAuth: true,
      });
      const idToken = result.credential?.idToken;
      if (!idToken) throw new Error("Google Sign-In did not return an ID token.");
      const credential = GoogleAuthProvider.credential(
        idToken,
        result.credential?.accessToken
      );
      await signInWithCredential(auth, credential);
      return;
    }
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
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

// --- Protected Route ---
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-6">Loading...</div>;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;

  return <>{children}</>;
};

// --- Subscription Gate (auto-routes based on subscription state) ---
const StartSubscription: React.FC = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const ranRef = useRef(false);
  const [nativeSubscriptionRequired, setNativeSubscriptionRequired] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    if (loading || ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      if (!user) {
        navigate("/", { replace: true });
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
      } else if (!user.userAgreementAcceptedAt) {
        navigate("/agreement", { replace: true });
        return;
      }

      if (user.subscriptionStatus === SubscriptionStatus.ACTIVE) {
        navigate(user.role === UserRole.PRODUCER ? "/producer" : "/buyer", {
          replace: true,
        });
        return;
      }

      if (isNativeAndroidApp()) {
        setNativeSubscriptionRequired(true);
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
  }, [user, loading, navigate]);

  if (nativeSubscriptionRequired) {
    return (
      <main className="min-h-[70vh] bg-[#efe1b6] p-6">
        <section className="mx-auto max-w-xl rounded-2xl bg-white p-7 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-stone-900">Subscription required</h1>
          <p className="mt-3 text-stone-700">
            This Google Play app is for accounts with an active Maine Farm Market subscription.
            Subscription enrollment and billing are managed outside the Android app.
          </p>
          <p className="mt-3 text-sm text-stone-600">
            After your account is activated, return here and sign in again.
          </p>
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
      <Link to="/onboarding" className="inline-block mt-4 text-emerald-700 font-bold hover:text-emerald-800">
        Go back
      </Link>
    </div>
  );
};

// --- Header ---
const Header = () => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white/70 backdrop-blur border-b border-stone-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col items-center">
        <Link to="/" className="block">
          <img src="/mfm-logo.png" alt="Maine Farm Market" className="h-20 md:h-24 object-contain" />
        </Link>

        <div className="w-full flex justify-between items-center mt-2">
          <Link to="/contact" className="text-sm font-bold text-emerald-700 hover:text-emerald-800">
            Contact
          </Link>

          {user ? (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-stone-700">
                {user.displayName || user.email}
              </span>

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
            <div className="h-6" />
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
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/agreement"
            element={
              <ProtectedRoute>
                <UserAgreementPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/subscribe-success"
            element={
              <ProtectedRoute>
                <SubscribeSuccess />
              </ProtectedRoute>
            }
          />

          <Route path="/subscribe-cancel" element={<SubscribeCancel />} />

          <Route
            path="/buyer"
            element={
              <ProtectedRoute>
                <BuyerDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/buyer/orders"
            element={
              <ProtectedRoute>
                <BuyerOrdersPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer"
            element={
              <ProtectedRoute>
                <ProducerDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer/terms"
            element={
              <ProtectedRoute>
                <ProducerTermsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/producer/setup"
            element={
              <ProtectedRoute>
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
              <ProtectedRoute>
                <StripePayoutPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/cart"
            element={
              <ProtectedRoute>
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
