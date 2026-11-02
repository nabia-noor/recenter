import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import type { PopupState } from "../../shared/popup.ts";
import "./popup.css";
import { FocusIcon } from "./FocusIcon";

function ReminderPopup() {
  const [state, setState] = useState<PopupState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState("");
  const pointer = useRef<number | null>(null);
  const session = useRef<string | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancel() {
    generation.current++;
    pointer.current = null;
    clearTimeout(timer.current);
    const token = session.current;
    session.current = null;
    setElapsed(0);
    setHolding(false);
    if (token) void window.reminderPopup.cancel(token).catch(() => {});
  }
  useEffect(() => {
    let mounted = true;
    void window.reminderPopup
      .get()
      .then((value) => {
        if (mounted) setState(value);
      })
      .catch((reason) => {
        if (mounted) setError(String(reason));
      });
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted = false;
      cancel();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  async function begin(event: PointerEvent<HTMLButtonElement>) {
    if (
      !state?.item ||
      pointer.current !== null ||
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    event.preventDefault();
    cancel();
    const attempt = generation.current;
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setError("");
    setHolding(true);
    try {
      const result = await window.reminderPopup.begin(state.item.key);
      if (attempt !== generation.current) {
        if (result.token) void window.reminderPopup.cancel(result.token);
        return;
      }
      session.current = result.token;
      const pulse = async () => {
        if (attempt !== generation.current || !session.current) return;
        try {
          const update = await window.reminderPopup.pulse(
            state.item!.key,
            session.current,
          );
          if (attempt !== generation.current) return;
          setElapsed(update.elapsed);
          if (update.dismissed) {
            session.current = null;
            pointer.current = null;
            setHolding(false);
            return;
          }
          if (!update.token) {
            cancel();
            return;
          }
          timer.current = setTimeout(() => void pulse(), 100);
        } catch (reason) {
          cancel();
          setError(
            `Could not dismiss: ${String(reason)}. Hold again to retry.`,
          );
        }
      };
      timer.current = setTimeout(() => void pulse(), 100);
    } catch (reason) {
      if (attempt === generation.current) {
        cancel();
        setError(String(reason));
      }
    }
  }
  const item = state?.item;
  return (
    <main className="popup-shell">
      <div className="popup-brand">
        <span className="brand-mark">
          <FocusIcon size={18} />
        </span>{" "}
        Recenter
        <span className="popup-dot">.</span>
        <span className="due-badge">DUE NOW</span>
      </div>
      <div className="popup-bell" aria-hidden="true">
        <svg
          width="38"
          height="38"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
      </div>
      <p className="popup-eyebrow">A LITTLE MOMENT FOR YOU</p>
      <div className="popup-copy">
        <h1>{item?.reminder.title ?? "Loading your reminder…"}</h1>
        {item?.reminder.note && (
          <p className="popup-note">{item.reminder.note}</p>
        )}
      </div>
      <p className="popup-instruction">
        Take a moment to acknowledge this reminder.
      </p>
      <button
        className={`hold-button ${holding ? "holding" : ""}`}
        disabled={!item}
        onPointerDown={(event) => void begin(event)}
        onPointerUp={(event) => {
          if (event.pointerId === pointer.current) cancel();
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === pointer.current) cancel();
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId === pointer.current) cancel();
        }}
        onPointerLeave={(event) => {
          if (event.pointerId === pointer.current) cancel();
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            cancel();
        }}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Hold for 5 seconds to dismiss"
      >
        <span
          className="hold-fill"
          style={{ width: `${Math.min(100, elapsed / 50)}%` }}
        />
        <span className="hold-label">
          {holding
            ? `Keep holding… ${(Math.max(0, 5000 - elapsed) / 1000).toFixed(1)}s`
            : "Hold for 5 seconds to dismiss"}
        </span>
      </button>
      <div
        className="hold-progress"
        role="progressbar"
        aria-label="Dismiss progress"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={Math.round(elapsed / 100) / 10}
      >
        <span style={{ width: `${elapsed / 50}%` }} />
      </div>
      <p className="popup-hint">Release or move away to start over.</p>
      {error && (
        <p role="alert" className="popup-error">
          {error}
        </p>
      )}
      <footer className="popup-footer">
        <span className="footer-dot" />
        {state && state.count > 1
          ? `${state.count - 1} more reminder${state.count > 2 ? "s" : ""} waiting`
          : "Return to what matters."}
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReminderPopup />);
