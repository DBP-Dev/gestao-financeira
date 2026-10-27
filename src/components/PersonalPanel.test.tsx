// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Member, Today } from '../domain/types'
import type { DueAlert, DueAlerts } from '../domain/dueAlerts'
import type { PersonalMonthSummary } from '../domain/personal'
import { PersonalPanel } from './PersonalPanel'

const member = (id: string, name: string, inactive = false): Member => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

afterEach(() => {
  cleanup()
})

const TODAY: Today = { month: '2026-10', day: 26 }

describe('escolha de perfil no painel pessoal (PersonalPanel)', () => {
  function renderChooser(members: Member[], onChooseMember = vi.fn()) {
    render(
      <PersonalPanel
        summary={null}
        alerts={null}
        today={TODAY}
        members={members}
        member={null}
        onChooseMember={onChooseMember}
      />,
    )
    const select = screen.getByLabelText('Quem é você?') as HTMLSelectElement
    // Sem a opção inicial ("Escolha um integrante"), que fica desabilitada.
    const offered = [...select.options].filter((option) => !option.disabled).map((option) => option.text)
    return { select, offered, onChooseMember }
  }

  it('oferece só participantes ativos; desativados ficam de fora', () => {
    const { offered } = renderChooser([
      member('h1', 'Ana'),
      member('h2', 'Bia', true),
      member('h3', 'Caio'),
    ])
    expect(offered).toEqual(['Ana', 'Caio'])
  })

  it('sem desativados, todos continuam disponíveis e a escolha funciona', () => {
    const { select, offered, onChooseMember } = renderChooser([member('h1', 'Ana'), member('h2', 'Bia')])
    expect(offered).toEqual(['Ana', 'Bia'])
    fireEvent.change(select, { target: { value: 'h2' } })
    expect(onChooseMember).toHaveBeenCalledWith('h2')
  })
})

describe('resumo do mês no painel pessoal (PersonalPanel)', () => {
  const bia = member('h2', 'Bia')

  function renderSummary(summary: PersonalMonthSummary, alerts: DueAlerts = { overdue: [], dueSoon: [] }) {
    const { container } = render(
      <PersonalPanel
        summary={summary}
        alerts={alerts}
        today={TODAY}
        members={[member('h1', 'Ana'), bia]}
        member={bia}
        onChooseMember={vi.fn()}
      />,
    )
    return container.textContent ?? ''
  }

  it('mostra sua parte, pago, pendente e o total geral, sem lista de áreas, barra ou legenda', () => {
    const text = renderSummary({ shareCents: 31001, paidCents: 17000, pendingCents: 14001, monthTotalCents: 64001 })
    expect(screen.getByRole('heading', { name: 'Bia' })).toBeTruthy()
    expect(text).toMatch(/Sua parte\s*R\$\s*310,01/)
    expect(text).toMatch(/Pago\s*R\$\s*170,00/)
    expect(text).toMatch(/Pendente\s*R\$\s*140,01/)
    expect(text).toMatch(/Total de todas as contas do mês:\s*R\$\s*640,01/)
    // A frase explicativa sobre "Pago" saiu; sem alertas, nenhuma seção aparece.
    expect(text).not.toContain('Pago: sua parte')
    expect(text).not.toContain('Contas em atraso')
    expect(text).not.toContain('Próximas do vencimento')
    expect(document.querySelector('.segmented-bar, .legend, .personal-panel__areas')).toBeNull()
    // O mês já aparece no cabeçalho do app; o painel não o repete.
    expect(text).not.toMatch(/outubro|novembro|dezembro/i)
  })

  it('mês sem nenhuma conta: mensagem própria e valores zerados', () => {
    const text = renderSummary({ shareCents: 0, paidCents: 0, pendingCents: 0, monthTotalCents: 0 })
    expect(text).toContain('Nenhuma conta neste mês.')
    expect(text).not.toContain('Nenhuma conta sua')
    expect(text).toMatch(/Sua parte\s*R\$\s*0,00/)
    expect(text).toMatch(/Total de todas as contas do mês:\s*R\$\s*0,00/)
  })

  it('mês com contas, mas nenhuma sua: mensagem diferente e total geral preenchido', () => {
    const text = renderSummary({ shareCents: 0, paidCents: 0, pendingCents: 0, monthTotalCents: 9000 })
    expect(text).toContain('Nenhuma conta sua neste mês.')
    expect(text).not.toContain('Nenhuma conta neste mês.')
    expect(text).toMatch(/Total de todas as contas do mês:\s*R\$\s*90,00/)
  })
})

describe('alertas no painel pessoal (PersonalPanel)', () => {
  const bia = member('h2', 'Bia')
  const summary: PersonalMonthSummary = { shareCents: 10000, paidCents: 0, pendingCents: 10000, monthTotalCents: 10000 }
  const alert = (areaName: string, billName: string, month: string, dueDay: number): DueAlert => ({
    areaId: areaName, areaName, billId: `${areaName}-${billName}`, billName, month, dueDay,
  })

  function renderAlerts(alerts: DueAlerts) {
    render(
      <PersonalPanel summary={summary} alerts={alerts} today={TODAY} members={[bia]} member={bia} onChooseMember={vi.fn()} />,
    )
    const section = (title: string) => screen.queryByRole('region', { name: title })
    const items = (title: string) =>
      [...(section(title)?.querySelectorAll('li') ?? [])].map((item) => (item.textContent ?? '').replace(/\s+/g, ' '))
    return { section, items }
  }

  it('mostra área, conta e vencimento; o ano só quando não é o de hoje', () => {
    const { items } = renderAlerts({
      overdue: [alert('Gastos da casa', 'Luz', '2025-12', 10), alert('Minhas contas', 'Celular', '2026-10', 5)],
      dueSoon: [alert('Viagem', 'Hotel', '2026-10', 27)],
    })
    expect(items('Contas em atraso')).toEqual([
      'Gastos da casa · Luz10 de dezembro de 2025',
      'Minhas contas · Celular5 de outubro',
    ])
    expect(items('Próximas do vencimento')).toEqual(['Viagem · Hotel27 de outubro'])
  })

  it('cada seção só aparece com itens; sem nenhum, não há aviso vazio', () => {
    const onlyLate = renderAlerts({ overdue: [alert('A', 'Luz', '2026-10', 5)], dueSoon: [] })
    expect(onlyLate.section('Contas em atraso')).not.toBeNull()
    expect(onlyLate.section('Próximas do vencimento')).toBeNull()
    cleanup()
    const onlySoon = renderAlerts({ overdue: [], dueSoon: [alert('A', 'Luz', '2026-10', 27)] })
    expect(onlySoon.section('Contas em atraso')).toBeNull()
    expect(onlySoon.section('Próximas do vencimento')).not.toBeNull()
    cleanup()
    renderAlerts({ overdue: [], dueSoon: [] })
    expect(document.querySelector('.personal-panel__alerts')).toBeNull()
  })

  it('no máximo três contas por seção e "e mais N" com o restante', () => {
    const late = [1, 2, 3, 4, 5, 6, 7].map((day) => alert('A', `Conta ${day}`, '2026-10', day))
    const soon = [26, 27, 28].map((day) => alert('B', `Conta ${day}`, '2026-10', day))
    const { section, items } = renderAlerts({ overdue: late, dueSoon: soon })
    expect(items('Contas em atraso')).toHaveLength(3)
    expect(section('Contas em atraso')?.textContent).toContain('e mais 4')
    expect(items('Próximas do vencimento')).toHaveLength(3)
    expect(section('Próximas do vencimento')?.textContent).not.toContain('e mais')
  })
})
