// Inline SVG icon library. Returns an <svg> element with stroke=currentColor so
// it inherits color from the CSS context (button text color, link color, etc).

export type IconName =
  | "plus"
  | "close"
  | "split"
  | "cmd"
  | "search"
  | "settings"
  | "terminal"
  | "copy"
  | "chevron-d"
  | "check"
  | "info"
  | "palette"
  | "type"
  | "layers"
  | "sliders"
  | "folder"
  | "keyboard"
  | "smile"
  | "wrench"
  | "corner"
  | "history"
  | "git"
  | "download"
  | "external";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Returns an <svg> node for the given icon name. */
export function icon(name: IconName, size = 14, stroke = 1.5): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(stroke));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const child of paths(name)) svg.appendChild(child);
  return svg;
}

function el(tag: string, attrs: Record<string, string>): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function paths(name: IconName): SVGElement[] {
  switch (name) {
    case "plus":
      return [
        el("line", { x1: "12", y1: "5", x2: "12", y2: "19" }),
        el("line", { x1: "5", y1: "12", x2: "19", y2: "12" }),
      ];
    case "close":
      return [
        el("line", { x1: "6", y1: "6", x2: "18", y2: "18" }),
        el("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
      ];
    case "split":
      return [
        el("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }),
        el("line", { x1: "12", y1: "4", x2: "12", y2: "20" }),
      ];
    case "cmd":
      return [
        el("path", {
          d: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
        }),
      ];
    case "search":
      return [
        el("circle", { cx: "11", cy: "11", r: "7" }),
        el("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }),
      ];
    case "settings":
      return [
        el("circle", { cx: "12", cy: "12", r: "3" }),
        el("path", {
          d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
        }),
      ];
    case "terminal":
      return [
        el("polyline", { points: "4 7 9 12 4 17" }),
        el("line", { x1: "12", y1: "19", x2: "20", y2: "19" }),
      ];
    case "copy":
      return [
        el("rect", { x: "9", y: "9", width: "13", height: "13", rx: "2" }),
        el("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }),
      ];
    case "chevron-d":
      return [el("polyline", { points: "6 9 12 15 18 9" })];
    case "check":
      return [el("polyline", { points: "20 6 9 17 4 12" })];
    case "info":
      return [
        el("circle", { cx: "12", cy: "12", r: "10" }),
        el("line", { x1: "12", y1: "16", x2: "12", y2: "12" }),
        el("line", { x1: "12", y1: "8", x2: "12.01", y2: "8" }),
      ];
    case "palette":
      return [
        el("circle", { cx: "12", cy: "12", r: "9" }),
        el("circle", { cx: "8", cy: "10", r: "1" }),
        el("circle", { cx: "12", cy: "7", r: "1" }),
        el("circle", { cx: "16", cy: "10", r: "1" }),
        el("circle", { cx: "15", cy: "15", r: "1" }),
        el("path", {
          d: "M12 21a3 3 0 0 1-3-3v-1a3 3 0 0 1 3-3h1a2 2 0 0 1 2 2 2 2 0 0 0 2 2h1",
        }),
      ];
    case "type":
      return [
        el("polyline", { points: "4 7 4 4 20 4 20 7" }),
        el("line", { x1: "9", y1: "20", x2: "15", y2: "20" }),
        el("line", { x1: "12", y1: "4", x2: "12", y2: "20" }),
      ];
    case "layers":
      return [
        el("polygon", { points: "12 2 2 7 12 12 22 7 12 2" }),
        el("polyline", { points: "2 17 12 22 22 17" }),
        el("polyline", { points: "2 12 12 17 22 12" }),
      ];
    case "sliders":
      return [
        el("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
        el("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
        el("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
        el("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
        el("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
        el("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
        el("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
        el("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
        el("line", { x1: "17", y1: "16", x2: "23", y2: "16" }),
      ];
    case "folder":
      return [el("path", { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" })];
    case "keyboard":
      return [
        el("rect", { x: "2", y: "6", width: "20", height: "12", rx: "2" }),
        el("line", { x1: "6", y1: "10", x2: "6", y2: "10" }),
        el("line", { x1: "10", y1: "10", x2: "10", y2: "10" }),
        el("line", { x1: "14", y1: "10", x2: "14", y2: "10" }),
        el("line", { x1: "18", y1: "10", x2: "18", y2: "10" }),
        el("line", { x1: "6", y1: "14", x2: "18", y2: "14" }),
      ];
    case "smile":
      return [
        el("circle", { cx: "12", cy: "12", r: "10" }),
        el("path", { d: "M8 14s1.5 2 4 2 4-2 4-2" }),
        el("line", { x1: "9", y1: "9", x2: "9.01", y2: "9" }),
        el("line", { x1: "15", y1: "9", x2: "15.01", y2: "9" }),
      ];
    case "wrench":
      return [el("path", { d: "M14.7 6.3a5 5 0 1 1 3 3L6 21l-3-3z" })];
    case "corner":
      return [
        el("path", { d: "M4 4h10v10" }),
        el("path", { d: "M20 14v6h-6" }),
      ];
    case "history":
      return [
        el("path", { d: "M3 3v5h5" }),
        el("path", { d: "M3.05 13A9 9 0 1 0 6 5.3L3 8" }),
        el("polyline", { points: "12 7 12 12 16 14" }),
      ];
    case "git":
      return [
        el("circle", { cx: "6", cy: "6", r: "2" }),
        el("circle", { cx: "6", cy: "18", r: "2" }),
        el("circle", { cx: "18", cy: "12", r: "2" }),
        el("path", { d: "M6 8v8" }),
        el("path", { d: "M18 10a6 6 0 0 0-6-6H6" }),
      ];
    case "download":
      return [
        el("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
        el("polyline", { points: "7 10 12 15 17 10" }),
        el("line", { x1: "12", y1: "15", x2: "12", y2: "3" }),
      ];
    case "external":
      return [
        el("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
        el("polyline", { points: "15 3 21 3 21 9" }),
        el("line", { x1: "10", y1: "14", x2: "21", y2: "3" }),
      ];
  }
}
