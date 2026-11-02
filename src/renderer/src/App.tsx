import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { FocusIcon } from "./FocusIcon";
import {
  loadReminderState,
  reminderLoadError,
  validateReminder,
  type Reminder,
  type Repeat,
  type FormErrors,
} from "./reminderStorage";

const repeatLabels: Record<Repeat, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
};

async function readStoredReminders() {
  try {
    const state = await loadReminderState(window.reminders, localStorage);
    return { ...state, error: "" };
  } catch (error) {
    console.error("Reminder initialization failed:", error);
    return {
      reminders: [] as Reminder[],
      notificationStatus: "",
      error: reminderLoadError(error),
    };
  }
}

function displayDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function displayTime(time: string) {
  return new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
type IconName =
  | "bell"
  | "plus"
  | "sparkles"
  | "water"
  | "move"
  | "eye"
  | "leaf"
  | "close"
  | "arrow";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    sparkles: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
        <path d="M21 2v4M19 4h4" />
      </>
    ),
    water: (
      <path d="M12 3S5 10 5 15a7 7 0 0 0 14 0c0-5-7-12-7-12ZM9 15a3 3 0 0 0 3 3" />
    ),
    move: (
      <>
        <circle cx="14" cy="4" r="2" />
        <path d="m7 10 4-3 4 4 4 1M11 7l-1 7-4 6m4-6 5 1 2 6" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    leaf: <path d="M20 4C5 1 2 10 7 16c6 5 15 0 13-12ZM5 21 16 10" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const defaults: {
  title: string;
  note: string;
  icon: IconName;
  color: string;
  category: string;
}[] = [
  {
    title: "Stay hydrated",
    note: "A little water goes a long way.",
    icon: "water",
    color: "blue",
    category: "HYDRATION",
  },
  {
    title: "Take a movement break",
    note: "Stand up, stretch, and reset.",
    icon: "move",
    color: "peach",
    category: "MOVEMENT",
  },
  {
    title: "Rest your eyes",
    note: "Look away. Give your eyes a breather.",
    icon: "eye",
    color: "purple",
    category: "SCREEN BREAK",
  },
  {
    title: "Take a mindful moment",
    note: "Pause for a few slow, deep breaths.",
    icon: "leaf",
    color: "green",
    category: "MINDFULNESS",
  },
];

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [storageError, setStorageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notificationStatus, setNotificationStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  async function reloadReminders() {
    setLoading(true);
    const loaded = await readStoredReminders();
    setReminders(loaded.reminders);
    setStorageError(loaded.error);
    setNotificationStatus(loaded.notificationStatus);
    setLoading(false);
  }
  useEffect(() => {
    let mounted = true;
    void readStoredReminders().then((loaded) => {
      if (!mounted) return;
      setReminders(loaded.reminders);
      setStorageError(loaded.error);
      setNotificationStatus(loaded.notificationStatus);
      setLoading(false);
    });
    const interval = setInterval(() => {
      void window.reminders
        ?.status?.()
        .then((status) => {
          if (mounted) setNotificationStatus(status);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Reminder | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  function openForm(reminder?: Reminder) {
    setEditingId(reminder?.id ?? null);
    setTitle(reminder?.title ?? "");
    setNote(reminder?.note ?? "");
    setDate(reminder?.date ?? "");
    setTime(reminder?.time ?? "");
    setRepeat(reminder?.repeat ?? "none");
    setErrors({});
    setSaveError("");
    dialog.current?.showModal();
    titleInput.current?.focus();
  }

  async function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || loading || storageError) return;
    const draft = {
      title: title.trim(),
      note: note.trim(),
      date,
      time,
      repeat,
    };
    const validation = validateReminder(draft);
    setErrors(validation);
    setSaveError("");
    if (Object.keys(validation).length) {
      const field = Object.keys(validation)[0];
      document.getElementById(`reminder-${field}`)?.focus();
      return;
    }
    try {
      savingRef.current = true;
      setSaving(true);
      const reminder = { ...draft, id: editingId ?? crypto.randomUUID() };
      const state = await window.reminders.save(reminder);
      setReminders(state.reminders);
      setNotificationStatus(state.notificationStatus);
      setAnnouncement(editingId ? "Reminder updated." : "Reminder saved.");
      dialog.current?.close();
    } catch {
      setSaveError(
        "Could not save your reminder locally. Nothing was changed. Please try again.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function openDelete(reminder: Reminder) {
    setDeleting(reminder);
    setDeleteError("");
    deleteDialog.current?.showModal();
  }

  async function deleteReminder() {
    if (!deleting || savingRef.current) return;
    try {
      savingRef.current = true;
      setSaving(true);
      const state = await window.reminders.remove(deleting.id);
      setReminders(state.reminders);
      setAnnouncement("Reminder deleted.");
      deleteDialog.current?.close();
      setDeleting(null);
    } catch {
      setDeleteError(
        "Could not delete this reminder from local storage. Please try again.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <FocusIcon />
          </span>
          <span>
            Recenter<span className="brand-dot">.</span>
          </span>
        </div>
        <span className="header-note">
          <span className="status-dot" /> Return to what matters.
        </span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>Return to what matters.</h1>
            <p className="page-description">
              Capture the idea of returning to your values, intentions, and
              commitments throughout the day.
            </p>
          </div>
          <span className="heading-art">
            <Icon name="sparkles" size={30} />
          </span>
        </div>
        <div className="workspace">
          <section className="personal-panel" aria-labelledby="my-title">
            <div className="section-heading">
              <div>
                <div className="title-row">
                  <h2 id="my-title">My Reminders</h2>
                  <span className="count">{reminders.length}</span>
                </div>
                <p>Your thoughts, plans, and little to-dos.</p>
              </div>
              <button
                className="primary-button"
                onClick={() => openForm()}
                disabled={saving}
              >
                <Icon name="plus" size={17} /> New Reminder
              </button>
            </div>
            <div className="personal-content">
              {loading ? (
                <p className="storage-loading" role="status">
                  Loading your reminders…
                </p>
              ) : storageError ? (
                <div className="storage-error" role="alert">
                  <p>{storageError}</p>
                  <button
                    className="secondary-button"
                    onClick={() => void reloadReminders()}
                  >
                    Retry loading
                  </button>
                </div>
              ) : reminders.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <span className="orbit-dot one" />
                    <span className="orbit-dot two" />
                    <div className="mini-card">
                      <span className="mini-icon">
                        <Icon name="bell" size={30} />
                      </span>
                      <span className="mini-line" />
                      <span className="mini-line short" />
                    </div>
                    <span className="illustration-plus">
                      <Icon name="plus" size={15} />
                    </span>
                  </div>
                  <h3>A fresh start, just for you</h3>
                  <p>
                    Have something on your mind?
                    <br />
                    Give it a little space here.
                  </p>
                  <button className="text-button" onClick={() => openForm()}>
                    Create your first reminder <Icon name="arrow" size={16} />
                  </button>
                </div>
              ) : (
                <ul className="reminder-list" aria-label="My reminders">
                  {reminders.map((reminder) => (
                    <li className="personal-card" key={reminder.id}>
                      <span className="personal-card-icon">
                        <Icon name="bell" size={19} />
                      </span>
                      <div className="personal-card-body">
                        <h3>{reminder.title}</h3>
                        {reminder.note && <p>{reminder.note}</p>}
                        <p className="reminder-details">
                          <time dateTime={`${reminder.date}T${reminder.time}`}>
                            {displayDate(reminder.date)} ·{" "}
                            {displayTime(reminder.time)}
                          </time>
                          <span>{repeatLabels[reminder.repeat]}</span>
                        </p>
                        <div className="card-bottom">
                          <span className="card-tag">Personal</span>
                          <div className="card-actions">
                            <button
                              className="text-button"
                              aria-label={`Edit ${reminder.title}`}
                              onClick={() => openForm(reminder)}
                            >
                              Edit
                            </button>
                            <button
                              className="text-button delete-link"
                              aria-label={`Delete ${reminder.title}`}
                              onClick={() => openDelete(reminder)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="panel-footer" title={notificationStatus}>
              <span className="session-dot" /> Saved on this device{" "}
              <span className="footer-detail">
                ·{" "}
                {notificationStatus.startsWith(
                  "Desktop notifications are available",
                )
                  ? "Alerts while app is open"
                  : notificationStatus}
              </span>
            </div>
          </section>
          <section className="defaults-panel" aria-labelledby="defaults-title">
            <div className="default-heading">
              <span className="default-symbol">
                <Icon name="sparkles" size={19} />
              </span>
              <div>
                <h2 id="defaults-title">Default Reminders</h2>
                <p>Little nudges to take care of you.</p>
              </div>
            </div>
            <div className="default-list">
              {defaults.map((reminder) => (
                <article
                  className={`default-card ${reminder.color}`}
                  key={reminder.title}
                >
                  <span className="default-card-icon">
                    <Icon name={reminder.icon} size={22} />
                  </span>
                  <div>
                    <span className="category">{reminder.category}</span>
                    <h3>{reminder.title}</h3>
                    <p>{reminder.note}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="defaults-footnote">
              <Icon name="leaf" size={14} /> A few good habits, thoughtfully
              picked.<span>Sample reminders · Preview only</span>
            </p>
          </section>
        </div>
      </main>
      <footer className="app-footer">
        <span>Recenter</span>
        <span>Return to what matters.</span>
      </footer>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <dialog
        ref={dialog}
        aria-labelledby="dialog-title"
        className="reminder-dialog"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <form onSubmit={addReminder} noValidate>
          <div className="dialog-heading">
            <span className="dialog-icon">
              <Icon name="bell" size={23} />
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close reminder dialog"
              disabled={saving}
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2 id="dialog-title">
            {editingId ? "Edit reminder" : "New reminder"}
          </h2>
          <p className="dialog-description">
            Add it here and free up some headspace.
          </p>
          {loading && (
            <p className="form-hint" role="status">
              Loading saved reminders before saving…
            </p>
          )}
          {storageError && (
            <div className="form-error" role="alert">
              <p>{storageError}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void reloadReminders()}
              >
                Retry loading
              </button>
            </div>
          )}
          <label htmlFor="reminder-title">
            Title <span>Required</span>
          </label>
          <input
            ref={titleInput}
            id="reminder-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            required
            maxLength={100}
            placeholder="e.g. Pick up a book for the weekend"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
          />
          {errors.title && (
            <p id="title-error" className="form-error" role="alert">
              {errors.title}
            </p>
          )}
          <div className="date-time-fields">
            <div>
              <label htmlFor="reminder-date">
                Date <span>Required</span>
              </label>
              <input
                id="reminder-date"
                type="date"
                required
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setErrors((current) => ({ ...current, date: undefined }));
                }}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? "date-error" : undefined}
              />
              {errors.date && (
                <p id="date-error" className="form-error" role="alert">
                  {errors.date}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="reminder-time">
                Time <span>Required</span>
              </label>
              <input
                id="reminder-time"
                type="time"
                required
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setErrors((current) => ({ ...current, time: undefined }));
                }}
                aria-invalid={!!errors.time}
                aria-describedby={errors.time ? "time-error" : undefined}
              />
              {errors.time && (
                <p id="time-error" className="form-error" role="alert">
                  {errors.time}
                </p>
              )}
            </div>
          </div>
          <label htmlFor="reminder-repeat">Repeat</label>
          <select
            id="reminder-repeat"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value as Repeat)}
            aria-invalid={!!errors.repeat}
            aria-describedby={errors.repeat ? "repeat-error" : undefined}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          {errors.repeat && (
            <p id="repeat-error" className="form-error" role="alert">
              {errors.repeat}
            </p>
          )}
          <label htmlFor="reminder-note">
            Note <span>Optional</span>
          </label>
          <textarea
            id="reminder-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setErrors((current) => ({ ...current, note: undefined }));
            }}
            maxLength={300}
            placeholder="Any little details you’d like to keep…"
            rows={2}
            aria-invalid={!!errors.note}
            aria-describedby={errors.note ? "note-error" : undefined}
          />
          {errors.note && (
            <p id="note-error" className="form-error" role="alert">
              {errors.note}
            </p>
          )}
          <p className="form-hint">
            Saved on this device. Keep the app running for desktop alerts, even
            when minimized.
          </p>
          {saveError && (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={saving || loading || !!storageError}
            >
              {saving ? "Saving…" : "Save Reminder"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={deleteDialog}
        className="reminder-dialog delete-dialog"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <h2 id="delete-title">Delete reminder?</h2>
        <p id="delete-description" className="dialog-description">
          “{deleting?.title}” will be removed from this device.
        </p>
        {deleteError && (
          <p className="form-error" role="alert">
            {deleteError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            autoFocus
            disabled={saving}
            className="secondary-button"
            onClick={() => deleteDialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="primary-button danger-button"
            disabled={saving}
            onClick={deleteReminder}
          >
            Delete Reminder
          </button>
        </div>
      </dialog>
    </div>
  );
}
