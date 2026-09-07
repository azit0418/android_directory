import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Phone, Plus, X, ChevronLeft, ChevronRight, Pencil, Trash2,
  GraduationCap, Users, SlidersHorizontal, Check, CalendarCheck2,
  Banknote, Settings2, CircleCheck, CircleX, Wallet, RefreshCw, AlertTriangle,
  Download, FileStack, Printer, Inbox, ClipboardList,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import NepaliDate from "nepali-date-converter";
import { safeGet, safeSet } from "./services/storage";
import {
  isConfigured,
  fetchStudents, addStudentRemote, updateStudentRemote, deleteStudentRemote,
  fetchAttendance, saveAttendanceDayRemote,
  fetchBilling, setDefaultFeeRemote,
  addBillRemote, updateBillRemote, deleteBillRemote,
  addPaymentRemote, updatePaymentRemote, deletePaymentRemote,
  addExpenseRemote, updateExpenseRemote, deleteExpenseRemote,
  addPaymentRequestRemote, decidePaymentRequestRemote,
  generateBillsRemote,
} from "./services/dataService";
import {
  loginAdmin as loginAdminService,
  registerStaff as registerStaffService,
  loginStaff as loginStaffService,
  listStaffUsers,
  removeStaffUser as removeStaffUserService,
  loadSession, validateSession, logout as logoutService,
} from "./services/authService";

/* =========================================================================
   Data handling (dataService.js) and authentication (authService.js) now
   live in their own files under ./services — see those for the Apps
   Script URL, sheet setup, and login/session logic. This file is UI only.
   ========================================================================= */
const ATTENDANCE_MONTH_LABEL = "Bhadra 2083 B.S."; // matches the Sheet currently wired up
const SCHOOL_PHONE = "+977-000-0000000"; // update with your school's real contact number

const FONT = "'Source Sans 3', 'Segoe UI', sans-serif";

const EXPENSE_CATEGORIES = ["Teacher", "Staff", "Goods/HR"];
const RANGE_LABELS = { today: "Today", "7d": "Last 7 days", month: "This month", all: "All time" };

const TEACHER_FIELDS = [
  { key: "name", label: "Full name", required: true },
  { key: "teacherId", label: "Staff ID" },
  { key: "subject", label: "Subject(s) taught" },
  { key: "gender", label: "Gender" },
  { key: "qualification", label: "Qualification" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone", isPhone: true },
  { key: "email", label: "Email" },
];

const STUDENT_FIELDS = [
  { key: "Name", label: "Full name", required: true },
  { key: "StudentID", label: "Student ID" },
  { key: "Gender", label: "Gender" },
  { key: "Class", label: "Class" },
  { key: "Section", label: "Section" },
  { key: "Address", label: "Address" },
  { key: "DOB_AD", label: "Date of birth (A.D.)" },
  { key: "Phone", label: "Phone", isPhone: true },
  { key: "FatherName", label: "Father's name" },
  { key: "FatherCell", label: "Father's phone", isPhone: true },
  { key: "MotherName", label: "Mother's name" },
  { key: "MotherCell", label: "Mother's phone", isPhone: true },
  { key: "monthlyFee", label: "Monthly fee (Rs.) — leave blank to use default" },
];

const PALETTE = ["#8A5A44", "#3E6259", "#7A4B6E", "#4A5A78", "#8C6A2F", "#5B4A7A", "#3F6B7A"];
function hashColor(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
function emptyRecord(fields) {
  const r = {};
  fields.forEach((f) => (r[f.key] = ""));
  return r;
}
function makeId() { return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }
function money(n) {
  const num = Number(n) || 0;
  try { return "Rs. " + num.toLocaleString("en-IN"); } catch (e) { return "Rs. " + num; }
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function inRange(dateStr, range) {
  if (!dateStr) return false;
  if (range === "all") return true;
  const now = new Date();
  if (range === "today") return dateStr === todayISO();
  const d = new Date(dateStr + "T00:00:00");
  if (range === "7d") {
    const cutoff = new Date(now); cutoff.setDate(now.getDate() - 6); cutoff.setHours(0, 0, 0, 0);
    return d >= cutoff;
  }
  if (range === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return true;
}

// -----------------------------------------------------------------------
// Real Bikram Sambat (Nepali calendar) conversion via nepali-date-converter
// (not hand-approximated) — used for the live "today" date and for
// displaying every stored date (payments, expenses, requests, PDFs) in BS.
// Dates are still *stored* as Gregorian ISO internally so range filters
// ("last 7 days", "this month") stay simple and reliable.
// -----------------------------------------------------------------------
function toLocalDate(input) {
  if (input instanceof Date) return input;
  if (typeof input === "string") return new Date(input.length <= 10 ? input + "T00:00:00" : input);
  return new Date(input);
}
function formatBS(input, fmt = "DD MMMM YYYY") {
  try { return new NepaliDate(toLocalDate(input)).format(fmt); }
  catch (e) { return typeof input === "string" ? input : ""; }
}
function getTodayBSDayNumber() {
  try { return new NepaliDate().getDate(); } catch (e) { return 1; }
}

/* -------------------------------------------------------------------------
   PDF generation
   ------------------------------------------------------------------------- */
function pdfLetterhead(doc, subtitle) {
  const cx = doc.internal.pageSize.getWidth() / 2;
  doc.setFontSize(15);
  doc.setTextColor(31, 42, 60);
  doc.text("Shree Tribhuwan Shanti Secondary School", cx, 17, { align: "center" });
  doc.setFontSize(9.5);
  doc.setTextColor(120, 113, 100);
  doc.text("Secondary School · Pokhara-30, Khudi", cx, 23, { align: "center" });
  doc.setFontSize(11);
  doc.setTextColor(34, 37, 42);
  doc.text(subtitle, cx, 33, { align: "center" });
  doc.setFontSize(8.5);
  doc.setTextColor(150, 145, 132);
  doc.text(`Generated ${formatBS(new Date())} B.S.`, cx, 38, { align: "center" });
}

function addSignatureBlock(doc, y, pageWidth, marginX = 14) {
  const w = pageWidth || doc.internal.pageSize.getWidth();
  const leftX1 = marginX, leftX2 = marginX + 60;
  const rightX2 = w - marginX, rightX1 = rightX2 - 60;
  doc.setDrawColor(150, 145, 132);
  doc.line(leftX1, y, leftX2, y);
  doc.line(rightX1, y, rightX2, y);
  doc.setFontSize(8.5);
  doc.setTextColor(90, 85, 75);
  doc.text("Issued by", leftX1, y + 4.5);
  doc.text("Verified by", rightX1, y + 4.5);
}

function drawScissorLine(doc, y) {
  doc.setLineDashPattern([2, 2], 0);
  doc.setDrawColor(190, 184, 168);
  doc.line(6, y, 204, y);
  doc.setLineDashPattern([], 0);
}

function downloadStudentBillPDF(student, ledger) {
  const doc = new jsPDF();
  pdfLetterhead(doc, `Fee Statement — ${student.Name}`);
  const cx = doc.internal.pageSize.getWidth() / 2;
  doc.setFontSize(9.5);
  doc.setTextColor(90, 85, 75);
  doc.text(
    `Class ${student.Class || "-"}  ·  Section ${student.Section || "-"}  ·  ID ${student.StudentID || "-"}`,
    cx, 44, { align: "center" }
  );

  autoTable(doc, {
    startY: 50,
    head: [["Summary", "Amount"]],
    body: [
      ["Total billed", money(ledger.totalBilled)],
      ["Total paid", money(ledger.totalPaid)],
      ["Balance due", money(ledger.due)],
    ],
    headStyles: { fillColor: [31, 42, 60] },
    styles: { fontSize: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Bill", "Amount"]],
    body: ledger.bills.length
      ? [...ledger.bills].reverse().map((b) => [b.title, money(b.amount)])
      : [["—", "No bills recorded"]],
    headStyles: { fillColor: [138, 90, 68] },
    styles: { fontSize: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Date (B.S.)", "Amount", "Note"]],
    body: ledger.payments.length
      ? [...ledger.payments].sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => [formatBS(p.date, "YYYY-MM-DD"), money(p.amount), p.note || "-"])
      : [["—", "—", "No payments recorded"]],
    headStyles: { fillColor: [62, 98, 89] },
    styles: { fontSize: 10 },
  });

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 16);
  doc.save(`Bill_${(student.Name || "student").replace(/\s+/g, "_")}.pdf`);
}

function downloadGroupDuePDF(rows, label) {
  const doc = new jsPDF();
  pdfLetterhead(doc, `Due Amount Report — ${label}`);

  autoTable(doc, {
    startY: 44,
    head: [["Name", "Section", "Billed", "Paid", "Due"]],
    body: rows.map(({ student, ledger }) => [
      student.Name || "-", student.Section || "-", money(ledger.totalBilled), money(ledger.totalPaid), money(ledger.due),
    ]),
    headStyles: { fillColor: [31, 42, 60] },
    styles: { fontSize: 9.5 },
  });

  const totalDue = rows.reduce((s, r) => s + r.ledger.due, 0);
  doc.setFontSize(10.5);
  doc.setTextColor(34, 37, 42);
  doc.text(`Total students: ${rows.length}     Total due: ${money(totalDue)}`, 14, doc.lastAutoTable.finalY + 10);

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 24);
  doc.save(`Due_Report_${label.replace(/\s+/g, "_")}.pdf`);
}

function downloadPaymentReceiptPDF(student, payment, ledger) {
  const doc = new jsPDF();
  pdfLetterhead(doc, "Payment Receipt");
  const cx = doc.internal.pageSize.getWidth() / 2;
  doc.setFontSize(9.5);
  doc.setTextColor(90, 85, 75);
  doc.text(`${student.Name || "-"}  ·  Class ${student.Class || "-"}  ·  Section ${student.Section || "-"}`, cx, 44, { align: "center" });

  autoTable(doc, {
    startY: 52,
    head: [["Detail", "Value"]],
    body: [
      ["Receipt date (B.S.)", formatBS(payment.date, "YYYY-MM-DD")],
      ["Amount received", money(payment.amount)],
      ["Note", payment.note || "-"],
      ["Balance due after this payment", money(ledger.due)],
    ],
    headStyles: { fillColor: [62, 98, 89] },
    styles: { fontSize: 10 },
  });

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 20);
  doc.save(`Receipt_${(student.Name || "student").replace(/\s+/g, "_")}_${payment.date}.pdf`);
}

// Half-A4 bill slip, two students per page (physically cut along the dashed
// line). Larger type and more detail than a plain line-item slip — if a
// student has a long bill history the table can still run past the
// half-page mark into the neighbouring slip's space, so it's worth a quick
// look for students with many bills.
const SLIP_H = 148.5;
function drawBillSlip(doc, yTop, student, ledger) {
  const cx = doc.internal.pageSize.getWidth() / 2;
  let y = yTop + 12;

  doc.setFont(undefined, "bold");
  doc.setFontSize(16);
  doc.setTextColor(31, 42, 60);
  doc.text("Shree Tribhuwan Shanti Secondary School", cx, y, { align: "center" });
  doc.setFont(undefined, "normal");
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(120, 113, 100);
  doc.text("Pokhara-30, Khudi", cx, y, { align: "center" });
  y += 5.5;
  doc.setFontSize(11);
  doc.setTextColor(34, 37, 42);
  doc.text("Fee Bill", cx, y, { align: "center" });
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(150, 145, 132);
  doc.text(`Generated ${formatBS(new Date())} B.S.`, cx, y, { align: "center" });
  y += 8;

  doc.setFont(undefined, "bold");
  doc.setFontSize(14);
  doc.setTextColor(34, 37, 42);
  doc.text(student.Name || "-", 8, y);
  doc.setFont(undefined, "normal");
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(90, 85, 75);
  doc.text(`Class ${student.Class || "-"}  ·  Section ${student.Section || "-"}  ·  ID ${student.StudentID || "-"}`, 8, y);
  y += 5.5;
  if (student.FatherName) { doc.text(`Guardian: ${student.FatherName}`, 8, y); y += 5.5; }
  const contact = student.Phone || student.FatherCell;
  if (contact) { doc.text(`Contact: ${contact}`, 8, y); y += 5.5; }
  y += 2;

  autoTable(doc, {
    startY: y,
    margin: { left: 8, right: 8 },
    tableWidth: 194,
    head: [["Bill", "Amount"]],
    body: ledger.bills.length ? [...ledger.bills].reverse().map((b) => [b.title, money(b.amount)]) : [["—", "No bills recorded"]],
    headStyles: { fillColor: [138, 90, 68], fontSize: 10 },
    styles: { fontSize: 10.5, cellPadding: 2.2 },
    theme: "grid",
  });

  let ty = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(11);
  doc.setTextColor(34, 37, 42);
  doc.text(`Billed: ${money(ledger.totalBilled)}     Paid: ${money(ledger.totalPaid)}`, 8, ty);
  ty += 7;
  doc.setFont(undefined, "bold");
  doc.setFontSize(14);
  if (ledger.due > 0) doc.setTextColor(177, 74, 60); else doc.setTextColor(62, 98, 89);
  doc.text(`Balance Due: ${money(ledger.due)}`, 8, ty);
  doc.setFont(undefined, "normal");
  ty += 6;
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 100);
  doc.text(`Kindly clear dues at the earliest. Queries: ${SCHOOL_PHONE}`, 8, ty);

  addSignatureBlock(doc, yTop + SLIP_H - 12, doc.internal.pageSize.getWidth(), 8);
}

function downloadBatchBillSlipsPDF(rows, label) {
  if (!rows || rows.length === 0) return;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  rows.forEach((r, i) => {
    const posInPage = i % 2;
    if (i > 0 && posInPage === 0) doc.addPage();
    drawBillSlip(doc, posInPage * SLIP_H, r.student, r.ledger);
  });
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawScissorLine(doc, SLIP_H);
  }
  doc.save(`Bills_${label.replace(/\s+/g, "_")}.pdf`);
}

function downloadAttendanceReportPDF(rows, day, monthLabel, label) {
  const doc = new jsPDF();
  pdfLetterhead(doc, `Attendance Report — Day ${day}, ${monthLabel}`);
  const cx = doc.internal.pageSize.getWidth() / 2;
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 100);
  doc.text(label, cx, 44, { align: "center" });

  const mIdx = (day - 1) * 2, eIdx = mIdx + 1;
  autoTable(doc, {
    startY: 50,
    head: [["Name", "Section", "Morning", "Evening"]],
    body: rows.map((r) => [r.name, r.section || "-", r.cells[mIdx] || "P", r.cells[eIdx] || "P"]),
    headStyles: { fillColor: [31, 42, 60] },
    styles: { fontSize: 9.5 },
  });

  const presentCount = rows.filter((r) => (r.cells[mIdx] || "P") === "P" && (r.cells[eIdx] || "P") === "P").length;
  doc.setFontSize(10);
  doc.setTextColor(34, 37, 42);
  doc.text(`Total: ${rows.length}   Present: ${presentCount}   Absent (M or E): ${rows.length - presentCount}`, 14, doc.lastAutoTable.finalY + 10);

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 24);
  doc.save(`Attendance_Day${day}_${label.replace(/\s+/g, "_")}.pdf`);
}

function downloadLedgerReportPDF(expenses, summary, label) {
  const doc = new jsPDF();
  pdfLetterhead(doc, `Ledger Report — ${label}`);

  autoTable(doc, {
    startY: 44,
    head: [["Summary", "Amount"]],
    body: [
      ["Total collected", money(summary.collected)],
      ["Total due (outstanding)", money(summary.due)],
      ["Total paid out", money(summary.paidOut)],
      ["Net balance", money(summary.net)],
    ],
    headStyles: { fillColor: [31, 42, 60] },
    styles: { fontSize: 10 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Date (B.S.)", "Category", "Paid to", "Amount", "Note"]],
    body: expenses.length ? expenses.map((e) => [formatBS(e.date, "YYYY-MM-DD"), e.category, e.payee, money(e.amount), e.note || "-"]) : [["—", "—", "No payments recorded", "—", "—"]],
    headStyles: { fillColor: [138, 90, 68] },
    styles: { fontSize: 9.5 },
  });

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 16);
  doc.save(`Ledger_Report_${label.replace(/\s+/g, "_")}.pdf`);
}

function downloadActivityReportPDF(actor, rangeLabel, rows, students) {
  const doc = new jsPDF();
  pdfLetterhead(doc, `Staff Activity Report — ${actor}`);
  const cx = doc.internal.pageSize.getWidth() / 2;
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 100);
  doc.text(`Payment requests · ${rangeLabel}`, cx, 44, { align: "center" });

  autoTable(doc, {
    startY: 50,
    head: [["Date (B.S.)", "Student", "Amount", "Status", "Note"]],
    body: rows.length ? rows.map((r) => {
      const student = students.find((s) => s.row === r.row);
      const status = r.status || "pending";
      return [formatBS(r.date, "YYYY-MM-DD"), student ? student.Name : `Row ${r.row}`, money(r.amount), status[0].toUpperCase() + status.slice(1), r.note || "-"];
    }) : [["—", "No requests in this range", "—", "—", "—"]],
    headStyles: { fillColor: [31, 42, 60] },
    styles: { fontSize: 9.5 },
  });

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const approved = rows.filter((r) => r.status === "approved").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const pending = rows.filter((r) => !r.status || r.status === "pending").length;
  doc.setFontSize(10);
  doc.setTextColor(34, 37, 42);
  doc.text(`Total requested: ${money(total)}   Approved: ${approved}   Pending: ${pending}   Rejected: ${rejected}`, 14, doc.lastAutoTable.finalY + 10);

  addSignatureBlock(doc, doc.lastAutoTable.finalY + 24);
  doc.save(`Activity_${actor.replace(/\s+/g, "_")}_${rangeLabel.replace(/\s+/g, "_")}.pdf`);
}

const NAV_BASE = [
  { id: "students", label: "Students", icon: GraduationCap },
  { id: "teachers", label: "Teachers", icon: Users },
  { id: "attendance", label: "Attendance", icon: CalendarCheck2 },
  { id: "billing", label: "Billing", icon: Banknote },
];

export default function SchoolDirectory() {
  const [currentUser, setCurrentUser] = useState(null); // { role: "admin"|"staff", name: string }
  const role = currentUser?.role || null;
  const isAdmin = role === "admin";

  const [staffUsers, setStaffUsers] = useState([]); // [username, username, ...] — fetched from the Sheet when Staff Activity opens

  const [tab, setTab] = useState("students");
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [attendance, setAttendance] = useState({ days: 0, rows: [] });
  const [billing, setBilling] = useState({ defaultFee: 1500, records: {}, expenses: [], paymentRequests: [] });
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [syncing, setSyncing] = useState(false);

  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("All");
  const [showFilter, setShowFilter] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formDraft, setFormDraft] = useState(null);
  const [formIsNew, setFormIsNew] = useState(false);
  const [toast, setToast] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const toastTimer = useRef(null);

  // Teachers filter
  const [teacherSubjectFilter, setTeacherSubjectFilter] = useState("All");
  const [teacherShowFilter, setTeacherShowFilter] = useState(false);

  // Attendance
  const [attnDay, setAttnDay] = useState(() => getTodayBSDayNumber());
  const [attnDraft, setAttnDraft] = useState({}); // { row: {m:'P'|'A', e:'P'|'A'} }
  const [attnQuery, setAttnQuery] = useState("");
  const [attnSectionFilter, setAttnSectionFilter] = useState("All");
  const [attnShowFilter, setAttnShowFilter] = useState(false);

  // Billing
  const [billingQuery, setBillingQuery] = useState("");
  const [billingSectionFilter, setBillingSectionFilter] = useState("All");
  const [billingStatusFilter, setBillingStatusFilter] = useState("All"); // All | Due | Paid
  const [billingShowFilter, setBillingShowFilter] = useState(false);
  const [billingSelected, setBillingSelected] = useState(null);
  const [showFeeSettings, setShowFeeSettings] = useState(false);
  const [feeDraft, setFeeDraft] = useState("");
  const [paymentForm, setPaymentForm] = useState(null);
  const [billForm, setBillForm] = useState(null);
  const [genBillsDraft, setGenBillsDraft] = useState(null);
  const [pendingReview, setPendingReview] = useState(false);
  const [activityView, setActivityView] = useState(null); // { actor, range }
  const [staffPaymentTarget, setStaffPaymentTarget] = useState(null);
  const [staffPaymentForm, setStaffPaymentForm] = useState(null);

  // Ledger (expenses / payments out)
  const [expenseQuery, setExpenseQuery] = useState("");
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState("All");
  const [expenseShowFilter, setExpenseShowFilter] = useState(false);
  const [expenseForm, setExpenseForm] = useState(null);

  const configured = isConfigured();
  const NAV = isAdmin ? [...NAV_BASE, { id: "ledger", label: "Ledger", icon: Wallet }] : NAV_BASE;
  const todayBSLabel = formatBS(new Date());

  /* ---------- load ---------- */
  async function loadFromSheets() {
    if (!configured) { setReady(true); return; }
    setLoadError("");
    try {
      const [stu, attn, bill] = await Promise.all([fetchStudents(), fetchAttendance(), fetchBilling()]);
      setStudents(stu);
      setAttendance(attn);
      if (bill && !bill.error) {
        setBilling({
          defaultFee: bill.defaultFee ?? 1500,
          records: bill.records || {},
          expenses: bill.expenses || [],
          paymentRequests: bill.paymentRequests || [],
        });
      }
    } catch (e) {
      setLoadError("Could not reach the Sheet. Check the Apps Script URL and your connection.");
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        // A refresh should NOT log you out: the session is a small local
        // marker, re-checked against the Sheet for staff accounts so a
        // removed account can't keep a stale session alive (see
        // validateSession in authService.js).
        const session = await loadSession();
        if (session) {
          const validated = await validateSession(session);
          if (validated) setCurrentUser(validated);
        }
        const t = await safeGet("sts-teachers");
        if (t) setTeachers(JSON.parse(t));
        else await safeSet("sts-teachers", []);
      } catch (e) { /* local storage is best-effort */ }
      await loadFromSheets();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // reset the day's edit draft whenever the day or the fetched grid changes
    const next = {};
    attendance.rows.forEach((r) => {
      const mIdx = (attnDay - 1) * 2, eIdx = mIdx + 1;
      next[r.row] = { m: r.cells[mIdx] || "P", e: r.cells[eIdx] || "P" };
    });
    setAttnDraft(next);
  }, [attnDay, attendance]);

  useEffect(() => {
    if (attendance.days && attnDay > attendance.days) setAttnDay(attendance.days);
  }, [attendance.days]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin && tab === "ledger") setTab("students");
  }, [isAdmin, tab]);

  // "Always get from the Sheet" in practice: since Apps Script can't push
  // updates to open sessions, this re-pulls Students/Attendance/Billing
  // whenever the app becomes visible again (switching back to this tab,
  // unlocking the phone, reopening the app) — the same pattern email/chat
  // apps use to stay current without a live connection. Plus a manual
  // refresh button in the header for "check right now."
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === "visible") loadFromSheets();
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", loadFromSheets);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", loadFromSheets);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function manualRefresh() {
    setRefreshing(true);
    await loadFromSheets();
    setRefreshing(false);
    notify("Refreshed from the Sheet");
  }

  function notify(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }
  async function persistLocal(key, value) {
    const ok = await safeSet(key, value);
    if (!ok) notify("Could not save locally — try again");
    return ok;
  }

  /* ---------- accounts (delegates to authService; admin is fixed, staff is sheet-backed) ---------- */
  async function loginAdmin(username, password) {
    const res = await loginAdminService(username, password);
    if (res.ok) setCurrentUser({ role: "admin", name: "Admin" });
    return res;
  }
  async function registerStaff(username, password, confirmPassword) {
    const res = await registerStaffService(username, password, confirmPassword);
    if (res.ok) setCurrentUser({ role: "staff", name: res.username });
    return res;
  }
  async function loginStaff(username, password) {
    const res = await loginStaffService(username, password);
    if (res.ok) setCurrentUser({ role: "staff", name: res.username });
    return res;
  }
  async function openStaffActivity() {
    setActivityView({ actor: "", range: "7d" });
    const usernames = await listStaffUsers();
    setStaffUsers(usernames);
    setActivityView((v) => (v ? { ...v, actor: usernames[0] || "" } : v));
  }
  async function handleRemoveStaffUser(username) {
    const res = await removeStaffUserService(username);
    if (res.ok) {
      setStaffUsers((prev) => prev.filter((u) => u !== username));
      notify(`Removed account: ${username}`);
    } else {
      notify(res.error || "Could not remove account");
    }
  }
  async function logout() {
    await logoutService();
    setCurrentUser(null);
  }

  /* ---------- derived ---------- */
  const sections = useMemo(() => {
    const s = new Set(students.map((r) => r.Section).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [students]);

  const teacherSubjects = useMemo(() => {
    const s = new Set(teachers.map((r) => r.subject).filter(Boolean));
    return ["All", ...Array.from(s).sort()];
  }, [teachers]);

  const filteredStudents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students
      .filter((r) => (sectionFilter !== "All" ? r.Section === sectionFilter : true))
      .filter((r) => (q ? (r.Name || "").toLowerCase().includes(q) || (r.StudentID || "").toLowerCase().includes(q) : true))
      .sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
  }, [students, query, sectionFilter]);

  const filteredTeachers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teachers
      .filter((r) => (teacherSubjectFilter !== "All" ? r.subject === teacherSubjectFilter : true))
      .filter((r) => (q ? (r.name || "").toLowerCase().includes(q) : true))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [teachers, query, teacherSubjectFilter]);

  const attnList = useMemo(() => {
    const q = attnQuery.trim().toLowerCase();
    return attendance.rows
      .filter((r) => (attnSectionFilter !== "All" ? r.section === attnSectionFilter : true))
      .filter((r) => (q ? (r.name || "").toLowerCase().includes(q) : true))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [attendance, attnQuery, attnSectionFilter]);

  const attnAbsentCount = attnList.filter((r) => {
    const v = attnDraft[r.row];
    return v && (v.m === "A" || v.e === "A");
  }).length;
  const attnPresentCount = attnList.length - attnAbsentCount;

  function ledgerFor(rowKey) {
    const rec = billing.records[rowKey] || { bills: [], payments: [] };
    const totalBilled = rec.bills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const totalPaid = rec.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return { ...rec, totalBilled, totalPaid, due: totalBilled - totalPaid };
  }
  const allBillingRows = useMemo(() => {
    return students.map((s) => ({ student: s, ledger: ledgerFor(s.row) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, billing]);

  const billingRows = useMemo(() => {
    const q = billingQuery.trim().toLowerCase();
    return allBillingRows
      .filter(({ student }) => (billingSectionFilter !== "All" ? student.Section === billingSectionFilter : true))
      .filter(({ ledger }) => (billingStatusFilter === "Due" ? ledger.due > 0 : billingStatusFilter === "Paid" ? ledger.due <= 0 : true))
      .filter(({ student }) => (q ? (student.Name || "").toLowerCase().includes(q) : true))
      .sort((a, b) => b.ledger.due - a.ledger.due || (a.student.Name || "").localeCompare(b.student.Name || ""));
  }, [allBillingRows, billingQuery, billingSectionFilter, billingStatusFilter]);

  const billingFilterLabel = [
    billingSectionFilter !== "All" ? billingSectionFilter : null,
    billingStatusFilter !== "All" ? billingStatusFilter : null,
  ].filter(Boolean).join(" · ") || "All students";

  const totalCollected = allBillingRows.reduce((s, r) => s + r.ledger.totalPaid, 0);
  const totalDueOutstanding = allBillingRows.reduce((s, r) => s + Math.max(r.ledger.due, 0), 0);
  const totalPaidOut = (billing.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netBalance = totalCollected - totalPaidOut;

  const filteredExpenses = useMemo(() => {
    const q = expenseQuery.trim().toLowerCase();
    return (billing.expenses || [])
      .filter((e) => (expenseCategoryFilter !== "All" ? e.category === expenseCategoryFilter : true))
      .filter((e) => (q ? (e.payee || "").toLowerCase().includes(q) : true))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [billing.expenses, expenseQuery, expenseCategoryFilter]);

  const pendingList = (billing.paymentRequests || []).filter((p) => (p.status || "pending") === "pending");
  const pendingCount = pendingList.length;

  const requestActors = useMemo(() => {
    const s = new Set([...staffUsers, ...(billing.paymentRequests || []).map((r) => r.actor)].filter(Boolean));
    return Array.from(s).sort();
  }, [staffUsers, billing.paymentRequests]);

  const activityRows = useMemo(() => {
    if (!activityView) return [];
    return (billing.paymentRequests || [])
      .filter((r) => r.actor === activityView.actor)
      .filter((r) => inRange(r.date, activityView.range))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [activityView, billing.paymentRequests]);

  /* ---------- students CRUD (synced to Sheet) ---------- */
  function openAdd() {
    if (tab === "students") setFormDraft(emptyRecord(STUDENT_FIELDS));
    else setFormDraft(emptyRecord(TEACHER_FIELDS));
    setFormIsNew(true);
    setFormOpen(true);
  }
  function openEdit(rec) {
    setFormDraft({ ...rec });
    setFormIsNew(false);
    setFormOpen(true);
    setSelected(null);
  }

  async function saveForm() {
    if (tab === "students") {
      if (!formDraft.Name || !formDraft.Name.trim()) { notify("Name is required"); return; }
      if (!configured) { notify("Set APPS_SCRIPT_URL first — see the setup note."); return; }
      setSyncing(true);
      try {
        if (formIsNew) await addStudentRemote(formDraft);
        else await updateStudentRemote(formDraft.row, formDraft);
        await loadFromSheets();
        notify(formIsNew ? "Added — saved to the Sheet" : "Saved to the Sheet");
      } catch (e) {
        notify("Could not reach the Sheet. Nothing was saved.");
      } finally { setSyncing(false); }
    } else {
      if (!formDraft.name || !formDraft.name.trim()) { notify("Name is required"); return; }
      const next = formIsNew ? [{ ...formDraft, _id: makeId() }, ...teachers] : teachers.map((r) => (r._id === formDraft._id ? formDraft : r));
      setTeachers(next);
      await persistLocal("sts-teachers", next);
      notify(formIsNew ? "Added" : "Saved");
    }
    setFormOpen(false); setFormDraft(null);
  }

  async function doDelete(rec) {
    if (tab === "students") {
      if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
      setSyncing(true);
      try {
        await deleteStudentRemote(rec.row);
        await loadFromSheets();
        notify("Deleted from the Sheet");
      } catch (e) {
        notify("Could not reach the Sheet. Nothing was deleted.");
      } finally { setSyncing(false); }
    } else {
      const next = teachers.filter((r) => r._id !== rec._id);
      setTeachers(next);
      await persistLocal("sts-teachers", next);
      notify("Deleted");
    }
    setConfirmDelete(null); setSelected(null);
  }

  /* ---------- attendance (synced to Sheet) ---------- */
  function toggleCell(row, which) {
    setAttnDraft((prev) => {
      const cur = prev[row] || { m: "P", e: "P" };
      const next = { ...cur, [which]: cur[which] === "P" ? "A" : "P" };
      return { ...prev, [row]: next };
    });
  }
  function markAllPresent() {
    setAttnDraft((prev) => {
      const next = { ...prev };
      attnList.forEach((r) => (next[r.row] = { m: "P", e: "P" }));
      return next;
    });
  }
  async function saveAttendance() {
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    setSyncing(true);
    try {
      const entries = attendance.rows.map((r) => ({ row: r.row, ...attnDraft[r.row] }));
      await saveAttendanceDayRemote(attnDay, entries);
      await loadFromSheets();
      notify(`Day ${attnDay} saved to the Sheet`);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was saved.");
    } finally { setSyncing(false); }
  }

  /* ---------- billing (synced to the Sheet — every mutation is one small,
     atomic, server-side call; the server's returned billing object is
     always what gets stored locally, never a client-computed merge) ---------- */
  async function updateDefaultFee() {
    const val = parseFloat(feeDraft);
    if (isNaN(val) || val < 0) { notify("Enter a valid amount"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    try {
      const next = await setDefaultFeeRemote(val);
      setBilling(next);
      notify("Default fee updated");
      setShowFeeSettings(false);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was saved.");
    }
  }

  // Admin: record an already-approved payment directly. Supports edit (id
  // present) and correction of amount/date/note on any past entry.
  async function submitPayment() {
    if (!billingSelected || !paymentForm) return;
    const amt = parseFloat(paymentForm.amount);
    if (isNaN(amt) || amt <= 0) { notify("Enter a valid amount"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    const date = paymentForm.date || todayISO();
    try {
      const next = paymentForm.id
        ? await updatePaymentRemote(billingSelected.row, paymentForm.id, amt, paymentForm.note || "", date)
        : await addPaymentRemote(billingSelected.row, amt, paymentForm.note || "", date);
      setBilling(next);
      notify(paymentForm.id ? "Payment updated" : "Payment recorded");
      setPaymentForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was saved.");
    }
  }
  async function deletePayment(id) {
    if (!billingSelected) return;
    try {
      const next = await deletePaymentRemote(billingSelected.row, id);
      setBilling(next);
      notify("Payment removed");
      setPaymentForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was deleted.");
    }
  }

  // billForm.title is a free-text label for the bill — it can name a single
  // month ("Bhadra 2083 B.S.") or a bundled period ("First Installment
  // (Bhadra, Ashwin and Shrawan)"). Supports full edit/correction via id.
  async function submitBill() {
    if (!billingSelected || !billForm) return;
    const title = (billForm.title || "").trim();
    if (!title) { notify("Enter a bill title"); return; }
    const amt = parseFloat(billForm.amount);
    if (isNaN(amt) || amt < 0) { notify("Enter a valid amount"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    try {
      const next = billForm.id
        ? await updateBillRemote(billingSelected.row, billForm.id, title, amt)
        : await addBillRemote(billingSelected.row, title, amt);
      setBilling(next);
      notify(billForm.id ? "Bill updated" : "Bill saved");
      setBillForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was saved.");
    }
  }
  async function deleteBill(id) {
    if (!billingSelected) return;
    try {
      const next = await deleteBillRemote(billingSelected.row, id);
      setBilling(next);
      notify("Bill removed");
      setBillForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was deleted.");
    }
  }

  // Generate one bill, under one custom title, for many students at once —
  // no need to open each student individually. "target" picks the base group
  // (everyone, or whoever is currently showing under the Billing filters);
  // "excluded" lets you uncheck specific students out of that base group.
  // Per-student "auto" fees are resolved server-side from the Students
  // sheet, not trusted from this client's possibly-stale copy.
  function openGenerateBills() {
    setGenBillsDraft({ title: "", target: "filtered", amountMode: "auto", fixedAmount: "", excluded: new Set() });
  }
  function genBillsBaseRows(draft) { return draft.target === "all" ? allBillingRows : billingRows; }
  function genBillsTargetRows(draft) { return genBillsBaseRows(draft).filter(({ student }) => !draft.excluded.has(student.row)); }
  function toggleGenBillsStudent(row) {
    setGenBillsDraft((prev) => {
      const next = new Set(prev.excluded);
      if (next.has(row)) next.delete(row); else next.add(row);
      return { ...prev, excluded: next };
    });
  }
  async function submitGenerateBills() {
    if (!genBillsDraft) return;
    const title = (genBillsDraft.title || "").trim();
    if (!title) { notify("Enter a bill title"); return; }
    let fixedAmt = 0;
    if (genBillsDraft.amountMode === "fixed") {
      fixedAmt = parseFloat(genBillsDraft.fixedAmount);
      if (isNaN(fixedAmt) || fixedAmt < 0) { notify("Enter a valid amount"); return; }
    }
    const targetRowNumbers = genBillsTargetRows(genBillsDraft).map(({ student }) => student.row);
    if (targetRowNumbers.length === 0) { notify("No students selected"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    try {
      const next = await generateBillsRemote(title, genBillsDraft.amountMode, fixedAmt, targetRowNumbers, billing.defaultFee);
      setBilling(next);
      notify(`"${title}" generated for ${targetRowNumbers.length} student${targetRowNumbers.length === 1 ? "" : "s"}`);
      setGenBillsDraft(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was generated.");
    }
  }

  /* ---------- staff payments -> pending approval, kept forever as an audit trail ---------- */
  async function submitStaffPayment() {
    if (!staffPaymentTarget || !staffPaymentForm) return;
    const amt = parseFloat(staffPaymentForm.amount);
    if (isNaN(amt) || amt <= 0) { notify("Enter a valid amount"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    try {
      const next = await addPaymentRequestRemote(staffPaymentTarget.row, amt, staffPaymentForm.note || "", todayISO(), currentUser?.name || "Unknown");
      setBilling(next);
      notify("Payment submitted for admin approval");
      setStaffPaymentTarget(null); setStaffPaymentForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Try again.");
    }
  }
  async function approvePending(entry) {
    try {
      const next = await decidePaymentRequestRemote(entry.id, "approved", currentUser?.name);
      setBilling(next);
      notify("Payment approved");
    } catch (e) {
      notify("Could not reach the Sheet.");
    }
  }
  async function rejectPending(entry) {
    try {
      const next = await decidePaymentRequestRemote(entry.id, "rejected", currentUser?.name);
      setBilling(next);
      notify("Payment rejected");
    } catch (e) {
      notify("Could not reach the Sheet.");
    }
  }

  /* ---------- ledger / expenses (paid to teachers, staff, goods & HR) ---------- */
  function openAddExpense() {
    setExpenseForm({ category: EXPENSE_CATEGORIES[0], payee: "", amount: "", date: todayISO(), note: "" });
  }
  function openEditExpense(exp) {
    setExpenseForm({ ...exp, amount: String(exp.amount) });
  }
  async function submitExpense() {
    if (!expenseForm) return;
    if (!expenseForm.payee || !expenseForm.payee.trim()) { notify("Enter who this payment is to"); return; }
    const amt = parseFloat(expenseForm.amount);
    if (isNaN(amt) || amt <= 0) { notify("Enter a valid amount"); return; }
    if (!configured) { notify("Set APPS_SCRIPT_URL first."); return; }
    const date = expenseForm.date || todayISO();
    const note = expenseForm.note || "";
    try {
      const next = expenseForm.id
        ? await updateExpenseRemote(expenseForm.id, expenseForm.category, expenseForm.payee.trim(), amt, date, note)
        : await addExpenseRemote(expenseForm.category, expenseForm.payee.trim(), amt, date, note);
      setBilling(next);
      notify(expenseForm.id ? "Payment updated" : "Payment recorded");
      setExpenseForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was saved.");
    }
  }
  async function deleteExpense(id) {
    try {
      const next = await deleteExpenseRemote(id);
      setBilling(next);
      notify("Payment removed");
      setExpenseForm(null);
    } catch (e) {
      notify("Could not reach the Sheet. Nothing was deleted.");
    }
  }

  const activeFields = tab === "students" ? STUDENT_FIELDS : TEACHER_FIELDS;


  return (
    <div style={{
      fontFamily: FONT, background: "#F6F4EF", height: "100dvh", maxHeight: "100dvh", maxWidth: "480px", margin: "0 auto",
      position: "relative", display: "flex", flexDirection: "column", color: "#22252A",
      borderRadius: "18px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .sd-scroll::-webkit-scrollbar { width: 4px; }
        .sd-scroll::-webkit-scrollbar-thumb { background: #d8d3c6; border-radius: 4px; }
        .sd-row:active { background: #EFEBE0 !important; }
        .sd-btn:active { transform: scale(0.97); }
        input:focus, select:focus { outline: 2px solid #8A5A44; outline-offset: 1px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div style={{ background: "#1F2A3C", padding: "16px 18px 12px 18px", color: "#F6F4EF", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: "19px", fontWeight: 600 }}>Shree Tribhuwan Shanti</div>
            <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "1px" }}>Secondary School · Pokhara-30, Khudi</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: "10px", padding: "5px 10px", textAlign: "right", flexShrink: 0, display: "flex", alignItems: "center", gap: "6px" }}>
            <button className="sd-btn" onClick={manualRefresh} title="Refresh from the Sheet" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.75)", cursor: "pointer", display: "flex", padding: 0 }}>
              <RefreshCw size={13} style={(syncing || refreshing) ? { animation: "spin 1s linear infinite" } : {}} />
            </button>
            <div>
              <div style={{ fontSize: "10px", opacity: 0.55 }}>{configured ? "synced" : "not connected"}</div>
              <div style={{ fontSize: "11px", fontWeight: 700 }}>{todayBSLabel} B.S.</div>
              {currentUser && (
                <button className="sd-btn" onClick={logout} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: "9px", cursor: "pointer", padding: 0, marginTop: "2px" }}>
                  {currentUser.name} · {isAdmin ? "Admin" : "Staff"} · Log out
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {!configured && (
        <div style={{ background: "#FCEFC7", color: "#6B4E00", padding: "10px 16px", fontSize: "11.5px", display: "flex", gap: "8px", alignItems: "flex-start", flexShrink: 0 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
          <div>Students, Attendance, and Billing aren't connected yet. Paste your Apps Script Web App URL into <b>APPS_SCRIPT_URL</b> in <b>services/dataService.js</b>, then reload.</div>
        </div>
      )}
      {loadError && (
        <div style={{ background: "#F7E4DF", color: "#8A3B2E", padding: "10px 16px", fontSize: "11.5px", flexShrink: 0 }}>{loadError}</div>
      )}

      {/* Content */}
      <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!ready ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#9A9384", fontSize: "13px" }}>Loading…</div>
        ) : tab === "students" || tab === "teachers" ? (
          <>
            <div style={{ padding: "14px 16px 8px 16px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px", background: "#fff", border: "1px solid #E4DFD1", borderRadius: "11px", padding: "9px 12px" }}>
                  <Search size={16} color="#9A9384" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "students" ? "Search students by name" : "Search teachers by name"}
                    style={{ border: "none", outline: "none", flex: 1, fontSize: "14px", background: "transparent", color: "#22252A" }} />
                  {query && <X size={15} color="#9A9384" style={{ cursor: "pointer" }} onClick={() => setQuery("")} />}
                </div>
                <button className="sd-btn" onClick={() => (tab === "students" ? setShowFilter((v) => !v) : setTeacherShowFilter((v) => !v))} style={{
                  border: "1px solid " + ((tab === "students" ? sectionFilter : teacherSubjectFilter) !== "All" ? "#8A5A44" : "#E4DFD1"),
                  background: (tab === "students" ? sectionFilter : teacherSubjectFilter) !== "All" ? "#8A5A44" : "#fff",
                  color: (tab === "students" ? sectionFilter : teacherSubjectFilter) !== "All" ? "#fff" : "#22252A",
                  borderRadius: "11px", width: "40px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}><SlidersHorizontal size={16} /></button>
              </div>
              {tab === "students" && showFilter && (
                <FilterChips options={sections} value={sectionFilter} onChange={setSectionFilter} />
              )}
              {tab === "teachers" && teacherShowFilter && (
                <FilterChips options={teacherSubjects} value={teacherSubjectFilter} onChange={setTeacherSubjectFilter} />
              )}
              <div style={{ fontSize: "12px", color: "#9A9384", marginTop: "10px", fontWeight: 500 }}>
                {tab === "students" ? `${filteredStudents.length} of ${students.length} students` : `${filteredTeachers.length} of ${teachers.length} teachers`}
                {!isAdmin && <span> · view only</span>}
              </div>
            </div>

            <div style={{ padding: "0 16px 16px 16px" }}>
              {tab === "students" ? (
                filteredStudents.length === 0 ? (
                  <EmptyState query={query} label="students" configured={configured} />
                ) : filteredStudents.map((rec) => (
                  <PersonRow key={rec.row} rec={{ name: rec.Name, sub: [rec.Class && ("Class " + rec.Class), rec.Section, rec.StudentID].filter(Boolean).join(" · "), phone: rec.Phone }}
                    onClick={() => setSelected(rec)} />
                ))
              ) : (
                filteredTeachers.length === 0 ? (
                  <EmptyState query={query} label="teachers" configured={true} />
                ) : filteredTeachers.map((rec) => (
                  <PersonRow key={rec._id} rec={{ name: rec.name, sub: [rec.subject, rec.teacherId].filter(Boolean).join(" · ") || "Staff", phone: rec.phone }}
                    onClick={() => setSelected(rec)} />
                ))
              )}
            </div>
          </>
        ) : tab === "attendance" ? (
          <div style={{ padding: "14px 16px 16px 16px", flex: 1 }}>
            <div style={{ background: "#fff", border: "1px solid #E4DFD1", borderRadius: "14px", padding: "12px 14px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button className="sd-btn" onClick={() => setAttnDay((d) => Math.max(1, d - 1))} style={{ border: "none", background: "#F1EEE3", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ChevronLeft size={16} /></button>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600 }}>Day {attnDay} · {ATTENDANCE_MONTH_LABEL}</div>
                  <div style={{ fontSize: "11px", color: "#9A9384", marginTop: "1px" }}>{attendance.days ? `1–${attendance.days} available` : "no data loaded"}</div>
                </div>
                <button className="sd-btn" onClick={() => setAttnDay((d) => Math.min(attendance.days || 1, d + 1))} style={{ border: "none", background: "#F1EEE3", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ChevronRight size={16} /></button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <div style={{ flex: 1, background: "#fff", border: "1px solid #E4DFD1", borderRadius: "11px", padding: "9px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Search size={15} color="#9A9384" />
                <input value={attnQuery} onChange={(e) => setAttnQuery(e.target.value)} placeholder="Search students"
                  style={{ border: "none", outline: "none", flex: 1, fontSize: "13.5px", background: "transparent" }} />
              </div>
              <button className="sd-btn" onClick={() => setAttnShowFilter((v) => !v)} style={{
                border: "1px solid " + (attnSectionFilter !== "All" ? "#8A5A44" : "#E4DFD1"),
                background: attnSectionFilter !== "All" ? "#8A5A44" : "#fff", color: attnSectionFilter !== "All" ? "#fff" : "#22252A",
                borderRadius: "11px", width: "40px", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}><SlidersHorizontal size={16} /></button>
              <button className="sd-btn" onClick={() => downloadAttendanceReportPDF(attnList, attnDay, ATTENDANCE_MONTH_LABEL, attnSectionFilter !== "All" ? attnSectionFilter : "All sections")} title="Download report" style={iconBtnStyle}>
                <Download size={16} color="#54504A" />
              </button>
            </div>
            {attnShowFilter && <FilterChips options={sections} value={attnSectionFilter} onChange={setAttnSectionFilter} />}

            <div style={{ display: "flex", gap: "8px", margin: "10px 0" }}>
              <button className="sd-btn" onClick={markAllPresent} style={{ border: "1px solid #3E6259", background: "#EFEBE0", color: "#3E6259", borderRadius: "11px", padding: "7px 12px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                Mark all present
              </button>
              <div style={{ display: "flex", gap: "10px", fontSize: "12.5px", fontWeight: 600, alignItems: "center" }}>
                <div style={{ color: "#3E6259" }}>{attnPresentCount} present</div>
                <div style={{ color: "#B14A3C" }}>{attnAbsentCount} absent</div>
              </div>
            </div>

            <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
              {attnList.map((s, i) => {
                const cur = attnDraft[s.row] || { m: "P", e: "P" };
                return (
                  <div key={s.row} className="sd-row" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderBottom: i < attnList.length - 1 ? "1px solid #F1EEE3" : "none" }}>
                    <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: hashColor(s.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, flexShrink: 0, fontFamily: "'Fraunces', serif" }}>{initials(s.name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                      <div style={{ fontSize: "11px", color: "#9A9384" }}>{s.section}</div>
                    </div>
                    <button className="sd-btn" onClick={() => toggleCell(s.row, "m")} style={{ display: "flex", alignItems: "center", gap: "3px", padding: "5px 8px", borderRadius: "16px", fontSize: "10.5px", fontWeight: 700, border: "none", cursor: "pointer", background: cur.m === "A" ? "#F7E4DF" : "#E4EFE9", color: cur.m === "A" ? "#B14A3C" : "#3E6259" }}>
                      {cur.m === "A" ? <CircleX size={11} /> : <CircleCheck size={11} />} M
                    </button>
                    <button className="sd-btn" onClick={() => toggleCell(s.row, "e")} style={{ display: "flex", alignItems: "center", gap: "3px", padding: "5px 8px", borderRadius: "16px", fontSize: "10.5px", fontWeight: 700, border: "none", cursor: "pointer", background: cur.e === "A" ? "#F7E4DF" : "#E4EFE9", color: cur.e === "A" ? "#B14A3C" : "#3E6259" }}>
                      {cur.e === "A" ? <CircleX size={11} /> : <CircleCheck size={11} />} E
                    </button>
                  </div>
                );
              })}
              {attnList.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#9A9384", fontSize: "12.5px" }}>{configured ? "No attendance data matches this filter." : "Connect the Sheet to take attendance."}</div>}
            </div>
          </div>
        ) : tab === "billing" ? (
          <div style={{ padding: "14px 16px 16px 16px", flex: 1 }}>
            {isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: "8px", flexWrap: "wrap" }}>
                <button className="sd-btn" onClick={() => { setFeeDraft(String(billing.defaultFee)); setShowFeeSettings(true); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12.5px", color: "#54504A", display: "flex", alignItems: "center", gap: "4px" }}>
                  Default fee: <b>{money(billing.defaultFee)}</b> <Pencil size={11} color="#9A9384" />
                </button>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="sd-btn" onClick={openStaffActivity} title="Staff activity" style={iconBtnStyle}><ClipboardList size={15} color="#54504A" /></button>
                  <button className="sd-btn" onClick={() => setPendingReview(true)} title="Pending approvals" style={{ ...iconBtnStyle, position: "relative" }}>
                    <Inbox size={15} color="#54504A" />
                    {pendingCount > 0 && (
                      <span style={{ position: "absolute", top: "-4px", right: "-4px", background: "#B14A3C", color: "#fff", fontSize: "9px", fontWeight: 700, borderRadius: "8px", padding: "1px 4px", lineHeight: 1 }}>{pendingCount}</span>
                    )}
                  </button>
                  <button className="sd-btn" onClick={openGenerateBills} title="Generate bills" style={iconBtnStyle}><FileStack size={15} color="#54504A" /></button>
                  <button className="sd-btn" onClick={() => downloadBatchBillSlipsPDF(billingRows, billingFilterLabel)} title="Print bills (batch)" style={iconBtnStyle}><Printer size={15} color="#54504A" /></button>
                  <button className="sd-btn" onClick={() => downloadGroupDuePDF(billingRows, billingFilterLabel)} title="Download due report" style={iconBtnStyle}><Download size={15} color="#54504A" /></button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "#9A9384", marginBottom: "10px" }}>Tap a student to submit a payment for admin approval.</div>
            )}

            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <div style={{ flex: 1, background: "#fff", border: "1px solid #E4DFD1", borderRadius: "11px", padding: "9px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Search size={15} color="#9A9384" />
                <input value={billingQuery} onChange={(e) => setBillingQuery(e.target.value)} placeholder="Search students"
                  style={{ border: "none", outline: "none", flex: 1, fontSize: "13.5px", background: "transparent" }} />
              </div>
              <button className="sd-btn" onClick={() => setBillingShowFilter((v) => !v)} style={{
                border: "1px solid " + (billingSectionFilter !== "All" || billingStatusFilter !== "All" ? "#8A5A44" : "#E4DFD1"),
                background: billingSectionFilter !== "All" || billingStatusFilter !== "All" ? "#8A5A44" : "#fff",
                color: billingSectionFilter !== "All" || billingStatusFilter !== "All" ? "#fff" : "#22252A",
                borderRadius: "11px", width: "40px", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}><SlidersHorizontal size={16} /></button>
            </div>
            {billingShowFilter && (
              <div style={{ marginBottom: "6px" }}>
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#9A9384", marginBottom: "4px" }}>SECTION</div>
                <FilterChips options={sections} value={billingSectionFilter} onChange={setBillingSectionFilter} />
                <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#9A9384", margin: "8px 0 4px 0" }}>STATUS</div>
                <FilterChips options={["All", "Due", "Paid"]} value={billingStatusFilter} onChange={setBillingStatusFilter} />
              </div>
            )}

            <div style={{ fontSize: "12px", color: "#9A9384", margin: "8px 0" }}>{billingRows.length} of {students.length} students · {billingFilterLabel}</div>

            <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
              {billingRows.map(({ student, ledger }, i) => (
                <div key={student.row} className="sd-row" onClick={() => {
                  if (isAdmin) setBillingSelected(student);
                  else { setStaffPaymentTarget(student); setStaffPaymentForm({ amount: "", note: "" }); }
                }} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderBottom: i < billingRows.length - 1 ? "1px solid #F1EEE3" : "none", cursor: "pointer" }}>
                  <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: hashColor(student.Name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, flexShrink: 0, fontFamily: "'Fraunces', serif" }}>{initials(student.Name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{student.Name}</div>
                    <div style={{ fontSize: "11px", color: "#9A9384" }}>{student.Section}</div>
                  </div>
                  <div style={{ fontSize: "12.5px", fontWeight: 700, color: ledger.due > 0 ? "#B14A3C" : "#3E6259", whiteSpace: "nowrap" }}>{ledger.due > 0 ? "Due " + money(ledger.due) : "Paid up"}</div>
                </div>
              ))}
              {billingRows.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#9A9384", fontSize: "12.5px" }}>{configured ? "No students match this filter." : "Connect the Sheet to see students here."}</div>}
            </div>
          </div>
        ) : (
          <div style={{ padding: "14px 16px 16px 16px", flex: 1 }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              <SummaryCard label="Collected" value={money(totalCollected)} color="#3E6259" />
              <SummaryCard label="Due" value={money(totalDueOutstanding)} color="#B14A3C" />
              <SummaryCard label="Paid out" value={money(totalPaidOut)} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: "8px" }}>
              <div style={{ fontSize: "12px", color: "#54504A" }}>Net balance: <b>{money(netBalance)}</b></div>
              <button className="sd-btn" onClick={() => downloadLedgerReportPDF(filteredExpenses, { collected: totalCollected, due: totalDueOutstanding, paidOut: totalPaidOut, net: netBalance }, expenseCategoryFilter !== "All" ? expenseCategoryFilter : "All categories")} title="Download ledger report" style={iconBtnStyle}>
                <Download size={15} color="#54504A" />
              </button>
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <div style={{ flex: 1, background: "#fff", border: "1px solid #E4DFD1", borderRadius: "11px", padding: "9px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Search size={15} color="#9A9384" />
                <input value={expenseQuery} onChange={(e) => setExpenseQuery(e.target.value)} placeholder="Search by payee"
                  style={{ border: "none", outline: "none", flex: 1, fontSize: "13.5px", background: "transparent" }} />
              </div>
              <button className="sd-btn" onClick={() => setExpenseShowFilter((v) => !v)} style={{
                border: "1px solid " + (expenseCategoryFilter !== "All" ? "#8A5A44" : "#E4DFD1"),
                background: expenseCategoryFilter !== "All" ? "#8A5A44" : "#fff", color: expenseCategoryFilter !== "All" ? "#fff" : "#22252A",
                borderRadius: "11px", width: "40px", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}><SlidersHorizontal size={16} /></button>
            </div>
            {expenseShowFilter && <FilterChips options={["All", ...EXPENSE_CATEGORIES]} value={expenseCategoryFilter} onChange={setExpenseCategoryFilter} />}

            <div style={{ fontSize: "12px", color: "#9A9384", margin: "10px 0" }}>{filteredExpenses.length} payment{filteredExpenses.length === 1 ? "" : "s"} out</div>

            <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
              {filteredExpenses.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "#9A9384", fontSize: "12.5px" }}>No payments recorded yet.</div>
              ) : filteredExpenses.map((e, i) => (
                <div key={e.id} className="sd-row" onClick={() => openEditExpense(e)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < filteredExpenses.length - 1 ? "1px solid #F1EEE3" : "none", cursor: "pointer" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.payee}</div>
                    <div style={{ fontSize: "11px", color: "#9A9384" }}>{e.category} · {formatBS(e.date)} B.S.{e.note ? " · " + e.note : ""}</div>
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 700, flexShrink: 0 }}>{money(e.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ display: "flex", background: "#fff", borderTop: "1px solid #EAE6D9", flexShrink: 0 }}>
        {NAV.map((n) => {
          const Icon = n.icon; const active = tab === n.id;
          return (
            <button key={n.id} className="sd-btn" onClick={() => { setTab(n.id); setQuery(""); setSectionFilter("All"); }} style={{
              flex: 1, border: "none", background: "none", cursor: "pointer", padding: "9px 2px 8px 2px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", color: active ? "#8A5A44" : "#9A9384",
            }}><Icon size={19} strokeWidth={active ? 2.4 : 2} /><span style={{ fontSize: "10px", fontWeight: active ? 700 : 600 }}>{n.label}</span></button>
          );
        })}
      </div>

      {isAdmin && (tab === "students" || tab === "teachers" || tab === "ledger") && (
        <button className="sd-btn" onClick={tab === "ledger" ? openAddExpense : openAdd} style={{ position: "absolute", bottom: "72px", right: "18px", width: "52px", height: "52px", borderRadius: "50%", background: "#8A5A44", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(138,90,68,0.4)", cursor: "pointer" }}><Plus size={24} /></button>
      )}

      {tab === "attendance" && ready && (
        <div style={{ padding: "10px 16px", background: "#F6F4EF", borderTop: "1px solid #EAE6D9", flexShrink: 0 }}>
          <button className="sd-btn" onClick={saveAttendance} disabled={!configured || syncing} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: (!configured || syncing) ? "#9A9384" : "#1F2A3C", color: "#fff", fontWeight: 700, fontSize: "14px", cursor: (!configured || syncing) ? "default" : "pointer" }}>
            {syncing ? "Saving to Sheet…" : `Save Day ${attnDay} to the Sheet`}
          </button>
        </div>
      )}

      {toast && (
        <div style={{ position: "absolute", bottom: "76px", left: "50%", transform: "translateX(-50%)", background: "#1F2A3C", color: "#fff", padding: "9px 16px", borderRadius: "20px", fontSize: "12.5px", fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: "6px", zIndex: 60, maxWidth: "88%", textAlign: "center" }}>
          <Check size={14} style={{ flexShrink: 0 }} /> {toast}
        </div>
      )}

      {selected && (
        <PersonDetail
          tab={tab} selected={selected} onBack={() => setSelected(null)}
          onEdit={isAdmin ? () => openEdit(selected) : null}
          onDelete={isAdmin ? () => setConfirmDelete(selected) : null}
          onViewBilling={tab === "students" && isAdmin ? () => { setSelected(null); setBillingSelected(selected); setTab("billing"); } : null}
          fields={activeFields}
        />
      )}

      {confirmDelete && (
        <ConfirmDelete name={tab === "students" ? confirmDelete.Name : confirmDelete.name} onCancel={() => setConfirmDelete(null)} onConfirm={() => doDelete(confirmDelete)} />
      )}

      {formOpen && formDraft && (
        <PersonForm tab={tab} isNew={formIsNew} draft={formDraft} setDraft={setFormDraft} fields={activeFields} onCancel={() => { setFormOpen(false); setFormDraft(null); }} onSave={saveForm} syncing={syncing} />
      )}

      {showFeeSettings && (
        <SimpleModal title="Default monthly fee" onCancel={() => setShowFeeSettings(false)} onSave={updateDefaultFee}>
          <input value={feeDraft} onChange={(e) => setFeeDraft(e.target.value)} type="number" inputMode="decimal" style={inputStyle} />
          <div style={{ fontSize: "11.5px", color: "#9A9384", marginTop: "6px" }}>Used for any student without their own monthly fee set.</div>
        </SimpleModal>
      )}

      {genBillsDraft && (() => {
        const baseRows = genBillsBaseRows(genBillsDraft);
        const targetRows = genBillsTargetRows(genBillsDraft);
        return (
          <SimpleModal title="Generate bills" onCancel={() => setGenBillsDraft(null)} onSave={submitGenerateBills} saveLabel="Generate">
            <label style={labelStyle}>Bill title</label>
            <input value={genBillsDraft.title} onChange={(e) => setGenBillsDraft({ ...genBillsDraft, title: e.target.value })} type="text" style={inputStyle} placeholder="e.g. First Installment (Bhadra, Ashwin and Shrawan)" autoFocus />
            <div style={{ fontSize: "10.5px", color: "#9A9384", marginTop: "4px" }}>This becomes one bill entry per student — name it however you like.</div>

            <label style={{ ...labelStyle, marginTop: "12px" }}>Apply to</label>
            <div style={{ display: "flex", gap: "6px" }}>
              <ChoiceButton active={genBillsDraft.target === "filtered"} onClick={() => setGenBillsDraft({ ...genBillsDraft, target: "filtered", excluded: new Set() })}>
                Current filter ({billingRows.length})
              </ChoiceButton>
              <ChoiceButton active={genBillsDraft.target === "all"} onClick={() => setGenBillsDraft({ ...genBillsDraft, target: "all", excluded: new Set() })}>
                All students ({students.length})
              </ChoiceButton>
            </div>

            <label style={{ ...labelStyle, marginTop: "12px" }}>Amount</label>
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <ChoiceButton active={genBillsDraft.amountMode === "auto"} onClick={() => setGenBillsDraft({ ...genBillsDraft, amountMode: "auto" })}>
                Each student's fee
              </ChoiceButton>
              <ChoiceButton active={genBillsDraft.amountMode === "fixed"} onClick={() => setGenBillsDraft({ ...genBillsDraft, amountMode: "fixed" })}>
                Fixed amount
              </ChoiceButton>
            </div>
            {genBillsDraft.amountMode === "fixed" && (
              <input value={genBillsDraft.fixedAmount} onChange={(e) => setGenBillsDraft({ ...genBillsDraft, fixedAmount: e.target.value })} type="number" inputMode="decimal" style={inputStyle} placeholder="Amount for everyone (Rs.)" />
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "14px", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Students ({targetRows.length} of {baseRows.length} selected)</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button type="button" className="sd-btn" onClick={() => setGenBillsDraft({ ...genBillsDraft, excluded: new Set() })} style={{ border: "none", background: "none", color: "#8A5A44", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>All</button>
                <button type="button" className="sd-btn" onClick={() => setGenBillsDraft({ ...genBillsDraft, excluded: new Set(baseRows.map((r) => r.student.row)) })} style={{ border: "none", background: "none", color: "#9A9384", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>None</button>
              </div>
            </div>
            <div style={{ maxHeight: "160px", overflowY: "auto", border: "1px solid #E4DFD1", borderRadius: "10px" }}>
              {baseRows.length === 0 ? (
                <div style={{ padding: "12px", fontSize: "12px", color: "#9A9384", textAlign: "center" }}>No students in this group.</div>
              ) : baseRows.map(({ student }, i) => (
                <label key={student.row} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", borderBottom: i < baseRows.length - 1 ? "1px solid #F1EEE3" : "none", fontSize: "12.5px", cursor: "pointer" }}>
                  <input type="checkbox" checked={!genBillsDraft.excluded.has(student.row)} onChange={() => toggleGenBillsStudent(student.row)} />
                  <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{student.Name}</span>
                  <span style={{ color: "#9A9384", flexShrink: 0 }}>{student.Section}</span>
                </label>
              ))}
            </div>
          </SimpleModal>
        );
      })()}

      {pendingReview && (
        <div style={{ position: "absolute", inset: 0, background: "#F6F4EF", zIndex: 26, display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#1F2A3C", padding: "16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <button className="sd-btn" onClick={() => setPendingReview(false)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex" }}><ChevronLeft size={22} /></button>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>Pending approvals</div>
          </div>
          <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {pendingList.length === 0 ? (
              <div style={{ textAlign: "center", color: "#9A9384", fontSize: "13px", padding: "32px 0" }}>Nothing waiting for approval.</div>
            ) : pendingList.map((entry) => {
              const student = students.find((s) => s.row === entry.row);
              return (
                <div key={entry.id} style={{ background: "#fff", border: "1px solid #EAE6D9", borderRadius: "14px", padding: "12px 14px", marginBottom: "10px" }}>
                  <div style={{ fontSize: "13.5px", fontWeight: 700 }}>{student ? student.Name : `Row ${entry.row}`}</div>
                  <div style={{ fontSize: "12px", color: "#9A9384", margin: "2px 0 8px 0" }}>Requested by {entry.actor || "Unknown"} · {formatBS(entry.date)} B.S.{entry.note ? " · " + entry.note : ""}</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#3E6259", marginBottom: "10px" }}>{money(entry.amount)}</div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="sd-btn" onClick={() => approvePending(entry)} style={{ flex: 1, padding: "9px", borderRadius: "10px", border: "none", background: "#3E6259", color: "#fff", fontWeight: 700, fontSize: "12.5px", cursor: "pointer" }}>Approve</button>
                    <button className="sd-btn" onClick={() => rejectPending(entry)} style={{ flex: 1, padding: "9px", borderRadius: "10px", border: "1px solid #E4DFD1", background: "#fff", color: "#B14A3C", fontWeight: 700, fontSize: "12.5px", cursor: "pointer" }}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activityView && (
        <div style={{ position: "absolute", inset: 0, background: "#F6F4EF", zIndex: 27, display: "flex", flexDirection: "column" }}>
          <div style={{ background: "#1F2A3C", padding: "16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
            <button className="sd-btn" onClick={() => setActivityView(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex" }}><ChevronLeft size={22} /></button>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px", flex: 1 }}>Staff activity</div>
            <button className="sd-btn" onClick={() => downloadActivityReportPDF(activityView.actor, RANGE_LABELS[activityView.range], activityRows, students)} disabled={!activityView.actor} title="Download report" style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", cursor: activityView.actor ? "pointer" : "default", opacity: activityView.actor ? 1 : 0.4, borderRadius: "8px", padding: "7px", display: "flex" }}><Download size={16} /></button>
          </div>
          <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            <label style={labelStyle}>Registered accounts</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
              {staffUsers.length === 0 ? (
                <div style={{ fontSize: "12px", color: "#9A9384" }}>No staff accounts yet — they can create one from the login screen.</div>
              ) : staffUsers.map((u) => (
                <div key={u} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", border: "1px solid #EAE6D9", borderRadius: "10px", padding: "8px 12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600 }}>{u}</span>
                  <button className="sd-btn" onClick={() => handleRemoveStaffUser(u)} title="Remove account" style={{ border: "none", background: "none", color: "#B14A3C", cursor: "pointer", display: "flex" }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            {requestActors.length === 0 ? (
              <div style={{ textAlign: "center", color: "#9A9384", fontSize: "13px", padding: "16px 0" }}>No staff payment requests recorded yet.</div>
            ) : (
              <>
                <label style={labelStyle}>Staff member</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                  {requestActors.map((a) => (
                    <ChoiceButton key={a} active={activityView.actor === a} onClick={() => setActivityView({ ...activityView, actor: a })}>{a}</ChoiceButton>
                  ))}
                </div>
                <label style={labelStyle}>Range</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                  {Object.entries(RANGE_LABELS).map(([key, label]) => (
                    <ChoiceButton key={key} active={activityView.range === key} onClick={() => setActivityView({ ...activityView, range: key })}>{label}</ChoiceButton>
                  ))}
                </div>
                <div style={{ fontSize: "12px", color: "#9A9384", marginBottom: "10px" }}>{activityRows.length} request{activityRows.length === 1 ? "" : "s"} · {money(activityRows.reduce((s, r) => s + (Number(r.amount) || 0), 0))} total</div>
                <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
                  {activityRows.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "#9A9384", fontSize: "12.5px" }}>No requests in this range.</div>
                  ) : activityRows.map((r, i) => {
                    const student = students.find((s) => s.row === r.row);
                    const status = r.status || "pending";
                    const statusColor = status === "approved" ? "#3E6259" : status === "rejected" ? "#B14A3C" : "#8A5A44";
                    return (
                      <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < activityRows.length - 1 ? "1px solid #F1EEE3" : "none" }}>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600 }}>{student ? student.Name : `Row ${r.row}`}</div>
                          <div style={{ fontSize: "11px", color: "#9A9384" }}>{formatBS(r.date)} B.S.{r.note ? " · " + r.note : ""}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "13.5px", fontWeight: 700 }}>{money(r.amount)}</div>
                          <div style={{ fontSize: "10px", fontWeight: 700, color: statusColor, textTransform: "capitalize" }}>{status}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {billingSelected && (() => {
        const ledger = ledgerFor(billingSelected.row);
        const sortedBills = [...ledger.bills].reverse();
        const sortedPayments = [...ledger.payments].sort((a, b) => (a.date < b.date ? 1 : -1));
        const myPending = (billing.paymentRequests || []).filter((p) => p.row === billingSelected.row && (p.status || "pending") === "pending");
        return (
          <div style={{ position: "absolute", inset: 0, background: "#F6F4EF", zIndex: 25, display: "flex", flexDirection: "column" }}>
            <div style={{ background: "#1F2A3C", padding: "16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <button className="sd-btn" onClick={() => setBillingSelected(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex" }}><ChevronLeft size={22} /></button>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px", flex: 1 }}>{billingSelected.Name}</div>
              <button className="sd-btn" onClick={() => downloadStudentBillPDF(billingSelected, ledger)} title="Download PDF" style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", cursor: "pointer", borderRadius: "8px", padding: "7px", display: "flex" }}><Download size={16} /></button>
            </div>
            <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 20px 24px 20px" }}>
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                <SummaryCard label="Billed" value={money(ledger.totalBilled)} />
                <SummaryCard label="Paid" value={money(ledger.totalPaid)} color="#3E6259" />
                <SummaryCard label="Due" value={money(ledger.due)} color={ledger.due > 0 ? "#B14A3C" : "#3E6259"} />
              </div>

              {myPending.length > 0 && (
                <div style={{ background: "#FCEFC7", border: "1px solid #F0DFA0", borderRadius: "12px", padding: "10px 12px", marginBottom: "16px" }}>
                  <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#6B4E00", marginBottom: "6px" }}>Awaiting approval</div>
                  {myPending.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                      <div style={{ fontSize: "12px", color: "#6B4E00" }}>{money(p.amount)} · requested by {p.actor || "Unknown"}{p.note ? " · " + p.note : ""} · {formatBS(p.date)} B.S.</div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button className="sd-btn" onClick={() => approvePending(p)} style={{ border: "none", background: "#3E6259", color: "#fff", borderRadius: "8px", padding: "4px 8px", fontSize: "10.5px", fontWeight: 700, cursor: "pointer" }}>Approve</button>
                        <button className="sd-btn" onClick={() => rejectPending(p)} style={{ border: "1px solid #E4DFD1", background: "#fff", color: "#B14A3C", borderRadius: "8px", padding: "4px 8px", fontSize: "10.5px", fontWeight: 700, cursor: "pointer" }}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
                <button className="sd-btn" onClick={() => setPaymentForm({ amount: "", note: "", date: todayISO() })} style={{ flex: 1, padding: "10px", borderRadius: "11px", border: "none", background: "#3E6259", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Record payment</button>
                <button className="sd-btn" onClick={() => setBillForm({ title: "", amount: String(billingSelected.monthlyFee || billing.defaultFee || "") })} style={{ flex: 1, padding: "10px", borderRadius: "11px", border: "1px solid #E4DFD1", background: "#fff", color: "#1F2A3C", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Add / edit bill</button>
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#54504A", marginBottom: "8px" }}>Monthly bills</div>
              <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden", marginBottom: "20px" }}>
                {sortedBills.length === 0 ? <div style={{ padding: "16px", fontSize: "12.5px", color: "#9A9384", textAlign: "center" }}>No bills yet.</div> :
                  sortedBills.map((b, i) => (
                    <div key={b.id} onClick={() => setBillForm({ id: b.id, title: b.title, amount: String(b.amount) })} className="sd-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < sortedBills.length - 1 ? "1px solid #F1EEE3" : "none", cursor: "pointer" }}>
                      <div><div style={{ fontSize: "13px", fontWeight: 600 }}>{b.title}</div>{b.manual && <div style={{ fontSize: "10.5px", color: "#9A9384" }}>Entered manually</div>}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}><span style={{ fontSize: "13.5px", fontWeight: 700 }}>{money(b.amount)}</span><Pencil size={13} color="#9A9384" /></div>
                    </div>
                  ))}
              </div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#54504A", marginBottom: "8px" }}>Payment history</div>
              <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
                {sortedPayments.length === 0 ? <div style={{ padding: "16px", fontSize: "12.5px", color: "#9A9384", textAlign: "center" }}>No payments recorded yet.</div> :
                  sortedPayments.map((p, i) => (
                    <div key={p.id} className="sd-row" onClick={() => setPaymentForm({ id: p.id, amount: String(p.amount), note: p.note || "", date: p.date })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderBottom: i < sortedPayments.length - 1 ? "1px solid #F1EEE3" : "none", cursor: "pointer" }}>
                      <div><div style={{ fontSize: "13px", fontWeight: 600, color: "#3E6259" }}>{money(p.amount)}</div><div style={{ fontSize: "10.5px", color: "#9A9384" }}>{formatBS(p.date)} B.S.{p.note ? " · " + p.note : ""}</div></div>
                      <button className="sd-btn" onClick={(e) => { e.stopPropagation(); downloadPaymentReceiptPDF(billingSelected, p, ledger); }} title="Download receipt" style={{ border: "none", background: "#EFEBE0", borderRadius: "8px", padding: "6px", cursor: "pointer", color: "#3E6259", display: "flex" }}><Download size={13} /></button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        );
      })()}

      {staffPaymentTarget && staffPaymentForm && (
        <SimpleModal title={`Submit payment — ${staffPaymentTarget.Name}`} onCancel={() => { setStaffPaymentTarget(null); setStaffPaymentForm(null); }} onSave={submitStaffPayment} saveLabel="Submit for approval" saveColor="#3E6259">
          <label style={labelStyle}>Amount (Rs.)</label>
          <input value={staffPaymentForm.amount} onChange={(e) => setStaffPaymentForm({ ...staffPaymentForm, amount: e.target.value })} type="number" inputMode="decimal" style={inputStyle} autoFocus />
          <label style={{ ...labelStyle, marginTop: "10px" }}>Note (optional)</label>
          <input value={staffPaymentForm.note} onChange={(e) => setStaffPaymentForm({ ...staffPaymentForm, note: e.target.value })} type="text" style={inputStyle} />
          <div style={{ fontSize: "10.5px", color: "#9A9384", marginTop: "8px" }}>Submitted as {currentUser?.name} on {todayBSLabel} B.S. This is sent to the admin for approval before it's applied to the due amount.</div>
        </SimpleModal>
      )}

      {paymentForm && (
        <SimpleModal title={paymentForm.id ? "Edit payment" : "Record payment"} onCancel={() => setPaymentForm(null)} onSave={submitPayment} onDelete={paymentForm.id ? () => deletePayment(paymentForm.id) : undefined} saveLabel="Save" saveColor="#3E6259">
          <label style={labelStyle}>Amount (Rs.)</label>
          <input value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} type="number" inputMode="decimal" style={inputStyle} autoFocus />
          <label style={{ ...labelStyle, marginTop: "10px" }}>Date</label>
          <input value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} type="date" style={inputStyle} />
          <div style={{ fontSize: "10.5px", color: "#9A9384", marginTop: "4px" }}>≈ {formatBS(paymentForm.date)} B.S.</div>
          <label style={{ ...labelStyle, marginTop: "10px" }}>Note (optional)</label>
          <input value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} type="text" style={inputStyle} />
        </SimpleModal>
      )}

      {billForm && (
        <SimpleModal title={billForm.id ? "Edit bill" : "Add / edit bill"} onCancel={() => setBillForm(null)} onSave={submitBill} onDelete={billForm.id ? () => deleteBill(billForm.id) : undefined}>
          <label style={labelStyle}>Bill title</label>
          <input value={billForm.title} onChange={(e) => setBillForm({ ...billForm, title: e.target.value })} type="text" style={inputStyle} placeholder="e.g. First Installment (Bhadra, Ashwin and Shrawan)" autoFocus />
          <label style={{ ...labelStyle, marginTop: "10px" }}>Amount (Rs.)</label>
          <input value={billForm.amount} onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })} type="number" inputMode="decimal" style={inputStyle} />
        </SimpleModal>
      )}

      {expenseForm && (
        <SimpleModal title={expenseForm.id ? "Edit payment" : "Make a payment"} onCancel={() => setExpenseForm(null)} onSave={submitExpense} onDelete={expenseForm.id ? () => deleteExpense(expenseForm.id) : undefined}>
          <label style={labelStyle}>Category</label>
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            {EXPENSE_CATEGORIES.map((c) => (
              <ChoiceButton key={c} active={expenseForm.category === c} onClick={() => setExpenseForm({ ...expenseForm, category: c })}>{c}</ChoiceButton>
            ))}
          </div>
          <label style={labelStyle}>Paid to</label>
          <input value={expenseForm.payee} onChange={(e) => setExpenseForm({ ...expenseForm, payee: e.target.value })} type="text" style={inputStyle} placeholder="Name of teacher, staff, or vendor" />
          <label style={{ ...labelStyle, marginTop: "10px" }}>Amount (Rs.)</label>
          <input value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} type="number" inputMode="decimal" style={inputStyle} />
          <label style={{ ...labelStyle, marginTop: "10px" }}>Date</label>
          <input value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} type="date" style={inputStyle} />
          <div style={{ fontSize: "10.5px", color: "#9A9384", marginTop: "4px" }}>≈ {formatBS(expenseForm.date)} B.S.</div>
          <label style={{ ...labelStyle, marginTop: "10px" }}>Note (optional)</label>
          <input value={expenseForm.note} onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })} type="text" style={inputStyle} />
        </SimpleModal>
      )}

      {!currentUser && (
        <LoginGate
          onAdminLogin={(u, p) => loginAdmin(u, p)}
          onStaffLogin={(u, p) => loginStaff(u, p)}
          onStaffSignup={(u, p, c) => registerStaff(u, p, c)}
        />
      )}
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E4DFD1", fontSize: "14px", background: "#fff", color: "#22252A" };
const labelStyle = { fontSize: "11.5px", fontWeight: 600, color: "#54504A", display: "block", marginBottom: "5px" };
const iconBtnStyle = { border: "1px solid #E4DFD1", background: "#fff", borderRadius: "9px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };

function FilterChips({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
      {options.map((s) => (
        <button key={s} className="sd-btn" onClick={() => onChange(s)} style={{
          border: "1px solid " + (value === s ? "#1F2A3C" : "#E4DFD1"), background: value === s ? "#1F2A3C" : "#fff",
          color: value === s ? "#fff" : "#54504A", borderRadius: "20px", padding: "5px 12px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
        }}>{s}</button>
      ))}
    </div>
  );
}

function ChoiceButton({ active, onClick, children }) {
  return (
    <button className="sd-btn" onClick={onClick} style={{
      border: "1px solid " + (active ? "#8A5A44" : "#E4DFD1"), background: active ? "#8A5A44" : "#fff",
      color: active ? "#fff" : "#54504A", borderRadius: "10px", padding: "8px 10px", fontSize: "11.5px", fontWeight: 700, cursor: "pointer",
    }}>{children}</button>
  );
}

function PersonRow({ rec, onClick }) {
  return (
    <div className="sd-row" onClick={onClick} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 4px", borderBottom: "1px solid #EAE6D9", cursor: "pointer" }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: hashColor(rec.name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13.5px", fontWeight: 700, flexShrink: 0, fontFamily: "'Fraunces', serif" }}>{initials(rec.name)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14.5px", fontWeight: 600, color: "#22252A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rec.name || "Unnamed"}</div>
        <div style={{ fontSize: "12px", color: "#9A9384", marginTop: "1px" }}>{rec.sub}</div>
      </div>
      {rec.phone && (
        <a href={"tel:" + rec.phone} onClick={(e) => e.stopPropagation()} className="sd-btn" style={{ width: "34px", height: "34px", borderRadius: "50%", background: "#EFEBE0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#3E6259" }}><Phone size={15} /></a>
      )}
    </div>
  );
}

function EmptyState({ query, label, configured }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 16px", color: "#9A9384" }}>
      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#54504A", marginBottom: "4px" }}>
        {query ? "No one matches that search" : !configured ? "Not connected yet" : `No ${label} found`}
      </div>
      <div style={{ fontSize: "12.5px" }}>{query ? "Try a different name." : !configured ? "Set APPS_SCRIPT_URL to load data." : "Tap the + button below to add one."}</div>
    </div>
  );
}

function PersonDetail({ tab, selected, onBack, onEdit, onDelete, onViewBilling, fields }) {
  const name = tab === "students" ? selected.Name : selected.name;
  const phone = tab === "students" ? selected.Phone : selected.phone;
  const fatherCell = tab === "students" ? selected.FatherCell : null;
  const motherCell = tab === "students" ? selected.MotherCell : null;
  const subLine = tab === "students" ? [selected.Class && ("Class " + selected.Class), selected.Section].filter(Boolean).join(" · ") : selected.subject;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#F6F4EF", zIndex: 20, display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#1F2A3C", padding: "16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <button className="sd-btn" onClick={onBack} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex" }}><ChevronLeft size={22} /></button>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>Details</div>
        <div style={{ flex: 1 }} />
        {onEdit && <button className="sd-btn" onClick={onEdit} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", cursor: "pointer", borderRadius: "8px", padding: "7px", display: "flex" }}><Pencil size={16} /></button>}
        {onDelete && <button className="sd-btn" onClick={onDelete} style={{ background: "rgba(255,255,255,0.12)", border: "none", color: "#fff", cursor: "pointer", borderRadius: "8px", padding: "7px", display: "flex" }}><Trash2 size={16} /></button>}
      </div>
      <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", padding: "22px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "20px" }}>
          <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: hashColor(name), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", fontWeight: 700, fontFamily: "'Fraunces', serif", marginBottom: "10px" }}>{initials(name)}</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: "20px", fontWeight: 600, textAlign: "center" }}>{name}</div>
          <div style={{ fontSize: "12.5px", color: "#9A9384", marginTop: "2px" }}>{subLine}</div>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "22px", flexWrap: "wrap" }}>
          {phone && <CallChip label={tab === "students" ? "Call student" : "Call"} number={phone} />}
          {fatherCell && <CallChip label="Call father" number={fatherCell} />}
          {motherCell && <CallChip label="Call mother" number={motherCell} />}
          {!phone && !fatherCell && !motherCell && <div style={{ fontSize: "12.5px", color: "#9A9384" }}>No phone numbers on file.</div>}
        </div>
        {onViewBilling && (
          <button className="sd-btn" onClick={onViewBilling} style={{ width: "100%", marginBottom: "14px", padding: "10px", borderRadius: "12px", border: "1px solid #E4DFD1", background: "#fff", color: "#1F2A3C", fontWeight: 700, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            <Wallet size={15} /> View billing & payments
          </button>
        )}
        <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #EAE6D9", overflow: "hidden" }}>
          {fields.filter((f) => f.key !== "Name" && f.key !== "name").map((f, i, arr) => (
            <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "11px 14px", borderBottom: i < arr.length - 1 ? "1px solid #F1EEE3" : "none", gap: "16px" }}>
              <div style={{ fontSize: "12.5px", color: "#9A9384", flexShrink: 0 }}>{f.label.replace(" — leave blank to use default", "")}</div>
              <div style={{ fontSize: "13.5px", color: "#22252A", fontWeight: 500, textAlign: "right" }}>{selected[f.key] || <span style={{ color: "#C7C1B2" }}>—</span>}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PersonForm({ tab, isNew, draft, setDraft, fields, onCancel, onSave, syncing }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#F6F4EF", zIndex: 30, display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#1F2A3C", padding: "16px", display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
        <button className="sd-btn" onClick={onCancel} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", display: "flex" }}><X size={22} /></button>
        <div style={{ color: "#fff", fontWeight: 600, fontSize: "15px" }}>{isNew ? (tab === "students" ? "Add student" : "Add teacher") : "Edit details"}</div>
      </div>
      <div className="sd-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
        {fields.map((f) => (
          <div key={f.key} style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>{f.label}{f.required && <span style={{ color: "#B14A3C" }}> *</span>}</label>
            <input value={draft[f.key] || ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} type={f.isPhone ? "tel" : "text"} style={inputStyle} />
          </div>
        ))}
      </div>
      <div style={{ padding: "14px 20px", background: "#F6F4EF", borderTop: "1px solid #EAE6D9", flexShrink: 0 }}>
        <button className="sd-btn" onClick={onSave} disabled={syncing} style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: syncing ? "#9A9384" : "#8A5A44", color: "#fff", fontWeight: 700, fontSize: "14.5px", cursor: syncing ? "default" : "pointer" }}>
          {syncing ? "Saving…" : (isNew ? "Add" : "Save changes")}
        </button>
      </div>
    </div>
  );
}

function ConfirmDelete({ name, onCancel, onConfirm }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(31,42,60,0.45)", zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "300px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "6px" }}>Remove {name}?</div>
        <div style={{ fontSize: "13px", color: "#9A9384", marginBottom: "16px" }}>This will be permanently deleted from the Sheet.</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="sd-btn" onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #E4DFD1", background: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "13.5px" }}>Cancel</button>
          <button className="sd-btn" onClick={onConfirm} style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "none", background: "#B14A3C", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "13.5px" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function SimpleModal({ title, children, onCancel, onSave, onDelete, saveLabel = "Save", saveColor = "#8A5A44" }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(31,42,60,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "300px", maxHeight: "86%", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>{title}</div>
        {children}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button className="sd-btn" onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #E4DFD1", background: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "13.5px" }}>Cancel</button>
          <button className="sd-btn" onClick={onSave} style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "none", background: saveColor, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "13.5px" }}>{saveLabel}</button>
        </div>
        {onDelete && (
          <button className="sd-btn" onClick={onDelete} style={{ width: "100%", marginTop: "8px", padding: "8px", background: "none", border: "none", color: "#B14A3C", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Delete this entry</button>
        )}
      </div>
    </div>
  );
}

function CallChip({ label, number }) {
  return (
    <a href={"tel:" + number} style={{ display: "flex", alignItems: "center", gap: "6px", background: "#EFEBE0", color: "#3E6259", textDecoration: "none", padding: "8px 13px", borderRadius: "20px", fontSize: "12.5px", fontWeight: 600 }}>
      <Phone size={13} /> {label}
    </a>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #EAE6D9", borderRadius: "12px", padding: "10px 8px", textAlign: "center" }}>
      <div style={{ fontSize: "10.5px", color: "#9A9384", marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: color || "#22252A" }}>{value}</div>
    </div>
  );
}

function LoginGate({ onAdminLogin, onStaffLogin, onStaffSignup }) {
  const [mode, setMode] = useState("choose"); // choose | admin | staffLogin | staffSignup
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() { setUsername(""); setPw(""); setConfirmPw(""); setErr(""); }
  function goto(m) { setMode(m); reset(); }

  async function tryAdmin() {
    setErr("");
    const res = await onAdminLogin(username || "admin", pw);
    if (!res.ok) setErr(res.error);
  }
  async function tryStaffLogin() {
    setErr(""); setBusy(true);
    const res = await onStaffLogin(username, pw);
    setBusy(false);
    if (!res.ok) setErr(res.error);
  }
  async function tryStaffSignup() {
    setErr(""); setBusy(true);
    const res = await onStaffSignup(username, pw, confirmPw);
    setBusy(false);
    if (!res.ok) setErr(res.error);
  }

  return (
    <div style={{ position: "absolute", inset: 0, background: "#1F2A3C", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "300px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: "18px", fontWeight: 600, marginBottom: "4px" }}>Shree Tribhuwan Shanti</div>
        <div style={{ fontSize: "11.5px", color: "#9A9384", marginBottom: "18px" }}>Sign in to continue</div>

        {mode === "choose" && (
          <>
            <button className="sd-btn" onClick={() => goto("admin")} style={{ width: "100%", padding: "11px", borderRadius: "11px", border: "none", background: "#8A5A44", color: "#fff", fontWeight: 700, fontSize: "13.5px", cursor: "pointer", marginBottom: "10px" }}>Sign in as Admin</button>
            <button className="sd-btn" onClick={() => goto("staffLogin")} style={{ width: "100%", padding: "11px", borderRadius: "11px", border: "1px solid #E4DFD1", background: "#fff", color: "#1F2A3C", fontWeight: 700, fontSize: "13.5px", cursor: "pointer" }}>Sign in as Staff</button>
          </>
        )}

        {mode === "admin" && (
          <>
            <input value={username} onChange={(e) => { setUsername(e.target.value); setErr(""); }} type="text" placeholder="Username" style={inputStyle} autoFocus />
            <input value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} type="password" placeholder="Password" style={{ ...inputStyle, marginTop: "8px" }} onKeyDown={(e) => e.key === "Enter" && tryAdmin()} />
            {err && <div style={{ color: "#B14A3C", fontSize: "11.5px", marginTop: "6px" }}>{err}</div>}
            <button className="sd-btn" onClick={tryAdmin} style={{ width: "100%", marginTop: "10px", padding: "11px", borderRadius: "11px", border: "none", background: "#8A5A44", color: "#fff", fontWeight: 700, fontSize: "13.5px", cursor: "pointer" }}>Sign in</button>
            <button className="sd-btn" onClick={() => goto("choose")} style={{ width: "100%", marginTop: "8px", padding: "9px", background: "none", border: "none", color: "#9A9384", fontSize: "12px", cursor: "pointer" }}>Back</button>
          </>
        )}

        {mode === "staffLogin" && (
          <>
            <input value={username} onChange={(e) => { setUsername(e.target.value); setErr(""); }} type="text" placeholder="Username" style={inputStyle} autoFocus />
            <input value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} type="password" placeholder="Password" style={{ ...inputStyle, marginTop: "8px" }} onKeyDown={(e) => e.key === "Enter" && tryStaffLogin()} />
            {err && <div style={{ color: "#B14A3C", fontSize: "11.5px", marginTop: "6px" }}>{err}</div>}
            <button className="sd-btn" onClick={tryStaffLogin} disabled={busy} style={{ width: "100%", marginTop: "10px", padding: "11px", borderRadius: "11px", border: "none", background: busy ? "#9A9384" : "#8A5A44", color: "#fff", fontWeight: 700, fontSize: "13.5px", cursor: busy ? "default" : "pointer" }}>{busy ? "Checking…" : "Log In"}</button>
            <button className="sd-btn" onClick={() => goto("staffSignup")} style={{ width: "100%", marginTop: "10px", padding: "9px", background: "none", border: "none", color: "#8A5A44", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>New here? Create an account</button>
            <button className="sd-btn" onClick={() => goto("choose")} style={{ width: "100%", marginTop: "2px", padding: "9px", background: "none", border: "none", color: "#9A9384", fontSize: "12px", cursor: "pointer" }}>Back</button>
          </>
        )}

        {mode === "staffSignup" && (
          <>
            <input value={username} onChange={(e) => { setUsername(e.target.value); setErr(""); }} type="text" placeholder="Choose a username" style={inputStyle} autoFocus />
            <input value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} type="password" placeholder="Choose a password" style={{ ...inputStyle, marginTop: "8px" }} />
            <input value={confirmPw} onChange={(e) => { setConfirmPw(e.target.value); setErr(""); }} type="password" placeholder="Confirm password" style={{ ...inputStyle, marginTop: "8px" }} onKeyDown={(e) => e.key === "Enter" && tryStaffSignup()} />
            {err && <div style={{ color: "#B14A3C", fontSize: "11.5px", marginTop: "6px" }}>{err}</div>}
            <button className="sd-btn" onClick={tryStaffSignup} disabled={busy} style={{ width: "100%", marginTop: "10px", padding: "11px", borderRadius: "11px", border: "none", background: busy ? "#9A9384" : "#8A5A44", color: "#fff", fontWeight: 700, fontSize: "13.5px", cursor: busy ? "default" : "pointer" }}>{busy ? "Creating…" : "Create Account & Continue"}</button>
            <button className="sd-btn" onClick={() => goto("staffLogin")} style={{ width: "100%", marginTop: "8px", padding: "9px", background: "none", border: "none", color: "#9A9384", fontSize: "12px", cursor: "pointer" }}>Already have an account? Log in</button>
            <div style={{ fontSize: "10px", color: "#C7C1B2", marginTop: "12px" }}>Your username is attached to any payment requests you submit, so the admin can review who requested what.</div>
          </>
        )}
      </div>
    </div>
  );
}
