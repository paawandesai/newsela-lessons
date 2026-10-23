"use server";

import { eq } from "@nl/db/orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog, db, units } from "@nl/db";
import { OutlineError } from "@nl/schema";
import { requireUser } from "@/lib/session";
import { gridFromGoogleSheet, gridFromUpload, ImportError, parseSheetLink } from "@/lib/spreadsheet";
import { createUnitFromGrid, getUnitWithRows, resolveFlag, unresolvedErrors, type FlagRef } from "@/lib/units";

export async function importUnit(_prev: { error?: string } | undefined, form: FormData) {
  const user = await requireUser("expert");
  const file = form.get("file");
  const link = String(form.get("link") ?? "").trim();
  let unitId: string;
  try {
    if (file instanceof File && file.size > 0) {
      unitId = await createUnitFromGrid(await gridFromUpload(file), { kind: "upload", ref: file.name }, user);
    } else if (link) {
      const { sheetId, gid } = parseSheetLink(link);
      unitId = await createUnitFromGrid(await gridFromGoogleSheet(sheetId, gid), { kind: "google_sheet", ref: `${sheetId}#gid=${gid}` }, user);
    } else {
      return { error: "Choose a file or paste a Google Sheets link." };
    }
  } catch (e) {
    if (e instanceof ImportError || e instanceof OutlineError) return { error: e.message };
    throw e;
  }
  redirect(`/units/${unitId}`);
}

export async function resolveFlagAction(form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  const rowId = form.get("rowId");
  const ref: FlagRef = rowId ? { scope: "row", rowId: String(rowId) } : { scope: "unit" };
  const choice = form.get("choice");
  await resolveFlag(unitId, ref, Number(form.get("index")), choice ? String(choice) : undefined, user);
  revalidatePath(`/units/${unitId}`);
}

export async function confirmOutline(form: FormData) {
  const user = await requireUser("expert");
  const unitId = String(form.get("unitId"));
  const data = await getUnitWithRows(unitId);
  if (!data) throw new Error("Unit not found");
  if (unresolvedErrors(data.unit.flags, data.rows) > 0) throw new Error("Resolve every decision first.");
  await db.update(units).set({ status: "ready" }).where(eq(units.id, unitId));
  await db.insert(auditLog).values({ unitId, actorId: user.id, action: "unit.confirmed" });
  redirect(`/units/${unitId}/generate`);
}
