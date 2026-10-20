# Contas da Família

Aplicativo local e simples para organizar as contas mensais da família:
quem paga o quê, quanto cabe a cada pessoa e o que já foi pago.

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
- Na primeira vez são exibidas contas de **exemplo** com valores fictícios.
  Use o botão “Apagar exemplos” para removê-las.
