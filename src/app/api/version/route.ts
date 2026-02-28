import { NextResponse } from "next/server";
import { getVersionInfo } from "@/lib/server/version-check";

// GET /api/version — returns current version, latest available, and update status
export async function GET(): Promise<NextResponse> {
  const info = await getVersionInfo();

  return NextResponse.json(
    {
      version: info.current,
      latest: info.latest,
      updateAvailable: info.updateAvailable,
      checkedAt: info.checkedAt?.toISOString() ?? null,
    },
    { status: 200 }
  );
}
