import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LATE_AFTER_DAY = 10;

export type PaymentStatus = "Pending" | "Partial" | "Late";

export type MonthlyBill = {
  id: string;
  unit_id: string;
  base_rent: number;
  electricity_fee: number;
  kwh_reading: number | null;
  total_due: number;
  status: "Pending";
};

export type LatePayment = {
  id: string;
  unit_id: string;
  status: "Late";
};

type UnitRow = {
  id: string;
  base_rent: number | string | null;
  status: string | null;
};

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase key (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireFiniteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return parsed;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function generateMonthlyBill(
  unitId: string,
  extractedKwh: number | null,
  extractedElectricityFee: number,
): Promise<MonthlyBill> {
  if (!unitId) {
    throw new Error("unitId is required.");
  }

  const electricityFee = requireFiniteNumber(
    extractedElectricityFee,
    "extractedElectricityFee",
  );
  const kwhReading =
    extractedKwh === null
      ? null
      : requireFiniteNumber(extractedKwh, "extractedKwh");

  const supabase = getSupabase();
  const { data: unit, error: unitError } = await supabase
    .from("Units")
    .select("id, base_rent, status")
    .eq("id", unitId)
    .maybeSingle<UnitRow>();

  if (unitError) {
    throw new Error(unitError.message);
  }
  if (!unit) {
    throw new Error(`Unit ${unitId} was not found.`);
  }

  const baseRent = requireFiniteNumber(unit.base_rent, "base_rent");
  const totalDue = roundMoney(baseRent + electricityFee);

  const { data: payment, error: insertError } = await supabase
    .from("Payments")
    .insert({
      unit_id: unitId,
      base_rent: baseRent,
      electricity_fee: electricityFee,
      kwh_reading: kwhReading,
      total_due: totalDue,
      status: "Pending",
    })
    .select(
      "id, unit_id, base_rent, electricity_fee, kwh_reading, total_due, status",
    )
    .single<MonthlyBill>();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return payment;
}

export async function checkLatePayments(): Promise<LatePayment[]> {
  if (new Date().getDate() <= LATE_AFTER_DAY) {
    return [];
  }

  const supabase = getSupabase();
  const { data: occupiedUnits, error: unitError } = await supabase
    .from("Units")
    .select("id, status")
    .eq("status", "Occupied");

  if (unitError) {
    throw new Error(unitError.message);
  }

  const occupiedIds = (occupiedUnits ?? [])
    .filter((unit) => unit.status === "Occupied")
    .map((unit) => String(unit.id));

  if (occupiedIds.length === 0) {
    return [];
  }

  const { data: updated, error: updateError } = await supabase
    .from("Payments")
    .update({ status: "Late" })
    .in("status", ["Pending", "Partial"])
    .in("unit_id", occupiedIds)
    .select("id, unit_id, status");

  if (updateError) {
    throw new Error(updateError.message);
  }

  return (updated ?? []) as LatePayment[];
}
