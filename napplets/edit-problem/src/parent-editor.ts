const COORDINATE = /^31971:[0-9a-f]{64}:[0-9a-f]{64}$/;

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);

export const parentCoordinatesFromEditor = (scope: ParentNode = document): string[] =>
  [...scope.querySelectorAll<HTMLElement>("[data-parent-coordinate]")]
    .map((node) => node.dataset.parentCoordinate ?? "");

export function renderParentRows(coordinates: string[], canChange: boolean): string {
  if (!coordinates.length) return '<p class="parent-empty">No direct parents in this draft.</p>';
  return coordinates.map((coordinate) => `<div class="parent-row" data-parent-coordinate="${coordinate}">
    <code title="${coordinate}">${escapeHtml(coordinate)}</code>
    ${canChange ? `<button type="button" class="remove-parent" aria-label="Remove parent ${coordinate}">Remove</button>` : ""}
  </div>`).join("");
}

export function bindParentEditor(
  canChange: boolean,
  onStatus: (message: string, error?: boolean) => void,
  scope: ParentNode = document
): void {
  const list = scope.querySelector<HTMLElement>("#parent-list");
  const input = scope.querySelector<HTMLInputElement>("#parent-coordinate");
  const add = scope.querySelector<HTMLButtonElement>("#add-parent");
  if (!list || !input || !add || !canChange) return;
  const repaint = (coordinates: string[]) => {
    list.innerHTML = renderParentRows(coordinates, true);
    list.querySelectorAll<HTMLButtonElement>(".remove-parent").forEach((button) => button.addEventListener("click", () => {
      const coordinate = button.closest<HTMLElement>("[data-parent-coordinate]")?.dataset.parentCoordinate;
      if (!coordinate) return;
      repaint(parentCoordinatesFromEditor(scope).filter((value) => value !== coordinate));
      input.focus();
    }));
  };
  const addParent = () => {
    const coordinate = input.value.trim();
    if (!COORDINATE.test(coordinate)) {
      onStatus("Parent must use exact 31971:<owner>:<problem-id> coordinate.", true);
      input.focus();
      return;
    }
    const existing = parentCoordinatesFromEditor(scope);
    if (existing.includes(coordinate)) {
      onStatus("That direct parent is already listed.", true);
      input.focus();
      return;
    }
    repaint([...existing, coordinate]);
    input.value = "";
    onStatus("Parent draft updated. Publish revision to apply it.");
    input.focus();
  };
  add.addEventListener("click", addParent);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addParent();
  });
}
