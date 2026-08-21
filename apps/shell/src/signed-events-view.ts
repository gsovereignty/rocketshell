import { gsap } from "gsap";
import type { Observable, Subscription } from "rxjs";

interface SignedEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

interface SignedEventsElements {
  readonly trigger: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly panel: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly list: HTMLUListElement;
  readonly empty: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly dialogTitle: HTMLElement;
  readonly relayList: HTMLUListElement;
  readonly relayEmpty: HTMLElement;
  readonly code: HTMLElement;
  readonly dialogClose: HTMLButtonElement;
}

const eventLabel = (event: SignedEvent): string => `Kind ${event.kind}`;
const shortId = (id: string): string => `${id.slice(0, 8)}…${id.slice(-8)}`;
const eventTime = (createdAt: number): string => new Intl.DateTimeFormat(undefined, {
  hour: "2-digit", minute: "2-digit", second: "2-digit"
}).format(new Date(createdAt * 1_000));

export function createSignedEventsView(
  elements: SignedEventsElements,
  events$: Observable<readonly SignedEvent[]>,
  reducedMotion: MediaQueryList,
  beforeOpen?: () => void,
  seenRelaysForEvent: (eventId: string) => readonly string[] = () => []
): { close(): void; destroy(): void } {
  let open = false;
  let events: readonly SignedEvent[] = [];
  let returnFocus: HTMLElement | null = null;

  const render = (): void => {
    elements.count.textContent = String(events.length);
    elements.count.hidden = events.length === 0;
    elements.trigger.setAttribute("aria-label", `Signed events, ${events.length} this session`);
    elements.empty.hidden = events.length !== 0;
    elements.list.replaceChildren(...events.slice().reverse().map((event) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const heading = document.createElement("span");
      const id = document.createElement("code");
      const time = document.createElement("time");
      button.type = "button";
      button.className = "signed-event-row";
      heading.textContent = eventLabel(event);
      id.textContent = shortId(event.id);
      time.dateTime = new Date(event.created_at * 1_000).toISOString();
      time.textContent = eventTime(event.created_at);
      button.append(heading, id, time);
      button.addEventListener("click", () => {
        returnFocus = button;
        const relays = seenRelaysForEvent(event.id);
        elements.dialogTitle.textContent = `${eventLabel(event)} · ${shortId(event.id)}`;
        elements.relayList.replaceChildren(...relays.map((relay) => {
          const item = document.createElement("li");
          const code = document.createElement("code");
          code.textContent = relay;
          item.append(code);
          return item;
        }));
        elements.relayEmpty.hidden = relays.length !== 0;
        elements.code.textContent = JSON.stringify(event, null, 2);
        elements.dialog.showModal();
        if (!reducedMotion.matches) {
          gsap.fromTo(elements.dialog, { autoAlpha: 0, scale: .96, y: 12 }, { autoAlpha: 1, scale: 1, y: 0, duration: .26, ease: "power4.out" });
        }
        elements.dialogClose.focus();
      });
      item.append(button);
      return item;
    }));
  };

  const closeDialog = (): void => {
    if (!elements.dialog.open) return;
    const finish = (): void => { elements.dialog.close(); returnFocus?.focus(); };
    if (reducedMotion.matches) finish();
    else gsap.to(elements.dialog, { autoAlpha: 0, scale: .97, y: 8, duration: .14, ease: "power2.in", onComplete: finish });
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    elements.trigger.setAttribute("aria-expanded", "false");
    const finish = (): void => { elements.panel.hidden = true; };
    if (reducedMotion.matches) finish();
    else gsap.to(elements.panel, { autoAlpha: 0, x: 20, duration: .16, ease: "power2.in", onComplete: finish });
  };
  const show = (): void => {
    beforeOpen?.();
    open = true;
    elements.trigger.setAttribute("aria-expanded", "true");
    elements.panel.hidden = false;
    if (!reducedMotion.matches) {
      gsap.fromTo(elements.panel, { autoAlpha: 0, x: 28 }, { autoAlpha: 1, x: 0, duration: .3, ease: "power4.out" });
    }
    (elements.list.querySelector("button") ?? elements.close).focus();
  };

  elements.trigger.addEventListener("click", () => open ? close() : show());
  elements.close.addEventListener("click", () => { close(); elements.trigger.focus(); });
  elements.dialogClose.addEventListener("click", closeDialog);
  elements.dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(); });
  elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) closeDialog(); });
  const subscription: Subscription = events$.subscribe((next) => { events = next; render(); });

  return { close, destroy: () => subscription.unsubscribe() };
}
