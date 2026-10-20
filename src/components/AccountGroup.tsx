import { useId, type ReactNode } from 'react'

interface AccountGroupProps {
  icon: 'person' | 'people'
  title: string
  description: string
  /** Ação opcional no cabeçalho (ex.: botão "Nova área"). */
  action?: ReactNode
  children: ReactNode
}

function GroupIcon({ icon }: { icon: AccountGroupProps['icon'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon === 'person' ? (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      ) : (
        <>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <circle cx="16.5" cy="9" r="2.6" />
          <path d="M15.5 14.2A5 5 0 0 1 21 19" />
        </>
      )}
    </svg>
  )
}

/** Box que agrupa áreas de contas (individuais ou compartilhadas). */
export function AccountGroup({ icon, title, description, action, children }: AccountGroupProps) {
  const titleId = useId()
  return (
    <section className="account-group" aria-labelledby={titleId}>
      <header className="account-group__header">
        <span className="account-group__icon">
          <GroupIcon icon={icon} />
        </span>
        <div className="account-group__heading">
          <h2 id={titleId} className="account-group__title">
            {title}
          </h2>
          <p className="account-group__description">{description}</p>
        </div>
        {action && <div className="account-group__action">{action}</div>}
      </header>
      <div className="account-group__content">{children}</div>
    </section>
  )
}
