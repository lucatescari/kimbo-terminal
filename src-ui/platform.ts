// Browser-side platform probe. WKWebView exposes "MacIntel" / "MacARM" /
// "Mac…" on macOS. Kept as its own module so tests can vi.mock() it.

export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /^Mac/i.test(navigator.platform ?? "");
}
