/* ================= Card hover — static dwell only ================= */
/* Cards lift only after the mouse has been *motionless* over them for
   a short dwell period (400 ms). Fast mouse sweeps and scroll-throughs
   will never trigger the lift animation. */

const DWELL_MS = 400;

let hoveredCard = null;
let dwellTimer = null;
let lastMoveX = -1;
let lastMoveY = -1;

function clearHover() {
  clearTimeout(dwellTimer);
  dwellTimer = null;
  if (hoveredCard) {
    hoveredCard.classList.remove('card-hovered');
    hoveredCard = null;
  }
  lastMoveX = lastMoveY = -1;
}

function startDwell(card, x, y) {
  clearTimeout(dwellTimer);
  lastMoveX = x;
  lastMoveY = y;
  dwellTimer = setTimeout(() => {
    if (hoveredCard !== card) {
      if (hoveredCard) hoveredCard.classList.remove('card-hovered');
      hoveredCard = card;
    }
    card.classList.add('card-hovered');
  }, DWELL_MS);
}

const view = document.getElementById('view');

view.addEventListener('mousemove', e => {
  // Ignore sub-pixel jitter (touchpad noise)
  if (Math.abs(e.clientX - lastMoveX) < 2 && Math.abs(e.clientY - lastMoveY) < 2) return;

  const card = e.target.closest('.card[data-open]');
  if (!card) { clearHover(); return; }

  // Mouse moved inside the same card — restart dwell timer
  if (card === hoveredCard && hoveredCard.classList.contains('card-hovered')) {
    // Already hovered and settled — keep it
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    return;
  }

  // New card or mouse moved before dwell completed
  if (hoveredCard && hoveredCard !== card) {
    hoveredCard.classList.remove('card-hovered');
    hoveredCard = null;
  }
  startDwell(card, e.clientX, e.clientY);
}, { passive: true });

view.addEventListener('mouseleave', clearHover, { passive: true });

// Any scroll immediately kills the hover state
window.addEventListener('scroll', clearHover, { passive: true });
// Also catch horizontal row scrolls
view.addEventListener('scroll', clearHover, { capture: true, passive: true });
