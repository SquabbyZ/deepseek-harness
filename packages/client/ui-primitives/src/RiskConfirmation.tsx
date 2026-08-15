/**
 * Controlled risk acknowledgement dialog shared by product surfaces that
 * must gate a sensitive action behind an explicit checkbox.
 */
import { Button } from './Button.tsx'
import { IconWarningOutline16 } from './icons/index.tsx'
import { Modal } from './Modal.tsx'

export interface RiskConfirmationProps {
  open: boolean
  title: string
  description: string
  acknowledgeLabel: string
  cancelLabel: string
  confirmLabel: string
  acknowledged: boolean
  disabled?: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Render one in-page confirmation whose primary action is unavailable until
 * the caller-controlled acknowledgement is checked.
 */
export function RiskConfirmation({
  open,
  title,
  description,
  acknowledgeLabel,
  cancelLabel,
  confirmLabel,
  acknowledged,
  disabled = false,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
}: RiskConfirmationProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className={CONFIRMATION}
      contentClassName={CONFIRMATION_CONTENT}
      footer={(
        <>
          <Button variant="outline" className={MODAL_ACTION} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            className={CONFIRM_ACTION}
            disabled={disabled || !acknowledged}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className={WARNING}>
        <IconWarningOutline16 size={18} className={WARNING_ICON} />
        <p className="m-0">{description}</p>
      </div>
      <label className={ACKNOWLEDGEMENT}>
        <input
          type="checkbox"
          className={ACKNOWLEDGEMENT_INPUT}
          checked={acknowledged}
          disabled={disabled}
          autoFocus
          onChange={(event) => { onAcknowledgedChange(event.currentTarget.checked) }}
        />
        <span>{acknowledgeLabel}</span>
      </label>
    </Modal>
  )
}

const CONFIRMATION =
  'w-[min(440px,100%)] max-h-[calc(100vh_-_48px)] supports-[height:100dvh]:max-h-[calc(100dvh_-_48px)] overflow-hidden'

const CONFIRMATION_CONTENT = 'min-h-0 overflow-y-auto overscroll-contain'

const WARNING = 'flex items-start gap-2.5 text-[var(--dsw-alias-label-secondary)] text-sm leading-[22px]'

const WARNING_ICON = 'flex-none mt-0.5 text-[var(--dsw-alias-state-error-primary)]'

const ACKNOWLEDGEMENT =
  'flex items-start gap-2.5 mt-5 text-[var(--dsw-alias-label-primary)] text-sm leading-[22px] cursor-pointer'

const ACKNOWLEDGEMENT_INPUT =
  'flex-none size-4 mt-[3px] accent-[var(--dsw-alias-button-primary-fill)] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--dsw-alias-border-l4)] focus-visible:outline-offset-2 disabled:cursor-default'

const MODAL_ACTION = 'min-w-[72px]'

const CONFIRM_ACTION = 'min-w-[136px]'
