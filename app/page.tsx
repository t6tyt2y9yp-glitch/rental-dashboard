"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RENT_TIERS = [2500, 3000, 5000] as const;
const UNIT_STATUSES = ["Occupied", "Vacant", "Maintenance"] as const;
const PAYMENT_STATUSES = ["Pending", "Paid", "Partial", "Late"] as const;
const PAYMENT_METHODS = ["Cash", "GCash"] as const;

type RentTier = (typeof RENT_TIERS)[number];
type UnitStatus = (typeof UNIT_STATUSES)[number];
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type ReceiptExtraction = {
  base_rent: number | null;
  electricity_fee: number | null;
  kwh_reading: number | null;
  total_due: number | null;
};

type DashboardUnit = {
  id: string;
  label: string;
  baseRent: RentTier;
  status: UnitStatus;
  paymentStatus: PaymentStatus | null;
  paymentMethod: PaymentMethod | "";
  paymentId: string | null;
  extracting: boolean;
  extraction: ReceiptExtraction | null;
  message: string | null;
};

type UnitRow = Record<string, unknown>;
type PaymentRow = Record<string, unknown>;

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

function asRentTier(value: unknown): RentTier | null {
  const amount = typeof value === "number" ? value : Number(value);
  return RENT_TIERS.find((tier) => tier === amount) ?? null;
}

function asUnitStatus(value: unknown): UnitStatus {
  return UNIT_STATUSES.find((status) => status === value) ?? "Occupied";
}

function asPaymentStatus(value: unknown): PaymentStatus | null {
  return PAYMENT_STATUSES.find((status) => status === value) ?? null;
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
        extracting: false,
        extraction: null,
        message: null,
      },
    ];
  });
}

function statusTone(status: PaymentStatus | null) {
  if (status === "Paid") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (status === "Partial") {
    return "bg-sky-50 text-sky-700 ring-sky-200";
  }
  if (status === "Late") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }
  if (status === "Pending") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  return "bg-slate-50 text-slate-600 ring-slate-200";
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read that image."));
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [activeTier, setActiveTier] = useState<RentTier>(2500);
  const [units, setUnits] = useState<DashboardUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);

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
        status: item.paymentStatus ?? "Pending",
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
      paymentStatus: item.paymentStatus ?? "Pending",
    });
  }

  async function extractReceipt(item: DashboardUnit, file: File) {
    patchUnit(item.id, {
      extracting: true,
      message: null,
      extraction: null,
    });

    try {
      const image = await readFileAsDataUrl(file);
      const response = await fetch("/api/extract-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mimeType: file.type }),
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

      patchUnit(item.id, {
        extracting: false,
        extraction: payload as ReceiptExtraction,
      });
    } catch (error) {
      patchUnit(item.id, {
        extracting: false,
        message:
          error instanceof Error ? error.message : "Receipt extraction failed.",
      });
    }
  }

  return (
    <div className="min-h-full bg-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2">
          <p className="text-sm font-medium tracking-wide text-slate-500">
            Rental ledger
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Units
          </h1>
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

        <div
          role="tablist"
          aria-label="Rent tiers"
          className="grid grid-cols-1 gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3"
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
                className={`rounded-xl px-4 py-3 text-left transition ${
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
            className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Description
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Repairs, supplies, utilities"
                className="rounded-lg border border-slate-300 px-3 py-2 font-normal text-slate-900 outline-none focus:border-slate-900"
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
                className="rounded-lg border border-slate-300 px-3 py-2 font-normal text-slate-900 outline-none focus:border-slate-900"
              />
            </label>
            <button
              type="submit"
              disabled={savingExpense}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
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

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleUnits.map((item) => (
              <article
                key={item.id}
                className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{item.label}</h2>
                    <p className="text-sm text-slate-500">
                      {peso(item.baseRent)} / month
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(item.paymentStatus)}`}
                  >
                    {item.paymentStatus ?? "No payment"}
                  </span>
                </div>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  Unit status
                  <select
                    value={item.status}
                    onChange={(event) =>
                      void changeStatus(item, event.target.value as UnitStatus)
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900 outline-none focus:border-slate-900"
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
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900 outline-none focus:border-slate-900"
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

                {item.status === "Occupied" ? (
                  <div className="flex flex-col gap-3">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
                      {item.extracting ? "Reading receipt…" : "Upload receipt"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={item.extracting}
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) {
                            void extractReceipt(item, file);
                          }
                        }}
                      />
                    </label>
                    {item.extracting ? (
                      <p className="text-sm text-slate-500">
                        Extracting rent, electricity, and kWh…
                      </p>
                    ) : null}
                    {item.extraction ? (
                      <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                        <div>
                          <dt className="text-slate-500">Base rent</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(item.extraction.base_rent)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Electricity</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(item.extraction.electricity_fee)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">kWh</dt>
                          <dd className="font-medium">
                            {item.extraction.kwh_reading ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Total due</dt>
                          <dd className="font-medium">
                            {formatMaybePeso(item.extraction.total_due)}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                ) : null}

                {item.message ? (
                  <p className="text-sm text-rose-700">{item.message}</p>
                ) : null}
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function formatMaybePeso(value: number | null) {
  return value === null ? "—" : peso(value);
}
