// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '../types'
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

describe('escolha de perfil no painel pessoal (PersonalPanel)', () => {
  function renderChooser(members: Member[], onChooseMember = vi.fn()) {
    render(
      <PersonalPanel
        bills={[]}
        members={members}
        monthName="outubro"
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
