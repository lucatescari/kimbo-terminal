import "../screen-pets.css";
import { getPrefs, setPref, onChange } from "../ui-prefs";
import type { Bounds, PetInstance, Species, PetEntity } from "./types";
import { SPECIES, spriteUrl, tokenForState } from "./sprites";
import { PET_W, PET_H } from "./pet";
import {
  createWorld, stepWorld, addPet, removePet, setBounds, throwBall, type World,
} from "./world";

let root: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let world: World | null = null;
let rafId = 0;
let lastTs = 0;
let unsub: (() => void) | null = null;
let resizeObs: ResizeObserver | null = null;

const SPEED_MUL: Record<string, number> = { calm: 0.6, normal: 1, lively: 1.6 };

let idCounter = 0;
export function newPetId(): string {
  idCounter += 1;
  return `pet-${idCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function defaultPet(): PetInstance {
  return { id: newPetId(), species: "cat", color: SPECIES.cat.defaultColor, name: "Pet" };
}

function computeBounds(): Bounds {
  const w = layer?.clientWidth || root?.clientWidth || 800;
  const h = layer?.clientHeight || root?.clientHeight || 400;
  return { left: 0, top: 0, right: w, bottom: h };
}

export function initScreenPets(rootEl: HTMLElement): void {
  root = rootEl;
  // Guard against double-init leaking a prior subscription.
  unsub?.(); unsub = null;
  // React to enable/roster/speed changes.
  unsub = onChange(() => reconcile());
  reconcile();
}

function teardownLayer(): void {
  stopLoop();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("resize", onWindowResize);
  resizeObs?.disconnect(); resizeObs = null;
  ballEl?.remove(); ballEl = null;
  layer?.remove(); layer = null;
  world = null;
}

export function disposeScreenPets(): void {
  unsub?.(); unsub = null;
  teardownLayer();
}

/** Build/teardown the layer and world to match current prefs. */
function reconcile(): void {
  const prefs = getPrefs();
  if (!prefs.screenPetsEnabled) {
    if (layer) teardownLayer();
    return;
  }

  // Seed exactly one pet if enabled with an empty roster.
  if (prefs.screenPets.length === 0) {
    setPref("screenPets", [defaultPet()]);
    return; // setPref re-enters reconcile() via onChange
  }

  if (!layer) mountLayer();
  if (!world) world = createWorld(computeBounds(), Math.random, SPEED_MUL[prefs.screenPetsSpeed] ?? 1);
  world.speedMul = SPEED_MUL[prefs.screenPetsSpeed] ?? 1;

  syncRoster(prefs.screenPets);
  startLoop();
}

function mountLayer(): void {
  if (!root) return;
  layer = document.createElement("div");
  layer.id = "screen-pets-layer";
  // jsdom does not set inline styles from the stylesheet, so set the load-bearing ones inline.
  layer.style.pointerEvents = "none";
  root.appendChild(layer);

  if (typeof ResizeObserver !== "undefined") {
    resizeObs = new ResizeObserver(() => { if (world) setBounds(world, computeBounds()); });
    resizeObs.observe(layer);
  } else {
    window.addEventListener("resize", onWindowResize);
  }
  document.addEventListener("visibilitychange", onVisibility);
}

function onWindowResize() { if (world) setBounds(world, computeBounds()); }
function onVisibility() { if (document.hidden) stopLoop(); else startLoop(); }

/** Add/remove pet entities + elements so the world matches the roster. */
function syncRoster(roster: PetInstance[]): void {
  if (!world || !layer) return;
  const wanted = new Set(roster.map((r) => r.id));

  // Remove entities no longer in the roster.
  for (const e of [...world.entities]) {
    if (!wanted.has(e.id)) { e.el?.remove(); removePet(world, e.id); }
  }
  const present = new Set(world.entities.map((e) => e.id));

  for (const inst of roster) {
    if (present.has(inst.id)) continue;
    const pet = addPet(world, inst);
    createPetEl(pet);
  }
}

function createPetEl(pet: PetEntity): void {
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "screen-pet";
  el.dataset.petId = pet.id;
  el.style.pointerEvents = "auto";
  el.style.width = `${PET_W}px`;
  el.style.height = `${PET_H}px`;
  el.title = pet.name;
  const img = document.createElement("img");
  img.alt = pet.name;
  img.draggable = false;
  el.appendChild(img);
  layer.appendChild(el);
  pet.el = el;
  pet.img = img;

  let dragging = false;
  let moved = false;
  let offX = 0, offY = 0;

  const onMove = (ev: PointerEvent) => {
    if (!dragging || !layer) return;
    moved = true;
    const rect = layer.getBoundingClientRect();
    pet.pos.x = ev.clientX - rect.left - offX;
    pet.pos.y = ev.clientY - rect.top - offY;
    pet.vel.x = 0; pet.vel.y = 0;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    pet.grabbed = false;
    el.classList.remove("grabbing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    pet.state = pet.locomotion === "flyer" ? "walk" : "falling";
    pet.stateUntil = 0;
  };

  el.addEventListener("pointerdown", (ev) => {
    dragging = true;
    moved = false;
    pet.grabbed = true;
    el.classList.add("grabbing");
    const rect = el.getBoundingClientRect();
    offX = ev.clientX - rect.left;
    offY = ev.clientY - rect.top;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  el.addEventListener("click", () => {
    if (moved) return; // a drag, not a tap
    pet.state = "swipe";
    pet.stateUntil = world ? world.clock + 0.8 : 0;
    showPetHeart(el);
  });
}

function showPetHeart(petEl: HTMLElement): void {
  const heart = document.createElement("span");
  heart.className = "screen-pet-heart";
  heart.textContent = "❤️";
  petEl.appendChild(heart);
  setTimeout(() => heart.remove(), 1400);
}

function startLoop(): void {
  if (rafId || !world) return;
  if (typeof requestAnimationFrame === "undefined") return; // jsdom without rAF (tests)
  lastTs = 0;
  const tick = (ts: number) => {
    if (!world) return;
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (dt > 0) stepWorld(world, dt);
    render();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function render(): void {
  if (!world) return;
  for (const pet of world.entities) {
    if (!pet.el || !pet.img) continue;
    pet.el.style.transform = `translate3d(${pet.pos.x}px, ${pet.pos.y}px, 0) scaleX(${pet.facing})`;
    const url = spriteUrl(pet.species, pet.color, tokenForState(pet.species, pet.state));
    if (pet.img.getAttribute("src") !== url) pet.img.setAttribute("src", url);
  }
  renderBall();
}

let ballEl: HTMLElement | null = null;
function renderBall(): void {
  if (!world || !layer) return;
  if (!world.ball) { ballEl?.remove(); ballEl = null; return; }
  if (!ballEl) {
    ballEl = document.createElement("div");
    ballEl.className = "screen-pet-ball";
    ballEl.style.pointerEvents = "auto";
    layer.appendChild(ballEl);
    world.ball.el = ballEl;
  }
  ballEl.style.transform = `translate3d(${world.ball.pos.x}px, ${world.ball.pos.y}px, 0)`;
}

/** Spawn or re-throw the ball toward a random point. */
export function throwPetBall(): void {
  if (!world) return;
  const b = world.bounds;
  const from = { x: b.left + 20, y: b.top + 20 };
  const vx = 150 + Math.random() * 250;
  throwBall(world, from, { x: vx, y: 40 });
  render(); // surface the ball immediately (and synchronously for tests)
}
