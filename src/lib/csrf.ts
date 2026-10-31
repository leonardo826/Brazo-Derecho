import { cookies } from "next/headers";
import { CSRF_COOKIE, tokensMatch } from "@/lib/csrf-token";

export async function csrfMatches(formData: FormData) {
  const jar = await cookies();
  const cookie = jar.get(CSRF_COOKIE)?.value ?? "";
  return tokensMatch(cookie, String(formData.get("csrf") ?? ""));
}
