import React, { ReactNode, JSX } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader as DHeader,
  DialogTitle as DTitle,
  DialogDescription as DDescription,
  DialogFooter as DFooter,
} from './Dialog'
import { Button } from './Button'
import { cn } from './utils'

interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  open: boolean
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Modal({ open, onClose, children, size = 'md', className }: ModalProps): JSX.Element {
  const sizes = {
    sm: 'max-w-[calc(100vw-2rem)] sm:max-w-sm',
    md: 'max-w-[calc(100vw-2rem)] sm:max-w-lg',
    lg: 'max-w-[calc(100vw-2rem)] sm:max-w-2xl',
    xl: 'max-w-[calc(100vw-2rem)] sm:max-w-4xl',
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className={cn(sizes[size], 'flex flex-col max-h-[85vh]', className)}>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function ModalHeader({ children, className = '' }: { children: ReactNode; onClose?: () => void; className?: string }): JSX.Element {
  return <DHeader className={className}>{children}</DHeader>
}

function ModalTitle({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <DTitle className={className}>{children}</DTitle>
}

function ModalDescription({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <DDescription className={className}>{children}</DDescription>
}

function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('flex-1 overflow-y-auto py-4', className)}>{children}</div>
}

function ModalFooter({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return <DFooter className={className}>{children}</DFooter>
}

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  variant?: 'destructive' | 'default'
  loading?: boolean
}

export function ConfirmModal({ open, onClose, onConfirm, title, description, confirmText = 'Confirm', cancelText = 'Cancel', variant = 'destructive', loading = false }: ConfirmModalProps): JSX.Element {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <Modal.Title>{title}</Modal.Title>
        {description && <Modal.Description>{description}</Modal.Description>}
      </Modal.Header>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelText}</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmText}</Button>
      </Modal.Footer>
    </Modal>
  )
}

Modal.Header = ModalHeader
Modal.Title = ModalTitle
Modal.Description = ModalDescription
Modal.Body = ModalBody
Modal.Footer = ModalFooter

export default Modal
