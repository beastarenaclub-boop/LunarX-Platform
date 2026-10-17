"use client";
import { useCallback, useEffect, useState } from "react";
import { Camera, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { Dialog, Empty, Panel } from "../App";
import type { VisitorRecord } from "./visitor-types";
import { VISITOR_CONSENT } from "./visitor-types";

export default function AdminVisitors() {
  const [records, setRecords] = useState<VisitorRecord[]>([]);
  const [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<VisitorRecord | null>(null);
  const [deleting, setDeleting] = useState<VisitorRecord | null>(null);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/visitors?offset=${offset}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        error?: string;
        records: VisitorRecord[];
        total: number;
      };
      if (!response.ok) throw Error(data.error || "Could not load visitors.");
      if (offset > 0 && !data.records.length) {
        setOffset(Math.max(0, offset - 25));
        return;
      }
      setRecords(data.records);
      setTotal(data.total);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [offset]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  const close = useCallback(() => setSelected(null), []);
  const closeDelete = useCallback(() => setDeleting(null), []);
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/visitors/${deleting.id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw Error(data.error || "Could not delete visitor.");
      setDeleting(null);
      setSelected(null);
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="info-banner">
        <Camera size={24} />
        <div>
          <strong>{total} consented visitor check-ins</strong>
          <p>
            Only visitors who chose to save a camera photo appear here. These
            are unverified visitor records. IP city may be unavailable;
            localhost records a loopback IP.
          </p>
        </div>
        <button className="btn secondary" onClick={load}>
          <RefreshCw size={16} />
          Refresh visitors
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Panel
        title="Visitor photos & access"
        action={<span>{total} saved</span>}
      >
        {records.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Visitor / saved at</th>
                  <th>Connection</th>
                  <th>Location</th>
                  <th>Consent / actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const position = JSON.parse(record.location);
                  return (
                    <tr key={record.id}>
                      <td>
                        <strong>{record.name}</strong>
                        <br />
                        <small>
                          {new Date(record.created_at).toLocaleString()}
                        </small>
                        <br />
                        <code>{record.id.slice(0, 8)}</code>
                      </td>
                      <td>
                        {record.ip}
                        <br />
                        <small>
                          {[record.city, record.country]
                            .filter(Boolean)
                            .join(", ") || "Network city unavailable"}
                        </small>
                      </td>
                      <td>
                        {position.latitude}, {position.longitude}
                        <br />
                        <small>
                          Rounded coordinates · device estimate{" "}
                          {position.accuracy} m
                        </small>
                      </td>
                      <td>
                        <small>{record.consent_version}</small>
                        <div className="page-actions">
                          <button
                            className="btn secondary"
                            onClick={() => setSelected(record)}
                          >
                            <Camera size={15} />
                            View photo & details
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`Delete visitor ${record.id}`}
                            onClick={() => setDeleting(record)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No visitor check-ins yet"
            detail="Consented camera check-ins from the entrance will appear here."
          />
        )}
        <div className="visitor-pagination">
          <button
            className="btn secondary"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Previous
          </button>
          <span>
            {total
              ? `${offset + 1}–${Math.min(offset + records.length, total)} of ${total}`
              : "0 records"}
          </span>
          <button
            className="btn secondary"
            disabled={offset + 25 >= total}
            onClick={() => setOffset(offset + 25)}
          >
            Next
          </button>
        </div>
      </Panel>
      {selected && (
        <Dialog title="Visitor photo & access details" close={close}>
          <div className="visitor-details">
            <img
              src={`/api/visitors/${selected.id}/photo`}
              alt={`Consented visitor photo: ${selected.name}`}
            />
            <dl>
              {[
                ["Visitor", selected.name],
                ["Visitor ID", selected.id],
                ["Saved", new Date(selected.created_at).toLocaleString()],
                ["IP", selected.ip],
                [
                  "Network location",
                  [selected.city, selected.country]
                    .filter(Boolean)
                    .join(", ") || "Unavailable",
                ],
                [
                  "Browser location",
                  `${JSON.parse(selected.location).latitude}, ${JSON.parse(selected.location).longitude} (rounded to 0.01°; device estimate ${JSON.parse(selected.location).accuracy} m)`,
                ],
                ["Location captured", JSON.parse(selected.location).capturedAt],
                ["Device / browser", selected.user_agent],
                [
                  "Consent accepted",
                  new Date(selected.consent_at).toLocaleString(),
                ],
                ["Consent version", selected.consent_version],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p>
              <MapPin size={14} /> Location is browser-reported and approximate;
              the photo does not verify identity.
            </p>
            <blockquote>{VISITOR_CONSENT}</blockquote>
          </div>
        </Dialog>
      )}
      {deleting && (
        <Dialog title="Delete visitor check-in?" close={closeDelete}>
          <div className="visitor-checkin">
            <p>
              Delete {deleting.name}'s saved photo and visitor details
              permanently?
            </p>
            <div className="page-actions">
              <button
                className="btn secondary"
                disabled={busy}
                onClick={closeDelete}
              >
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Delete photo & record"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
