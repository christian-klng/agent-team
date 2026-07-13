import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "./auth";

/**
 * Session-Guard für Route Handler: liefert die userId oder eine fertige
 * 401-Response. Verwendung:
 *
 *   const authResult = await requireUserId();
 *   if (authResult instanceof NextResponse) return authResult;
 *   const { userId } = authResult;
 */
export async function requireUserId(): Promise<{ userId: string } | NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }
  return { userId: session.user.id };
}
