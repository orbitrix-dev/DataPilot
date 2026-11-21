import { useState } from 'react'
import { usePageChrome } from '../../../components/layout/ShellContext'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/Toast'
import { cn } from '../../../lib/cn'
import { AdminHeader, AdminPage, CheckRow, SettingsTabs } from '../components/parts'
import { panelClass } from '../styles'
import { notificationChannels, type NotificationId } from '../data'
import { setNotification, useAdminState } from '../store'

/** Notification Preferences (designed: admin_notification_preferences). Changes save immediately. */
export function NotificationsPage() {
  usePageChrome([{ label: 'Administration' }, { label: 'Notification Preferences' }])
  const { notifications } = useAdminState()
  const [confirm, setConfirm] = useState<NotificationId | null>(null)
  const toast = useToast()
  const pending = notificationChannels.find((n) => n.id === confirm)

  return (
    <AdminPage width="4xl">
      <SettingsTabs />
      <AdminHeader
        title="Notification Preferences"
        description="Configure how business alerts, Trust incidents, and Automate approval requests are delivered. Changes save immediately."
      />
      <div className={cn(panelClass, 'px-5 py-2 divide-y divide-light-outline-variant')}>
        {notificationChannels.map((n) => (
          <CheckRow
            key={n.id}
            id={`notify-${n.id}`}
            label={n.label}
            hint={notifications[n.id] ? n.channel : 'Off: no email or chat delivery'}
            checked={notifications[n.id]}
            onChange={(on) => {
              if (!on) return setConfirm(n.id)
              setNotification(n.id, true)
              toast(`${n.label} turned on`)
            }}
          />
        ))}
      </div>

      <Modal
        open={!!pending}
        onClose={() => setConfirm(null)}
        title={`Turn off ${pending?.label.replace(/ \(.*\)/, '')}?`}
        description={pending?.offWarning}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirm(null)}>
              Keep on
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!pending) return
                setNotification(pending.id, false)
                toast(`${pending.label.replace(/ \(.*\)/, '')} turned off`, 'warning')
                setConfirm(null)
              }}
            >
              Turn off
            </Button>
          </>
        }
      />
    </AdminPage>
  )
}
