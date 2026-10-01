// The thing under the cursor while a tab is being dragged.
//
// Chromium's own drag image is a grey screenshot of the button, and once the pointer leaves
// the window it is all the user has to go on: the OS draws a "no drop" sign over it, which
// says the opposite of what letting go there does -- it gives the mailbox a window of its
// own. So the app draws its own: the account, and a plus saying "this lands somewhere".
//
// Built by hand rather than rendered by React because setDragImage needs a laid-out element
// in the same tick as dragstart, and a state change is a tick too late. The element is parked
// off screen, handed to the drag, and thrown away on the next tick -- Chromium has taken its
// snapshot by then.

export interface TabGhost {
  label: string;
  /** The account's colour, which is what the strip marks its tab with */
  color: string;
  avatarUrl?: string;
}

/** Where the cursor sits inside the ghost: just inside its top-left, as a tab is grabbed. */
export const TAB_GHOST_GRAB = { x: 20, y: 16 };

/**
 * Builds the picture that follows the cursor during a tab drag
 *
 * @param doc the document to build it in; it has to be in one to be snapshotted
 * @param ghost what the account looks like
 * @param dark whether the app is drawing dark, so the card matches the bar it came from
 * @returns the element, already parked off screen and in the document. The caller hands it to
 *   setDragImage and removes it on the next tick.
 */
export function createTabDragImage(doc: Document, ghost: TabGhost, dark: boolean): HTMLElement {
  const card = doc.createElement('div');
  card.style.cssText = [
    'position:fixed',
    'top:-1000px',
    'left:-1000px',
    'display:flex',
    'align-items:center',
    'gap:8px',
    'height:32px',
    'max-width:240px',
    'padding:0 12px 0 10px',
    'border-radius:8px',
    'font:500 13px/1 system-ui, sans-serif',
    'white-space:nowrap',
    'pointer-events:none',
    `background:${dark ? '#27272a' : '#ffffff'}`,
    `color:${dark ? '#fafafa' : '#18181b'}`,
    `border:1px solid ${dark ? '#3f3f46' : '#e4e4e7'}`,
    'box-shadow:0 8px 20px rgba(0,0,0,.35)',
  ].join(';');

  const mark = doc.createElement('span');
  mark.style.cssText = [
    'flex:0 0 auto',
    'width:18px',
    'height:18px',
    'border-radius:9999px',
    'background-size:cover',
    'background-position:center',
    `background-color:${ghost.color}`,
    ghost.avatarUrl ? `background-image:url(${JSON.stringify(ghost.avatarUrl)})` : '',
  ]
    .filter(Boolean)
    .join(';');
  card.append(mark);

  const name = doc.createElement('span');
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
  name.textContent = ghost.label;
  card.append(name);

  // The plus is the whole message: wherever this is let go, the mailbox arrives -- in a window
  // of its own outside, in the strip it is dropped on inside.
  const plus = doc.createElement('span');
  plus.style.cssText = [
    'flex:0 0 auto',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'width:16px',
    'height:16px',
    'margin-left:2px',
    'border-radius:9999px',
    'background:#2563eb',
    'color:#fff',
    'font:700 12px/1 system-ui, sans-serif',
  ].join(';');
  plus.textContent = '+';
  card.append(plus);

  doc.body.append(card);
  return card;
}
