"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const TRIP_START = "2026-08-29";
const TRIP_END = "2026-09-06";

// Rotates through these until the boys upload their own shots.
const FALLBACK_BG = [
  "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1800&q=60",
  "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1800&q=60",
  "https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1800&q=60",
  "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?auto=format&fit=crop&w=1800&q=60",
  "https://images.unsplash.com/photo-1480796927426-f609979314bd?auto=format&fit=crop&w=1800&q=60",
  "https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?auto=format&fit=crop&w=1800&q=60",
];

const fmtDay = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const fmtTime = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const tokyoToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

function allPhotos(state) {
  const out = [];
  for (const p of state.generalPhotos || []) out.push({ ...p, item: null, itemId: "general" });
  for (const day of state.days)
    for (const item of [...day.items, ...(day.fixed || [])])
      for (const p of item.photos || []) out.push({ ...p, item: item.name, itemId: item.id });
  out.sort((a, b) => (a.at < b.at ? 1 : -1));
  return out;
}

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1100px)");
    const f = () => setWide(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return wide;
}

export default function Page() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("itinerary");
  const [openDay, setOpenDay] = useState(null);
  const [selected, setSelected] = useState(null); // item or fixed id
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [myName, setMyName] = useState("");

  useEffect(() => {
    setMyName(localStorage.getItem("wt_name") || "");
    const today = tokyoToday();
    if (today >= TRIP_START && today <= TRIP_END) setOpenDay(today);
    fetch("/api/state")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setToast("Couldn't load — refresh?"));
  }, []);

  const say = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const act = async (payload, okMsg) => {
    setBusy(true);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      if (j.state) setData((d) => ({ ...d, state: j.state }));
      if (okMsg) say(okMsg);
      return true;
    } catch (e) {
      say(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rememberName = (name) => {
    const n = (name || "").trim().slice(0, 40);
    if (n) {
      setMyName(n);
      localStorage.setItem("wt_name", n);
    }
    return n;
  };

  const upload = async (file, itemId) => {
    if (!file) return false;
    let name = myName;
    if (!name) name = rememberName(prompt("Who's uploading? (shown on the photo)"));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("itemId", itemId);
      fd.append("by", name || "someone");
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setData((d) => ({ ...d, state: j.state }));
      say("Photo up! 📷");
      return true;
    } catch (e) {
      say(e.message);
      return false;
    }
  };

  if (!data)
    return (
      <>
        <div className="bg" />
        <div className="spin">Loading the plan…</div>
      </>
    );

  if (!data.access) return <Gate onIn={setData} />;

  const { role, state } = data;
  const photos = allPhotos(state);
  const pendingCount = state.ideas.filter((i) => i.status === "pending").length;

  return (
    <>
      <Background photos={photos} />
      <div className="wrap">
        <header className="hero glass">
          <div className="chips top">
            <JapanClock />
            <Weather />
            <TripPhase />
          </div>
          <h1>
            Boys Weeb Trip <span className="grad">2026</span>
          </h1>
          <p className="tag">Tokyo · Aug 29 – Sep 6 · flexible by design — only 🔒 items are time-locked</p>
          <RoleBar role={role} onChange={setData} say={say} />
        </header>

        <nav className="tabs glass">
          <button className={tab === "itinerary" ? "active" : ""} onClick={() => setTab("itinerary")}>
            Itinerary
          </button>
          <button className={tab === "ideas" ? "active" : ""} onClick={() => setTab("ideas")}>
            Ideas{pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </button>
          <button className={tab === "photos" ? "active" : ""} onClick={() => setTab("photos")}>
            Photos{photos.length > 0 && <span className="count">{photos.length}</span>}
          </button>
        </nav>

        {tab === "itinerary" && (
          <Itinerary
            state={state}
            role={role}
            openDay={openDay}
            setOpenDay={setOpenDay}
            selected={selected}
            setSelected={setSelected}
            act={act}
            busy={busy}
            upload={upload}
            myName={myName}
            photosTotal={photos.length}
            pendingCount={pendingCount}
          />
        )}
        {tab === "ideas" && (
          <Ideas state={state} role={role} act={act} busy={busy} myName={myName} rememberName={rememberName} />
        )}
        {tab === "photos" && <Gallery photos={photos} role={role} act={act} upload={upload} state={state} />}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}

/* ---------- gate ---------- */

function Gate({ onIn }) {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pass.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pass }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "That's not it.");
        return;
      }
      const s = await fetch("/api/state").then((x) => x.json());
      onIn(s);
    } catch {
      setErr("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Background photos={[]} />
      <div className="gateWrap">
        <div className="gateCard glass">
          <div className="gateMark">🗼</div>
          <h1>Boys Weeb Trip <span className="grad">2026</span></h1>
          <p className="hint">Private trip. Enter the word to come in.</p>
          <div className="field" style={{ margin: "16px 0 8px" }}>
            <input
              type="password"
              placeholder="Password"
              value={pass}
              autoFocus
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {err && <div className="gateErr">{err}</div>}
          <button className="small primary" style={{ width: "100%", marginTop: 6 }} disabled={busy} onClick={submit}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- ambient bits ---------- */

function Background({ photos }) {
  // One random photo per page load — no rotation.
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const urls = photos.length > 0 ? photos.map((p) => p.url) : FALLBACK_BG;
    setUrl(urls[Math.floor(Math.random() * urls.length)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg">
      {url && <div className="layer on" style={{ backgroundImage: `url(${url})` }} />}
    </div>
  );
}

function JapanClock() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="chip clock">🇯🇵 …</span>;
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);
  return (
    <span className="chip clock">
      🇯🇵 {time} <span className="dim">· {date}</span>
    </span>
  );
}

const WMO = [
  [[0], "☀️", "clear"],
  [[1, 2], "🌤️", "partly cloudy"],
  [[3], "☁️", "overcast"],
  [[45, 48], "🌫️", "foggy"],
  [[51, 53, 55, 56, 57], "🌦️", "drizzle"],
  [[61, 63, 65, 66, 67], "🌧️", "rain"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "snow"],
  [[80, 81, 82], "🌧️", "showers"],
  [[95, 96, 99], "⛈️", "thunderstorms"],
];
const wmo = (code) => WMO.find(([codes]) => codes.includes(code)) || [[], "🌡️", ""];

function Weather() {
  const [wx, setWx] = useState(null);
  useEffect(() => {
    const load = () =>
      fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=Asia%2FTokyo"
      )
        .then((r) => r.json())
        .then(setWx)
        .catch(() => {});
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  if (!wx?.current) return null;
  const c = wx.current.temperature_2m;
  const f = Math.round((c * 9) / 5 + 32);
  const [, icon, label] = wmo(wx.current.weather_code);
  const rain = wx.daily?.precipitation_probability_max?.[0];
  return (
    <span className="chip" title={`Tokyo: ${label}`}>
      {icon} {Math.round(c)}°C <span className="dim">/ {f}°F</span>
      {rain != null && rain > 20 && <span className="dim">· ☔ {rain}%</span>}
    </span>
  );
}

function TripPhase() {
  const [today, setToday] = useState(null);
  useEffect(() => {
    setToday(tokyoToday());
    const t = setInterval(() => setToday(tokyoToday()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  if (!today) return null;
  if (today < TRIP_START) {
    const days = Math.ceil(
      (new Date(TRIP_START + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000
    );
    return <span className="chip phase">🚀 {days} day{days === 1 ? "" : "s"} to go</span>;
  }
  if (today <= TRIP_END) {
    const n =
      Math.round(
        (new Date(today + "T00:00:00") - new Date(TRIP_START + "T00:00:00")) / 86400000
      ) + 1;
    return <span className="chip phase">🗼 Day {n} in Tokyo</span>;
  }
  return <span className="chip phase">🥲 that was the one</span>;
}

/* ---------- auth ---------- */

function RoleBar({ role, onChange, say }) {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);

  const login = async () => {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const j = await r.json();
    if (!r.ok) return say(j.error || "Wrong PIN");
    const s = await fetch("/api/state").then((x) => x.json());
    onChange(s);
    setShowPin(false);
    setPin("");
    say(j.role === "admin" ? "Welcome back, boss 🫡" : "Crew mode unlocked 📸");
  };

  const logout = async () => {
    await fetch("/api/login", { method: "DELETE" });
    const s = await fetch("/api/state").then((x) => x.json());
    onChange(s);
  };

  return (
    <div className="rolebar">
      <span className={`badge ${role}`}>
        {role === "admin" ? "👑 admin" : role === "crew" ? "📸 crew" : "👀 viewing"}
      </span>
      {role === "viewer" && !showPin && (
        <button className="small ghost" onClick={() => setShowPin(true)}>
          Have a PIN?
        </button>
      )}
      {role !== "viewer" && (
        <button className="small ghost" onClick={logout}>
          Log out
        </button>
      )}
      {showPin && (
        <div className="pinRow">
          <input
            type="password"
            placeholder="PIN"
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
          <button className="small primary" onClick={login}>
            Enter
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- itinerary ---------- */

function findSelected(state, id) {
  if (!id) return null;
  for (const day of state.days) {
    const item = day.items.find((i) => i.id === id);
    if (item) return { kind: "item", day, obj: item };
    const fixed = day.fixed.find((f) => f.id === id);
    if (fixed) return { kind: "fixed", day, obj: fixed };
  }
  return null;
}

function Itinerary(props) {
  const wide = useWide();
  const [hideDone, setHideDone] = useState(false);
  useEffect(() => {
    setHideDone(localStorage.getItem("wt_hideDone") === "1");
  }, []);
  const toggleHideDone = () =>
    setHideDone((h) => {
      localStorage.setItem("wt_hideDone", h ? "0" : "1");
      return !h;
    });

  const canCheck = ["crew", "admin"].includes(props.role);
  const toggleDone = (id) => props.act({ type: "toggleDone", id, by: props.myName });
  const doneCount = props.state.days.reduce(
    (n, d) =>
      n + d.items.filter((i) => i.done).length + d.fixed.filter((f) => f.done).length,
    0
  );

  const shared = { ...props, canCheck, toggleDone, hideDone };
  return (
    <>
      {doneCount > 0 && (
        <div className="chips" style={{ marginTop: 14 }}>
          <button className={`chip filter ${hideDone ? "on" : ""}`} onClick={toggleHideDone}>
            ✓ {doneCount} done {hideDone ? "· hidden" : "· shown"}
          </button>
        </div>
      )}
      {wide ? <SplitItinerary {...shared} /> : <MobileItinerary {...shared} />}
    </>
  );
}

function SplitItinerary({
  state, role, selected, setSelected, act, busy, upload,
  photosTotal, pendingCount, canCheck, toggleDone, hideDone,
}) {
  const today = tokyoToday();
  const sel = findSelected(state, selected);
  const [showCompleted, setShowCompleted] = useState(false);

  const Check = ({ obj }) =>
    canCheck ? (
      <span
        className={`doneBtn ${obj.done ? "on" : ""}`}
        title={obj.done ? `Done — ${obj.done.by}` : "Mark done"}
        onClick={(e) => {
          e.stopPropagation();
          toggleDone(obj.id);
        }}
      >
        ✓
      </span>
    ) : obj.done ? (
      <span className="doneBtn on static">✓</span>
    ) : null;

  const renderDay = (day) => {
    const isToday = day.date === today;
    const fixed = hideDone ? day.fixed.filter((f) => !f.done) : day.fixed;
    const items = hideDone ? day.items.filter((i) => !i.done) : day.items;
    return (
      <section className="day glass" key={day.date}>
        <div className="head static">
          <h2>{day.title}</h2>
          <span className="date">
            {isToday && <span className="today">TODAY</span>}
            {fmtDay(day.date)}
          </span>
        </div>
        {day.subtitle && <p className="subtitle">{day.subtitle}</p>}
        <div className="body">
          {fixed.map((f) => (
            <button
              key={f.id}
              className={`itemRow fixedRow ${selected === f.id ? "sel" : ""} ${f.done ? "done" : ""}`}
              onClick={() => setSelected(selected === f.id ? null : f.id)}
            >
              <span className="nm">{f.name}</span>
              <span className="rmeta">
                {f.photos?.length > 0 && `📷 ${f.photos.length} `}
                <span className="t">🔒 {f.time}</span> <Check obj={f} />
              </span>
            </button>
          ))}
          {items.map((item) => (
            <button
              key={item.id}
              className={`itemRow ${selected === item.id ? "sel" : ""} ${item.done ? "done" : ""}`}
              onClick={() => setSelected(selected === item.id ? null : item.id)}
            >
              <span className="nm">{item.name}</span>
              <span className="rmeta">
                {item.suggestedBy && "💡 "}
                {item.photos?.length > 0 && `📷 ${item.photos.length} `}
                <Check obj={item} />
              </span>
            </button>
          ))}
          {items.length === 0 && fixed.length === 0 && (
            <div className="empty">
              {hideDone && (day.items.length || day.fixed.length)
                ? "All done here ✓"
                : "Nothing planned — suggest something!"}
            </div>
          )}
          {role === "admin" && <AddItem day={day} act={act} busy={busy} />}
        </div>
      </section>
    );
  };

  const activeDays = state.days.filter((d) => d.date >= today);
  const completedDays = state.days.filter((d) => d.date < today);

  return (
    <div className="split">
      <div className="listCol">
        {activeDays.map(renderDay)}
        {completedDays.length > 0 && (
          <>
            <button className="completedToggle" onClick={() => setShowCompleted((s) => !s)}>
              ✓ Completed · {completedDays.length} day{completedDays.length === 1 ? "" : "s"}
              <span>{showCompleted ? "▾" : "▸"}</span>
            </button>
            {showCompleted && completedDays.map(renderDay)}
          </>
        )}
      </div>

      <aside className="detailPanel glass">
        {!sel && (
          <div className="placeholder">
            <div className="big">🗼</div>
            <p>Pick anything on the left to see the details, photos, and links here.</p>
            <div className="statsRow">
              <span className="chip">{state.days.length} days</span>
              <span className="chip">
                {state.days.reduce((n, d) => n + d.items.length + d.fixed.length, 0)} stops
              </span>
              <span className="chip">📷 {photosTotal}</span>
              {pendingCount > 0 && <span className="chip">💡 {pendingCount} pending</span>}
            </div>
          </div>
        )}
        {sel && (
          <ItemDetail
            key={sel.obj.id}
            sel={sel}
            role={role}
            act={act}
            busy={busy}
            upload={upload}
            canCheck={canCheck}
            toggleDone={toggleDone}
            onDeleted={() => setSelected(null)}
          />
        )}
      </aside>
    </div>
  );
}

function EditItemForm({ obj, act, busy, onClose }) {
  const [name, setName] = useState(obj.name);
  const [note, setNote] = useState(obj.note || "");
  const [mapUrl, setMapUrl] = useState(obj.mapUrl || "");
  return (
    <div className="card glass" style={{ margin: "12px 0 0" }}>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Note</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="field">
        <label>Map link</label>
        <input type="text" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} placeholder="https://maps.google.com/…" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="small primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            const ok = await act({ type: "editItem", id: obj.id, name, note, mapUrl }, "Saved ✏️");
            if (ok) onClose();
          }}
        >
          Save
        </button>
        <button className="small ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function ItemDetail({ sel, role, act, busy, upload, canCheck, toggleDone, onDeleted }) {
  const { kind, day, obj } = sel;
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const canUpload = ["crew", "admin"].includes(role);

  return (
    <div>
      <div className="dayLabel">
        {day.title} · {fmtDay(day.date)}
      </div>
      <h2>{obj.done ? <s>{obj.name}</s> : obj.name}</h2>
      {kind === "fixed" && <div className="time">🔒 {obj.time}</div>}
      {obj.done && (
        <div className="from" style={{ color: "var(--green)" }}>
          ✓ done — {obj.done.by}, {fmtTime(obj.done.at)}
        </div>
      )}
      {obj.note && <p className="note">{obj.note}</p>}
      {obj.suggestedBy && <div className="from">💡 suggested by {obj.suggestedBy}</div>}
      {obj.mapUrl && (
        <div className="links">
          <a href={obj.mapUrl} target="_blank" rel="noreferrer">📍 Open in Maps</a>
        </div>
      )}
      {(canUpload || role === "admin") && (
        <div className="links">
          {canUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  setUploading(true);
                  await upload(e.target.files?.[0], obj.id);
                  setUploading(false);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button className="small" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "＋ Add photo"}
              </button>
            </>
          )}
          {role === "admin" && (
            <button className="small" disabled={busy} onClick={() => setEditing((e) => !e)}>
              ✏️ Edit
            </button>
          )}
        </div>
      )}
      {(canCheck || (kind === "item" && role === "admin")) && (
        <div className="links">
          {canCheck && (
            <button
              className={`small ${obj.done ? "" : "approve"}`}
              disabled={busy}
              onClick={() => toggleDone(obj.id)}
            >
              {obj.done ? "↩ Not done" : "✓ Mark done"}
            </button>
          )}
          {kind === "item" && role === "admin" && (
            <button
              className="small reject"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Remove "${obj.name}" from ${fmtDay(day.date)}?`)) return;
                const ok = await act({ type: "deleteItem", date: day.date, id: obj.id }, "Removed");
                if (ok) onDeleted();
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {editing && <EditItemForm obj={obj} act={act} busy={busy} onClose={() => setEditing(false)} />}
      {obj.photos?.length > 0 && (
        <div className="photoGrid">
          {obj.photos.map((p) => (
            <div className="ph" key={p.url}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={`${obj.name} by ${p.by}`} loading="lazy" />
              </a>
              <span className="who">{p.by}</span>
              {role === "admin" && (
                <button
                  className="del"
                  onClick={() =>
                    confirm("Delete this photo?") &&
                    act({ type: "deletePhoto", itemId: obj.id, url: p.url }, "Photo deleted")
                  }
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileItinerary({
  state, role, openDay, setOpenDay, selected, setSelected, act, busy, upload,
  canCheck, toggleDone, hideDone,
}) {
  const today = tokyoToday();
  const [showCompleted, setShowCompleted] = useState(false);

  const renderDay = (day) => {
    const open = openDay === day.date;
    const isToday = day.date === today;
    const nPhotos = day.items.reduce((n, i) => n + (i.photos?.length || 0), 0);
    const fixed = hideDone ? day.fixed.filter((f) => !f.done) : day.fixed;
    const items = hideDone ? day.items.filter((i) => !i.done) : day.items;
    return (
      <section className="day glass" key={day.date}>
        <div className="head" onClick={() => setOpenDay(open ? null : day.date)}>
          <h2>{day.title}</h2>
          <span className="date">
            {isToday && <span className="today">TODAY</span>}
            {fmtDay(day.date)} {nPhotos > 0 && `· 📷 ${nPhotos}`} {open ? "▾" : "▸"}
          </span>
        </div>
        {open && (
          <>
            {day.subtitle && <p className="subtitle">{day.subtitle}</p>}
            <div className="body">
              {fixed.map((f) => (
                <MobileFixedCard
                  key={f.id}
                  f={f}
                  role={role}
                  busy={busy}
                  upload={upload}
                  act={act}
                  canCheck={canCheck}
                  toggleDone={toggleDone}
                />
              ))}
              {items.map((item) => (
                <MobileItemCard
                  key={item.id}
                  day={day}
                  item={item}
                  role={role}
                  open={selected === item.id}
                  toggle={() => setSelected(selected === item.id ? null : item.id)}
                  act={act}
                  busy={busy}
                  upload={upload}
                  canCheck={canCheck}
                  toggleDone={toggleDone}
                />
              ))}
              {items.length === 0 && fixed.length === 0 && (
                <div className="empty">
                  {hideDone && (day.items.length || day.fixed.length)
                    ? "All done here ✓"
                    : "Nothing planned — suggest something!"}
                </div>
              )}
              {role === "admin" && <AddItem day={day} act={act} busy={busy} />}
            </div>
          </>
        )}
      </section>
    );
  };

  const activeDays = state.days.filter((d) => d.date >= today);
  const completedDays = state.days.filter((d) => d.date < today);

  return (
    <>
      {activeDays.map(renderDay)}
      {completedDays.length > 0 && (
        <>
          <button className="completedToggle" onClick={() => setShowCompleted((s) => !s)}>
            ✓ Completed · {completedDays.length} day{completedDays.length === 1 ? "" : "s"}
            <span>{showCompleted ? "▾" : "▸"}</span>
          </button>
          {showCompleted && completedDays.map(renderDay)}
        </>
      )}
    </>
  );
}

function MobileFixedCard({ f, role, busy, upload, act, canCheck, toggleDone }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const canUpload = ["crew", "admin"].includes(role);

  return (
    <div className={`fixedItem ${f.done ? "done" : ""}`}>
      <span className="time">🔒 {f.time}</span>
      <h3>{f.done ? <s>{f.name}</s> : f.name}</h3>
      {f.done && (
        <div className="from" style={{ color: "var(--green)", margin: "6px 0" }}>
          ✓ done — {f.done.by}, {fmtTime(f.done.at)}
        </div>
      )}
      <p>{f.note}</p>
      {f.mapUrl && (
        <div className="links" style={{ marginTop: 8 }}>
          <a href={f.mapUrl} target="_blank" rel="noreferrer">📍 Map</a>
        </div>
      )}
      {(canUpload || role === "admin") && (
        <div className="links">
          {canUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  setUploading(true);
                  await upload(e.target.files?.[0], f.id);
                  setUploading(false);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              />
              <button className="small" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "＋ Add photo"}
              </button>
            </>
          )}
          {role === "admin" && (
            <button className="small" disabled={busy} onClick={() => setEditing((e) => !e)}>
              ✏️ Edit
            </button>
          )}
        </div>
      )}
      {canCheck && (
        <div className="links">
          <button className={`small ${f.done ? "" : "approve"}`} disabled={busy} onClick={() => toggleDone(f.id)}>
            {f.done ? "↩ Not done" : "✓ Mark done"}
          </button>
        </div>
      )}
      {editing && <EditItemForm obj={f} act={act} busy={busy} onClose={() => setEditing(false)} />}
      {f.photos?.length > 0 && (
        <div className="photoGrid">
          {f.photos.map((p) => (
            <div className="ph" key={p.url}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={`${f.name} by ${p.by}`} loading="lazy" />
              </a>
              <span className="who">{p.by}</span>
              {role === "admin" && (
                <button
                  className="del"
                  onClick={() =>
                    confirm("Delete this photo?") &&
                    act({ type: "deletePhoto", itemId: f.id, url: p.url }, "Photo deleted")
                  }
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileItemCard({ day, item, role, open, toggle, act, busy, upload, canCheck, toggleDone }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const canUpload = ["crew", "admin"].includes(role);

  return (
    <div className={`item ${item.done ? "done" : ""}`}>
      <div className="titleRow" onClick={toggle}>
        <h3>{item.done ? <s>{item.name}</s> : item.name}</h3>
        <span className="meta">
          {item.done && "✓ "}
          {item.photos?.length > 0 && `📷 ${item.photos.length} `}
          {open ? "▾" : "▸"}
        </span>
      </div>
      {open && (
        <>
          {item.done && (
            <div className="from" style={{ color: "var(--green)", marginTop: 8 }}>
              ✓ done — {item.done.by}, {fmtTime(item.done.at)}
            </div>
          )}
          {item.note && <p className="note">{item.note}</p>}
          {item.suggestedBy && <div className="from">💡 suggested by {item.suggestedBy}</div>}
          {item.mapUrl && (
            <div className="links">
              <a href={item.mapUrl} target="_blank" rel="noreferrer">📍 Map</a>
            </div>
          )}
          {(canUpload || role === "admin") && (
            <div className="links">
              {canUpload && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      setUploading(true);
                      await upload(e.target.files?.[0], item.id);
                      setUploading(false);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                  <button className="small" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? "Uploading…" : "＋ Add photo"}
                  </button>
                </>
              )}
              {role === "admin" && (
                <button className="small" disabled={busy} onClick={() => setEditing((e) => !e)}>
                  ✏️ Edit
                </button>
              )}
            </div>
          )}
          {(canCheck || role === "admin") && (
            <div className="links">
              {canCheck && (
                <button className={`small ${item.done ? "" : "approve"}`} disabled={busy} onClick={() => toggleDone(item.id)}>
                  {item.done ? "↩ Not done" : "✓ Mark done"}
                </button>
              )}
              {role === "admin" && (
                <button
                  className="small reject"
                  disabled={busy}
                  onClick={() =>
                    confirm(`Remove "${item.name}" from ${fmtDay(day.date)}?`) &&
                    act({ type: "deleteItem", date: day.date, id: item.id }, "Removed")
                  }
                >
                  Remove
                </button>
              )}
            </div>
          )}
          {editing && <EditItemForm obj={item} act={act} busy={busy} onClose={() => setEditing(false)} />}
          {item.photos?.length > 0 && (
            <div className="photoGrid">
              {item.photos.map((p) => (
                <div className="ph" key={p.url}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt={`${item.name} by ${p.by}`} loading="lazy" />
                  </a>
                  <span className="who">{p.by}</span>
                  {role === "admin" && (
                    <button
                      className="del"
                      onClick={() =>
                        confirm("Delete this photo?") &&
                        act({ type: "deletePhoto", itemId: item.id, url: p.url }, "Photo deleted")
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddItem({ day, act, busy }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [mapUrl, setMapUrl] = useState("");

  if (!show)
    return (
      <button className="small" style={{ marginTop: 8 }} onClick={() => setShow(true)}>
        ＋ Add item (admin)
      </button>
    );

  return (
    <div className="card glass" style={{ margin: "8px 0 0" }}>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Note (optional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="field">
        <label>Map link (optional)</label>
        <input type="text" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} placeholder="https://maps.google.com/…" />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="small primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            const ok = await act({ type: "addItem", date: day.date, name, note, mapUrl }, "Added to the day");
            if (ok) {
              setName(""); setNote(""); setMapUrl(""); setShow(false);
            }
          }}
        >
          Add
        </button>
        <button className="small ghost" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- ideas ---------- */

function Ideas({ state, role, act, busy, myName, rememberName }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState(myName);
  const [suggestedDay, setSuggestedDay] = useState("");
  const [hp, setHp] = useState("");
  const [dayPick, setDayPick] = useState({});

  const pending = state.ideas.filter((i) => i.status === "pending");
  const awaiting = state.ideas.filter((i) => i.status === "approved" && !i.approvedDay);
  const adopted = state.ideas.filter((i) => i.status === "approved" && i.approvedDay);
  const rejected = state.ideas.filter((i) => i.status === "rejected");

  return (
    <>
      <div className="card glass">
        <h2>💡 Suggest something</h2>
        <p className="hint">Anyone can pitch an idea. Ben approves and slots it into a day.</p>
        <div className="field">
          <label>What's the idea?</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kirby Café reservation" />
        </div>
        <div className="field">
          <label>Details (why / where / link)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field">
          <label>Your name</label>
          <input type="text" value={by} onChange={(e) => setBy(e.target.value)} placeholder="Aaron? Alex? A mysterious stranger?" />
        </div>
        <div className="field">
          <label>Day it'd fit best (optional)</label>
          <select value={suggestedDay} onChange={(e) => setSuggestedDay(e.target.value)}>
            <option value="">No preference</option>
            {state.days.map((d) => (
              <option key={d.date} value={d.date}>
                {fmtDay(d.date)} — {d.title}
              </option>
            ))}
          </select>
        </div>
        <input className="hp" type="text" value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <button
          className="small primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            const ok = await act(
              { type: "submitIdea", name, note, by, suggestedDay, website: hp },
              "Idea submitted — pending Ben's blessing 🙏"
            );
            if (ok) {
              rememberName(by);
              setName(""); setNote(""); setSuggestedDay("");
            }
          }}
        >
          Submit idea
        </button>
      </div>

      <div className="card glass">
        <h2>
          Pending <span className="statusTag pending">{pending.length}</span>
        </h2>
        {pending.length === 0 && <div className="empty">Queue's clear.</div>}
        {pending.map((idea) => (
          <div className="idea" key={idea.id}>
            <h3>{idea.name}</h3>
            <span className="by">
              by {idea.by} · {fmtTime(idea.createdAt)}
              {idea.suggestedDay && ` · wants ${fmtDay(idea.suggestedDay)}`}
            </span>
            {idea.note && <p>{idea.note}</p>}
            {role === "admin" && (
              <div className="controls">
                <select
                  value={dayPick[idea.id] ?? idea.suggestedDay ?? ""}
                  onChange={(e) => setDayPick((s) => ({ ...s, [idea.id]: e.target.value }))}
                >
                  <option value="">Pick a day…</option>
                  {state.days.map((d) => (
                    <option key={d.date} value={d.date}>
                      {fmtDay(d.date)} — {d.title}
                    </option>
                  ))}
                </select>
                <button
                  className="small approve"
                  disabled={busy || !(dayPick[idea.id] ?? idea.suggestedDay)}
                  onClick={() =>
                    act(
                      { type: "approveIdea", id: idea.id, date: dayPick[idea.id] ?? idea.suggestedDay },
                      "Approved ✅ — added to the itinerary"
                    )
                  }
                >
                  Approve
                </button>
                <button
                  className="small approve"
                  disabled={busy}
                  onClick={() =>
                    act(
                      { type: "approveIdea", id: idea.id },
                      "Approved ✅ — Claude will slot it into the schedule"
                    )
                  }
                >
                  ✨ Approve, Claude slots it
                </button>
                <button className="small reject" disabled={busy} onClick={() => act({ type: "rejectIdea", id: idea.id }, "Rejected")}>
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {awaiting.length > 0 && (
        <div className="card glass">
          <h2>
            ✨ Awaiting schedule <span className="statusTag approved">{awaiting.length}</span>
          </h2>
          <p className="hint">Approved — Claude works these into the remaining days on the next sync.</p>
          {awaiting.map((idea) => (
            <div className="idea approved" key={idea.id}>
              <h3>{idea.name}</h3>
              <span className="by">by {idea.by}</span>
              {idea.note && <p>{idea.note}</p>}
              {role === "admin" && (
                <div className="controls">
                  <select
                    value={dayPick[idea.id] ?? ""}
                    onChange={(e) => setDayPick((s) => ({ ...s, [idea.id]: e.target.value }))}
                  >
                    <option value="">Slot manually…</option>
                    {state.days.map((d) => (
                      <option key={d.date} value={d.date}>
                        {fmtDay(d.date)} — {d.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="small approve"
                    disabled={busy || !dayPick[idea.id]}
                    onClick={() =>
                      act(
                        { type: "scheduleIdea", id: idea.id, date: dayPick[idea.id] },
                        "Slotted into the itinerary 📅"
                      )
                    }
                  >
                    Slot
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {adopted.length > 0 && (
        <div className="card glass">
          <h2>
            ✅ Adopted <span className="statusTag approved">{adopted.length}</span>
          </h2>
          <p className="hint">Suggestions that made it onto the itinerary.</p>
          {adopted.map((idea) => (
            <div className="idea approved" key={idea.id}>
              <h3>{idea.name}</h3>
              <span className="by">
                by {idea.by}
                {idea.approvedDay && ` → ${fmtDay(idea.approvedDay)}`}
              </span>
              {idea.note && <p>{idea.note}</p>}
            </div>
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <div className="card glass">
          <h2>
            Not this time <span className="statusTag rejected">{rejected.length}</span>
          </h2>
          {rejected.slice(0, 20).map((idea) => (
            <div className="idea rejected" key={idea.id}>
              <h3>
                {idea.name}
                <span className="statusTag rejected">rejected</span>
              </h3>
              <span className="by">by {idea.by}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- photos ---------- */

function Gallery({ photos, role, act, upload, state }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const canUpload = ["crew", "admin"].includes(role);
  const canAssign = ["crew", "admin"].includes(role);

  return (
    <>
      <div className="card glass">
        <h2>📷 Trip photos</h2>
        <p className="hint">
          {photos.length === 0
            ? "Nothing here yet — every photo uploaded shows up here, and rotates through the background."
            : "Every photo from the trip — item shots and everything in between."}
        </p>
        {canUpload && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={async (e) => {
                setUploading(true);
                await upload(e.target.files?.[0], "general");
                setUploading(false);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button className="small primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? "Uploading…" : "＋ Add a trip photo"}
            </button>
          </>
        )}
        {!canUpload && role === "viewer" && (
          <p className="hint" style={{ margin: 0 }}>Crew can upload with the PIN (top of page).</p>
        )}
      </div>

      {photos.length > 0 && (
        <div className="gallery">
          {photos.map((p) => (
            <figure key={p.url}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={p.item || "trip photo"} loading="lazy" />
              </a>
              {role === "admin" && (
                <button
                  className="del"
                  onClick={() =>
                    confirm("Delete this photo?") &&
                    act({ type: "deletePhoto", itemId: p.itemId, url: p.url }, "Photo deleted")
                  }
                >
                  ✕
                </button>
              )}
              <figcaption>
                {p.item ? `${p.item} — ` : ""}{p.by}, {fmtTime(p.at)}
              </figcaption>
              {canAssign && (
                <select
                  className="assignSel"
                  value={p.itemId}
                  onChange={(e) => {
                    const to = e.target.value;
                    if (to !== p.itemId) act({ type: "movePhoto", url: p.url, toItemId: to }, "Photo reassigned 📌");
                  }}
                >
                  <option value="general">📍 General (no activity)</option>
                  {state.days.map((d) => {
                    const opts = [...d.fixed, ...d.items];
                    if (opts.length === 0) return null;
                    return (
                      <optgroup key={d.date} label={fmtDay(d.date)}>
                        {opts.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              )}
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
