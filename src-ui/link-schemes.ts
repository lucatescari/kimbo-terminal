// Scheme gate for links the terminal hands to the system opener.
//
// An OSC 8 hyperlink carries its target in the escape sequence, so the URI is
// chosen by whatever program is writing to the pane — and the label the user
// sees is separate text that can read "release notes" while the URI points
// somewhere else entirely. Without a gate, one Cmd+click reaches `openUrl`
// with any scheme, including the custom protocol handlers that installed apps
// register (ms-msdt:, zoommtg:, and anything a malicious app claims).
//
// http/https/mailto are the ordinary web cases. file: is here because
// `ls --hyperlink`, eza, bat and git emit file:// links for real files, and
// blocking it would silently break Cmd+click on their output. It carries the
// same exposure as Cmd+clicking a plain path in the terminal, which Kimbo
// already supports, and it stays subject to the opener path scope in
// src-tauri/capabilities/default.json.
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "file:"]);

// Leading whitespace and C0/C1 control characters are stripped before the
// scheme is read. Openers trim before dispatching, so "\u0000javascript:..."
// must not slip through as "no recognised scheme, therefore harmless".
const TRIMMABLE = /^[\s\u0000-\u001F\u007F-\u009F]+|[\s\u0000-\u001F\u007F-\u009F]+$/g;

// RFC 3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ). Anchored and
// followed by a literal colon, so "https-evil://" reads as the scheme
// "https-evil:" rather than matching on the "https" prefix.
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** The lowercased `scheme:` of a URI, or null when it carries none. */
function schemeOf(uri: string): string | null {
  const match = SCHEME.exec(uri.replace(TRIMMABLE, ""));
  return match ? `${match[1].toLowerCase()}:` : null;
}

/** Whether a terminal link may be handed to the system opener. */
export function isAllowedLinkUri(uri: string): boolean {
  const scheme = schemeOf(uri);
  return scheme !== null && ALLOWED_SCHEMES.has(scheme);
}

/**
 * Open `uri` through `open` when its scheme is allowed. Returns whether the
 * link was dispatched, so callers can tell a blocked link from an opened one.
 *
 * The opener's promise is settled here: both call sites are click handlers,
 * where a rejection would surface as an unhandled rejection rather than
 * anything the user can act on.
 */
export function openLinkIfAllowed(
  uri: string,
  open: (uri: string) => Promise<unknown>,
): boolean {
  if (!isAllowedLinkUri(uri)) {
    console.warn(
      `Refused to open a terminal link with a disallowed scheme: ${schemeOf(uri) ?? "(none)"}`,
    );
    return false;
  }
  void Promise.resolve(open(uri)).catch((e) =>
    console.error("openUrl failed:", e),
  );
  return true;
}
