"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const RENT_TIERS = [2500, 3000, 5000] as const;
const UNIT_STATUSES = ["Occupied", "Vacant", "Maintenance"] as const;
const PAYMENT_STATUSES = ["Paid", "Partial", "Unpaid"] as const;
const PAYMENT_METHODS = ["Cash", "GCash"] as const;
const ADMIN_EMAIL = "kylemata313131@gmail.com";
const DISPLAY_NAME_BY_EMAIL: Record<string, string> = {
  [ADMIN_EMAIL]: "Kyle",
};

type RentTier = (typeof RENT_TIERS)[number];
type UnitStatus = (typeof UNIT_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type ReceiptExtraction = {
  unitName: string;
  currentReading: number;
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
  consumedKwh: number | null;
  electricityRate: number | null;
  electricityCharge: number | null;
  wholeNumber: boolean;
  datePaid: string;
  paymentMethod: string;
  receiptUrl: string | null;
  receivedBy: string;
};

type PaymentHistoryRecord = {
  id: string;
  unitName: string;
  paymentDate: string | null;
  baseRent: number | null;
  consumedKwh: number | null;
  electricityRate: number | null;
  electricityCharge: number | null;
  totalPaid: number | null;
  receiptUrl: string | null;
  receivedBy: string | null;
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
        paymentStatus: asPaymentStatus(payment?.status ?? row.payment_status),
        paymentMethod: asPaymentMethod(
          payment?.payment_method ?? payment?.method ?? row.payment_method,
        ),
        paymentId:
          payment?.id === undefined || payment?.id === null
            ? null
            : String(payment.id),
        previousReading: "",
        currentReading: "",
        balance: asBalance(row.balance),
        receiptUrl:
          typeof payment?.receipt_url === "string" ? payment.receipt_url : null,
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

      return [
        {
          id: String(row.id),
          unitName:
            unitLabels.get(unitKey) ??
            (unitKey ? `Unit ${unitKey.slice(0, 8)}` : "Unknown unit"),
          paymentDate,
          baseRent: historyNumber(row.base_rent ?? row.baseRent),
          consumedKwh: historyNumber(row.consumed_kwh),
          electricityRate: historyNumber(row.electricity_rate),
          electricityCharge: historyNumber(
            row.electricity_charge ?? row.electricity_fee,
          ),
          totalPaid: historyNumber(row.total_due ?? row.totalPaid),
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
    const source = rows.find((row) => String(row.id) === record.id);
    const status = typeof source?.status === "string" ? source.status : "";
    if (status !== "Paid" || record.baseRent === null || record.totalPaid === null) {
      return [];
    }

    return [
      {
        id: record.id,
        unitName: record.unitName,
        totalPaid: record.totalPaid,
        baseRent: record.baseRent,
        consumedKwh: record.consumedKwh,
        electricityRate: record.electricityRate,
        electricityCharge: record.electricityCharge,
        wholeNumber: record.baseRent === 5000,
        datePaid: record.paymentDate ?? new Date().toISOString(),
        paymentMethod:
          typeof source?.payment_method === "string" && source.payment_method
            ? source.payment_method
            : "—",
        receiptUrl: record.receiptUrl,
        receivedBy: record.receivedBy ?? "—",
      },
    ];
  });
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

function findUnitByReceiptName(units: DashboardUnit[], unitName: string) {
  const exact = unitName.trim().toLowerCase().replace(/\s+/g, " ");
  if (!exact) {
    return null;
  }

  return (
    units.find(
      (unit) => unit.label.trim().toLowerCase().replace(/\s+/g, " ") === exact,
    ) ?? null
  );
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
  const [ledgerMonth, setLedgerMonth] = useState("");
  const [electricityRateInput, setElectricityRateInput] = useState("");
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  const [receiptNoticeIsError, setReceiptNoticeIsError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openUnitIds, setOpenUnitIds] = useState<Record<string, boolean>>({});
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryRecord[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<LedgerEntry | null>(null);

  const isAdmin = isAdminEmail(user?.email);
  const roleLabel = isAdmin ? "Admin" : "Staff";

  const parsedElectricityRate = Number(electricityRateInput);
  const electricityRate =
    electricityRateInput !== "" &&
    Number.isFinite(parsedElectricityRate) &&
    parsedElectricityRate >= 0
      ? electricityRateInput
      : null;

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
        { data: paymentRows, error: paymentError },
      ] = await Promise.all([
        supabase.from("Units").select("*"),
        supabase.from("Expenses").select("id, description, amount, expense_date"),
        supabase.from("Payments").select("*"),
      ]);

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

      const safePaymentRows = paymentError ? [] : (paymentRows ?? []);
      const mapped = mapUnits(unitRows ?? [], safePaymentRows).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
      const labels = new Map(mapped.map((unit) => [unit.id, unit.label]));
      setUnits(mapped);
      setLedger(paymentsToLedger(safePaymentRows, labels));

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

  const visibleUnits = useMemo(
    () => units.filter((item) => item.baseRent === activeTier),
    [units, activeTier],
  );

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
    if (!ledgerFilterActive) {
      return [];
    }

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
  }, [ledger, ledgerFilterActive, ledgerMonth, ledgerSearch]);

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
    if (!isAdmin) {
      return;
    }

    const confirmed = window.confirm(
      "Start a new month? Current readings will move to previous readings, current readings will be cleared, and every unit payment status will reset to Unpaid.",
    );
    if (!confirmed) {
      return;
    }

    setUnits((current) =>
      current.map((unit) => ({
        ...unit,
        previousReading: unit.currentReading,
        currentReading: "",
        paymentStatus: "Unpaid",
        paymentId: null,
        receiptUrl: null,
        message: null,
      })),
    );
  }

  async function changePaymentStatus(item: DashboardUnit, next: PaymentStatus) {
    if (next === item.paymentStatus) {
      return;
    }

    patchUnit(item.id, { paymentStatus: next, message: null });

    const markingPaid = next === "Paid";
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
    const electricityChargeSnapshot =
      consumedKwh != null && rateSnapshot != null
        ? Number((consumedKwh * rateSnapshot).toFixed(bill?.roundsToWholePeso ? 0 : 2))
        : bill?.electricityCharge == null
          ? null
          : Number(bill.electricityCharge);
    const totalDue =
      bill?.totalAmountDue == null
        ? item.baseRent + item.balance
        : Number(bill.totalAmountDue);
    const amountPaid = totalDue;
    const nextBalance = Math.max(0, totalDue - amountPaid);

    if (supabase && markingPaid) {
      const { data, error } = await supabase
        .from("Payments")
        .insert({
          unit_id: item.id,
          base_rent: Number(item.baseRent),
          electricity_fee: electricityChargeSnapshot ?? 0,
          electricity_rate: rateSnapshot,
          electricity_charge: electricityChargeSnapshot,
          consumed_kwh: consumedKwh,
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

      const { error: balanceError } = await supabase
        .from("Units")
        .update({ balance: nextBalance })
        .eq("id", item.id);

      if (balanceError) {
        patchUnit(item.id, {
          paymentId: String(data.id),
          paymentStatus: "Paid",
          message: balanceError.message,
        });
        return;
      }

      patchUnit(item.id, {
        paymentId: String(data.id),
        paymentStatus: "Paid",
        balance: nextBalance,
      });

      if (item.paymentStatus === "Unpaid") {
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
      }
      return;
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
      }
    }
  }

  async function scanGlobalReceipt(file: File) {
    setScanningReceipt(true);
    setReceiptNotice(null);

    try {
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
        throw new Error(errorMessage);
      }

      const extraction = payload as ReceiptExtraction;
      if (
        typeof extraction.currentReading !== "number" ||
        !Number.isFinite(extraction.currentReading)
      ) {
        throw new Error("The receipt did not include a kWh reading.");
      }

      const unitName =
        typeof extraction.unitName === "string" ? extraction.unitName.trim() : "";
      const matched = findUnitByReceiptName(unitsRef.current, unitName);

      if (!matched) {
        setReceiptNoticeIsError(true);
        setReceiptNotice(
          unitName
            ? `No unit matches “${unitName}”.`
            : "The receipt did not include a unit name.",
        );
        return;
      }

      let receiptUrl: string | null = null;
      let uploadMessage: string | null = null;
      try {
        receiptUrl = await uploadReceiptImage(matched.id, image);
      } catch (error) {
        uploadMessage =
          error instanceof Error
            ? error.message
            : "Could not store the receipt image.";
      }

      patchUnit(matched.id, {
        currentReading: String(extraction.currentReading),
        receiptUrl,
        message: null,
      });
      setActiveTier(matched.baseRent);
      setReceiptNoticeIsError(uploadMessage !== null);
      setReceiptNotice(
        uploadMessage
          ? `Set ${matched.label} current reading to ${extraction.currentReading.toLocaleString("en-PH")} kWh from “${unitName}”. The receipt image was not stored: ${uploadMessage}`
          : `Set ${matched.label} current reading to ${extraction.currentReading.toLocaleString("en-PH")} kWh from “${unitName}”. Receipt image saved.`,
      );
    } catch (error) {
      setReceiptNoticeIsError(true);
      setReceiptNotice(
        error instanceof Error ? error.message : "Receipt extraction failed.",
      );
    } finally {
      setScanningReceipt(false);
    }
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

        <section
          aria-label="Global controls"
          className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between"
        >
          {isAdmin ? (
            <label className="flex w-full flex-col gap-1.5 text-sm font-medium text-slate-700 sm:flex-1">
              Electricity Rate (₱ / kWh)
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={electricityRateInput}
                onChange={(event) => setElectricityRateInput(event.target.value)}
                placeholder="0.00"
                className={`${fieldClass} sm:max-w-xs`}
              />
            </label>
          ) : (
            <div className="flex w-full flex-col gap-1.5 text-sm text-slate-500 sm:flex-1">
              <span className="font-medium text-slate-700">
                Electricity Rate (₱ / kWh)
              </span>
              <span>
                {electricityRate === null
                  ? "Set by Admin"
                  : `₱${Number(electricityRate).toLocaleString("en-PH")} / kWh`}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center sm:justify-center">
            <label className={`${primaryButtonClass} cursor-pointer`}>
              {scanningReceipt ? "Scanning…" : "Scan Global Receipt"}
              <input
                type="file"
                accept="image/*"
                disabled={scanningReceipt}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    void scanGlobalReceipt(file);
                  }
                }}
              />
            </label>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => void startNewMonth()}
                className={primaryButtonClass}
              >
                Start New Month
              </button>
            ) : null}
          </div>
          <div className="hidden sm:block sm:flex-1" aria-hidden="true" />
        </section>

        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Units
          </h1>
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
          <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Filter by monthly rent, update occupancy, and read handwritten
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
            return (
              <button
                key={tier}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTier(tier)}
                className={`min-h-12 min-w-[11.5rem] shrink-0 flex-1 rounded-xl px-4 py-3 text-left transition md:min-w-0 ${
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-64 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200"
              />
            ))}
          </div>
        ) : visibleUnits.length === 0 ? (
          <p className="rounded-2xl bg-white px-6 py-16 text-center text-slate-500 ring-1 ring-slate-200">
            No units at {peso(activeTier)}.
          </p>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleUnits.map((item) => {
              const expanded = openUnitIds[item.id] === true;
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
              return (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
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
                      <h2 className="text-lg font-semibold">{item.label}</h2>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(item.paymentStatus)}`}
                      >
                        {item.paymentStatus}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {item.status}
                      </span>
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden" inert={expanded ? undefined : true}>
                    <div className="flex flex-col gap-4 px-4 pb-4">
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
                            isAdmin
                              ? ""
                              : " cursor-not-allowed bg-slate-50 text-slate-600"
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
                      <dl className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
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
                                item.balance > 0
                                  ? "text-amber-700"
                                  : "text-slate-400"
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
                            {formatMaybePeso(
                              totalDueDisplay,
                              bill.roundsToWholePeso,
                            )}
                          </dd>
                        </div>
                      </dl>
                      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                        Payment status
                        <select
                          value={item.paymentStatus}
                          onChange={(event) =>
                            void changePaymentStatus(
                              item,
                              event.target.value as PaymentStatus,
                            )
                          }
                          className={`${fieldClass} py-2 text-sm ${statusTone(item.paymentStatus)}`}
                        >
                          {PAYMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                        Unit status
                        {isAdmin ? (
                          <select
                            value={item.status}
                            onChange={(event) =>
                              void changeStatus(
                                item,
                                event.target.value as UnitStatus,
                              )
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
                      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                        Payment method
                        <select
                          value={item.paymentMethod}
                          onChange={(event) =>
                            void changeMethod(
                              item,
                              event.target.value as PaymentMethod,
                            )
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
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          disabled={item.paymentStatus === "Paid"}
                          onClick={(event) => {
                            event.stopPropagation();
                            void changePaymentStatus(item, "Paid");
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
                      </div>
                      {item.message ? (
                        <p className="text-sm text-rose-700">{item.message}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
              );
            })}
          </section>
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
              Look up payment history by unit name, who received it, or month.
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
                <option value="">Select month</option>
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

          {!ledgerFilterActive ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Search a unit (e.g., 1N) or select a month to view payment history.
            </p>
          ) : filteredLedger.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No matching payments.
            </p>
          ) : (
            <div className="mt-5 max-h-80 overflow-y-auto rounded-xl border border-slate-100">
              <ul className="divide-y divide-slate-100">
                {filteredLedger.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLedgerEntry(entry)}
                      className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left hover:bg-slate-50"
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
                          <dt className="text-slate-500">Base rent</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(entry.baseRent ?? null, entry.wholeNumber)}
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
                            {formatMaybePeso(entry.totalPaid, entry.wholeNumber)}
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
              <button
                type="button"
                onClick={() => setSelectedLedgerEntry(null)}
                className={primaryButtonClass}
              >
                Close
              </button>
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
                  <dt className="text-slate-500">Base rent</dt>
                  <dd className="font-medium">
                    {formatMaybePeso(
                      selectedLedgerEntry.baseRent ?? null,
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
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
                    >
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
                      <dl className="grid flex-1 grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
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
                          <dt className="text-slate-500">Base rent</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(record.baseRent)}
                          </dd>
                        </div>
                        <div className="sm:col-span-2 lg:col-span-2">
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
                            {formatMaybePeso(record.totalPaid)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Received by</dt>
                          <dd className="font-medium">{record.receivedBy ?? "—"}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {receiptPreview ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-5"
          onClick={() => setReceiptPreview(null)}
        >
          <img
            src={receiptPreview}
            alt="Receipt"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
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
