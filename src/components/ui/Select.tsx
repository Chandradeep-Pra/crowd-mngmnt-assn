import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import { closedSelect, selectPlacement, selectTransition } from './select-model.ts'
import type { SelectOption } from './select-model.ts'

export interface SelectProps {
  label: string; value: string; options: readonly SelectOption[]; onValueChange: (value: string) => void
  id?: string; name?: string; hint?: string; error?: string; disabled?: boolean
  hideLabel?: boolean; icon?: ReactNode; className?: string; placeholder?: string
}

export function Select({ label, value, options, onValueChange, id, name, hint, error, disabled, hideLabel, icon, className, placeholder = 'Select an option' }: SelectProps) {
  const generated = useId(), fieldId = id ?? generated
  const listId = `${fieldId}-list`, labelId = `${fieldId}-label`, messageId = `${fieldId}-message`
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const [state, setState] = useState(closedSelect)
  const [placement, setPlacement] = useState<ReturnType<typeof selectPlacement> | null>(null)
  const [portalTarget, setPortalTarget] = useState<Element | null>(null)
  const unavailable = disabled || !options.some(option => !option.disabled)
  const expanded = state.open && !unavailable
  const selected = options.find(option => option.value === value)
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
  const active = options[state.active] && !options[state.active].disabled ? state.active : selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled)

  function position() {
    if (!trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    setPortalTarget(trigger.current.closest('dialog[open]') ?? document.body)
    setPlacement(selectPlacement(rect, { width: document.documentElement.clientWidth, height: window.innerHeight }))
  }
  function apply(action: Parameters<typeof selectTransition>[3]) {
    if (unavailable) return
    const result = selectTransition(options, { ...state, active }, value, action)
    if (result.state.open && !expanded) position()
    setState(result.state)
    if (result.commit !== undefined && result.commit !== value) onValueChange(result.commit)
    return result
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const result = apply({ type: 'key', key: event.key, now: Date.now(), altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })
    if (result?.handled) event.preventDefault()
    if (event.key === 'Escape' && expanded) event.stopPropagation()
  }

  // Drop provisional navigation when a control becomes unavailable.
  if (state.open && unavailable) setState(closedSelect)

  useEffect(() => {
    if (!expanded) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setState(closedSelect)
    }
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) { setState(closedSelect); return }
      setPlacement(selectPlacement(rect, { width: document.documentElement.clientWidth, height: window.innerHeight }))
    }
    const blur = () => setState(closedSelect)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    const observer = new ResizeObserver(reposition)
    if (trigger.current) observer.observe(trigger.current)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      observer.disconnect()
    }
  }, [expanded])
  useEffect(() => {
    if (!expanded) return
    const list = menu.current, option = list?.querySelector<HTMLElement>('[data-active="true"]')
    if (!list || !option) return
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight
  }, [expanded, active])

  return <div className={clsx('ui-field ui-select', className)}>
    <label id={labelId} htmlFor={fieldId} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
    <button ref={trigger} type="button" id={fieldId} className="ui-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-labelledby={labelId} aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined} aria-describedby={hint || error ? messageId : undefined} aria-invalid={error ? true : undefined} disabled={unavailable} onClick={() => { apply({ type: 'toggle' }) }} onKeyDown={keyDown}>
      {icon && <span className="ui-select-icon" aria-hidden="true">{icon}</span>}<span className="ui-select-value">{selected?.label ?? placeholder}</span><ChevronDown size={17} className="ui-select-chevron" aria-hidden="true" />
    </button>
    {name && <input type="hidden" name={name} value={value} disabled={unavailable} />}
    {(hint || error) && <p id={messageId} className={clsx('ui-field-message', error && 'ui-field-message--error')}>{error || hint}</p>}
    {expanded && placement && createPortal(<div ref={menu} id={listId} role="listbox" aria-labelledby={labelId} className="ui-select-popover" data-side={placement.side} style={{ left: placement.left, width: placement.width, maxHeight: placement.maxHeight, top: placement.top, bottom: placement.bottom }} onMouseDown={event => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={active === index} className="ui-select-option" onPointerMove={event => { if (event.pointerType === 'mouse' && active !== index) apply({ type: 'hover', index }) }} onClick={() => { if (!option.disabled) { trigger.current?.focus({ preventScroll: true }); apply({ type: 'choose', index }) } }}><span><span className="ui-select-option-label">{option.label}</span>{option.description && <span className="ui-select-option-description">{option.description}</span>}</span>{option.value === value && <Check size={17} aria-hidden="true" />}</div>)}
    </div>, portalTarget ?? document.body)}
  </div>
}
