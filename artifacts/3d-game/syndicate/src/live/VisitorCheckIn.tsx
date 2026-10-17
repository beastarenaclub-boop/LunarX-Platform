"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, CheckCircle2 } from "lucide-react";
import { Dialog } from "../App";
import { requestLoginLocation, type LoginPosition } from "./location";
import { VISITOR_CONSENT, VISITOR_CONSENT_VERSION } from "./visitor-types";
import { playEntrySound } from "./entry-audio";

export default function VisitorCheckIn({
  close,
  onStatus,
}: {
  close: () => void;
  onStatus?: (saved: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const active = useRef(true);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [position, setPosition] = useState<LoginPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) onStatus?.(!!receipt);
  }, [loaded, receipt, onStatus]);
  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => {
    active.current = true;
    const abort = new AbortController();
    fetch("/api/visitors/mine", { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw Error("Could not load your visitor receipt.");
        return response.json() as Promise<{ saved: { id: string } | null }>;
      })
      .then((value) => {
        if (active.current) {
          setReceipt(value.saved?.id || null);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (active.current && cause.name !== "AbortError") {
          setError(cause.message);
          setLoaded(true);
        }
      });
    const hide = () => {
      if (document.hidden) {
        stop();
        setLive(false);
        setReady(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      active.current = false;
      abort.abort();
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
    };
  }, []);
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function start() {
    if (!consent || busy) return;
    setBusy(true);
    setError("");
    setReady(false);
    setPhoto(null);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw Error(
          "Camera requires HTTPS or localhost and a supported browser.",
        );
      const response = await fetch("/api/visitors/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          version: VISITOR_CONSENT_VERSION,
        }),
      });
      const result = (await response.json()) as { error?: string; id: string };
      if (!response.ok)
        throw Error(result.error || "Could not start visitor check-in.");
      if (!active.current) return;
      const camera = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      if (!active.current || document.hidden) {
        camera.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = camera;
      for (const track of camera.getVideoTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (stream.current !== camera) return;
            stop();
            if (active.current) {
              setLive(false);
              setReady(false);
              setError(
                "Camera access stopped. No photo was saved. Enable the camera to retry.",
              );
            }
          },
          { once: true },
        );
      }
      setLive(true);
      if (video.current) {
        video.current.srcObject = camera;
        await video.current.play();
      }
      const location = await requestLoginLocation();
      if (active.current && !document.hidden && stream.current === camera) {
        setPosition(location);
        setReady(true);
      } else stop();
    } catch (cause) {
      stop();
      if (active.current) {
        setLive(false);
        const e = cause as Error;
        setError(
          e.name === "NotAllowedError"
            ? "Camera permission was denied. No photo was taken or saved. You can allow camera access and retry, or close this check-in."
            : e.name === "NotFoundError"
              ? "No camera was found. No photo has been saved."
              : e.message.replace(/ Login[^.]*\./g, ""),
        );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function capture() {
    if (!consent || !ready || !video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      640 / Math.max(video.current.videoWidth, video.current.videoHeight),
    );
    canvas.width = Math.round(video.current.videoWidth * scale);
    canvas.height = Math.round(video.current.videoHeight * scale);
    canvas
      .getContext("2d")!
      .drawImage(video.current, 0, 0, canvas.width, canvas.height);
    stop();
    setLive(false);
    setReady(false);
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!active.current) return;
    if (!image) {
      setError("Photo capture failed. Please retry.");
      return;
    }
    setPhoto(image);
    playEntrySound("click");
  }
  async function save() {
    if (!consent || !photo || busy) return;
    setBusy(true);
    setError("");
    try {
      const location =
        position && Date.now() - position.capturedAt < 90000
          ? position
          : await requestLoginLocation();
      if (!active.current) return;
      const form = new FormData();
      form.set("photo", photo, "visitor-camera.jpg");
      form.set("name", name.trim() || "Visitor");
      form.set("location", JSON.stringify(location));
      form.set("consent", "true");
      form.set("version", VISITOR_CONSENT_VERSION);
      const response = await fetch("/api/visitors/check-in", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as { error?: string; id: string };
      if (!response.ok) throw Error(result.error || "Could not save check-in.");
      if (active.current) {
        setReceipt(result.id);
        setPhoto(null);
        playEntrySound("success");
      }
    } catch (cause) {
      if (active.current) setError((cause as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/visitors/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = (await response.json()) as { error?: string; id: string };
      if (!response.ok)
        throw Error(result.error || "Could not delete check-in.");
      if (active.current) {
        setReceipt(null);
        setConsent(false);
        setPhoto(null);
      }
    } catch (cause) {
      if (active.current) setError((cause as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <Dialog title="Visitor camera check-in" close={close}>
      <div className="visitor-checkin" data-loaded={loaded}>
        {receipt ? (
          <>
            <div className="visitor-saved">
              <CheckCircle2 />
              <h3>Check-in saved</h3>
              <p>
                Your photo and consented location are available only to
                administrators.
              </p>
              <code>{receipt}</code>
            </div>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={withdraw}
            >
              Delete my check-in
            </button>
            <button className="btn primary" disabled={busy} onClick={close}>
              Return to the puzzle
            </button>
          </>
        ) : (
          <>
            <p>
              Photo check-in is optional. You can complete the entrance and open
              login without a camera. Nothing is captured or saved
              automatically. Closing this window stops the camera.
            </p>
            <label className="visitor-name">
              Name (optional)
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoComplete="name"
                disabled={busy}
              />
            </label>
            <label className="visitor-consent">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => {
                  setConsent(event.target.checked);
                  if (!event.target.checked) {
                    stop();
                    setLive(false);
                    setReady(false);
                    setPhoto(null);
                    setPosition(null);
                  }
                }}
              />
              <span>{VISITOR_CONSENT}</span>
            </label>
            <div className={`visitor-camera ${live ? "is-live" : ""}`}>
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                hidden={!live}
                aria-label="Your live camera preview"
              />
              {preview ? (
                <img src={preview} alt="Your captured photo, not yet saved" />
              ) : (
                !live && (
                  <div>
                    <Camera size={40} />
                    <span>Camera is off</span>
                  </div>
                )
              )}
              {live && (
                <span className="visitor-camera-indicator">
                  ● CAMERA ON — PREVIEW ONLY
                </span>
              )}
            </div>
            <p className="visitor-location">
              <MapPin size={15} />
              {position
                ? "Browser location received; approximate coordinates will be saved with your photo."
                : "Camera and location permissions are requested after you agree."}
            </p>
            {!live && !photo && (
              <button
                className="btn primary"
                disabled={!loaded || !consent || busy}
                onClick={start}
              >
                {busy ? "Requesting permissions…" : "Enable camera & location"}
              </button>
            )}
            {live && (
              <button
                className="btn primary"
                disabled={!ready || busy}
                onClick={capture}
              >
                {busy ? "Getting location…" : "Capture photo"}
              </button>
            )}
            {photo && (
              <div className="page-actions">
                <button
                  className="btn secondary"
                  disabled={busy || !consent}
                  onClick={start}
                >
                  Retake photo
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !consent}
                  onClick={save}
                >
                  {busy ? "Saving…" : "Save visitor check-in"}
                </button>
              </div>
            )}
            <button className="link-button" onClick={close}>
              Continue without camera check-in
            </button>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
