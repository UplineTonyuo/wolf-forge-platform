"use client";

import { useSyncExternalStore } from "react";
import { recordStoreInterestAction } from "../../../app/actions/store-interest";
import {
  addToCart,
  parseCart,
  removeFromCart,
  type CartItem,
} from "../../../domain/client-portal/cart";

/**
 * The cart, held outside React.
 *
 * A module store rather than a context with `useState` for one specific reason:
 * the contents live in localStorage, and reading storage during render would
 * disagree with the server-rendered HTML. `useSyncExternalStore` takes a
 * separate server snapshot, so the first client render matches the server
 * exactly and the persisted contents arrive on the subscribe pass instead —
 * no hydration mismatch, and no state written from an effect.
 *
 * It also means any Store card can reach the cart without the whole portal
 * being wrapped in another provider.
 */

const storageKey = "wf-portal-cart";

/** A stable identity, so the server snapshot never triggers a re-render loop. */
const emptyCart: CartItem[] = [];

let items: CartItem[] = emptyCart;
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function persist() {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // A full or blocked storage quota must not break browsing the Store.
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;

  try {
    const restored = parseCart(window.localStorage.getItem(storageKey));
    if (restored.length > 0) {
      items = restored;
      emit();
    }
  } catch {
    // Storage can throw outright in hardened privacy modes.
  }
}

function subscribe(listener: () => void) {
  // First subscriber pulls the persisted cart in; later ones just listen.
  hydrate();
  listeners.add(listener);

  // Another tab in the same portal session should not drift out of sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    items = parseCart(event.newValue);
    emit();
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): CartItem[] {
  return items;
}

function getServerSnapshot(): CartItem[] {
  return emptyCart;
}

/**
 * Tells the server what the client just did with their cart.
 *
 * Deliberately the only place this happens. Routing it through the store rather
 * than the three components means every present and future cart surface reports
 * automatically, and it keeps the two paths that are NOT client intent -- the
 * initial hydrate from localStorage and the cross-tab storage sync -- silent.
 * Restoring a cart is not a new signal, and neither is a second tab catching up.
 *
 * Fire and forget, and unawaited on purpose: the local cart has already changed
 * by the time this runs. A failure costs one row of sales intelligence, which is
 * not worth interrupting someone browsing a Store to report. The action itself
 * never throws and never claims success it did not have; the next add or remove
 * of the same investment re-states the correct state.
 */
function signalInterest(serviceIds: string[], inCart: boolean) {
  if (serviceIds.length === 0) return;

  void recordStoreInterestAction({ serviceIds, inCart }).catch(() => {
    // Telemetry only. The cart is the client's, and it stays exactly as they left it.
  });
}

export function addItem(item: CartItem) {
  const next = addToCart(items, item);
  // Unchanged means the cart was full or already held it -- no new signal either way.
  if (next === items) return;
  items = next;
  persist();
  emit();
  signalInterest([item.id], true);
}

export function removeItem(id: string) {
  const next = removeFromCart(items, id);
  if (next.length === items.length) return;
  items = next;
  persist();
  emit();
  signalInterest([id], false);
}

export function clearCart() {
  if (items.length === 0) return;
  // Captured before the state drops, and sent as one call rather than one per row.
  const cleared = items.map((item) => item.id);
  items = emptyCart;
  persist();
  emit();
  signalInterest(cleared, false);
}

/** The live cart contents. Empty on the server and on the first client render. */
export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test seam: drops both the in-memory cart and its persisted copy. */
export function resetCartForTests() {
  items = emptyCart;
  hydrated = false;
  listeners.clear();
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
