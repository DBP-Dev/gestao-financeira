# Gestão de Gastos

Aplicativo local e simples para organizar os gastos do mês, sozinho ou em grupo.
Serve para quem mora sozinho, casais, famílias e pessoas que dividem despesas:
quanto foi gasto, quem paga o quê, quanto cabe a cada pessoa e o que já foi pago.

## O que dá para fazer

- **Minhas contas**, a área fixa para despesas pessoais, sem divisão entre pessoas.
  Mostra o total e o pendente do mês e o que ficou em atraso de meses anteriores.
- **Áreas compartilhadas**, cada uma com seus próprios participantes e contas.
  A área “Gastos da casa” já vem criada, e novas áreas compartilhadas podem ser criadas.
- **Contas por mês**, divididas igualmente ou com valores escolhidos para cada pessoa,
  marcadas como pagas ou pendentes e copiadas do mês anterior.
- **Resumo do mês em cada área**: total, já pago, falta pagar e contas atrasadas de
  meses anteriores.
- **Meu painel**: a sua parte nas contas de “Gastos da casa”.
- **Backup**: salvar uma cópia dos dados em arquivo e restaurá-la depois.

## Como executar

```bash
npm install
npm run dev
```

Depois abra o endereço mostrado no terminal (normalmente http://localhost:5173).

Outros comandos:

- `npm run build` — gera a versão final em `dist/`
- `npm run lint` — verifica o código com o ESLint

## Observações

- Os dados ficam salvos apenas no navegador (localStorage), neste aparelho.
  Não há login nem servidor.
- Na primeira vez são exibidas contas de **exemplo** com valores fictícios.
  Use o botão “Apagar exemplos” para removê-las.
- Backups feitos quando o aplicativo se chamava “Contas da Família” continuam
  podendo ser restaurados normalmente.
