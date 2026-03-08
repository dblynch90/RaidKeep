/** Get string from Express req.params (can be string | string[]). */
export function paramStr(p: string | string[] | undefined): string {
  return Array.isArray(p) ? p[0] ?? "" : p ?? "";
}
