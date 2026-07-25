import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

const SUPPORT_EMAIL = "mainefarmmarket@gmail.com";
const SUPPORT_PHONE_DISPLAY = "207-431-4518";
const SUPPORT_PHONE_TEL = "+12074314518";

export default function ContactPage() {
  const [subject, setSubject] = useState("Maine Farm Market Support");
  const [message, setMessage] = useState("");

  const mailtoHref = useMemo(() => {
    const body =
      message.trim().length > 0
        ? message.trim()
        : "Hi Maine Farm Market Support,\n\n(Describe your issue here)\n\nThanks!";
    const params = new URLSearchParams({ subject, body });
    return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
  }, [subject, message]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link to="/" className="text-emerald-700 font-semibold hover:text-emerald-800">
        ← Back to Home
      </Link>

      <h1 className="text-3xl font-extrabold text-stone-900 mt-4">Contact Us</h1>
      <p className="text-stone-700 mt-2">
        Need help? Reach us here:
      </p>

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="text-stone-900">
          <span className="font-bold">Email:</span>{" "}
          <a className="text-emerald-700 font-semibold hover:text-emerald-800" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
        </div>

        <div className="text-stone-900 mt-2">
          <span className="font-bold">Phone:</span>{" "}
          <a className="text-emerald-700 font-semibold hover:text-emerald-800" href={`tel:${SUPPORT_PHONE_TEL}`}>
            {SUPPORT_PHONE_DISPLAY}
          </a>
        </div>
      </div>

      <h2 className="text-xl font-extrabold text-stone-900 mt-8">Send a message</h2>
      <p className="text-stone-700 mt-1">
        This opens your email app with your message pre-filled.
      </p>

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-bold text-stone-900">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-300"
        />

        <label className="block text-sm font-bold text-stone-900 mt-4">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={7}
          placeholder="Tell us what’s going on..."
          className="mt-2 w-full rounded-xl border border-stone-300 px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-300"
        />

        <a
          href={mailtoHref}
          className="inline-block mt-4 rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800"
        >
          Email Support
        </a>
      </div>
    </div>
  );
}
