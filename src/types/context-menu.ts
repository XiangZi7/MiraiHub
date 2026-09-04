export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  iconTone?: 'default' | 'violet' | 'blue' | 'amber' | 'danger'
  shortcut?: string
  groupLabel?: string
  checked?: boolean
  children?: readonly ContextMenuItem[]
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
}
