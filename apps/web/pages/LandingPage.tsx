import React, { useState } from 'react';
import { useNavigate, Navigate } from '../router';
import { useAuth } from '../App';
import { UserRole } from '../types';
import { PRICING } from '../constants';

const LandingPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [signInError, setSignInError] = useState("");

  const handleStart = async (role: UserRole) => {
    try {
      setSignInError("");
      // Save intent BEFORE login so after auth we know which plan to charge
      sessionStorage.setItem('mfm_intent_role', role);

      await login(role);

      // After Google sign-in, go straight to auto-checkout gate.
      // If already subscribed, it will send them directly to dashboard.
      navigate('/start-subscription', { replace: true });
    } catch (e) {
      console.error(e);
      setSignInError("Google sign-in was blocked or cancelled. Please try again.");
    }
  };

  // If already logged in, skip buttons entirely
  if (user) {
    return <Navigate to="/start-subscription" replace />;
  }

  return (
    <div className="relative overflow-hidden">
      <section className="relative min-h-[38rem] flex items-center justify-center bg-stone-900">
        <img
          src="/mfm-hero.webp"
          alt="A Maine farm landscape at sunrise"
          className="absolute inset-0 w-full h-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-stone-950/20 via-stone-950/45 to-stone-950/80" />
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <h1 className="font-serif text-5xl md:text-7xl text-white mb-6">A Fair Market for Maine.</h1>
          <p className="text-xl md:text-2xl text-stone-200 mb-10 font-light">
            Connecting Maine producers directly with Maine neighbors.
            No platform sales commission. No ads. Just local food and goods.
          </p>

          <div className="flex flex-col md:flex-row items-center justify-center gap-4">
            <button
              onClick={() => handleStart(UserRole.BUYER)}
              className="w-full md:w-auto px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-lg transition shadow-lg"
            >
              Shop the Market — Free
            </button>

            <button
              onClick={() => handleStart(UserRole.PRODUCER)}
              className="w-full md:w-auto px-8 py-4 bg-white hover:bg-stone-100 text-stone-900 rounded-lg font-bold text-lg transition shadow-lg"
            >
              Start Selling (${PRICING.PRODUCER}/mo)
            </button>
          </div>
          {signInError && (
            <p role="alert" className="mx-auto mt-5 max-w-lg rounded-xl bg-red-950/80 px-4 py-3 text-sm text-red-50">
              {signInError}
            </p>
          )}
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="mb-12 text-center text-3xl font-serif text-stone-900">
            Built for Maine communities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-emerald-800" strokeWidth="1.8">
                  <path d="M12 3 7 10h3l-4 6h5v5h2v-5h5l-4-6h3L12 3Z" />
                </svg>
              </div>
              <h3 className="text-2xl font-serif mb-4">Maine Only</h3>
              <p className="text-stone-600">Profiles collect a Maine city and ZIP so the marketplace stays focused on local connections.</p>
            </div>
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-emerald-800" strokeWidth="1.8">
                  <path d="M4 8h4l3 3 2-2 7 7-3 3-2-2-2 2-2-2-2 1-5-5V8Z" />
                  <path d="m8 8 3-3h5l4 4" />
                </svg>
              </div>
              <h3 className="text-2xl font-serif mb-4">No Sales Commission</h3>
              <p className="text-stone-600">Maine Farm Market does not take a platform commission from product sales. Payment processing fees may still apply.</p>
            </div>
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 fill-none stroke-emerald-800" strokeWidth="1.8">
                  <path d="M12 3v18M5 6h14M7 6l-4 7h8L7 6Zm10 0-4 7h8l-4-7ZM8 21h8" />
                </svg>
              </div>
              <h3 className="text-2xl font-serif mb-4">Fair Exposure</h3>
              <p className="text-stone-600">No sponsored rankings or paid boosts. Every farm gets an equal chance to be found.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-green-800 text-white text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl font-serif mb-6">Ready to support your local food system?</h2>
          <p className="text-green-100 mb-8">Buyers join free. Producer subscriptions help keep this Maine marketplace sustainable and healthy.</p>
          <button
            onClick={() => handleStart(UserRole.BUYER)}
            className="px-10 py-4 bg-white text-green-900 rounded-full font-bold hover:bg-stone-100 transition"
          >
            Get Started
          </button>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
