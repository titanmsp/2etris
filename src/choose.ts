// The links and GET form also work without JavaScript.
const menu = document.querySelector<HTMLElement>('.start-menu');
const panel = document.querySelector<HTMLDetailsElement>('#join-panel');
const code = document.querySelector<HTMLInputElement>('#code-input');

panel.addEventListener('toggle', () => { if (panel.open) code.focus(); });
panel.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    panel.open = false;
    panel.querySelector('summary').focus();
  }
});

// Up and down step through the menu like an arcade cursor, wrapping at the ends.
// With nothing focused the cursor rests on Create game, so the first press moves it.
function menuStops(): HTMLElement[] {
  const stops = [document.querySelector<HTMLElement>('#create-button'), panel.querySelector('summary')];
  if (panel.open) stops.push(code, document.querySelector<HTMLElement>('#join-button'));
  return stops;
}

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const stops = menuStops();
  const active = document.activeElement as HTMLElement;
  const resting = !active || active === document.body;
  if (event.key === 'Enter' && resting) {
    event.preventDefault();
    if (panel.open) code.focus(); else stops[0].click();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (!resting && !menu.contains(active)) return;
  const step = event.key === 'ArrowDown' ? 1 : -1;
  const at = resting ? stops.indexOf(panel.open ? panel.querySelector('summary') : stops[0]) : stops.indexOf(active);
  event.preventDefault();
  stops[(at + step + stops.length) % stops.length].focus();
});
