/**
 * Credit Manager: app state, auth, CRUD, rendering.
 * Uses Firebase when firebase-config.js has real keys; otherwise falls back to
 * localStorage "demo mode" so the app can be tested immediately.
 */
import * as fb from "./firebase-config.js";
import { evaluatePrereqs, validatePrereqs, normalizeCode } from "./parser.js";

const { auth, db, isConfigured } = fb;

/* ---------- Constants & demo data ---------- */
const TERMS = ["Fall Q 26-27", "Winter Q 26-27", "Spring Q 26-27", "Summer Q 26-27"];
const NONE = "Not Planned";
// Declared up here, before any code that renders, to avoid temporal-dead-zone errors.
const LABEL = { completed: "Completed", progress: "IN PROGRESS", available: "Available", locked: "Locked" };
const mk = (code, title, credits, description, prereqs, isMainMajor, completed, term) =>
  ({ code, title, credits, description, prereqs, isMainMajor, completed, inProgress: false, term });
const DEMO = [
  mk("CS 171", "Computer Programming I", 3, "Introduction to programming in Java.", "", true, true, NONE),
  mk("MATH 121", "Calculus I", 4, "Limits, derivatives and integrals.", "", true, false, NONE),
  mk("CS 172", "Computer Programming II", 3, "Data structures and object-oriented design.", "CS 171", true, false, TERMS[0]),
  mk("CS 265", "Advanced Programming Tools and Techniques", 3, "Unix tools, scripting and build systems.", "(CS 172 AND MATH 121) OR INFO 152", true, false, TERMS[1]),
];

/* ---------- State ---------- */
let user = null, courses = [], unsub = null, justRegistered = false, editing = null;
let view = "grid", filter = "all"; // list layout + status filter
try { view = localStorage.getItem("cm_view") === "list" ? "list" : "grid"; } catch { /* storage unavailable */ }

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const idOf = (code) => normalizeCode(code).replace(/ /g, "_");
const toEmail = (u) => { u = u.trim().toLowerCase(); return u.includes("@") ? u : `${u}@drexel.edu`; };
const byCode = (code) => courses.find((c) => c.code === code);
const localKey = () => `cm_courses_${user.uid}`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove("show"), 3500);
}
const friendly = (err) => (err.code ? err.code.replace("auth/", "").replace(/-/g, " ") : err.message);
/** Wraps an async handler so errors surface as a toast instead of failing silently. */
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (err) { console.error(err); toast(friendly(err)); } };

/* ---------- Derived data ---------- */
const doneSet = () => new Set(courses.filter((c) => c.completed).map((c) => normalizeCode(c.code)));

// "In progress" courses are NOT in doneSet(), so they never satisfy prerequisites.
function statusOf(c, done) {
  if (c.completed) return "completed";
  if (c.inProgress) return "progress";
  try { return evaluatePrereqs(c.prereqs, done) ? "available" : "locked"; }
  catch { return "locked"; } // malformed expression stays locked
}

/** Warns when a planned course's prerequisites are not met by completed or earlier-term courses. */
function termWarning(c) {
  const idx = TERMS.indexOf(c.term);
  if (c.completed || idx < 0 || !c.prereqs) return null;
  const avail = doneSet();
  courses.forEach((o) => { if (TERMS.indexOf(o.term) >= 0 && TERMS.indexOf(o.term) < idx) avail.add(normalizeCode(o.code)); });
  try { return evaluatePrereqs(c.prereqs, avail) ? null : "Prerequisite unsatisfied for this term"; }
  catch { return null; }
}

/* ---------- Persistence ---------- */
async function persist(c) {
  if (isConfigured) return fb.setDoc(fb.doc(db, "users", user.uid, "courses", idOf(c.code)), c);
  const i = courses.findIndex((x) => x.code === c.code);
  i < 0 ? courses.push(c) : (courses[i] = c);
  localStorage.setItem(localKey(), JSON.stringify(courses)); render();
}
async function destroy(code) {
  if (isConfigured) return fb.deleteDoc(fb.doc(db, "users", user.uid, "courses", idOf(code)));
  courses = courses.filter((c) => c.code !== code);
  localStorage.setItem(localKey(), JSON.stringify(courses)); render();
}
async function seedCloud() {
  const batch = fb.writeBatch(db);
  DEMO.forEach((c) => batch.set(fb.doc(db, "users", user.uid, "courses", idOf(c.code)), c));
  await batch.commit();
}

function subscribe() {
  if (!isConfigured) {
    courses = JSON.parse(localStorage.getItem(localKey()) || "null") || structuredClone(DEMO);
    return render();
  }
  // Reads are scoped strictly to users/{uid}/courses
  unsub = fb.onSnapshot(fb.collection(db, "users", user.uid, "courses"), async (snap) => {
    if (snap.empty && justRegistered) { justRegistered = false; return seedCloud().catch((e) => toast(friendly(e))); }
    courses = snap.docs.map((d) => d.data()); render();
  }, (err) => toast(friendly(err)));
}

/* ---------- Session ---------- */
function startSession(u) {
  user = u;
  $("#auth-view").hidden = true; $("#app-view").hidden = false;
  $("#username").textContent = u.name;
  subscribe();
}
function endSession() {
  unsub?.(); unsub = null; user = null; courses = [];
  $("#app-view").hidden = true; $("#auth-view").hidden = false;
}

$("#demo-note").hidden = isConfigured;
$("#auth-form").addEventListener("submit", safe(async (e) => {
  e.preventDefault();
  const name = $("#f-user").value.trim(), pass = $("#f-pass").value, mode = e.submitter?.value;
  if (!isConfigured) { // demo mode: no real auth
    localStorage.setItem("cm_user", name);
    return startSession({ uid: "local_" + name.toLowerCase(), name });
  }
  if (mode === "signup") { justRegistered = true; await fb.createUserWithEmailAndPassword(auth, toEmail(name), pass); }
  else await fb.signInWithEmailAndPassword(auth, toEmail(name), pass);
}));
$("#logout").addEventListener("click", safe(async () => {
  if (isConfigured) await fb.signOut(auth);
  else { localStorage.removeItem("cm_user"); endSession(); }
}));


/* ---------- Rendering ---------- */
/** One course as a card (grid) or a row (list); the markup is shared and CSS lays it out. */
function cardHTML(c, done, planner = false, pool = false) {
  const st = statusOf(c, done), warn = termWarning(c);
  const moves = [NONE, ...TERMS].map((t) => `<option ${t === c.term ? "selected" : ""}>${t}</option>`).join("");
  const statusBtns = c.completed
    ? `<button class="btn small" data-act="toggle">Mark not completed</button>`
    : `<button class="btn small" data-act="toggle">Mark completed</button>
       <button class="btn small ${c.inProgress ? "active" : ""}" data-act="progress">${c.inProgress ? "Remove In Progress" : "Mark as In Progress"}</button>`;
  return `<article class="card ${st}">
    <header><div class="id"><span class="code">${esc(c.code)}</span><span class="title">${esc(c.title)}</span></div>
      <span class="badge ${st}">${LABEL[st]}</span></header>
    <div class="meta"><span>${esc(c.credits)} credits</span>
      <span class="chip">${c.prereqs ? `Prereq: ${esc(c.prereqs)}` : "No prerequisites"}</span>
      ${pool ? `<span class="chip">${esc(c.term)}</span>` : ""}</div>
    ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ""}
    ${warn ? `<div class="warn">${warn}</div>` : ""}
    <div class="actions" data-code="${esc(c.code)}">
      ${statusBtns}
      ${planner ? `<select class="move" aria-label="Move ${esc(c.code)} to term">${moves}</select>` : ""}
      ${pool ? `<button class="btn small" data-act="edit">Edit</button><button class="btn small danger" data-act="delete">Delete</button>` : ""}
    </div></article>`;
}

/** Applies the active status filter. */
const visible = (list, done) => list.filter((c) => filter === "all" || statusOf(c, done) === filter);

/** Renders a filtered course collection in the current layout (grid or list). */
function collection(list, done, emptyMsg, pool = false) {
  const rows = visible(list, done);
  if (!rows.length) return `<p class="empty">${list.length ? "No courses match this status." : emptyMsg}</p>`;
  return `<div class="${view === "list" ? "list" : "grid"}">${rows.map((c) => cardHTML(c, done, false, pool)).join("")}</div>`;
}

function render() {
  const done = doneSet();
  const sum = (list) => list.reduce((n, c) => n + Number(c.credits || 0), 0);
  // In-progress credits are reported separately and are not double counted as "planned".
  $("#s-done").textContent = sum(courses.filter((c) => c.completed));
  $("#s-prog").textContent = sum(courses.filter((c) => !c.completed && c.inProgress));
  $("#s-plan").textContent = sum(courses.filter((c) => !c.completed && !c.inProgress && c.term !== NONE));
  $("#s-total").textContent = sum(courses);

  document.querySelectorAll(".view-btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  document.querySelectorAll(".status-filter").forEach((s) => (s.value = filter));

  $("#major-list").innerHTML = collection(courses.filter((c) => c.isMainMajor), done,
    `No major courses yet. Add one in the Course Pool and check "Part of main major".`);

  const col = (title, list) => `<section class="col"><h3>${title}<span>${sum(list)} credits</span></h3>
    ${list.map((c) => cardHTML(c, done, true)).join("") || `<p class="muted">Nothing here yet.</p>`}</section>`;
  $("#tab-plan").innerHTML = `<div class="board">
    ${col("Unplanned", courses.filter((c) => c.term === NONE && !c.completed))}
    ${TERMS.map((t) => col(t, courses.filter((c) => c.term === t))).join("")}</div>`;

  const sorted = [...courses].sort((a, b) => a.code.localeCompare(b.code));
  $("#pool-list").innerHTML = collection(sorted, done, "Your course pool is empty. Add your first course.", true);
}

/* ---------- View + filter controls (shared by Main Major and Course Pool) ---------- */
document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => {
  view = b.dataset.view;
  try { localStorage.setItem("cm_view", view); } catch { /* storage unavailable */ }
  render();
}));
document.querySelectorAll(".status-filter").forEach((s) => s.addEventListener("change", () => { filter = s.value; render(); }));

/* ---------- Tabs ---------- */
document.querySelectorAll(".tabs [role=tab]").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll(".tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", b === btn));
  document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `tab-${btn.dataset.tab}`));
}));

/* ---------- Card actions ---------- */
document.addEventListener("click", safe(async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const code = btn.closest("[data-code]").dataset.code, c = byCode(code);
  if (btn.dataset.act === "toggle") await persist({ ...c, completed: !c.completed, inProgress: false });
  if (btn.dataset.act === "progress") await persist({ ...c, inProgress: !c.inProgress, completed: false });
  if (btn.dataset.act === "edit") openDialog(c);
  if (btn.dataset.act === "delete" && confirm(`Delete ${code}?`)) await destroy(code);
}));
document.addEventListener("change", safe(async (e) => {
  if (!e.target.matches("select.move")) return;
  const c = byCode(e.target.closest("[data-code]").dataset.code);
  await persist({ ...c, term: e.target.value }); // Plan Term Info syncs to Firestore
}));

/* ---------- Course dialog ---------- */
const dlg = $("#course-dialog");
$("#c-term").innerHTML = [NONE, ...TERMS].map((t) => `<option>${t}</option>`).join("");

function openDialog(c = null) {
  editing = c;
  $("#dlg-title").textContent = c ? `Edit ${c.code}` : "Add course";
  $("#c-code").value = c?.code ?? ""; $("#c-code").readOnly = !!c;
  $("#c-title").value = c?.title ?? ""; $("#c-credits").value = c?.credits ?? 3;
  $("#c-desc").value = c?.description ?? ""; $("#c-prereq").value = c?.prereqs ?? "";
  $("#c-term").value = c?.term ?? NONE;
  $("#c-major").checked = !!c?.isMainMajor; $("#c-done").checked = !!c?.completed;
  $("#c-prog").checked = !!c?.inProgress;
  $("#c-error").hidden = true;
  dlg.showModal();
}
$("#add-course").addEventListener("click", () => openDialog());
$("#c-cancel").addEventListener("click", () => dlg.close());

$("#course-form").addEventListener("submit", safe(async (e) => {
  e.preventDefault();
  const err = $("#c-error"), code = normalizeCode($("#c-code").value), prereqs = $("#c-prereq").value.trim();
  const problem = !/^[A-Z]{2,5} \d{3}[A-Z]?$/.test(code) ? "Enter a course code like CS 265." :
    !editing && byCode(code) ? `${code} is already in your pool.` :
    validatePrereqs(prereqs) ? `Prerequisites: ${validatePrereqs(prereqs)}.` : null;
  if (problem) { err.textContent = problem; err.hidden = false; return; }
  await persist({
    code, title: $("#c-title").value.trim(), credits: Number($("#c-credits").value),
    description: $("#c-desc").value.trim(), prereqs, term: $("#c-term").value,
    isMainMajor: $("#c-major").checked, completed: $("#c-done").checked,
    inProgress: $("#c-prog").checked && !$("#c-done").checked, // completed wins
  });
  dlg.close(); toast(`Saved ${code}`);
}));

/* ---------- Startup ----------
 * Runs last on purpose: restoring a session calls render(), which needs every
 * const/function above (LABEL, visible, collection, ...) to be initialized. */
if (isConfigured) {
  fb.onAuthStateChanged(auth, (fu) => fu ? startSession({ uid: fu.uid, name: fu.email.split("@")[0] }) : endSession());
} else {
  const saved = localStorage.getItem("cm_user");
  if (saved) startSession({ uid: "local_" + saved.toLowerCase(), name: saved });
}
