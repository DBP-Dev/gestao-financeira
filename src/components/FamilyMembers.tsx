import type { Bill, Member } from '../types'
import { formatBRL } from '../utils/money'
import { Avatar } from './Avatar'

interface FamilyMembersProps {
  members: Member[]
  bills: Bill[]
  onRename: (member: Member) => void
}

function getMemberTotals(memberId: string, bills: Bill[]) {
  let total = 0
  let pending = 0
  for (const bill of bills) {
    const share = bill.shares.find((item) => item.memberId === memberId)
    if (!share) continue
    total += share.amountCents
    if (!bill.paid) pending += share.amountCents
  }
  return { total, pending }
}

export function FamilyMembers({ members, bills, onRename }: FamilyMembersProps) {
  return (
    <section className="section" aria-labelledby="family-title">
      <div className="section__header">
        <h2 id="family-title" className="section__title">
          A família
        </h2>
        <p className="section__hint">Quanto cabe a cada um neste mês</p>
      </div>

      <ul className="members">
        {members.map((member) => {
          const { total, pending } = getMemberTotals(member.id, bills)
          return (
            <li key={member.id} className="member-card">
              <Avatar member={member} size="large" />
              <strong className="member-card__name">{member.name}</strong>
              {total === 0 ? (
                <span className="member-card__muted">Sem contas este mês</span>
              ) : (
                <>
                  <span className="member-card__total">{formatBRL(total)}</span>
                  {pending === 0 ? (
                    <span className="tag tag--paid">✓ Tudo pago</span>
                  ) : (
                    <span className="tag tag--pending">
                      ○ Falta {formatBRL(pending)}
                    </span>
                  )}
                </>
              )}
              <button
                type="button"
                className="link-button"
                onClick={() => onRename(member)}
                aria-label={`Mudar o nome de ${member.name}`}
              >
                Mudar nome
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
