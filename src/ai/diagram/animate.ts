import type { Editor, TLShapeId } from 'tldraw'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Short staggered fade/scale-in for freshly created shapes. Uses the Web Animations API on the
 * rendered DOM only, so nothing is written to the store (Undo stays a single step).
 */
export function animateIn(editor: Editor, ids: TLShapeId[]): void {
  if (prefersReducedMotion() || typeof document === 'undefined') return
  const container = editor.getContainer()
  const run = () => {
    ids.forEach((id, i) => {
      const wrapper = container.querySelector<HTMLElement>(`[data-shape-id="${id}"]`)
      const el = wrapper?.firstElementChild as HTMLElement | null | undefined
      if (!el?.animate) return
      const isArrow = editor.getShape(id)?.type === 'arrow'
      el.animate(
        [
          { opacity: 0, transform: isArrow ? 'none' : 'scale(0.92)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 220,
          delay: Math.min(i * 16, 520) + (isArrow ? 120 : 0),
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          fill: 'backwards',
        },
      )
    })
  }
  requestAnimationFrame(() => requestAnimationFrame(run))
}
