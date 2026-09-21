import { describe, expect, it } from "vitest";
import { isAllowedLinkUri, openLinkIfAllowed } from "./link-schemes";

// An OSC 8 hyperlink carries its URI in the escape sequence, so any program
// that can write to the terminal picks it — and the label shown to the user is
// separate text that can say anything. A Cmd+click on "release notes" must not
// be able to hand an arbitrary scheme to the system opener.

describe("isAllowedLinkUri", () => {
  it("allows the schemes terminal links legitimately use", () => {
    expect(isAllowedLinkUri("https://example.com/x")).toBe(true);
    expect(isAllowedLinkUri("http://example.com")).toBe(true);
    expect(isAllowedLinkUri("mailto:someone@example.com")).toBe(true);
    // `ls --hyperlink` and eza emit file:// links.
    expect(isAllowedLinkUri("file:///Users/me/notes.md")).toBe(true);
  });

  it("rejects script and data URIs", () => {
    expect(isAllowedLinkUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedLinkUri("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedLinkUri("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects custom protocol handlers registered by installed apps", () => {
    expect(isAllowedLinkUri("ms-msdt:/id PCWDiagnostic")).toBe(false);
    expect(isAllowedLinkUri("zoommtg://zoom.us/join?confno=1")).toBe(false);
    expect(isAllowedLinkUri("kimbo://whatever")).toBe(false);
  });

  it("matches the scheme case-insensitively, both ways", () => {
    expect(isAllowedLinkUri("HTTPS://example.com")).toBe(true);
    expect(isAllowedLinkUri("JavaScript:alert(1)")).toBe(false);
    expect(isAllowedLinkUri("JAVASCRIPT:alert(1)")).toBe(false);
  });

  it("rejects a scheme smuggled past a leading space or control character", () => {
    // Some openers trim before dispatching, so the check has to trim too
    // rather than let " javascript:" through as "no recognised scheme".
    expect(isAllowedLinkUri(" javascript:alert(1)")).toBe(false);
    expect(isAllowedLinkUri("\tjavascript:alert(1)")).toBe(false);
    expect(isAllowedLinkUri("\njavascript:alert(1)")).toBe(false);
    expect(isAllowedLinkUri("\u0000javascript:alert(1)")).toBe(false);
  });

  it("rejects a URI with no scheme at all", () => {
    expect(isAllowedLinkUri("example.com")).toBe(false);
    expect(isAllowedLinkUri("/etc/passwd")).toBe(false);
    expect(isAllowedLinkUri("")).toBe(false);
  });

  it("does not accept a prefix that merely starts with an allowed scheme name", () => {
    expect(isAllowedLinkUri("https-evil://example.com")).toBe(false);
    expect(isAllowedLinkUri("httpsx:payload")).toBe(false);
    expect(isAllowedLinkUri("filezilla://host")).toBe(false);
  });
});

describe("openLinkIfAllowed", () => {
  it("hands an allowed URI to the opener untouched", () => {
    const opened: string[] = [];
    const result = openLinkIfAllowed("https://example.com/a?b=c#d", (u) => {
      opened.push(u);
      return Promise.resolve();
    });

    expect(result).toBe(true);
    expect(opened).toEqual(["https://example.com/a?b=c#d"]);
  });

  it("never calls the opener for a blocked scheme", () => {
    const opened: string[] = [];
    const result = openLinkIfAllowed("javascript:alert(1)", (u) => {
      opened.push(u);
      return Promise.resolve();
    });

    expect(result).toBe(false);
    expect(opened).toEqual([]);
  });

  it("swallows a rejection from the opener instead of raising unhandled", () => {
    // The call sites are click handlers, so a rejected promise would surface
    // as an unhandled rejection rather than anything the user can act on.
    expect(() =>
      openLinkIfAllowed("https://example.com", () =>
        Promise.reject(new Error("opener exploded")),
      ),
    ).not.toThrow();
  });
});
