export interface SelectOption { value: string; label: string; description?: string; disabled?: boolean }
export interface SelectState { open: boolean; active: number; search: string; searchedAt: number }
export const closedSelect: SelectState = { open: false, active: -1, search: '', searchedAt: 0 }
type Action = { type: 'toggle' | 'dismiss' } | { type: 'choose' | 'hover'; index: number } | { type: 'key'; key: string; now: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }

/** Navigation is provisional. Only explicit selection/Tab commits a value; Escape cancels. */
export function selectTransition(options: readonly SelectOption[], state: SelectState, value: string, action: Action): { state: SelectState; commit?: string; handled: boolean } {
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index])
  if (!enabled.length) return { state: closedSelect, handled: false }
  const selected = options.findIndex(option => option.value === value && !option.disabled)
  const active = enabled.includes(state.active) ? state.active : selected >= 0 ? selected : enabled[0]
  const openAt = (index: number) => ({ state: { open: true, active: index, search: '', searchedAt: 0 }, handled: true })
  const choose = (index: number) => ({ state: closedSelect, commit: options[index]?.disabled ? undefined : options[index]?.value, handled: true })
  if (action.type === 'dismiss') return { state: closedSelect, handled: state.open }
  if (action.type === 'toggle') return state.open ? { state: closedSelect, handled: true } : openAt(selected >= 0 ? selected : enabled[0])
  if (action.type === 'choose') return enabled.includes(action.index) ? choose(action.index) : { state, handled: false }
  if (action.type === 'hover') return enabled.includes(action.index) ? { state: { ...state, active: action.index, search: '', searchedAt: 0 }, handled: true } : { state, handled: false }
  if (action.type !== 'key' || action.ctrlKey || action.metaKey) return { state, handled: false }
  const key = action.key
  if (key === 'Escape') return { state: closedSelect, handled: state.open }
  if (key === 'Tab') return state.open ? { ...choose(active), handled: false } : { state, handled: false }
  if (key === 'Enter' || key === ' ') return state.open ? choose(active) : openAt(selected >= 0 ? selected : enabled[0])
  if (key === 'Home') return openAt(enabled[0])
  if (key === 'End') return openAt(enabled.at(-1)!)
  if (action.altKey && key === 'ArrowUp' && state.open) return choose(active)
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(key)) {
    if (!state.open || (action.altKey && key === 'ArrowDown')) return openAt(selected >= 0 ? selected : enabled[0])
    const step = (key.endsWith('Down') ? 1 : -1) * (key.startsWith('Page') ? 10 : 1)
    return openAt(enabled[Math.max(0, Math.min(enabled.length - 1, enabled.indexOf(active) + step))])
  }
  if (key.length === 1 && !action.altKey) {
    const search = (action.now - state.searchedAt <= 700 ? state.search : '') + key.toLocaleLowerCase()
    const repeating = [...search].every(char => char === search[0])
    const prefix = repeating ? search[0] : search
    const start = state.open ? active : selected
    const ordered = [...enabled.filter(index => index > start), ...enabled.filter(index => index <= start)]
    // A multi-character search continues matching the active label before cycling.
    if (!repeating && enabled.includes(active)) ordered.unshift(active)
    const match = ordered.find(index => options[index].label.trim().toLocaleLowerCase().startsWith(prefix))
    return { state: { open: true, active: match ?? active, search, searchedAt: action.now }, handled: true }
  }
  return { state, handled: false }
}

/** Fixed viewport placement keeps menus outside card/header clipping and inside narrow screens. */
export function selectPlacement(rect: { left: number; top: number; bottom: number; width: number }, viewport: { width: number; height: number }) {
  const margin = 12, gap = 8
  const width = Math.min(Math.max(rect.width, 220), Math.max(0, viewport.width - margin * 2))
  const below = Math.max(0, viewport.height - rect.bottom - gap - margin)
  const above = Math.max(0, rect.top - gap - margin)
  const side = below >= Math.min(280, above) ? 'bottom' : 'top'
  return {
    left: Math.max(margin, Math.min(rect.left, viewport.width - width - margin)), width,
    maxHeight: Math.min(304, side === 'bottom' ? below : above),
    top: side === 'bottom' ? rect.bottom + gap : undefined,
    bottom: side === 'top' ? viewport.height - rect.top + gap : undefined,
    side,
  }
}
