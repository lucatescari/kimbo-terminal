import { getActiveSession } from "./panes";

let barEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let caseToggleEl: HTMLInputElement | null = null;
let regexToggleEl: HTMLInputElement | null = null;
let visible = false;
let countDisposable: { dispose(): void } | null = null;

/** Update the count display based on search results. */
function updateCount(e: { resultIndex: number; resultCount: number }): void {
  if (!countEl) return;
  if (e.resultCount === 0) {
    countEl.textContent = "No matches";
  } else {
    countEl.textContent = `${e.resultIndex + 1} / ${e.resultCount}`;
  }
}

/** Bind the count listener for the active session. */
function bindCountListener(): void {
  countDisposable?.dispose();
  countDisposable = null;
  const session = getActiveSession();
  if (!session) return;
  countDisposable = session.search.onDidChangeResults(updateCount);
}

/** Mount the find-bar overlay into the given root element. Idempotent. */
export function initFindBar(root: HTMLElement): void {
  if (barEl) return;

  barEl = document.createElement("div");
  barEl.className = "find-bar";
  barEl.style.display = "none";
  barEl.innerHTML = `
    <input type="text" class="find-input" placeholder="Find" spellcheck="false" />
    <span class="find-count">0 / 0</span>
    <label class="find-toggle"><input type="checkbox" class="find-case" /> Aa</label>
    <label class="find-toggle"><input type="checkbox" class="find-regex" /> .*</label>
    <button class="find-prev" title="Previous (Shift+Enter)">↑</button>
    <button class="find-next" title="Next (Enter)">↓</button>
    <button class="find-close" title="Close (Esc)">×</button>
  `;
  root.appendChild(barEl);

  inputEl = barEl.querySelector(".find-input") as HTMLInputElement;
  countEl = barEl.querySelector(".find-count") as HTMLElement;
  caseToggleEl = barEl.querySelector(".find-case") as HTMLInputElement;
  regexToggleEl = barEl.querySelector(".find-regex") as HTMLInputElement;

  const onSearch = (direction: "next" | "prev") => {
    const session = getActiveSession();
    if (!session) return;
    const query = inputEl!.value;
    if (!query) {
      session.search.clearDecorations();
      countEl!.textContent = "0 / 0";
      return;
    }
    // Note: matchOverviewRuler and activeMatchColorOverviewRuler require
    // #RRGGBB hex strings (per ISearchDecorationOptions typings) — they
    // paint into xterm's overview-ruler canvas. The two *Background fields
    // accept any CSS color including rgba for transparency.
    const opts = {
      caseSensitive: caseToggleEl!.checked,
      regex: regexToggleEl!.checked,
      decorations: {
        matchBackground: "rgba(255, 200, 0, 0.4)",
        matchOverviewRuler: "#ffc800",
        activeMatchBackground: "rgba(255, 140, 0, 0.7)",
        activeMatchColorOverviewRuler: "#ff8c00",
      },
    };
    if (direction === "next") session.search.findNext(query, opts);
    else session.search.findPrevious(query, opts);
  };

  inputEl.addEventListener("input", () => onSearch("next"));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch(e.shiftKey ? "prev" : "next");
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideFindBar();
    }
  });
  caseToggleEl.addEventListener("change", () => onSearch("next"));
  regexToggleEl.addEventListener("change", () => onSearch("next"));
  (barEl.querySelector(".find-prev") as HTMLButtonElement).addEventListener("click", () => onSearch("prev"));
  (barEl.querySelector(".find-next") as HTMLButtonElement).addEventListener("click", () => onSearch("next"));
  (barEl.querySelector(".find-close") as HTMLButtonElement).addEventListener("click", () => hideFindBar());
}

export function toggleFindBar(): void {
  if (!barEl) return;
  if (visible) hideFindBar();
  else showFindBar();
}

export function isFindBarVisible(): boolean {
  return visible;
}

export function hideFindBar(): void {
  if (!barEl || !visible) return;
  barEl.style.display = "none";
  visible = false;
  countDisposable?.dispose();
  countDisposable = null;
  const session = getActiveSession();
  session?.search.clearDecorations();
  session?.term.focus();
}

function showFindBar(): void {
  if (!barEl) return;
  barEl.style.display = "flex";
  visible = true;
  if (countEl) countEl.textContent = "0 / 0";
  bindCountListener();
  inputEl?.focus();
  inputEl?.select();
}
