import { invoke } from "@tauri-apps/api/core";
import { createTab } from "./tabs";
import { kimboBus } from "./kimbo-bus";

interface ProjectInfo {
  name: string;
  path: string;
  project_type: string;
}

const TYPE_COLORS: Record<string, string> = {
  Rust: "#f38ba8",
  Node: "#a6e3a1",
  Python: "#f9e2af",
  Go: "#89dceb",
  Git: "#6c7086",
  Generic: "#6c7086",
};

let overlayEl: HTMLElement;
let visible = false;
let projects: ProjectInfo[] = [];
let filtered: ProjectInfo[] = [];
let selectedIndex = 0;

export function initLauncher(overlay: HTMLElement) {
  overlayEl = overlay;
}

export function toggleLauncher() {
  if (visible) {
    hideLauncher();
  } else {
    showLauncher();
  }
}

export function hideLauncher() {
  visible = false;
  overlayEl.classList.add("hidden");
  overlayEl.innerHTML = "";
}

export function isLauncherVisible(): boolean {
  return visible;
}

async function showLauncher() {
  visible = true;
  kimboBus.emit({ type: "launcher-open" });
  overlayEl.classList.remove("hidden");

  try {
    projects = await invoke<ProjectInfo[]>("list_projects");
  } catch {
    projects = [];
  }

  filtered = projects.slice(0, 20);
  selectedIndex = 0;

  render();

  const input = overlayEl.querySelector<HTMLInputElement>(".launcher-input");
  if (input) input.focus();
}

function render() {
  const homeDir = getHomeDir();

  overlayEl.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "launcher-panel";
  Object.assign(panel.style, {
    width: "500px",
    maxHeight: "460px",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  });

  // Search input
  const inputWrap = document.createElement("div");
  Object.assign(inputWrap.style, {
    padding: "12px",
    borderBottom: "1px solid var(--border)",
  });

  const input = document.createElement("input");
  input.className = "launcher-input";
  input.placeholder = "Open project...";
  input.type = "text";
  Object.assign(input.style, {
    width: "100%",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    padding: "8px 12px",
    fontSize: "14px",
    color: "var(--fg)",
    outline: "none",
    fontFamily: "system-ui, -apple-system, sans-serif",
  });

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase();
    if (query === "") {
      filtered = projects.slice(0, 20);
    } else {
      filtered = projects
        .filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.path.toLowerCase().includes(query),
        )
        .slice(0, 20);
    }
    selectedIndex = 0;
    renderList(list, homeDir);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        renderList(list, homeDir);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex =
          (selectedIndex - 1 + filtered.length) % filtered.length;
        renderList(list, homeDir);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectProject(filtered[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideLauncher();
    }
  });

  inputWrap.appendChild(input);
  panel.appendChild(inputWrap);

  // Project list
  const list = document.createElement("div");
  list.className = "launcher-list";
  Object.assign(list.style, {
    overflowY: "auto",
    flex: "1",
    padding: "4px 0",
  });

  renderList(list, homeDir);
  panel.appendChild(list);

  overlayEl.appendChild(panel);

  // Click outside panel to dismiss
  overlayEl.addEventListener(
    "click",
    (e) => {
      if (e.target === overlayEl) {
        hideLauncher();
      }
    },
    { once: true },
  );
}

function renderList(listEl: HTMLElement, homeDir: string) {
  listEl.innerHTML = "";

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    Object.assign(empty.style, {
      padding: "16px",
      textAlign: "center",
      color: "var(--tab-inactive-fg)",
      fontSize: "13px",
    });
    empty.textContent = "No projects found";
    listEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < filtered.length; i++) {
    const project = filtered[i];
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      padding: "6px 12px",
      cursor: "pointer",
      gap: "10px",
      background: i === selectedIndex ? "var(--surface)" : "transparent",
    });

    row.addEventListener("mouseenter", () => {
      selectedIndex = i;
      renderList(listEl, homeDir);
    });

    row.addEventListener("click", () => {
      selectProject(project);
    });

    // Type badge
    const badge = document.createElement("span");
    const badgeColor = TYPE_COLORS[project.project_type] || TYPE_COLORS.Generic;
    Object.assign(badge.style, {
      display: "inline-block",
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: badgeColor,
      flexShrink: "0",
    });
    row.appendChild(badge);

    // Name
    const name = document.createElement("span");
    name.textContent = project.name;
    Object.assign(name.style, {
      fontSize: "13px",
      color: "var(--fg)",
      fontWeight: "500",
      whiteSpace: "nowrap",
    });
    row.appendChild(name);

    // Path
    const pathEl = document.createElement("span");
    const displayPath = homeDir
      ? project.path.replace(homeDir, "~")
      : project.path;
    pathEl.textContent = displayPath;
    Object.assign(pathEl.style, {
      fontSize: "12px",
      color: "var(--tab-inactive-fg)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      marginLeft: "auto",
    });
    row.appendChild(pathEl);

    listEl.appendChild(row);
  }

  // Scroll selected item into view
  const selectedRow = listEl.children[selectedIndex] as HTMLElement | undefined;
  if (selectedRow) {
    selectedRow.scrollIntoView({ block: "nearest" });
  }
}

function selectProject(project: ProjectInfo) {
  hideLauncher();
  kimboBus.emit({ type: "project-opened" });
  createTab(project.path);
}

function getHomeDir(): string {
  // Derive home dir from common project paths or use a fallback
  if (projects.length > 0) {
    const match = projects[0].path.match(/^(\/Users\/[^/]+)/);
    if (match) return match[1];
  }
  return "";
}
