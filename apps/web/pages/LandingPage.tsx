import React from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../App';
import { UserRole, SubscriptionStatus } from '../types';
import { PRICING } from '../constants';

const LandingPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();

  const handleStart = async (role: UserRole) => {
    try {
      // Save intent BEFORE login so after auth we know which plan to charge
      sessionStorage.setItem('mfm_intent_role', role);

      await login(role);

      // After Google sign-in, go straight to auto-checkout gate.
      // If already subscribed, it will send them directly to dashboard.
      navigate('/start-subscription', { replace: true });
    } catch (e) {
      console.error(e);
      alert("Google sign-in was blocked or cancelled. Try again.");
    }
  };

  // If already logged in, skip buttons entirely
  if (user) {
    const norm = String(user.subscription?.status || '').toLowerCase();
    const active = norm === 'active' || norm === 'trialing' || norm === 'paid' || norm === String(SubscriptionStatus.ACTIVE).toLowerCase();

    if (active) return <Navigate to="/dashboard" replace />;
    return <Navigate to="/start-subscription" replace />;
  }

  return (
    <div className="relative overflow-hidden">
      <section className="relative h-[80vh] flex items-center justify-center bg-stone-900">
        <img
          src="https://picsum.photos/seed/maine-farm/1920/1080"
          alt="Maine Farm"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <h1 className="font-serif text-5xl md:text-7xl text-white mb-6">A Fair Market for Maine.</h1>
          <p className="text-xl md:text-2xl text-stone-200 mb-10 font-light">
            Connecting Maine producers directly with Maine neighbors.
            No transaction fees. No ads. Just local food.
          </p>

          <div className="flex flex-col md:flex-row items-center justify-center gap-4">
            <button
              onClick={() => handleStart(UserRole.BUYER)}
              className="w-full md:w-auto px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-lg transition shadow-lg"
            >
              Access the Market (${PRICING.BUYER}/mo)
            </button>

            <button
              onClick={() => handleStart(UserRole.PRODUCER)}
              className="w-full md:w-auto px-8 py-4 bg-white hover:bg-stone-100 text-stone-900 rounded-lg font-bold text-lg transition shadow-lg"
            >
              Start Selling (${PRICING.PRODUCER}/mo)
            </button>
          </div>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🌲</span>
              </div>
              <h3 className="text-2xl font-serif mb-4">Maine Only</h3>
              <p className="text-stone-600">Verification ensures every seller and every buyer is located right here in Maine.</p>
            </div>
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🤝</span>
              </div>
              <h3 className="text-2xl font-serif mb-4">100% Producer Profit</h3>
              <p className="text-stone-600">We take zero transaction fees. Producers keep every penny of their sales price.</p>
            </div>
            <div>
              <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">⚖️</span>
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
          <p className="text-green-100 mb-8">Join the subscription-only marketplace designed to keep Maine farming sustainable and healthy.</p>
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