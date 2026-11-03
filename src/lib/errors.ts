import { API_ORIGIN } from "./backend";
// Crashes on customers' phones are sent to SKY (with the phone's browser), so
// problems that show up only on some phones can be found and fixed.
let sent = 0;
export function reportError(error: unknown, where: string) {
  if (sent++ > 5) return; // one broken page shouldn't flood the server
  const e = error as { message?: string; stack?: string };
  void fetch(`${API_ORIGIN}/api/client-error/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      where,
      message: String(e?.message ?? error).slice(0, 500),
      stack: String(e?.stack ?? "").slice(0, 1500),
      url: location.href.replace(/spin=[^&]+/, "spin=…"),
    }),
    keepalive: true,
  }).catch(() => {});
}
export function catchErrors() {
  addEventListener("error", (e) => reportError(e.error ?? e.message, "page"));
  addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
