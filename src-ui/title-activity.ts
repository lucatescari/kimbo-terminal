// Reads the activity glyph a TUI puts at the front of the terminal title.
//
// Two programs get recognised, and only two. Claude Code's glyphs are stripped
// but say nothing about activity: the `claude_tab_states` poll owns Claude's
// dot and knows the difference between working and waiting for you, which a
// title cannot express. Codex has no such state on disk, so its spinner is the
// only live signal Kimbo receives, and it is read as "working".
//
// Everything else is left exactly as it arrived. A leading glyph is a weak
// signal on its own: plenty of titles legitimately start with an odd
// character, and a false positive here is a tab that claims to be working
// forever. Adding a program means confirming its frames first, the way
// codex's were confirmed against the shipped binary.
//
// Pure on purpose: no DOM, no state. tabs.ts owns what to do with the answer.

/** The ten-frame braille spinner codex animates in the title while it works,
 *  at roughly ten updates a second.
 *
 *  Captured off codex-cli 0.153.4 running in a pty, which writes OSC 0 (not
 *  OSC 2) and cycles the whole lifecycle through the title:
 *
 *      kimbo-terminal            (idle)
 *      ⠋ kimbo-terminal          (working, ten frames)
 *      ...
 *      kimbo-terminal            (idle again)
 *
 *  So the frame leaving the title is what clears the dot, and no timeout is
 *  needed. Note the text after the frame is the directory name, not the
 *  program name: nothing here may key off what follows the glyph. */
export const CODEX_SPINNER_FRAMES = [
  "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
] as const;

/** Claude Code's title prefix: two frames alternating at 960ms while it is
 *  working, plus a static mark when it is not.
 *
 *      var sB = ["◐", "◑"], lB = "✳", uTe = 960;
 */
export const CLAUDE_TITLE_GLYPHS = ["◐", "◑", "✳"] as const;

export interface TitleActivity {
  /** The title with a recognised glyph removed, ready to become the label. */
  title: string;
  /** Whether the glyph means the program is working right now. */
  busy: boolean;
}

/** Split a terminal title into the part worth showing and what its leading
 *  glyph says about activity. Matches only at position zero and only when the
 *  glyph is followed by a space, so "◐running" and "build ⠋ x" are untouched. */
export function classifyTitle(title: string): TitleActivity {
  for (const frame of CODEX_SPINNER_FRAMES) {
    if (title.startsWith(`${frame} `)) {
      return { title: title.slice(frame.length + 1), busy: true };
    }
  }
  for (const glyph of CLAUDE_TITLE_GLYPHS) {
    if (title.startsWith(`${glyph} `)) {
      return { title: title.slice(glyph.length + 1), busy: false };
    }
  }
  return { title, busy: false };
}
