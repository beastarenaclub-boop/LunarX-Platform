"use client";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Emblem } from "../App";
import { requestLoginLocation } from "./location";

export function LocationNotice() {
  return (
    <div className="location-notice">
      <strong>
        <MapPin size={16} /> Location required
      </strong>
      <p>
        To access this portal, allow browser location. Your approximate
        coordinates, reported accuracy, sign-in time and IP are recorded in
        access logs visible to you and administrators. Location is collected at
        sign-in, without background tracking.
      </p>
      <label className="inline-check">
        <input name="locationConsent" type="checkbox" required /> I agree to
        share my location to access this portal.
      </label>
    </div>
  );
}
export default function LocationAccess({
  done,
  signOut,
}: {
  done: () => void;
  signOut: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="live-auth password-access">
      <Emblem />
      <h1>Location access required.</h1>
      <p>Allow location to continue to your account.</p>
      <form
        className="panel form live-form-pad auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const location = await requestLoginLocation();
            const response = await fetch("/api/auth/connected-location", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ location }),
            });
            const result = (await response.json()) as { error?: string };
            if (!response.ok)
              throw Error(result.error || "Could not confirm location. Retry.");
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LocationNotice />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "Getting location…" : "Allow location and continue"}
        </button>
      </form>
      <button className="link-button" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
