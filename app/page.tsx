"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RENT_TIERS = [2500, 3000, 5000] as const;
const UNIT_STATUSES = ["Occupied", "Vacant", "Maintenance"] as const;
const PAYMENT_STATUSES = ["Paid", "Partial", "Unpaid"] as const;
const PAYMENT_METHODS = ["Cash", "GCash"] as const;

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
    auth: { persistSession: false, autoRefreshToken: false },
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

function statusDot(status: PaymentStatus) {
  if (status === "Paid") {
    return "bg-green-500";
  }
  if (status === "Partial") {
    return "bg-yellow-400";
  }
  return "bg-red-500";
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
          consumedKwh: historyNumber(row.kwh_reading ?? row.consumed_kwh),
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

function receivedByFromUserAgent(userAgent = navigator.userAgent) {
  const agent = userAgent.toLowerCase();
  if (
    agent.includes("iphone") ||
    agent.includes("ipad") ||
    agent.includes("macintosh")
  ) {
    return "Kyle";
  }
  if (agent.includes("realme") || agent.includes("rmx")) {
    return "[Friend 1 Name]";
  }
  if (agent.includes("vivo")) {
    return "[Friend 2 Name]";
  }
  return "Unknown Device";
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
  const [activeTier, setActiveTier] = useState<RentTier>(2500);
  const [units, setUnits] = useState<DashboardUnit[]>([]);
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [totalElectricityBill, setTotalElectricityBill] = useState("");
  const [totalMainKwh, setTotalMainKwh] = useState("");
  const [electricityRateInput, setElectricityRateInput] = useState("");
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  const [receiptNoticeIsError, setReceiptNoticeIsError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedUnitName, setSelectedUnitName] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryRecord[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<LedgerEntry | null>(null);

  const billAmount = Number(totalElectricityBill);
  const mainKwh = Number(totalMainKwh);
  const calculatedRate =
    totalElectricityBill !== "" &&
    totalMainKwh !== "" &&
    Number.isFinite(billAmount) &&
    Number.isFinite(mainKwh) &&
    mainKwh > 0
      ? (billAmount / mainKwh).toFixed(2)
      : null;
  const parsedElectricityRate = Number(electricityRateInput);
  const electricityRate =
    electricityRateInput !== "" &&
    Number.isFinite(parsedElectricityRate) &&
    parsedElectricityRate >= 0
      ? electricityRateInput
      : null;

  useEffect(() => {
    let cancelled = false;

    async function loadUnits() {
      if (!supabase) {
        if (!cancelled) {
          setLoadError("Supabase URL or anon key is missing.");
          setExpensesError("Supabase URL or anon key is missing.");
          setLoading(false);
          setExpensesLoading(false);
        }
        return;
      }

      const [{ data: unitRows, error: unitError }, expenseResult] =
        await Promise.all([
          supabase.from("Units").select("*"),
          supabase
            .from("Expenses")
            .select("id, description, amount, expense_date"),
        ]);

      if (!cancelled) {
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
      }

      if (cancelled) {
        return;
      }

      if (unitError) {
        setLoadError(unitError.message);
        setLoading(false);
        return;
      }

      const { data: paymentRows, error: paymentError } = await supabase
        .from("Payments")
        .select("*");

      if (cancelled) {
        return;
      }

      if (paymentError) {
        setLoadError(paymentError.message);
        setLoading(false);
        return;
      }

      const mapped = mapUnits(unitRows ?? [], paymentRows ?? []).sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
      setUnits(mapped);
      setLoadError(
        (unitRows?.length ?? 0) > 0 && mapped.length === 0
          ? "Units were found, but none have a base rent of ₱2,500, ₱3,000, or ₱5,000."
          : null,
      );
      setLoading(false);
    }

    void loadUnits();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleUnits = useMemo(
    () => units.filter((item) => item.baseRent === activeTier),
    [units, activeTier],
  );

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

  async function changeStatus(item: DashboardUnit, status: UnitStatus) {
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
    const confirmed = window.confirm(
      "Start a new month? Current readings will move to previous readings, current readings will be cleared, and every unit payment status will reset to Unpaid.",
    );
    if (!confirmed) {
      return;
    }

    const paymentIds = units
      .map((unit) => unit.paymentId)
      .filter((id): id is string => id !== null);

    setUnits((current) =>
      current.map((unit) => ({
        ...unit,
        previousReading: unit.currentReading,
        currentReading: "",
        paymentStatus: "Unpaid",
        receiptUrl: null,
        message: null,
      })),
    );

    if (!supabase || paymentIds.length === 0) {
      return;
    }

    const { error } = await supabase
      .from("Payments")
      .update({ status: "Unpaid" })
      .in("id", paymentIds);

    if (error) {
      setLoadError(error.message);
    }
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
        )
      : null;

    const receivedBy = markingPaid ? receivedByFromUserAgent() : null;

    if (supabase && item.paymentId) {
      const { error } = await supabase
        .from("Payments")
        .update({
          status: next,
          ...(receivedBy ? { received_by: receivedBy } : {}),
          ...(markingPaid && bill
            ? {
                base_rent: item.baseRent,
                electricity_fee: bill.electricityCharge ?? 0,
                kwh_reading: bill.consumed,
                total_due: bill.totalAmountDue ?? item.baseRent,
                receipt_url: item.receiptUrl,
              }
            : {}),
        })
        .eq("id", item.paymentId);

      if (error) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: error.message,
        });
        return;
      }
    } else if (supabase && markingPaid) {
      const { data, error } = await supabase
        .from("Payments")
        .insert({
          unit_id: item.id,
          base_rent: item.baseRent,
          electricity_fee: bill?.electricityCharge ?? 0,
          kwh_reading: bill?.consumed ?? null,
          total_due: bill?.totalAmountDue ?? item.baseRent,
          status: "Paid",
          payment_method: item.paymentMethod || null,
          receipt_url: item.receiptUrl,
          received_by: receivedBy,
        })
        .select("id")
        .single();

      if (error) {
        patchUnit(item.id, {
          paymentStatus: item.paymentStatus,
          message: error.message,
        });
        return;
      }

      patchUnit(item.id, {
        paymentId: String(data.id),
        paymentStatus: "Paid",
      });
    }

    if (item.paymentStatus === "Unpaid" && markingPaid && bill) {
      setLedger((current) => [
        {
          id: crypto.randomUUID(),
          unitName: item.label,
          totalPaid: bill.totalAmountDue ?? item.baseRent,
          baseRent: item.baseRent,
          consumedKwh: bill.consumed,
          wholeNumber: item.baseRent === 5000,
          datePaid: new Date().toISOString(),
          paymentMethod: item.paymentMethod || "—",
          receiptUrl: item.receiptUrl,
          receivedBy: receivedBy ?? "Unknown Device",
        },
        ...current,
      ]);
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

  return (
    <div className="min-h-full bg-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-6 sm:gap-8 sm:px-6 sm:py-8 lg:px-8">
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
              onChange={(event) => setElectricityRateInput(event.target.value)}
              placeholder="0.00"
              className={`${fieldClass} sm:max-w-xs`}
            />
          </label>
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
            <button
              type="button"
              onClick={() => void startNewMonth()}
              className={primaryButtonClass}
            >
              Start New Month
            </button>
          </div>
          <div className="hidden sm:block sm:flex-1" aria-hidden="true" />
        </section>

        <header className="flex flex-col gap-4">
          <p className="text-sm font-medium tracking-wide text-slate-500">
            Rental ledger
          </p>
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
            {visibleUnits.map((item) => (
              <article
                key={item.id}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("input, select, textarea, button, a, label")) {
                    return;
                  }
                  void openPaymentHistory(item);
                }}
                className="flex cursor-pointer flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3 w-3 shrink-0 rounded-full ${statusDot(item.paymentStatus)}`}
                      title={item.paymentStatus}
                      aria-label={`${item.label} payment status: ${item.paymentStatus}`}
                    />
                    <h2 className="text-lg font-semibold">{item.label}</h2>
                  </div>
                    <p className="text-sm text-slate-500">
                      {peso(item.baseRent)} / month
                    </p>
                  </div>
                  <label className="flex min-w-[8.5rem] flex-col gap-1 text-xs font-medium text-slate-500">
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
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  Previous kWh
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={item.previousReading}
                    onChange={(event) =>
                      patchUnit(item.id, {
                        previousReading: event.target.value,
                        message: null,
                      })
                    }
                    placeholder="Previous kWh"
                    className={fieldClass}
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

                <MeterSummary
                  previousReading={item.previousReading}
                  currentReading={item.currentReading}
                  electricityRate={electricityRate}
                  baseRent={item.baseRent}
                />

                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  Unit status
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

                {item.message ? (
                  <p className="text-sm text-rose-700">{item.message}</p>
                ) : null}
              </article>
            ))}
          </section>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Electricity Rate Calculator
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Divide the main bill by total kWh to get the active rate.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Total bill
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={totalElectricityBill}
                onChange={(event) => setTotalElectricityBill(event.target.value)}
                placeholder="0.00"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Total kWh
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={totalMainKwh}
                onChange={(event) => setTotalMainKwh(event.target.value)}
                placeholder="0.00"
                className={fieldClass}
              />
            </label>
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-slate-500">
                Active Rate
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {calculatedRate === null ? "—" : `₱${calculatedRate} / kWh`}
              </p>
            </div>
          </div>
        </section>

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
              Marking a unit Paid records it here. Starting a new month keeps
              this history.
            </p>
          </div>
          {ledger.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No payments recorded yet.
            </p>
          ) : (
            <div className="mt-5 max-h-80 overflow-y-auto rounded-xl border border-slate-100">
              <ul className="divide-y divide-slate-100">
                {ledger.map((entry) => (
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
                        <div>
                          <dt className="text-slate-500">Consumed kWh</dt>
                          <dd className="font-medium">
                            {entry.consumedKwh == null
                              ? "—"
                              : `${entry.consumedKwh.toLocaleString("en-PH")} kWh`}
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
                    {selectedLedgerEntry.consumedKwh == null
                      ? "—"
                      : `${selectedLedgerEntry.consumedKwh.toLocaleString("en-PH")} kWh`}
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
                        <div>
                          <dt className="text-slate-500">Consumed kWh</dt>
                          <dd className="font-medium">
                            {record.consumedKwh === null
                              ? "—"
                              : `${record.consumedKwh.toLocaleString("en-PH")} kWh`}
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
    electricityCharge === null ? null : baseRent + electricityCharge;

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

function MeterSummary({
  previousReading,
  currentReading,
  electricityRate,
  baseRent,
}: {
  previousReading: string;
  currentReading: string;
  electricityRate: string | null;
  baseRent: number;
}) {
  const { consumed, electricityCharge, totalAmountDue, roundsToWholePeso } =
    meterBill(previousReading, currentReading, electricityRate, baseRent);

  return (
    <dl className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-500">Current kWh</dt>
        <dd className="text-base font-semibold text-slate-900">
          {currentReading === "" ? "—" : `${Number(currentReading).toLocaleString("en-PH")} kWh`}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-500">Consumed kWh</dt>
        <dd className="text-base font-semibold text-slate-900">
          {consumed === null
            ? "—"
            : `${roundsToWholePeso ? consumed.toFixed(0) : consumed.toLocaleString("en-PH")} kWh`}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-500">Electricity Charge</dt>
        <dd className="font-medium">
          {formatMaybePeso(electricityCharge, roundsToWholePeso)}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
        <dt className="text-base font-semibold text-slate-900">
          Total Amount Due (₱)
        </dt>
        <dd className="text-lg font-semibold text-slate-900">
          {formatMaybePeso(totalAmountDue, roundsToWholePeso)}
        </dd>
      </div>
    </dl>
  );
}
