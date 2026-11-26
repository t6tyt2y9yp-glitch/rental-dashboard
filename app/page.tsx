"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "framer-motion";

const RENT_TIERS = [2500, 3000, 5000] as const;
const APPLE_EASE = [0.22, 1, 0.36, 1] as const;
const UNIT_STATUSES = ["Occupied", "Vacant", "Maintenance"] as const;
const PAYMENT_STATUSES = ["Paid", "Partial", "Unpaid"] as const;
const PAYMENT_METHODS = ["Cash", "GCash"] as const;
const ADMIN_EMAIL = "kylemata313131@gmail.com";
const DISPLAY_NAME_BY_EMAIL: Record<string, string> = {
  [ADMIN_EMAIL]: "Kyle",
};
const ELECTRICITY_RATE_STORAGE_KEY = "rental-dashboard:electricity-rate";
const ELECTRICITY_RATE_DISMISSED_KEY =
  "rental-dashboard:electricity-rate-dismissed-at";
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type RentTier = (typeof RENT_TIERS)[number];
type UnitStatus = (typeof UNIT_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type ReceiptExtraction = {
  unit: string;
  current_kwh: number | null;
  payment_date: string | null;
  rent_paid: number | null;
  electricity_paid: number | null;
  billing_period: string | null;
  total_paid: number | null;
};

type BatchMatchedUnit = {
  unitId: string;
  label: string;
  baseRent: RentTier;
};

type BatchFailedItem = {
  fileName: string;
  reason: string;
};

type BatchProgress = {
  current: number;
  total: number;
};

type DashboardUnit = {
  id: string;
  label: string;
  baseRent: RentTier;
  status: UnitStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | "";
  paymentId: string | null;
  previousReading: string;
  currentReading: string;
  paymentDate: string;
  billingPeriod: string;
  rentPaid: string;
  electricityPaid: string;
  amountPaid: string;
  balance: number;
  receiptUrl: string | null;
  message: string | null;
};

type UnitRow = Record<string, unknown>;
type PaymentRow = Record<string, unknown>;

type LedgerEntry = {
  id: string;
  unitName: string;
  totalPaid: number;
  baseRent: number;
  rentPaid: number | null;
  consumedKwh: number | null;
  electricityRate: number | null;
  electricityCharge: number | null;
  billingPeriod: string | null;
  amountPaid: number | null;
  wholeNumber: boolean;
  datePaid: string;
  paymentMethod: string;
  status: PaymentStatus;
  receiptUrl: string | null;
  receivedBy: string;
};

type PaymentHistoryRecord = {
  id: string;
  unitName: string;
  paymentDate: string | null;
  baseRent: number | null;
  rentPaid: number | null;
  consumedKwh: number | null;
  electricityRate: number | null;
  electricityCharge: number | null;
  billingPeriod: string | null;
  amountPaid: number | null;
  totalPaid: number | null;
  paymentMethod: string;
  status: PaymentStatus;
  receiptUrl: string | null;
  receivedBy: string | null;
};

type PaymentEditDraft = {
  id: string;
  unitName: string;
  baseRent: string;
  rentPaid: string;
  electricityPaid: string;
  consumedKwh: string;
  totalDue: string;
  paymentMethod: PaymentMethod | "";
  status: PaymentStatus;
  billingPeriod: string;
  paymentDate: string;
};

type MeterBill = {
  consumed: number | null;
  electricityCharge: number | null;
  totalAmountDue: number | null;
  roundsToWholePeso: boolean;
};

function asBalance(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function readingToInput(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? String(amount) : "";
}

function moneyToInput(value: unknown) {
  return readingToInput(value);
}

function getNextBillingPeriod(currentPeriod: string) {
  const trimmed = currentPeriod.trim();
  const match = /^([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (match) {
    const endName = match[2];
    const year = Number(match[3]);
    const endIndex = MONTH_NAMES.findIndex(
      (month) => month.toLowerCase() === endName.toLowerCase(),
    );
    if (endIndex >= 0 && Number.isFinite(year)) {
      const startIndex = endIndex;
      const nextEndIndex = (endIndex + 1) % 12;
      const endYear = endIndex === 11 ? year + 1 : year;
      return `${MONTH_NAMES[startIndex]} - ${MONTH_NAMES[nextEndIndex]} ${endYear}`;
    }
  }

  const now = new Date();
  const startIndex = now.getMonth();
  const nextEndIndex = (startIndex + 1) % 12;
  const endYear =
    startIndex === 11 ? now.getFullYear() + 1 : now.getFullYear();
  return `${MONTH_NAMES[startIndex]} - ${MONTH_NAMES[nextEndIndex]} ${endYear}`;
}

function readStoredElectricityRate() {
  try {
    return localStorage.getItem(ELECTRICITY_RATE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredElectricityRate(value: string) {
  try {
    if (!value) {
      localStorage.removeItem(ELECTRICITY_RATE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ELECTRICITY_RATE_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

function clearStoredElectricityRate() {
  writeStoredElectricityRate("");
}

function readRateNoticeDismissedAt() {
  try {
    return localStorage.getItem(ELECTRICITY_RATE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeRateNoticeDismissedAt(iso: string) {
  try {
    localStorage.setItem(ELECTRICITY_RATE_DISMISSED_KEY, iso);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

type ElectricityRateMeta = {
  rate: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type ElectricityRateNotice = {
  rate: number | null;
  updatedBy: string;
  updatedAt: string;
};

function rateMetaFromUnitRows(rows: UnitRow[]): ElectricityRateMeta {
  let best: ElectricityRateMeta = {
    rate: null,
    updatedBy: null,
    updatedAt: null,
  };
  let bestTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const updatedAt =
      typeof row.electricity_rate_updated_at === "string" &&
      row.electricity_rate_updated_at
        ? row.electricity_rate_updated_at
        : null;
    const updatedBy =
      typeof row.electricity_rate_updated_by === "string" &&
      row.electricity_rate_updated_by
        ? row.electricity_rate_updated_by
        : null;
    const raw = row.electricity_rate;
    const parsed =
      raw === null || raw === undefined || raw === ""
        ? null
        : Number(raw);
    const rate =
      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    const time = updatedAt ? Date.parse(updatedAt) : Number.NEGATIVE_INFINITY;

    if (
      time > bestTime ||
      (time === bestTime && best.rate == null && rate != null)
    ) {
      bestTime = time;
      best = { rate, updatedBy, updatedAt };
    }
  }

  return best;
}

function formatRateNoticeTime(iso: string) {
  try {
    return `${new Date(iso).toLocaleString("en-PH", {
      timeZone: "Asia/Singapore",
      dateStyle: "medium",
      timeStyle: "short",
    })} (Asia/Singapore)`;
  } catch {
    return iso;
  }
}

function formatRateNoticeActor(email: string | null | undefined) {
  if (!email) {
    return "someone";
  }
  return DISPLAY_NAME_BY_EMAIL[email] ?? email;
}

function shouldShowRateNotice(updatedAt: string | null | undefined) {
  if (!updatedAt) {
    return false;
  }
  const dismissedAt = readRateNoticeDismissedAt();
  if (!dismissedAt) {
    return true;
  }
  const updatedMs = Date.parse(updatedAt);
  const dismissedMs = Date.parse(dismissedAt);
  if (!Number.isFinite(updatedMs)) {
    return false;
  }
  if (!Number.isFinite(dismissedMs)) {
    return true;
  }
  return updatedMs > dismissedMs;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
}

type AudioContextRef = { current: AudioContext | null };

function getAudioContextConstructor(): (typeof AudioContext) | null {
  if (typeof window === "undefined") {
    return null;
  }
  const withWebkit = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return window.AudioContext ?? withWebkit.webkitAudioContext ?? null;
}

function unlockAudio(audioCtxRef: AudioContextRef) {
  try {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) {
      return;
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  } catch {
    // Silent fallback for unsupported / restricted browsers.
  }
}

function scheduleBellPartial(
  ctx: AudioContext,
  destination: AudioNode,
  frequency: number,
  startAt: number,
  peakGain: number,
  duration: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

function playApplePayChime(audioCtxRef: AudioContextRef) {
  try {
    unlockAudio(audioCtxRef);
    const ctx = audioCtxRef.current;
    if (!ctx) {
      return;
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, ctx.currentTime);
    master.connect(ctx.destination);

    const t0 = ctx.currentTime;
    // Note 1: B5 + 2nd harmonic
    scheduleBellPartial(ctx, master, 987.77, t0, 1, 0.28);
    scheduleBellPartial(ctx, master, 1975.53, t0, 0.2, 0.28);
    // Note 2: E6 + 2nd harmonic
    scheduleBellPartial(ctx, master, 1318.51, t0 + 0.11, 1, 0.55);
    scheduleBellPartial(ctx, master, 2637.02, t0 + 0.11, 0.2, 0.55);
  } catch {
    // Silent fallback if audio is blocked or unavailable.
  }
}

function PaymentStatusBadge({
  status,
  isMobile,
  className,
}: {
  status: PaymentStatus;
  isMobile: boolean;
  className: string;
}) {
  if (!isMobile) {
    return <span className={className}>{status}</span>;
  }

  return (
    <motion.span
      key={status}
      initial={{ scale: 0.85 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 18 }}
      className={className}
    >
      {status}
    </motion.span>
  );
}

function MobileSuccessOverlay({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 2200);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-6 md:hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: APPLE_EASE }}
      onClick={onDismiss}
    >
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, scale: 0.86, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 19 }}
        className="w-full max-w-sm rounded-3xl border border-white/40 bg-white/80 px-6 py-8 text-center shadow-2xl backdrop-blur-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-20 w-20 items-center justify-center">
          <svg viewBox="0 0 72 72" className="h-20 w-20" aria-hidden="true">
            <motion.circle
              cx="36"
              cy="36"
              r="30"
              fill="none"
              stroke="#16a34a"
              strokeWidth="4"
              initial={{ pathLength: 0, opacity: 0.35 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.45, ease: APPLE_EASE }}
            />
            <motion.path
              d="M22 37.5 L31.5 47 L51 27"
              fill="none"
              stroke="#16a34a"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, delay: 0.22, ease: APPLE_EASE }}
            />
          </svg>
        </div>
        <p className="mt-4 text-lg font-semibold tracking-tight text-slate-900">
          {message}
        </p>
        <p className="mt-1 text-sm text-slate-500">Tap anywhere to dismiss</p>
      </motion.div>
    </motion.div>
  );
}

type Expense = {
  id: string;
  description: string;
  amount: number;
  expenseDate: string;
};

function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

const supabase = getBrowserSupabase();

function peso(amount: number) {
  return `₱${amount.toLocaleString("en-PH")}`;
}

const fieldClass =
  "min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base font-normal text-slate-900 outline-none focus:border-slate-900";
const primaryButtonClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 sm:w-auto";
const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50";
const dangerButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100";

function asRentTier(value: unknown): RentTier | null {
  const amount = typeof value === "number" ? value : Number(value);
  return RENT_TIERS.find((tier) => tier === amount) ?? null;
}

function asUnitStatus(value: unknown): UnitStatus {
  return UNIT_STATUSES.find((status) => status === value) ?? "Occupied";
}

function asPaymentStatus(value: unknown): PaymentStatus {
  if (value === "Paid" || value === "Partial" || value === "Unpaid") {
    return value;
  }
  return "Unpaid";
}

function asPaymentMethod(value: unknown): PaymentMethod | "" {
  return PAYMENT_METHODS.find((method) => method === value) ?? "";
}

function textValue(row: UnitRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

function rowTime(row: PaymentRow) {
  const raw = row.created_at ?? row.inserted_at ?? row.updated_at;
  const time = typeof raw === "string" ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
}

function mapUnits(unitRows: UnitRow[], paymentRows: PaymentRow[]): DashboardUnit[] {
  const latestPayment = new Map<string, PaymentRow>();

  for (const payment of paymentRows) {
    const unitId = payment.unit_id ?? payment.unitId;
    if (typeof unitId !== "string" && typeof unitId !== "number") {
      continue;
    }
    const key = String(unitId);
    const current = latestPayment.get(key);
    if (!current || rowTime(payment) >= rowTime(current)) {
      latestPayment.set(key, payment);
    }
  }

  return unitRows.flatMap((row) => {
    const baseRent = asRentTier(row.base_rent ?? row.baseRent);
    if (baseRent === null || row.id === undefined || row.id === null) {
      return [];
    }

    const id = String(row.id);
    const payment = latestPayment.get(id);
    const label =
      textValue(row, [
        "unit_number",
        "unit_name",
        "name",
        "label",
        "number",
        "code",
        "title",
      ]) ?? `Unit ${id.slice(0, 8)}`;

    return [
      {
        id,
        label,
        baseRent,
        status: asUnitStatus(row.status),
        paymentStatus: asPaymentStatus(row.payment_status ?? payment?.status),
        paymentMethod: asPaymentMethod(
          row.payment_method ?? payment?.payment_method ?? payment?.method,
        ),
        // Don't re-link last month's Payments row after a new-month reset.
        paymentId:
          asPaymentStatus(row.payment_status) === "Unpaid" ||
          payment?.id === undefined ||
          payment?.id === null
            ? null
            : String(payment.id),
        previousReading: readingToInput(
          row.previous_reading ?? row.previousReading,
        ),
        currentReading: readingToInput(
          row.current_reading ?? row.currentReading,
        ),
        paymentDate:
          typeof row.payment_date === "string" && row.payment_date
            ? row.payment_date.slice(0, 10)
            : "",
        billingPeriod:
          typeof row.billing_period === "string" ? row.billing_period.trim() : "",
        rentPaid: moneyToInput(row.rent_paid),
        electricityPaid: moneyToInput(row.electricity_paid),
        amountPaid: moneyToInput(row.total_paid ?? row.amount_paid),
        balance: asBalance(row.balance),
        // Units.receipt_url is the current-month draft; do not fall back to ledger history.
        receiptUrl:
          typeof row.receipt_url === "string" ? row.receipt_url : null,
        message: null,
      },
    ];
  });
}

function statusTone(status: PaymentStatus) {
  if (status === "Paid") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (status === "Partial") {
    return "bg-yellow-50 text-yellow-800 ring-yellow-200";
  }
  return "bg-red-50 text-red-700 ring-red-200";
}

function mapExpense(row: Record<string, unknown>): Expense | null {
  if (row.id === undefined || row.id === null) {
    return null;
  }

  const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
  const description = typeof row.description === "string" ? row.description.trim() : "";
  const rawDate = row.expense_date;
  const expenseDate = typeof rawDate === "string" ? rawDate : "";

  if (!description || !Number.isFinite(amount)) {
    return null;
  }

  return {
    id: String(row.id),
    description,
    amount,
    expenseDate,
  };
}

function historyNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatRatePeso(rate: number) {
  return `₱${rate.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatConsumedKwhLine(
  consumedKwh: number | null,
  electricityRate: number | null,
  electricityCharge: number | null,
  wholeNumber = false,
) {
  if (consumedKwh == null) {
    return "—";
  }

  const kwhLabel = `${consumedKwh.toLocaleString("en-PH")} kWh`;
  if (electricityRate == null) {
    return kwhLabel;
  }

  const chargeLabel =
    electricityCharge == null
      ? "—"
      : formatMaybePeso(electricityCharge, wholeNumber);

  return `${kwhLabel} × ${formatRatePeso(electricityRate)}/kWh = ${chargeLabel}`;
}

function mapPaymentHistory(
  rows: PaymentRow[],
  unitLabels: Map<string, string>,
): PaymentHistoryRecord[] {
  return rows
    .flatMap((row) => {
      if (row.id === undefined || row.id === null) {
        return [];
      }
      const unitId = row.unit_id ?? row.unitId;
      const unitKey =
        typeof unitId === "string" || typeof unitId === "number"
          ? String(unitId)
          : "";
      const paymentDate =
        typeof row.payment_date === "string"
          ? row.payment_date
          : typeof row.created_at === "string"
            ? row.created_at
            : null;

      const billingPeriod =
        typeof row.billing_period === "string" && row.billing_period.trim()
          ? row.billing_period.trim()
          : null;

      return [
        {
          id: String(row.id),
          unitName:
            unitLabels.get(unitKey) ??
            (unitKey ? `Unit ${unitKey.slice(0, 8)}` : "Unknown unit"),
          paymentDate,
          baseRent: historyNumber(row.base_rent ?? row.baseRent),
          rentPaid: historyNumber(row.rent_paid),
          consumedKwh: historyNumber(row.consumed_kwh),
          electricityRate: historyNumber(row.electricity_rate),
          electricityCharge: historyNumber(
            row.electricity_charge ?? row.electricity_fee,
          ),
          billingPeriod,
          amountPaid: historyNumber(row.amount_paid ?? row.total_due),
          totalPaid: historyNumber(
            row.amount_paid ?? row.total_due ?? row.totalPaid,
          ),
          paymentMethod: asPaymentMethod(row.payment_method ?? row.method) || "",
          status: asPaymentStatus(row.status),
          receiptUrl: typeof row.receipt_url === "string" ? row.receipt_url : null,
          receivedBy:
            typeof row.received_by === "string" && row.received_by.trim()
              ? row.received_by.trim()
              : null,
        },
      ];
    })
    .sort((a, b) => {
      const aTime = a.paymentDate ? Date.parse(a.paymentDate) : 0;
      const bTime = b.paymentDate ? Date.parse(b.paymentDate) : 0;
      return (
        (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
      );
    });
}

function paymentsToLedger(
  rows: PaymentRow[],
  unitLabels: Map<string, string>,
): LedgerEntry[] {
  return mapPaymentHistory(rows, unitLabels).flatMap((record) => {
    if (
      record.status !== "Paid" ||
      record.baseRent === null ||
      record.totalPaid === null
    ) {
      return [];
    }

    return [
      {
        id: record.id,
        unitName: record.unitName,
        totalPaid: record.totalPaid,
        baseRent: record.baseRent,
        rentPaid: record.rentPaid,
        consumedKwh: record.consumedKwh,
        electricityRate: record.electricityRate,
        electricityCharge: record.electricityCharge,
        billingPeriod: record.billingPeriod,
        amountPaid: record.amountPaid,
        wholeNumber: record.baseRent === 5000,
        datePaid: record.paymentDate ?? new Date().toISOString(),
        paymentMethod: record.paymentMethod || "—",
        status: record.status,
        receiptUrl: record.receiptUrl,
        receivedBy: record.receivedBy ?? "—",
      },
    ];
  });
}

function nullableNumberInput(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : null;
}

function historyRecordToEditDraft(record: PaymentHistoryRecord): PaymentEditDraft {
  return {
    id: record.id,
    unitName: record.unitName,
    baseRent: nullableNumberInput(record.baseRent),
    rentPaid: nullableNumberInput(record.rentPaid ?? record.baseRent),
    electricityPaid: nullableNumberInput(record.electricityCharge),
    consumedKwh: nullableNumberInput(record.consumedKwh),
    totalDue: nullableNumberInput(record.amountPaid ?? record.totalPaid),
    paymentMethod: asPaymentMethod(record.paymentMethod) || "",
    status: record.status,
    billingPeriod: record.billingPeriod ?? "",
    paymentDate: record.paymentDate ? record.paymentDate.slice(0, 10) : "",
  };
}

function ledgerEntryToEditDraft(entry: LedgerEntry): PaymentEditDraft {
  return {
    id: entry.id,
    unitName: entry.unitName,
    baseRent: nullableNumberInput(entry.baseRent),
    rentPaid: nullableNumberInput(entry.rentPaid ?? entry.baseRent),
    electricityPaid: nullableNumberInput(entry.electricityCharge),
    consumedKwh: nullableNumberInput(entry.consumedKwh),
    totalDue: nullableNumberInput(entry.amountPaid ?? entry.totalPaid),
    paymentMethod: asPaymentMethod(entry.paymentMethod) || "",
    status: entry.status,
    billingPeriod: entry.billingPeriod ?? "",
    paymentDate: entry.datePaid ? entry.datePaid.slice(0, 10) : "",
  };
}

function sortPaymentHistory(records: PaymentHistoryRecord[]) {
  return [...records].sort((a, b) => {
    const aTime = a.paymentDate ? Date.parse(a.paymentDate) : 0;
    const bTime = b.paymentDate ? Date.parse(b.paymentDate) : 0;
    return (
      (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
    );
  });
}

function sortLedgerEntries(entries: LedgerEntry[]) {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(a.datePaid);
    const bTime = Date.parse(b.datePaid);
    return (
      (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
    );
  });
}

function getStaffMarkPaidBlockers(item: DashboardUnit): string[] {
  const blockers: string[] = [];

  if (!item.paymentMethod) {
    blockers.push("payment method");
  }

  const totalPaid = Number(item.amountPaid);
  if (
    item.amountPaid.trim() === "" ||
    !Number.isFinite(totalPaid) ||
    totalPaid <= 0
  ) {
    blockers.push("total paid");
  }

  if (item.currentReading.trim() === "") {
    blockers.push("current reading");
  } else if (
    item.previousReading.trim() !== "" &&
    Number.isFinite(Number(item.previousReading)) &&
    Number.isFinite(Number(item.currentReading)) &&
    Number(item.currentReading) < Number(item.previousReading)
  ) {
    blockers.push("readings");
  }

  return blockers;
}

function staffMarkPaidHint(blockers: string[]) {
  const needsMethod = blockers.includes("payment method");
  const needsTotal = blockers.includes("total paid");
  const needsReadings =
    blockers.includes("current reading") || blockers.includes("readings");

  if (needsMethod && needsReadings && !needsTotal) {
    return "Select a payment method and enter readings first.";
  }
  if (needsMethod && needsTotal && needsReadings) {
    return "Select a payment method, enter total paid, and enter readings first.";
  }
  if (needsMethod && needsTotal) {
    return "Select a payment method and enter total paid first.";
  }
  if (needsTotal && needsReadings) {
    return "Enter total paid and readings first.";
  }
  if (needsMethod) {
    return "Select a payment method first.";
  }
  if (needsTotal) {
    return "Enter total paid first.";
  }
  if (needsReadings) {
    return "Enter valid meter readings first.";
  }
  return "Complete the required payment fields first.";
}

function formatExpenseDate(value: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value.includes("T") ? value : `${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function paymentMonthKey(value: string) {
  if (!value) {
    return null;
  }

  const sliced = value.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(sliced)) {
    return sliced;
  }

  const date = new Date(value.includes("T") ? value : `${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function formatMonthOption(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthKey;
  }

  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
  });
}

function isAdminEmail(email: string | null | undefined) {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

function receivedByFromUser(user: User | null) {
  const email = user?.email?.trim();
  if (!email) {
    return "Unknown";
  }
  const mapped = DISPLAY_NAME_BY_EMAIL[email.toLowerCase()];
  return mapped ?? email;
}

function normalizeUnitName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/UNIT/g, "")
    .replace(/\s+/g, "");
}

function findUnitByReceiptName(units: DashboardUnit[], unitName: string) {
  const needle = normalizeUnitName(unitName);
  if (!needle) {
    return null;
  }

  return (
    units.find((unit) => normalizeUnitName(unit.label) === needle) ?? null
  );
}

function hasFiniteInput(value: string) {
  if (!value.trim()) {
    return false;
  }
  return Number.isFinite(Number(value));
}

function ocrMoneyMismatch(item: DashboardUnit) {
  if (
    !hasFiniteInput(item.rentPaid) ||
    !hasFiniteInput(item.electricityPaid) ||
    !hasFiniteInput(item.amountPaid)
  ) {
    return false;
  }
  const rent = Number(item.rentPaid);
  const electricity = Number(item.electricityPaid);
  const total = Number(item.amountPaid);
  return Math.abs(rent + electricity - total) > 0.009;
}

function ocrReadingMismatch(item: DashboardUnit) {
  if (
    !hasFiniteInput(item.previousReading) ||
    !hasFiniteInput(item.currentReading)
  ) {
    return false;
  }
  return Number(item.currentReading) < Number(item.previousReading);
}

function ReceiptThumbnail({
  receiptUrl,
  label,
  className,
  onOpen,
}: {
  receiptUrl: string;
  label: string;
  className?: string;
  onOpen: () => void;
}) {
  const [expired, setExpired] = useState(false);

  if (!receiptUrl || expired) {
    return (
      <div
        className={`rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200 ${className ?? ""}`}
      >
        Image archived/expired
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={`group overflow-hidden rounded-xl bg-slate-50 text-left ring-1 ring-slate-200 ${className ?? ""}`}
    >
      <img
        src={receiptUrl}
        alt={`Receipt for ${label}`}
        className="h-36 w-full object-cover transition group-hover:opacity-95 sm:h-40"
        onError={() => setExpired(true)}
      />
      <span className="block px-3 py-2 text-xs font-medium text-slate-600">
        Tap to verify receipt photo
      </span>
    </button>
  );
}

function unitPatchFromExtraction(
  extraction: ReceiptExtraction,
  receiptUrl: string | null,
  options?: { allowBillingPeriod?: boolean },
): Partial<DashboardUnit> {
  const unitPatch: Partial<DashboardUnit> = {
    currentReading: String(extraction.current_kwh),
    receiptUrl,
    message: null,
  };
  if (typeof extraction.payment_date === "string" && extraction.payment_date) {
    unitPatch.paymentDate = extraction.payment_date;
  }
  if (
    options?.allowBillingPeriod &&
    typeof extraction.billing_period === "string" &&
    extraction.billing_period.trim()
  ) {
    unitPatch.billingPeriod = extraction.billing_period.trim();
  }
  if (
    typeof extraction.rent_paid === "number" &&
    Number.isFinite(extraction.rent_paid)
  ) {
    unitPatch.rentPaid = String(extraction.rent_paid);
  }
  if (
    typeof extraction.electricity_paid === "number" &&
    Number.isFinite(extraction.electricity_paid)
  ) {
    unitPatch.electricityPaid = String(extraction.electricity_paid);
  }
  if (
    typeof extraction.total_paid === "number" &&
    Number.isFinite(extraction.total_paid)
  ) {
    unitPatch.amountPaid = String(extraction.total_paid);
  }
  return unitPatch;
}

function compressReceiptImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const maxWidth = 1200;
      const scale = image.width > maxWidth ? maxWidth / image.width : 1;
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not compress that image."));
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };

    image.src = objectUrl;
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [header, data] = dataUrl.split(",");
  const mimeType = /^data:([^;]+);base64$/i.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function uploadReceiptImage(unitId: string, dataUrl: string) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const path = `${unitId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("receipts").upload(path, dataUrlToBlob(dataUrl), {
    contentType: "image/jpeg",
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return supabase.storage.from("receipts").getPublicUrl(path).data.publicUrl;
}

export default function Home() {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [mobileSuccess, setMobileSuccess] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTier, setActiveTier] = useState<RentTier>(2500);
  const [units, setUnits] = useState<DashboardUnit[]>([]);
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const user = session?.user ?? null;
  const sessionUserId = user?.id ?? null;
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerMonth, setLedgerMonth] = useState(""); // "" = All Months
  const [electricityRateInput, setElectricityRateInput] = useState("");
  const [electricityRateNotice, setElectricityRateNotice] =
    useState<ElectricityRateNotice | null>(null);
  const [startingNewMonth, setStartingNewMonth] = useState(false);
  const lastRateUpdatedAtRef = useRef<string | null>(null);
  const persistRateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchMatched, setBatchMatched] = useState<BatchMatchedUnit[]>([]);
  const [batchFailed, setBatchFailed] = useState<BatchFailedItem[]>([]);
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  const [receiptNoticeIsError, setReceiptNoticeIsError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openUnitIds, setOpenUnitIds] = useState<Record<string, boolean>>({});
  const [selectedDesktopUnitId, setSelectedDesktopUnitId] = useState<
    string | null
  >(null);
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryRecord[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<LedgerEntry | null>(null);
  const [paymentEditDraft, setPaymentEditDraft] = useState<PaymentEditDraft | null>(
    null,
  );
  const [savingPaymentEdit, setSavingPaymentEdit] = useState(false);
  const [paymentEditError, setPaymentEditError] = useState<string | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [pendingPaidUnitId, setPendingPaidUnitId] = useState<string | null>(null);
  const [confirmingPaid, setConfirmingPaid] = useState(false);

  const isAdmin = isAdminEmail(user?.email);
  const roleLabel = isAdmin ? "Admin" : "Staff";

  const hasValidElectricityRate =
    electricityRateInput !== "" &&
    Number.isFinite(Number(electricityRateInput)) &&
    Number(electricityRateInput) > 0;
  // Never fall back to a default rate when the input is cleared or invalid.
  const electricityRate = hasValidElectricityRate ? electricityRateInput : null;
  const electricityRateRequiredMessage =
    "Enter an Electricity Rate (₱ / kWh) at the top before marking as paid.";
  const [billingPeriodPlaceholder, setBillingPeriodPlaceholder] = useState(
    "Month - Month YYYY",
  );

  useEffect(() => {
    // Defer Date.now() so prerender does not capture a blocking current-time read.
    setBillingPeriodPlaceholder(getNextBillingPeriod(""));
  }, []);

  function applyElectricityRateMeta(
    meta: ElectricityRateMeta,
    options?: { showNotice?: boolean },
  ) {
    if (meta.rate != null) {
      const text = String(meta.rate);
      setElectricityRateInput(text);
      writeStoredElectricityRate(text);
    } else {
      setElectricityRateInput("");
      clearStoredElectricityRate();
    }

    if (meta.updatedAt) {
      lastRateUpdatedAtRef.current = meta.updatedAt;
    }

    if (
      options?.showNotice &&
      meta.updatedAt &&
      shouldShowRateNotice(meta.updatedAt)
    ) {
      setElectricityRateNotice({
        rate: meta.rate,
        updatedBy: formatRateNoticeActor(meta.updatedBy),
        updatedAt: meta.updatedAt,
      });
    }
  }

  function dismissElectricityRateNotice() {
    const stamp =
      electricityRateNotice?.updatedAt ?? new Date().toISOString();
    writeRateNoticeDismissedAt(stamp);
    setElectricityRateNotice(null);
  }

  useEffect(() => {
    const cached = readStoredElectricityRate();
    if (
      cached !== "" &&
      Number.isFinite(Number(cached)) &&
      Number(cached) > 0
    ) {
      setElectricityRateInput(cached);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setAuthReady(true);
      return;
    }

    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) {
        return;
      }
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Wait until auth has resolved so the Units fetch is not skipped on the
    // initial null-session render before getSession()/onAuthStateChange run.
    if (!authReady) {
      return;
    }

    let cancelled = false;

    async function loadDashboard() {
      if (!sessionUserId) {
        if (!cancelled) {
          setUnits([]);
          setLedger([]);
          setExpenses([]);
          setLoadError(null);
          setExpensesError(null);
          setLoading(false);
          setExpensesLoading(false);
        }
        return;
      }

      if (!supabase) {
        if (!cancelled) {
          setLoadError("Supabase URL or anon key is missing.");
          setExpensesError("Supabase URL or anon key is missing.");
          setLoading(false);
          setExpensesLoading(false);
        }
        return;
      }

      setLoading(true);
      setExpensesLoading(true);
      setLoadError(null);

      const [
        { data: unitRows, error: unitError },
        expenseResult,
        paymentResult,
      ] = await Promise.all([
        supabase.from("Units").select("*"),
        supabase.from("Expenses").select("id, description, amount, expense_date"),
        supabase
          .from("Payments")
          .select("*")
          .order("payment_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      let paymentRows = paymentResult.data;
      let paymentError = paymentResult.error;
      if (paymentError && /payment_date|created_at/i.test(paymentError.message)) {
        const fallback = await supabase
          .from("Payments")
          .select("*")
          .order("created_at", { ascending: false });
        paymentRows = fallback.data;
        paymentError = fallback.error;
      }

      if (cancelled) {
        return;
      }

      if (expenseResult.error) {
        setExpensesError(expenseResult.error.message);
        setExpenses([]);
      } else {
        const mappedExpenses = (expenseResult.data ?? [])
          .flatMap((row) => {
            const expense = mapExpense(row);
            return expense ? [expense] : [];
          })
          .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
        setExpenses(mappedExpenses);
        setExpensesError(null);
      }
      setExpensesLoading(false);

      if (unitError) {
        console.error("Supabase Units query failed:", unitError);
        setLoadError(unitError.message);
        setUnits([]);
        setLedger([]);
        setLoading(false);
        return;
      }

      const safeUnitRows = unitRows ?? [];
      const safePaymentRows = paymentError ? [] : (paymentRows ?? []);
      const mapped = mapUnits(safeUnitRows, safePaymentRows).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
      const labels = new Map(mapped.map((unit) => [unit.id, unit.label]));
      setUnits(mapped);
      setLedger(paymentsToLedger(safePaymentRows, labels));

      const rateMeta = rateMetaFromUnitRows(safeUnitRows);
      applyElectricityRateMeta(rateMeta, { showNotice: true });

      if (paymentError) {
        setLoadError(paymentError.message);
      } else if ((unitRows?.length ?? 0) > 0 && mapped.length === 0) {
        setLoadError(
          "Units were found, but none have a base rent of ₱2,500, ₱3,000, or ₱5,000.",
        );
      } else {
        setLoadError(null);
      }
      setLoading(false);
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [authReady, sessionUserId]);

  useEffect(() => {
    if (!supabase || !sessionUserId) {
      return;
    }

    const channel = supabase
      .channel("electricity-rate-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "Units",
        },
        (payload) => {
          const next = payload.new as UnitRow;
          const prev = payload.old as UnitRow | undefined;
          const nextUpdatedAt =
            typeof next.electricity_rate_updated_at === "string"
              ? next.electricity_rate_updated_at
              : null;
          const prevUpdatedAt =
            typeof prev?.electricity_rate_updated_at === "string"
              ? prev.electricity_rate_updated_at
              : null;
          const nextRate = next.electricity_rate;
          const prevRate = prev?.electricity_rate;

          const rateChanged =
            nextRate !== prevRate || nextUpdatedAt !== prevUpdatedAt;
          if (!rateChanged) {
            return;
          }

          if (
            nextUpdatedAt &&
            lastRateUpdatedAtRef.current === nextUpdatedAt
          ) {
            // Already applied from local save / prior event for this stamp.
            return;
          }

          applyElectricityRateMeta(rateMetaFromUnitRows([next]), {
            showNotice: true,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionUserId]);

  const visibleUnits = useMemo(
    () => units.filter((item) => item.baseRent === activeTier),
    [units, activeTier],
  );

  useEffect(() => {
    if (visibleUnits.length === 0) {
      setSelectedDesktopUnitId(null);
      return;
    }

    setSelectedDesktopUnitId((current) =>
      current && visibleUnits.some((unit) => unit.id === current)
        ? current
        : visibleUnits[0].id,
    );
  }, [visibleUnits]);

  const selectedDesktopUnit =
    visibleUnits.find((unit) => unit.id === selectedDesktopUnitId) ?? null;

  function announceSuccess(message: string) {
    if (isMobile && !reduceMotion) {
      setMobileSuccess(message);
      setReceiptNotice(null);
      setReceiptNoticeIsError(false);
      return;
    }
    setReceiptNoticeIsError(false);
    setReceiptNotice(message);
  }

  const ledgerMonthOptions = useMemo(() => {
    const months = new Set<string>();
    for (const entry of ledger) {
      const key = paymentMonthKey(entry.datePaid);
      if (key) {
        months.add(key);
      }
    }
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [ledger]);

  const ledgerFilterActive =
    ledgerSearch.trim() !== "" || ledgerMonth !== "";

  const filteredLedger = useMemo(() => {
    const query = ledgerSearch.trim().toLowerCase();
    return ledger.filter((entry) => {
      const matchesSearch =
        query === "" ||
        entry.unitName.toLowerCase().includes(query) ||
        entry.receivedBy.toLowerCase().includes(query);
      const matchesMonth =
        ledgerMonth === "" || paymentMonthKey(entry.datePaid) === ledgerMonth;
      return matchesSearch && matchesMonth;
    });
  }, [ledger, ledgerMonth, ledgerSearch]);

  async function writeElectricityRateToUnits(rate: number | null) {
    if (!supabase) {
      return;
    }

    const ids = unitsRef.current.map((unit) => unit.id);
    if (ids.length === 0) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const updatedBy = user?.email ?? null;
    lastRateUpdatedAtRef.current = updatedAt;

    const { error } = await supabase
      .from("Units")
      .update({
        electricity_rate: rate,
        electricity_rate_updated_by: updatedBy,
        electricity_rate_updated_at: updatedAt,
      })
      .in("id", ids);

    if (error) {
      console.error("Failed to save electricity rate:", error);
      return;
    }

    // Local sessions still get the banner if they reopen later; active peers
    // receive the realtime UPDATE. Show locally for the editor too.
    applyElectricityRateMeta(
      {
        rate,
        updatedBy,
        updatedAt,
      },
      { showNotice: true },
    );
  }

  async function persistElectricityRate(value: string) {
    setElectricityRateInput(value);

    if (value === "") {
      clearStoredElectricityRate();
      await writeElectricityRateToUnits(null);
      return;
    }

    const valid = Number.isFinite(Number(value)) && Number(value) > 0;
    if (!valid) {
      return;
    }

    writeStoredElectricityRate(value);
    await writeElectricityRateToUnits(Number(value));
  }

  function schedulePersistElectricityRate(value: string) {
    setElectricityRateInput(value);
    if (value === "") {
      clearStoredElectricityRate();
    } else if (Number.isFinite(Number(value)) && Number(value) > 0) {
      writeStoredElectricityRate(value);
    }

    if (persistRateTimerRef.current) {
      clearTimeout(persistRateTimerRef.current);
    }
    persistRateTimerRef.current = setTimeout(() => {
      void persistElectricityRate(value);
    }, 450);
  }

  async function clearElectricityRateEverywhere() {
    setElectricityRateInput("");
    clearStoredElectricityRate();
    await writeElectricityRateToUnits(null);
  }

  function changeBillingPeriod(item: DashboardUnit, next: string) {
    if (!isAdmin) {
      return;
    }
    patchUnit(item.id, {
      billingPeriod: next,
      message: null,
    });
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setLoginError("Supabase is not configured.");
      return;
    }

    setSigningIn(true);
    setLoginError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    setSigningIn(false);

    if (error) {
      setLoginError(error.message);
      return;
    }

    setLoginPassword("");
  }

  async function signOut() {
    if (!supabase) {
      return;
    }

    setSigningOut(true);
    setLoginError(null);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);

    if (error) {
      setLoadError(error.message);
    }
  }

  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedDescription = description.trim();
    const parsedAmount = Number(amount);

    if (!trimmedDescription) {
      setExpensesError("Enter a description.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setExpensesError("Enter an amount of zero or more.");
      return;
    }
    if (!supabase) {
      setExpensesError("Supabase is not configured.");
      return;
    }

    setSavingExpense(true);
    setExpensesError(null);

    const { data, error } = await supabase
      .from("Expenses")
      .insert({
        description: trimmedDescription,
        amount: parsedAmount,
        expense_date: new Date().toISOString().slice(0, 10),
      })
      .select("id, description, amount, expense_date")
      .single();

    setSavingExpense(false);

    if (error) {
      setExpensesError(error.message);
      return;
    }

    const expense = mapExpense(data);
    if (expense) {
      setExpenses((current) => [expense, ...current]);
    }
    setDescription("");
    setAmount("");
  }

  function patchUnit(id: string, patch: Partial<DashboardUnit>) {
    setUnits((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function clearBalance(item: DashboardUnit) {
    if (!isAdmin) {
      return;
    }
    if (item.balance <= 0) {
      return;
    }

    const confirmed = window.confirm(
      `Clear remaining balance of ${peso(item.balance)} for ${item.label}?`,
    );
    if (!confirmed) {
      return;
    }

    if (!supabase) {
      patchUnit(item.id, { message: "Supabase is not configured." });
      return;
    }

    const previousBalance = item.balance;
    patchUnit(item.id, { balance: 0, message: null });

    const { error } = await supabase
      .from("Units")
      .update({ balance: 0 })
      .eq("id", item.id);

    if (error) {
      patchUnit(item.id, {
        balance: previousBalance,
        message: error.message,
      });
    }
  }

  async function changeStatus(item: DashboardUnit, status: UnitStatus) {
    if (!isAdmin) {
      patchUnit(item.id, {
        message: "Only Admin can change unit status.",
      });
      return;
    }

    patchUnit(item.id, { status, message: null });
    if (!supabase) {
      patchUnit(item.id, {
        status: item.status,
        message: "Supabase is not configured.",
      });
      return;
    }

    const { error } = await supabase
      .from("Units")
      .update({ status })
      .eq("id", item.id);

    if (error) {
      patchUnit(item.id, {
        status: item.status,
        message: error.message,
      });
    }
  }

  async function changeMethod(item: DashboardUnit, paymentMethod: PaymentMethod) {
    patchUnit(item.id, { paymentMethod, message: null });
    if (!supabase) {
      patchUnit(item.id, {
        paymentMethod: item.paymentMethod,
        message: "Supabase is not configured.",
      });
      return;
    }

    if (item.paymentId) {
      const { error } = await supabase
        .from("Payments")
        .update({ payment_method: paymentMethod })
        .eq("id", item.paymentId);

      if (error) {
        patchUnit(item.id, {
          paymentMethod: item.paymentMethod,
          message: error.message,
        });
      }
      return;
    }

    const { data, error } = await supabase
      .from("Payments")
      .insert({
        unit_id: item.id,
        base_rent: item.baseRent,
        electricity_fee: 0,
        kwh_reading: null,
        total_due: item.baseRent,
        status: item.paymentStatus,
        payment_method: paymentMethod,
      })
      .select("id")
      .single();

    if (error) {
      patchUnit(item.id, {
        paymentMethod: item.paymentMethod,
        message: error.message,
      });
      return;
    }

    patchUnit(item.id, {
      paymentId: String(data.id),
      paymentStatus: item.paymentStatus,
    });
  }

  async function startNewMonth() {
    if (!isAdmin || startingNewMonth) {
      return;
    }

    const confirmed = window.confirm(
      "Start a new month? Current readings will move to previous readings, current readings will be cleared, payment drafts will reset, and the electricity rate will be cleared.",
    );
    if (!confirmed) {
      return;
    }

    setStartingNewMonth(true);

    try {
      const before = unitsRef.current;
      const samplePeriod =
        before.find((unit) => unit.billingPeriod.trim())?.billingPeriod ?? "";
      const nextPeriod = getNextBillingPeriod(samplePeriod);

      await clearElectricityRateEverywhere();

      const rolled = before.map((unit) => {
        const currentNum = Number(unit.currentReading);
        const hasValidCurrent =
          unit.currentReading.trim() !== "" &&
          Number.isFinite(currentNum) &&
          currentNum > 0;

        return {
          ...unit,
          previousReading: hasValidCurrent
            ? String(currentNum)
            : unit.previousReading,
          currentReading: "",
          paymentDate: "",
          billingPeriod: nextPeriod,
          rentPaid: "",
          electricityPaid: "",
          amountPaid: "",
          paymentStatus:
            unit.status === "Occupied" ? ("Unpaid" as const) : unit.paymentStatus,
          paymentId: null,
          receiptUrl: null,
          message: null,
        };
      });

      setUnits(rolled);
      unitsRef.current = rolled;

      if (!supabase) {
        return;
      }

      await Promise.all(
        before.map(async (unit, index) => {
          const next = rolled[index];
          const currentNum = Number(unit.currentReading);
          const hasValidCurrent =
            unit.currentReading.trim() !== "" &&
            Number.isFinite(currentNum) &&
            currentNum > 0;

          const payload: Record<string, unknown> = {
            current_reading: null,
            payment_date: null,
            rent_paid: null,
            electricity_paid: null,
            total_paid: null,
            receipt_url: null,
            billing_period: nextPeriod,
          };

          // Roll current → previous only when current is valid; never wipe previous to null.
          if (hasValidCurrent) {
            payload.previous_reading = currentNum;
          }

          if (next.status === "Occupied") {
            payload.payment_status = "Unpaid";
          }

          await supabase.from("Units").update(payload).eq("id", unit.id);
        }),
      );
    } finally {
      setStartingNewMonth(false);
    }
  }

  function canSubmitMarkAsPaid(item: DashboardUnit) {
    if (item.paymentStatus === "Paid") {
      return false;
    }
    if (!hasValidElectricityRate) {
      return false;
    }
    return getStaffMarkPaidBlockers(item).length === 0;
  }

  function requestMarkAsPaid(item: DashboardUnit) {
    if (item.paymentStatus === "Paid") {
      return;
    }

    if (!hasValidElectricityRate) {
      patchUnit(item.id, {
        message: electricityRateRequiredMessage,
      });
      return;
    }

    const blockers = getStaffMarkPaidBlockers(item);
    if (blockers.length > 0) {
      patchUnit(item.id, {
        message: staffMarkPaidHint(blockers),
      });
      return;
    }

    if (!isAdmin) {
      setPendingPaidUnitId(item.id);
      return;
    }

    // Admin: instant save (unlock on mobile for the chime).
    if (isMobile) {
      unlockAudio(audioCtxRef);
    }
    void changePaymentStatus(item, "Paid");
  }

  async function confirmStaffMarkAsPaid() {
    if (!pendingPaidUnitId) {
      return;
    }

    const item = unitsRef.current.find((unit) => unit.id === pendingPaidUnitId);
    if (!item) {
      setPendingPaidUnitId(null);
      return;
    }

    if (!canSubmitMarkAsPaid(item)) {
      const blockers = getStaffMarkPaidBlockers(item);
      patchUnit(item.id, {
        message: !hasValidElectricityRate
          ? electricityRateRequiredMessage
          : staffMarkPaidHint(blockers),
      });
      setPendingPaidUnitId(null);
      return;
    }

    setConfirmingPaid(true);
    try {
      await changePaymentStatus(item, "Paid");
    } finally {
      setConfirmingPaid(false);
      setPendingPaidUnitId(null);
    }
  }

  async function changePaymentStatus(item: DashboardUnit, next: PaymentStatus) {
    if (next === item.paymentStatus) {
      return;
    }

    // Staff cannot change payment status via dropdown — only Mark as Paid.
    if (!isAdmin && next !== "Paid") {
      return;
    }

    const markingPaid = next === "Paid";
    if (markingPaid && !hasValidElectricityRate) {
      patchUnit(item.id, {
        message: electricityRateRequiredMessage,
      });
      return;
    }

    if (markingPaid) {
      const blockers = getStaffMarkPaidBlockers(item);
      if (blockers.length > 0) {
        patchUnit(item.id, {
          message: staffMarkPaidHint(blockers),
        });
        return;
      }
    }

    // Unlock audio during the user gesture so iOS/Android allow the success chime.
    // Do NOT flip local status to Paid until Supabase writes succeed.
    if (markingPaid && isMobile) {
      unlockAudio(audioCtxRef);
    }

    const bill = markingPaid
      ? meterBill(
          item.previousReading,
          item.currentReading,
          electricityRate,
          item.baseRent,
          item.balance,
        )
      : null;

    const receivedBy = markingPaid ? receivedByFromUser(user) : null;
    const consumedKwh = bill?.consumed == null ? null : Number(bill.consumed);
    const rateSnapshot =
      electricityRate !== null && Number.isFinite(Number(electricityRate))
        ? Number(electricityRate)
        : null;
    const scannedElectricity = Number(item.electricityPaid);
    const hasScannedElectricity =
      item.electricityPaid.trim() !== "" && Number.isFinite(scannedElectricity);
    const calculatedElectricity =
      consumedKwh != null && rateSnapshot != null
        ? Number((consumedKwh * rateSnapshot).toFixed(bill?.roundsToWholePeso ? 0 : 2))
        : bill?.electricityCharge == null
          ? null
          : Number(bill.electricityCharge);
    const electricityChargeSnapshot = hasScannedElectricity
      ? scannedElectricity
      : calculatedElectricity;
    const scannedRent = Number(item.rentPaid);
    const rentPaidSnapshot =
      item.rentPaid.trim() !== "" && Number.isFinite(scannedRent)
        ? scannedRent
        : Number(item.baseRent);
    const totalDue =
      bill?.totalAmountDue == null
        ? item.baseRent + item.balance
        : Number(bill.totalAmountDue);
    const scannedTotal = Number(item.amountPaid);
    const amountPaid =
      item.amountPaid.trim() !== "" && Number.isFinite(scannedTotal)
        ? scannedTotal
        : totalDue;
    const nextBalance = Math.max(0, totalDue - amountPaid);
    const paymentDate =
      item.paymentDate.trim() || new Date().toISOString().slice(0, 10);
    const billingPeriod = item.billingPeriod.trim() || null;

    if (markingPaid) {
      if (!supabase) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: "Supabase is not configured.",
        });
        return;
      }

      const { data, error } = await supabase
        .from("Payments")
        .insert({
          unit_id: item.id,
          base_rent: Number(item.baseRent),
          rent_paid: rentPaidSnapshot,
          electricity_fee: electricityChargeSnapshot ?? 0,
          electricity_rate: rateSnapshot,
          electricity_charge: electricityChargeSnapshot,
          consumed_kwh: consumedKwh,
          payment_date: paymentDate,
          billing_period: billingPeriod,
          amount_paid: amountPaid,
          total_due: amountPaid,
          status: "Paid",
          payment_method: item.paymentMethod || null,
          receipt_url: item.receiptUrl,
          received_by: receivedBy,
        })
        .select("*")
        .single();

      if (error) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: error.message,
        });
        return;
      }

      const { error: unitPaidError } = await supabase
        .from("Units")
        .update({
          balance: nextBalance,
          payment_status: "Paid",
          payment_date: paymentDate,
          billing_period: billingPeriod,
          rent_paid: rentPaidSnapshot,
          electricity_paid: electricityChargeSnapshot,
          total_paid: amountPaid,
          receipt_url: item.receiptUrl,
        })
        .eq("id", item.id);

      if (unitPaidError) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: unitPaidError.message,
        });
        return;
      }

      patchUnit(item.id, {
        paymentId: String(data.id),
        paymentStatus: "Paid",
        balance: nextBalance,
        paymentDate,
        billingPeriod: billingPeriod ?? item.billingPeriod,
        rentPaid: String(rentPaidSnapshot),
        electricityPaid:
          electricityChargeSnapshot == null
            ? item.electricityPaid
            : String(electricityChargeSnapshot),
        amountPaid: String(amountPaid),
        message: null,
      });

      const labels = new Map(
        unitsRef.current.map((unit) => [unit.id, unit.label]),
      );
      const [entry] = paymentsToLedger([data], labels);
      if (entry) {
        setLedger((current) => [
          entry,
          ...current.filter((row) => row.id !== entry.id),
        ]);
      }

      if (isMobile) {
        playApplePayChime(audioCtxRef);
        try {
          navigator.vibrate?.([30, 50, 40]);
        } catch {
          // Haptics are best-effort only.
        }
      }
      announceSuccess(`${item.label} Marked as Paid`);
      return;
    }

    if (supabase) {
      const { error: unitStatusError } = await supabase
        .from("Units")
        .update({ payment_status: next })
        .eq("id", item.id);

      if (unitStatusError) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: unitStatusError.message,
        });
        return;
      }
    }

    if (supabase && item.paymentId) {
      const { error } = await supabase
        .from("Payments")
        .update({ status: next })
        .eq("id", item.paymentId);

      if (error) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: error.message,
        });
        return;
      }
    }

    patchUnit(item.id, { paymentStatus: next, message: null });
  }

  function focusMatchedUnit(unit: BatchMatchedUnit) {
    setActiveTier(unit.baseRent);
    setSelectedDesktopUnitId(unit.unitId);
    setOpenUnitIds((current) => ({
      ...current,
      [unit.unitId]: true,
    }));
  }

  function renderUnitEditor(
    item: DashboardUnit,
    options?: { split?: boolean },
  ) {
    const split = options?.split === true;
    const bill = meterBill(
      item.previousReading,
      item.currentReading,
      electricityRate,
      item.baseRent,
      item.balance,
    );
    const totalDueDisplay =
      bill.totalAmountDue == null
        ? item.baseRent + item.balance
        : bill.totalAmountDue;
    const moneyMismatch = ocrMoneyMismatch(item);
    const readingMismatch = ocrReadingMismatch(item);

    return (
      <div
        className={
          split
            ? "grid grid-cols-1 gap-4 sm:grid-cols-2"
            : "flex flex-col gap-4"
        }
      >
        {item.receiptUrl ? (
          <ReceiptThumbnail
            receiptUrl={item.receiptUrl}
            label={item.label}
            className={split ? "sm:col-span-2" : undefined}
            onOpen={() => setReceiptPreview(item.receiptUrl)}
          />
        ) : null}
        {moneyMismatch || readingMismatch ? (
          <div
            className={`space-y-2 ${split ? "sm:col-span-2" : ""}`}
            role="status"
          >
            {moneyMismatch ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Amount mismatch: rent paid (
                {peso(Number(item.rentPaid))}) + electricity paid (
                {peso(Number(item.electricityPaid))}) does not equal total paid (
                {peso(Number(item.amountPaid))}). Check the receipt before
                marking as paid.
              </p>
            ) : null}
            {readingMismatch ? (
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                Reading mismatch: current kWh (
                {Number(item.currentReading).toLocaleString("en-PH")}) is lower
                than previous kWh (
                {Number(item.previousReading).toLocaleString("en-PH")}). Verify
                the handwritten meter reading.
              </p>
            ) : null}
          </div>
        ) : null}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Previous kWh
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.previousReading}
            readOnly={!isAdmin}
            disabled={!isAdmin}
            onChange={(event) => {
              if (!isAdmin) {
                return;
              }
              patchUnit(item.id, {
                previousReading: event.target.value,
                message: null,
              });
            }}
            placeholder="Previous kWh"
            className={`${fieldClass}${
              isAdmin ? "" : " cursor-not-allowed bg-slate-50 text-slate-600"
            }`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Current kWh
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.currentReading}
            onChange={(event) =>
              patchUnit(item.id, {
                currentReading: event.target.value,
                message: null,
              })
            }
            placeholder="Current kWh"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Payment Date
          <input
            type="date"
            value={item.paymentDate}
            onChange={(event) =>
              patchUnit(item.id, {
                paymentDate: event.target.value,
                message: null,
              })
            }
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Billing Period
          <input
            type="text"
            value={item.billingPeriod}
            readOnly={!isAdmin}
            disabled={!isAdmin}
            onChange={(event) => {
              changeBillingPeriod(item, event.target.value);
            }}
            placeholder={billingPeriodPlaceholder}
            className={`${fieldClass}${
              isAdmin ? "" : " cursor-not-allowed bg-slate-50 text-slate-600"
            }`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Rent Paid
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.rentPaid}
            onChange={(event) =>
              patchUnit(item.id, {
                rentPaid: event.target.value,
                message: null,
              })
            }
            placeholder="2500"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Electricity Paid
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.electricityPaid}
            onChange={(event) =>
              patchUnit(item.id, {
                electricityPaid: event.target.value,
                message: null,
              })
            }
            placeholder="126"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Total Paid
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={item.amountPaid}
            onChange={(event) =>
              patchUnit(item.id, {
                amountPaid: event.target.value,
                message: null,
              })
            }
            placeholder="2626"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Payment method
          <select
            value={item.paymentMethod}
            onChange={(event) =>
              void changeMethod(item, event.target.value as PaymentMethod)
            }
            className={fieldClass}
          >
            <option value="" disabled>
              Choose method
            </option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <dl
          className={`grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm ${
            split ? "sm:col-span-2 sm:grid-cols-2" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Consumed kWh</dt>
            <dd className="font-semibold text-slate-900">
              {bill.consumed === null
                ? "—"
                : `${bill.roundsToWholePeso ? bill.consumed.toFixed(0) : bill.consumed.toLocaleString("en-PH")} kWh`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Electricity Charge</dt>
            <dd className="font-medium">
              {formatMaybePeso(bill.electricityCharge, bill.roundsToWholePeso)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Remaining Balance</dt>
            <dd className="flex items-center gap-2">
              <span
                className={`font-semibold ${
                  item.balance > 0 ? "text-amber-700" : "text-slate-400"
                }`}
              >
                {peso(item.balance)}
              </span>
              {isAdmin && item.balance > 0 ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void clearBalance(item);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
                >
                  Clear Balance
                </button>
              ) : null}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">Total Due</dt>
            <dd className="font-semibold text-slate-900">
              {formatMaybePeso(totalDueDisplay, bill.roundsToWholePeso)}
            </dd>
          </div>
        </dl>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Payment status
          {isAdmin ? (
            <select
              value={item.paymentStatus}
              onChange={(event) => {
                const next = event.target.value as PaymentStatus;
                if (next === "Paid") {
                  requestMarkAsPaid(item);
                  return;
                }
                void changePaymentStatus(item, next);
              }}
              className={`${fieldClass} py-2 text-sm ${statusTone(item.paymentStatus)}`}
            >
              {PAYMENT_STATUSES.map((status) => (
                <option
                  key={status}
                  value={status}
                  disabled={
                    status === "Paid" && !canSubmitMarkAsPaid(item)
                  }
                >
                  {status}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={`inline-flex min-h-12 items-center rounded-lg px-3 py-3 text-sm font-semibold ring-1 ${statusTone(item.paymentStatus)}`}
            >
              {item.paymentStatus}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Unit status
          {isAdmin ? (
            <select
              value={item.status}
              onChange={(event) =>
                void changeStatus(item, event.target.value as UnitStatus)
              }
              className={fieldClass}
            >
              {UNIT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={item.status}
              readOnly
              disabled
              className={`${fieldClass} cursor-not-allowed bg-slate-50 text-slate-600`}
            />
          )}
        </label>
        {(() => {
          const markPaidBlockers = getStaffMarkPaidBlockers(item);
          const cannotMarkPaid = !canSubmitMarkAsPaid(item);
          const markPaidHint = !hasValidElectricityRate
            ? electricityRateRequiredMessage
            : markPaidBlockers.length > 0
              ? staffMarkPaidHint(markPaidBlockers)
              : null;

          return (
            <>
              <div
                className={`flex flex-col gap-2 sm:flex-row ${
                  split ? "sm:col-span-2" : ""
                }`}
              >
                {isMobile ? (
                  <>
                    <motion.button
                      type="button"
                      disabled={cannotMarkPaid}
                      whileTap={
                        cannotMarkPaid ? undefined : { scale: 0.98 }
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canSubmitMarkAsPaid(item)) {
                          return;
                        }
                        requestMarkAsPaid(item);
                      }}
                      className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
                    >
                      Mark as Paid
                    </motion.button>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openPaymentHistory(item);
                      }}
                      className={primaryButtonClass}
                    >
                      View History
                    </motion.button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={cannotMarkPaid}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canSubmitMarkAsPaid(item)) {
                          return;
                        }
                        requestMarkAsPaid(item);
                      }}
                      className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
                    >
                      Mark as Paid
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openPaymentHistory(item);
                      }}
                      className={primaryButtonClass}
                    >
                      View History
                    </button>
                  </>
                )}
              </div>
              {markPaidHint ? (
                <p
                  className={`text-sm text-amber-700 ${
                    split ? "sm:col-span-2" : ""
                  }`}
                >
                  {markPaidHint}
                </p>
              ) : null}
            </>
          );
        })()}
        {item.message ? (
          <p
            className={`text-sm text-rose-700 ${split ? "sm:col-span-2" : ""}`}
          >
            {item.message}
          </p>
        ) : null}
      </div>
    );
  }

  async function processReceiptFile(file: File): Promise<{
    matched: BatchMatchedUnit | null;
    failed: BatchFailedItem | null;
  }> {
    const image = await compressReceiptImage(file);
    const response = await fetch("/api/extract-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, mimeType: "image/jpeg" }),
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
      const errorMessage =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Receipt extraction failed.";
      return {
        matched: null,
        failed: { fileName: file.name, reason: errorMessage },
      };
    }

    const extraction = payload as ReceiptExtraction;
    if (
      typeof extraction.current_kwh !== "number" ||
      !Number.isFinite(extraction.current_kwh)
    ) {
      return {
        matched: null,
        failed: {
          fileName: file.name,
          reason: "The receipt did not include a kWh reading.",
        },
      };
    }

    const unitName =
      typeof extraction.unit === "string" ? extraction.unit.trim() : "";
    const matched = findUnitByReceiptName(unitsRef.current, unitName);

    if (!matched) {
      return {
        matched: null,
        failed: {
          fileName: file.name,
          reason: unitName
            ? `No unit matches “${unitName}”.`
            : "The receipt did not include a unit name.",
        },
      };
    }

    let receiptUrl: string | null = null;
    try {
      receiptUrl = await uploadReceiptImage(matched.id, image);
    } catch (error) {
      // Still populate OCR fields even if storage fails; note it in the message.
      const uploadMessage =
        error instanceof Error
          ? error.message
          : "Could not store the receipt image.";
      setUnits((prev) => {
        const next = prev.map((unit) =>
          unit.id === matched.id
            ? {
                ...unit,
                ...unitPatchFromExtraction(extraction, null, {
                  allowBillingPeriod: isAdmin,
                }),
                message: uploadMessage,
              }
            : unit,
        );
        unitsRef.current = next;
        return next;
      });
      return {
        matched: {
          unitId: matched.id,
          label: matched.label,
          baseRent: matched.baseRent,
        },
        failed: {
          fileName: file.name,
          reason: `Matched ${matched.label}, but receipt image was not stored: ${uploadMessage}`,
        },
      };
    }

    // Draft only: populate editable card fields. Never auto Mark as Paid.
    const unitPatch = unitPatchFromExtraction(extraction, receiptUrl, {
      allowBillingPeriod: isAdmin,
    });
    setUnits((prev) => {
      const next = prev.map((unit) =>
        unit.id === matched.id ? { ...unit, ...unitPatch } : unit,
      );
      unitsRef.current = next;
      return next;
    });

    return {
      matched: {
        unitId: matched.id,
        label: matched.label,
        baseRent: matched.baseRent,
      },
      failed: null,
    };
  }

  async function scanGlobalReceiptBatch(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setScanningReceipt(true);
    setReceiptNotice(null);
    setReceiptNoticeIsError(false);
    setBatchMatched([]);
    setBatchFailed([]);
    setBatchProgress({ current: 0, total: files.length });

    const matchedUnits: BatchMatchedUnit[] = [];
    const failedItems: BatchFailedItem[] = [];
    const matchedIds = new Set<string>();

    // Process up to 2 at a time to avoid Gemini rate limits.
    const concurrency = Math.min(2, files.length);
    let nextIndex = 0;
    let completed = 0;

    async function worker() {
      while (nextIndex < files.length) {
        const index = nextIndex;
        nextIndex += 1;
        const file = files[index];

        try {
          const result = await processReceiptFile(file);
          if (result.matched && !matchedIds.has(result.matched.unitId)) {
            matchedIds.add(result.matched.unitId);
            matchedUnits.push(result.matched);
          }
          if (result.failed) {
            failedItems.push(result.failed);
          }
        } catch (error) {
          failedItems.push({
            fileName: file.name,
            reason:
              error instanceof Error
                ? error.message
                : "Receipt extraction failed.",
          });
        } finally {
          completed += 1;
          setBatchProgress({ current: completed, total: files.length });
        }
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, () => worker()),
    );

    matchedUnits.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
    setBatchMatched(matchedUnits);
    setBatchFailed(failedItems);
    setBatchProgress(null);
    setScanningReceipt(false);

    if (matchedUnits.length === 0 && failedItems.length > 0) {
      setReceiptNoticeIsError(true);
      setReceiptNotice(
        `Batch finished with ${failedItems.length} issue${failedItems.length === 1 ? "" : "s"} and no matched units.`,
      );
    } else if (matchedUnits.length > 0) {
      const summary =
        failedItems.length === 0
          ? `Scan Complete — ${matchedUnits.length} Unit${matchedUnits.length === 1 ? "" : "s"} Updated`
          : `Scan Complete — ${matchedUnits.length} matched, ${failedItems.length} need attention`;
      announceSuccess(summary);
      if (failedItems.length > 0) {
        setReceiptNoticeIsError(false);
        setReceiptNotice(
          `Batch finished: ${matchedUnits.length} matched, ${failedItems.length} need attention.`,
        );
      }
    } else {
      setReceiptNoticeIsError(false);
      setReceiptNotice("Batch finished with no matched units.");
    }
  }

  function unitLabelsMap() {
    return new Map(unitsRef.current.map((item) => [item.id, item.label]));
  }

  function syncSharedPaymentUpdate(row: PaymentRow) {
    const labels = unitLabelsMap();
    const [historyRecord] = mapPaymentHistory([row], labels);
    const [ledgerEntry] = paymentsToLedger([row], labels);
    const paymentId = String(row.id);

    if (historyRecord) {
      setPaymentHistory((current) => {
        if (!current.some((record) => record.id === paymentId)) {
          return current;
        }
        return sortPaymentHistory([
          historyRecord,
          ...current.filter((record) => record.id !== paymentId),
        ]);
      });
    }

    setLedger((current) => {
      const without = current.filter((entry) => entry.id !== paymentId);
      if (!ledgerEntry) {
        return without;
      }
      return sortLedgerEntries([ledgerEntry, ...without]);
    });

    setSelectedLedgerEntry((current) => {
      if (!current || current.id !== paymentId) {
        return current;
      }
      return ledgerEntry ?? null;
    });
  }

  function syncSharedPaymentDelete(paymentId: string) {
    setPaymentHistory((current) =>
      current.filter((record) => record.id !== paymentId),
    );
    setLedger((current) => current.filter((entry) => entry.id !== paymentId));
    setSelectedLedgerEntry((current) =>
      current?.id === paymentId ? null : current,
    );
    setPaymentEditDraft((current) =>
      current?.id === paymentId ? null : current,
    );
  }

  function openPaymentEditFromHistory(record: PaymentHistoryRecord) {
    if (!isAdmin) {
      return;
    }
    setPaymentEditError(null);
    setPaymentEditDraft(historyRecordToEditDraft(record));
  }

  function openPaymentEditFromLedger(entry: LedgerEntry) {
    if (!isAdmin) {
      return;
    }
    setPaymentEditError(null);
    setPaymentEditDraft(ledgerEntryToEditDraft(entry));
  }

  async function savePaymentEdit() {
    if (!isAdmin) {
      return;
    }
    if (!paymentEditDraft) {
      return;
    }
    if (!supabase) {
      setPaymentEditError("Supabase is not configured.");
      return;
    }

    const draft = paymentEditDraft;
    const baseRent = parseOptionalNumber(draft.baseRent);
    const rentPaid = parseOptionalNumber(draft.rentPaid);
    const electricityPaid = parseOptionalNumber(draft.electricityPaid);
    const consumedKwh = parseOptionalNumber(draft.consumedKwh);
    const totalDue = parseOptionalNumber(draft.totalDue);

    setSavingPaymentEdit(true);
    setPaymentEditError(null);

    const { data, error } = await supabase
      .from("Payments")
      .update({
        base_rent: baseRent,
        rent_paid: rentPaid,
        electricity_fee: electricityPaid ?? 0,
        electricity_charge: electricityPaid,
        consumed_kwh: consumedKwh,
        total_due: totalDue,
        amount_paid: totalDue,
        payment_method: draft.paymentMethod || null,
        status: draft.status,
        billing_period: draft.billingPeriod.trim() || null,
        payment_date: draft.paymentDate.trim() || null,
      })
      .eq("id", draft.id)
      .select("*")
      .single();

    setSavingPaymentEdit(false);

    if (error) {
      setPaymentEditError(error.message);
      return;
    }

    if (data) {
      syncSharedPaymentUpdate(data);
    }
    setPaymentEditDraft(null);
  }

  async function deletePaymentRecord(paymentId: string, unitName: string) {
    if (!isAdmin) {
      return;
    }
    if (!supabase) {
      return;
    }

    const confirmed = window.confirm(
      `Delete this payment record for ${unitName}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingPaymentId(paymentId);

    const { data: paymentRow, error: fetchError } = await supabase
      .from("Payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();

    if (fetchError) {
      setDeletingPaymentId(null);
      window.alert(fetchError.message);
      return;
    }

    const unitIdFromPayment =
      paymentRow?.unit_id !== undefined && paymentRow?.unit_id !== null
        ? String(paymentRow.unit_id)
        : paymentRow?.unitId !== undefined && paymentRow?.unitId !== null
          ? String(paymentRow.unitId)
          : null;
    const unitFromName = unitsRef.current.find(
      (unit) => unit.label === unitName,
    );
    const unitId = unitIdFromPayment ?? unitFromName?.id ?? null;

    const { error } = await supabase
      .from("Payments")
      .delete()
      .eq("id", paymentId);

    if (error) {
      setDeletingPaymentId(null);
      window.alert(error.message);
      return;
    }

    syncSharedPaymentDelete(paymentId);

    if (unitId) {
      const unit = unitsRef.current.find((row) => row.id === unitId);
      const currentPeriod = unit?.billingPeriod.trim() ?? "";

      const { data: remainingRows, error: remainingError } = await supabase
        .from("Payments")
        .select("id, billing_period, status")
        .eq("unit_id", unitId);

      if (remainingError) {
        setDeletingPaymentId(null);
        window.alert(remainingError.message);
        return;
      }

      const hasCurrentPeriodPayment = (remainingRows ?? []).some((row) => {
        if (asPaymentStatus(row.status) !== "Paid") {
          return false;
        }
        const period =
          typeof row.billing_period === "string"
            ? row.billing_period.trim()
            : "";
        if (currentPeriod) {
          return period === currentPeriod;
        }
        // Unit has no billing period set — treat empty-period Paid rows as current.
        return period === "";
      });

      // Historical delete + current-period Paid still exists → leave Paid.
      // No remaining Paid payment for the unit's current billing period → Unpaid.
      const shouldRevert = !hasCurrentPeriodPayment;

      if (shouldRevert) {
        const { error: unitError } = await supabase
          .from("Units")
          .update({
            payment_status: "Unpaid",
            payment_date: null,
            rent_paid: null,
            electricity_paid: null,
            total_paid: null,
          })
          .eq("id", unitId);

        if (unitError) {
          setDeletingPaymentId(null);
          window.alert(unitError.message);
          return;
        }

        patchUnit(unitId, {
          paymentStatus: "Unpaid",
          paymentDate: "",
          rentPaid: "",
          electricityPaid: "",
          amountPaid: "",
          paymentId: null,
          message: null,
        });
      }
    }

    setDeletingPaymentId(null);
  }

  async function openPaymentHistory(unit: DashboardUnit) {
    setSelectedUnitName(unit.label);
    setHistoryOpen(true);
    setReceiptPreview(null);
    setHistoryLoading(true);
    setHistoryError(null);

    if (!supabase) {
      setHistoryError("Supabase is not configured.");
      setHistoryLoading(false);
      return;
    }

    const unitLabels = new Map(
      unitsRef.current.map((item) => [item.id, item.label]),
    );

    async function loadPayments(
      column: "unit_name" | "unit_id",
      value: string,
      orderColumn: "payment_date" | "created_at",
    ) {
      return supabase!
        .from("Payments")
        .select("*")
        .eq(column, value)
        .order(orderColumn, { ascending: false });
    }

    let column: "unit_name" | "unit_id" = "unit_name";
    let value = unit.label;
    let { data, error } = await loadPayments(column, value, "payment_date");

    if (error && /unit_name/i.test(error.message)) {
      column = "unit_id";
      value = unit.id;
      ({ data, error } = await loadPayments(column, value, "payment_date"));
    }

    if (error && /payment_date/i.test(error.message)) {
      ({ data, error } = await loadPayments(column, value, "created_at"));
    }

    if (error) {
      setHistoryError(error.message);
      setPaymentHistory([]);
      setHistoryLoading(false);
      return;
    }

    setPaymentHistory(mapPaymentHistory(data ?? [], unitLabels));
    setHistoryLoading(false);
  }

  if (!authReady) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 px-5 text-slate-900">
        <p className="text-sm text-slate-500">Checking session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 px-5 text-slate-900">
        <form
          onSubmit={(event) => void signIn(event)}
          className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8"
        >
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium tracking-wide text-slate-500">
              Rental ledger
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-slate-600">
              Use your email and password to open the dashboard.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className={fieldClass}
              />
            </label>
            {loginError ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {loginError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={signingIn}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
            >
              {signingIn ? "Signing in…" : "Sign In"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 sm:gap-8 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-wide text-slate-500">
              Rental ledger
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900">
              {user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                isAdmin
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-slate-100 text-slate-700 ring-slate-200"
              }`}
            >
              {roleLabel}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
            >
              {signingOut ? "Signing out…" : "Sign Out"}
            </button>
          </div>
        </header>

        {electricityRateNotice ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-amber-950 ring-1 ring-amber-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm font-medium sm:text-[0.95rem]">
              {electricityRateNotice.rate == null
                ? `Electricity rate cleared by ${electricityRateNotice.updatedBy} at ${formatRateNoticeTime(electricityRateNotice.updatedAt)}`
                : `Electricity rate updated to ₱${Number(
                    electricityRateNotice.rate,
                  ).toLocaleString("en-PH", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}/kWh by ${electricityRateNotice.updatedBy} at ${formatRateNoticeTime(electricityRateNotice.updatedAt)}`}
            </p>
            <button
              type="button"
              onClick={dismissElectricityRateNotice}
              className="shrink-0 rounded-xl bg-amber-900 px-3 py-2 text-sm font-semibold text-white"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <section
          aria-label="Global controls"
          className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-slate-700 sm:flex-1">
            Electricity Rate (₱ / kWh)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={electricityRateInput}
              onChange={(event) => {
                schedulePersistElectricityRate(event.target.value);
              }}
              placeholder="0.00"
              className={`${fieldClass} sm:max-w-xs`}
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center sm:justify-center">
            <label
              className={`${primaryButtonClass} cursor-pointer ${
                scanningReceipt ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {scanningReceipt
                ? batchProgress
                  ? `Scanning ${batchProgress.current}/${batchProgress.total}…`
                  : "Scanning…"
                : "Scan Global Receipt"}
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={scanningReceipt}
                className="sr-only"
                onChange={(event) => {
                  const selected = event.target.files
                    ? Array.from(event.target.files)
                    : [];
                  event.target.value = "";
                  if (selected.length > 0) {
                    void scanGlobalReceiptBatch(selected);
                  }
                }}
              />
            </label>
            {isAdmin ? (
              <button
                type="button"
                disabled={startingNewMonth}
                onClick={() => void startNewMonth()}
                className={`${primaryButtonClass} ${
                  startingNewMonth ? "pointer-events-none opacity-60" : ""
                }`}
              >
                {startingNewMonth ? "Starting…" : "Start New Month"}
              </button>
            ) : null}
          </div>
          <div className="hidden sm:block sm:flex-1" aria-hidden="true" />
        </section>

        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Units
          </h1>
          {batchProgress ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="font-medium text-slate-800">
                  Scanning receipt {batchProgress.current} of{" "}
                  {batchProgress.total}…
                </p>
                <p className="text-slate-500">
                  {Math.round(
                    (batchProgress.current / batchProgress.total) * 100,
                  )}
                  %
                </p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all duration-300"
                  style={{
                    width: `${Math.max(
                      4,
                      (batchProgress.current / batchProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {receiptNotice ? (
            <p
              className={`rounded-xl px-4 py-3 text-sm ${
                receiptNoticeIsError
                  ? "border border-rose-200 bg-rose-50 text-rose-800"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {receiptNotice}
            </p>
          ) : null}
          {!scanningReceipt &&
          (batchMatched.length > 0 || batchFailed.length > 0) ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              {batchMatched.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    Matched Units
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {batchMatched.map((unit) => (
                      <button
                        key={unit.unitId}
                        type="button"
                        onClick={() => focusMatchedUnit(unit)}
                        className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                      >
                        {unit.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {batchFailed.length > 0 ? (
                <div className={batchMatched.length > 0 ? "mt-4" : undefined}>
                  <p className="text-sm font-medium text-rose-800">
                    Needs Attention / Failed
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm text-rose-700">
                    {batchFailed.map((item) => (
                      <li
                        key={`${item.fileName}-${item.reason}`}
                        className="rounded-lg bg-rose-50 px-3 py-2"
                      >
                        <span className="font-medium">{item.fileName}</span>
                        <span className="text-rose-600"> — {item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Filter by monthly rent, update occupancy, and batch-scan handwritten
            receipts for occupied units.
          </p>
        </header>

        {loadError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {loadError}
          </p>
        ) : null}

        <div className="overflow-x-auto pb-1">
          <div
            role="tablist"
            aria-label="Rent tiers"
            className="flex w-max min-w-full gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200 md:grid md:w-full md:grid-cols-3"
          >
            {RENT_TIERS.map((tier) => {
              const count = units.filter((item) => item.baseRent === tier).length;
              const selected = activeTier === tier;
              if (isMobile) {
                return (
                  <motion.button
                    key={tier}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActiveTier(tier)}
                    className="relative min-h-12 min-w-[11.5rem] shrink-0 flex-1 overflow-hidden rounded-xl px-4 py-3 text-left"
                  >
                    {selected ? (
                      <motion.span
                        layoutId="activeRentTab"
                        className="absolute inset-0 rounded-xl bg-slate-900"
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 32,
                        }}
                      />
                    ) : null}
                    <span
                      className={`relative z-10 block text-sm font-medium opacity-80 ${
                        selected ? "text-white" : "text-slate-700"
                      }`}
                    >
                      Base rent
                    </span>
                    <span
                      className={`relative z-10 mt-1 flex items-baseline justify-between gap-3 ${
                        selected ? "text-white" : "text-slate-700"
                      }`}
                    >
                      <span className="text-lg font-semibold">{peso(tier)}</span>
                      <span className="text-xs">{count} units</span>
                    </span>
                  </motion.button>
                );
              }

              return (
                <button
                  key={tier}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTier(tier)}
                  className={`min-h-12 min-w-[11.5rem] shrink-0 flex-1 rounded-xl px-4 py-3 text-left md:min-w-0 ${
                    selected
                      ? "bg-slate-900 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="block text-sm font-medium opacity-80">
                    Base rent
                  </span>
                  <span className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="text-lg font-semibold">{peso(tier)}</span>
                    <span className="text-xs">{count} units</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
            <div className="h-64 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
            <div className="hidden h-64 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200 md:block" />
          </div>
        ) : visibleUnits.length === 0 ? (
          <p className="rounded-2xl bg-white px-6 py-16 text-center text-slate-500 ring-1 ring-slate-200">
            No units at {peso(activeTier)}.
          </p>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeTier}
                  initial={
                    reduceMotion ? false : { opacity: 0, y: 6 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: APPLE_EASE }}
                  className="grid grid-cols-1 gap-4"
                >
                  {visibleUnits.map((item) => {
                    const expanded = openUnitIds[item.id] === true;
                    return (
                      <motion.article
                        key={item.id}
                        whileTap={{ scale: 0.98 }}
                        className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
                      >
                        <motion.button
                          type="button"
                          aria-expanded={expanded}
                          whileTap={{ scale: 0.98 }}
                          onClick={() =>
                            setOpenUnitIds((current) => ({
                              ...current,
                              [item.id]: !current[item.id],
                            }))
                          }
                          className="flex w-full items-center gap-3 px-4 py-3 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-semibold">
                                {item.label}
                              </h2>
                              <PaymentStatusBadge
                                status={item.paymentStatus}
                                isMobile
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(item.paymentStatus)}`}
                              />
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                {item.status}
                              </span>
                            </div>
                          </div>
                          <motion.svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                            animate={{ rotate: expanded ? 180 : 0 }}
                            transition={{ duration: 0.22, ease: APPLE_EASE }}
                            className="h-5 w-5 shrink-0 text-slate-500"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                              clipRule="evenodd"
                            />
                          </motion.svg>
                        </motion.button>
                        <AnimatePresence initial={false}>
                          {expanded ? (
                            <motion.div
                              key={`${item.id}-body`}
                              initial={
                                reduceMotion
                                  ? false
                                  : { height: 0, opacity: 0 }
                              }
                              animate={{ height: "auto", opacity: 1 }}
                              exit={
                                reduceMotion
                                  ? undefined
                                  : { height: 0, opacity: 0 }
                              }
                              transition={{
                                duration: 0.22,
                                ease: APPLE_EASE,
                              }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4">
                                {renderUnitEditor(item)}
                              </div>
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </motion.article>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </section>

            <section className="hidden md:grid md:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)] md:items-start md:gap-4">
              <div className="max-h-[calc(100vh-8rem)] space-y-2 overflow-y-auto rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200">
                {visibleUnits.map((item) => {
                  const selected = item.id === selectedDesktopUnitId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedDesktopUnitId(item.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ${
                        selected
                          ? "bg-slate-900 text-white ring-2 ring-slate-900"
                          : "bg-slate-50 text-slate-900 hover:bg-slate-100 ring-1 ring-transparent"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold">
                          {item.label}
                        </span>
                        <span
                          className={`mt-1 block text-xs ${
                            selected ? "text-slate-300" : "text-slate-500"
                          }`}
                        >
                          {item.status}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                          selected
                            ? "bg-white/10 text-white ring-white/20"
                            : statusTone(item.paymentStatus)
                        }`}
                      >
                        {item.paymentStatus}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="sticky top-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                {selectedDesktopUnit ? (
                  <>
                    <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
                      <h2 className="text-xl font-semibold tracking-tight">
                        {selectedDesktopUnit.label}
                      </h2>
                      <PaymentStatusBadge
                        status={selectedDesktopUnit.paymentStatus}
                        isMobile={false}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(selectedDesktopUnit.paymentStatus)}`}
                      />
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {selectedDesktopUnit.status}
                      </span>
                    </div>
                    {renderUnitEditor(selectedDesktopUnit, { split: true })}
                  </>
                ) : (
                  <p className="text-sm text-slate-500">
                    Select a unit to edit payment details.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Business Expenses
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Record costs outside monthly rent.
              </p>
            </div>
            <p className="text-sm font-medium text-slate-700">
              {expenses.length} {expenses.length === 1 ? "expense" : "expenses"}
              {expenses.length > 0
                ? ` · ${peso(expenses.reduce((sum, expense) => sum + expense.amount, 0))}`
                : ""}
            </p>
          </div>

          <form
            onSubmit={(event) => void addExpense(event)}
            className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_9rem_auto] md:items-end"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Repairs, supplies, utilities"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Amount
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className={fieldClass}
              />
            </label>
            <button
              type="submit"
              disabled={savingExpense}
              className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
            >
              {savingExpense ? "Adding…" : "Add Expense"}
            </button>
          </form>

          {expensesError ? (
            <p className="mt-3 text-sm text-rose-700">{expensesError}</p>
          ) : null}

          {expensesLoading ? (
            <div className="mt-5 h-24 animate-pulse rounded-xl bg-slate-100" />
          ) : expenses.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No expenses yet.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-slate-100">
              {expenses.map((expense) => (
                <li
                  key={expense.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {expense.description}
                    </p>
                    <p className="text-sm text-slate-500">
                      {formatExpenseDate(expense.expenseDate)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {peso(expense.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Payment Ledger
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              All payments are listed below. Use search or month to narrow the
              list.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Search
              <input
                type="search"
                value={ledgerSearch}
                onChange={(event) => setLedgerSearch(event.target.value)}
                placeholder="Unit name or received by"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Month
              <select
                value={ledgerMonth}
                onChange={(event) => setLedgerMonth(event.target.value)}
                className={fieldClass}
              >
                <option value="">All Months</option>
                {ledgerMonthOptions.map((monthKey) => (
                  <option key={monthKey} value={monthKey}>
                    {formatMonthOption(monthKey)}
                  </option>
                ))}
              </select>
            </label>
            {ledgerFilterActive ? (
              <button
                type="button"
                onClick={() => {
                  setLedgerSearch("");
                  setLedgerMonth("");
                  setSelectedLedgerEntry(null);
                }}
                className={primaryButtonClass}
              >
                Clear
              </button>
            ) : (
              <div className="hidden sm:block" aria-hidden="true" />
            )}
          </div>

          {ledger.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No payments recorded yet.
            </p>
          ) : filteredLedger.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No matching payments.
            </p>
          ) : (
            <div className="mt-5 max-h-80 overflow-y-auto rounded-xl border border-slate-100">
              <ul className="divide-y divide-slate-100">
                {filteredLedger.map((entry) => (
                  <li key={entry.id} className="hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setSelectedLedgerEntry(entry)}
                      className="grid w-full grid-cols-1 gap-2 px-4 pt-3 pb-2 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-slate-900">
                          {entry.unitName}
                        </p>
                        <p className="font-semibold text-slate-900">
                          {formatMaybePeso(entry.totalPaid, entry.wholeNumber)}
                        </p>
                      </div>
                      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-slate-500">Date paid</dt>
                          <dd className="font-medium">
                            {formatExpenseDate(entry.datePaid)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Billing period</dt>
                          <dd className="font-medium">
                            {entry.billingPeriod ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Rent paid</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(
                              entry.rentPaid ?? entry.baseRent,
                              entry.wholeNumber,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Electricity paid</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(
                              entry.electricityCharge,
                              entry.wholeNumber,
                            )}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-slate-500">Consumed kWh</dt>
                          <dd className="font-medium">
                            {formatConsumedKwhLine(
                              entry.consumedKwh,
                              entry.electricityRate,
                              entry.electricityCharge,
                              entry.wholeNumber,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Total amount paid</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(
                              entry.amountPaid ?? entry.totalPaid,
                              entry.wholeNumber,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Payment method</dt>
                          <dd className="font-medium">{entry.paymentMethod}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Received by</dt>
                          <dd className="font-medium">{entry.receivedBy}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Receipt</dt>
                          <dd className="font-medium">
                            {entry.receiptUrl ? "Image attached" : "No receipt"}
                          </dd>
                        </div>
                      </dl>
                    </button>
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-2 px-4 pb-3">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          onClick={(event) => {
                            event.stopPropagation();
                            openPaymentEditFromLedger(entry);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={dangerButtonClass}
                          disabled={deletingPaymentId === entry.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void deletePaymentRecord(entry.id, entry.unitName);
                          }}
                        >
                          {deletingPaymentId === entry.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

      </main>

      {selectedLedgerEntry ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setSelectedLedgerEntry(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-detail-title"
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="ledger-detail-title" className="text-xl font-semibold">
                  {selectedLedgerEntry.unitName}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {formatExpenseDate(selectedLedgerEntry.datePaid)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() =>
                        openPaymentEditFromLedger(selectedLedgerEntry)
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={dangerButtonClass}
                      disabled={deletingPaymentId === selectedLedgerEntry.id}
                      onClick={() =>
                        void deletePaymentRecord(
                          selectedLedgerEntry.id,
                          selectedLedgerEntry.unitName,
                        )
                      }
                    >
                      {deletingPaymentId === selectedLedgerEntry.id
                        ? "Deleting…"
                        : "Delete"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedLedgerEntry(null)}
                  className={primaryButtonClass}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-4 sm:flex-row">
              {selectedLedgerEntry.receiptUrl ? (
                <button
                  type="button"
                  onClick={() => setReceiptPreview(selectedLedgerEntry.receiptUrl)}
                  className="h-28 w-full overflow-hidden rounded-xl ring-1 ring-slate-200 sm:h-36 sm:w-36"
                >
                  <img
                    src={selectedLedgerEntry.receiptUrl}
                    alt={`Receipt for ${selectedLedgerEntry.unitName}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <div className="flex h-28 w-full items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400 ring-1 ring-slate-200 sm:h-36 sm:w-36">
                  No receipt
                </div>
              )}
              <dl className="grid flex-1 grid-cols-1 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Billing period</dt>
                  <dd className="font-medium">
                    {selectedLedgerEntry.billingPeriod ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Rent paid</dt>
                  <dd className="font-medium">
                    {formatMaybePeso(
                      selectedLedgerEntry.rentPaid ??
                        selectedLedgerEntry.baseRent ??
                        null,
                      selectedLedgerEntry.wholeNumber,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Electricity paid</dt>
                  <dd className="font-medium">
                    {formatMaybePeso(
                      selectedLedgerEntry.electricityCharge,
                      selectedLedgerEntry.wholeNumber,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Consumed kWh</dt>
                  <dd className="font-medium">
                    {formatConsumedKwhLine(
                      selectedLedgerEntry.consumedKwh,
                      selectedLedgerEntry.electricityRate,
                      selectedLedgerEntry.electricityCharge,
                      selectedLedgerEntry.wholeNumber,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Total amount paid</dt>
                  <dd className="text-base font-semibold">
                    {formatMaybePeso(
                      selectedLedgerEntry.amountPaid ??
                        selectedLedgerEntry.totalPaid,
                      selectedLedgerEntry.wholeNumber,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Received by</dt>
                  <dd className="font-medium">{selectedLedgerEntry.receivedBy}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Payment method</dt>
                  <dd className="font-medium">{selectedLedgerEntry.paymentMethod}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40"
          onClick={() => {
            setReceiptPreview(null);
            setHistoryOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-history-title"
            className="flex h-full w-full flex-col bg-slate-100"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2
                  id="payment-history-title"
                  className="text-xl font-semibold tracking-tight"
                >
                  {selectedUnitName ?? "Payment History"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Payment history for this unit, newest first.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReceiptPreview(null);
                  setHistoryOpen(false);
                }}
                className={primaryButtonClass}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {historyLoading ? (
                <div className="h-24 animate-pulse rounded-xl bg-white" />
              ) : historyError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {historyError}
                </p>
              ) : paymentHistory.length === 0 ? (
                <p className="rounded-xl bg-white px-4 py-6 text-sm text-slate-500 ring-1 ring-slate-200">
                  No payments recorded for {selectedUnitName ?? "this unit"} yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                  {paymentHistory.map((record) => (
                    <li
                      key={record.id}
                      className="flex flex-col gap-3 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        {record.receiptUrl ? (
                          <button
                            type="button"
                            onClick={() => setReceiptPreview(record.receiptUrl)}
                            className="h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-200"
                          >
                            <img
                              src={record.receiptUrl}
                              alt={`Receipt for ${record.unitName}`}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-center text-xs text-slate-400 ring-1 ring-slate-200">
                            No receipt
                          </div>
                        )}
                        <dl className="grid flex-1 grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <dt className="text-slate-500">Unit name</dt>
                            <dd className="font-semibold text-slate-900">
                              {record.unitName}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Payment date</dt>
                            <dd className="font-medium">
                              {record.paymentDate
                                ? formatExpenseDate(record.paymentDate)
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Billing period</dt>
                            <dd className="font-medium">
                              {record.billingPeriod ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Rent paid</dt>
                            <dd className="font-medium">
                              {formatMaybePeso(
                                record.rentPaid ?? record.baseRent,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Electricity paid</dt>
                            <dd className="font-medium">
                              {formatMaybePeso(record.electricityCharge)}
                            </dd>
                          </div>
                          <div className="sm:col-span-2 lg:col-span-3">
                            <dt className="text-slate-500">Consumed kWh</dt>
                            <dd className="font-medium">
                              {formatConsumedKwhLine(
                                record.consumedKwh,
                                record.electricityRate,
                                record.electricityCharge,
                                record.baseRent === 5000,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Total amount paid</dt>
                            <dd className="font-semibold text-slate-900">
                              {formatMaybePeso(
                                record.amountPaid ?? record.totalPaid,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Payment method</dt>
                            <dd className="font-medium">
                              {record.paymentMethod || "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Status</dt>
                            <dd className="font-medium">{record.status}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Received by</dt>
                            <dd className="font-medium">
                              {record.receivedBy ?? "—"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      {isAdmin ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => openPaymentEditFromHistory(record)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={dangerButtonClass}
                            disabled={deletingPaymentId === record.id}
                            onClick={() =>
                              void deletePaymentRecord(
                                record.id,
                                record.unitName,
                              )
                            }
                          >
                            {deletingPaymentId === record.id
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {pendingPaidUnitId
        ? (() => {
            const pendingUnit = units.find(
              (unit) => unit.id === pendingPaidUnitId,
            );
            if (!pendingUnit) {
              return null;
            }
            const totalPaidValue = Number(pendingUnit.amountPaid);
            return (
              <div
                className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/35 p-4 backdrop-blur-sm sm:items-center"
                onClick={() => {
                  if (!confirmingPaid) {
                    setPendingPaidUnitId(null);
                  }
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="confirm-paid-title"
                  className="w-full max-w-md rounded-2xl border border-white/40 bg-white/75 p-5 shadow-xl backdrop-blur-xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <h2
                    id="confirm-paid-title"
                    className="text-xl font-semibold tracking-tight text-slate-900"
                  >
                    Confirm payment
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Double-check these details before saving.
                  </p>
                  <dl className="mt-5 grid grid-cols-1 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Unit name</dt>
                      <dd className="font-semibold text-slate-900">
                        {pendingUnit.label}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Billing period</dt>
                      <dd className="font-medium text-slate-900">
                        {pendingUnit.billingPeriod.trim() || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Total paid</dt>
                      <dd className="font-semibold text-slate-900">
                        {Number.isFinite(totalPaidValue)
                          ? formatMaybePeso(totalPaidValue)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Payment method</dt>
                      <dd className="font-medium text-slate-900">
                        {pendingUnit.paymentMethod || "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      disabled={confirmingPaid}
                      onClick={() => setPendingPaidUnitId(null)}
                      className={secondaryButtonClass}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={confirmingPaid}
                      onClick={() => {
                        unlockAudio(audioCtxRef);
                        void confirmStaffMarkAsPaid();
                      }}
                      className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
                    >
                      {confirmingPaid ? "Saving…" : "Confirm Payment"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {paymentEditDraft ? (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => {
            if (!savingPaymentEdit) {
              setPaymentEditDraft(null);
              setPaymentEditError(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-payment-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="edit-payment-title"
                  className="text-xl font-semibold tracking-tight"
                >
                  Edit payment
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {paymentEditDraft.unitName}
                </p>
              </div>
              <button
                type="button"
                disabled={savingPaymentEdit}
                onClick={() => {
                  setPaymentEditDraft(null);
                  setPaymentEditError(null);
                }}
                className={secondaryButtonClass}
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Base rent
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentEditDraft.baseRent}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, baseRent: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Rent paid
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentEditDraft.rentPaid}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, rentPaid: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Electricity paid
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentEditDraft.electricityPaid}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, electricityPaid: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Consumed kWh
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentEditDraft.consumedKwh}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, consumedKwh: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Total due / paid
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentEditDraft.totalDue}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, totalDue: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Payment method
                <select
                  value={paymentEditDraft.paymentMethod}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            paymentMethod: asPaymentMethod(event.target.value),
                          }
                        : current,
                    )
                  }
                  className={fieldClass}
                >
                  <option value="">Choose method</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Status
                <select
                  value={paymentEditDraft.status}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            status: event.target.value as PaymentStatus,
                          }
                        : current,
                    )
                  }
                  className={fieldClass}
                >
                  {PAYMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                Payment date
                <input
                  type="date"
                  value={paymentEditDraft.paymentDate}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, paymentDate: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700 sm:col-span-2">
                Billing period
                <input
                  type="text"
                  value={paymentEditDraft.billingPeriod}
                  onChange={(event) =>
                    setPaymentEditDraft((current) =>
                      current
                        ? { ...current, billingPeriod: event.target.value }
                        : current,
                    )
                  }
                  className={fieldClass}
                />
              </label>
            </div>
            {paymentEditError ? (
              <p className="mt-3 text-sm text-rose-700">{paymentEditError}</p>
            ) : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={savingPaymentEdit}
                onClick={() => {
                  setPaymentEditDraft(null);
                  setPaymentEditError(null);
                }}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingPaymentEdit}
                onClick={() => void savePaymentEdit()}
                className={`${primaryButtonClass} disabled:cursor-not-allowed disabled:bg-slate-400`}
              >
                {savingPaymentEdit ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receiptPreview ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 p-3 sm:p-5"
          onClick={() => setReceiptPreview(null)}
        >
          <div
            className="max-h-full max-w-full overflow-auto overscroll-contain"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={receiptPreview}
              alt="Receipt"
              className="mx-auto block h-auto w-auto max-w-[min(100vw-1.5rem,56rem)] origin-center touch-manipulation rounded-lg object-contain"
            />
            <p className="mt-3 text-center text-sm text-slate-300">
              Pinch to zoom · tap outside to close
            </p>
          </div>
        </div>
      ) : null}
      <AnimatePresence>
        {isMobile && mobileSuccess ? (
          <MobileSuccessOverlay
            key={mobileSuccess}
            message={mobileSuccess}
            onDismiss={() => setMobileSuccess(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function meterBill(
  previousReading: string,
  currentReading: string,
  electricityRate: string | null,
  baseRent: number,
  balance = 0,
): MeterBill {
  const previous = Number(previousReading);
  const current = Number(currentReading);
  const rate = electricityRate === null ? null : Number(electricityRate);
  const hasReadings =
    previousReading !== "" &&
    currentReading !== "" &&
    Number.isFinite(previous) &&
    Number.isFinite(current);
  const rawConsumed = hasReadings ? Math.abs(previous - current) : null;
  const roundsToWholePeso = baseRent === 5000;
  const consumed =
    rawConsumed === null
      ? null
      : roundsToWholePeso
        ? Math.round(rawConsumed)
        : rawConsumed;
  const electricityCharge =
    consumed !== null && rate !== null && Number.isFinite(rate)
      ? roundsToWholePeso
        ? Number((consumed * rate).toFixed(0))
        : consumed * rate
      : null;
  const totalAmountDue =
    electricityCharge === null
      ? null
      : baseRent + electricityCharge + balance;

  return { consumed, electricityCharge, totalAmountDue, roundsToWholePeso };
}

function formatMaybePeso(value: number | null, wholeNumber = false) {
  if (value === null) {
    return "—";
  }
  if (wholeNumber) {
    return `₱${Number(value.toFixed(0)).toLocaleString("en-PH", {
      maximumFractionDigits: 0,
    })}`;
  }
  return peso(value);
}
