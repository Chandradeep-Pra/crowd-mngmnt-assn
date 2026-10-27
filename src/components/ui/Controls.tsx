import { useId, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
  icon?: ReactNode
}
export function Button({ variant = 'primary', loading = false, icon, children, className, disabled, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} className={clsx('ui-button', `ui-button--${variant}`, className)} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <LoaderCircle size={18} aria-hidden="true" className="ui-spinner" /> : icon}{children}
  </button>
}
interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> { label: string; children: ReactNode }
export function IconButton({ label, children, className, variant = 'ghost', ...props }: IconButtonProps) {
  return <Button {...props} variant={variant} className={clsx('ui-icon-button', className)} aria-label={label}><span aria-hidden="true">{children}</span></Button>
}
interface FieldProps { label: string; hint?: string; error?: string }
export interface TextFieldProps extends FieldProps, InputHTMLAttributes<HTMLInputElement> { endAdornment?: ReactNode }
export function TextField({ label, hint, error, endAdornment, id, className, 'aria-describedby': describedBy, ...props }: TextFieldProps) {
  const generated = useId()
  const fieldId = id ?? generated
  const messageId = `${fieldId}-message`
  return <div className={clsx('ui-field', className)}>
    <label htmlFor={fieldId}>{label}{props.required && <span aria-hidden="true"> *</span>}</label>
    <div className="ui-input-wrap">
      <input {...props} id={fieldId} className="ui-input" aria-invalid={error ? true : props['aria-invalid']} aria-describedby={clsx(describedBy, (error || hint) && messageId) || undefined} />
      {endAdornment && <div className="ui-input-adornment">{endAdornment}</div>}
    </div>
    {(error || hint) && <p id={messageId} className={clsx('ui-field-message', error && 'ui-field-message--error')}>{error || hint}</p>}
  </div>
}
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'endAdornment'>) {
  const [visible, setVisible] = useState(false)
  return <TextField {...props} type={visible ? 'text' : 'password'} endAdornment={
    <IconButton label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} disabled={props.disabled} onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff size={20} /> : <Eye size={20} />}
    </IconButton>
  } />
}
