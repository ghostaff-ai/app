// Holding the mic, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// decision 4): hold to record and let go to send; slide left to cancel; slide
// up to lock and go on hands-free. A press shorter than a moment was a tap.

/** Slid this far left (points): cancelled. */
export const CANCEL_DX = 110;
/** Slid this far up: locked. */
export const LOCK_DY = 70;
/** Let go sooner than this: a tap, not a note («Mantén pulsado para grabar»). */
export const TAP_MS = 350;

/** What a move of the finger while holding means. Cancel wins when both are crossed. */
export function holdMove(dx: number, dy: number): 'cancel' | 'lock' | 'none' {
  if (dx <= -CANCEL_DX) return 'cancel';
  if (dy <= -LOCK_DY) return 'lock';
  return 'none';
}

/** What letting go means, after holding `heldMs`: send the note, or it was a tap. */
export function holdRelease(heldMs: number): 'send' | 'tap' {
  return heldMs < TAP_MS ? 'tap' : 'send';
}
