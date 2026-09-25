https://github.com/FernandoBolzan/Orquestrador-Maestro/blob/main/README.md


**Não. Você instala o Orquestrador Maestro uma vez no seu usuário/máquina**, e ele fica disponível globalmente para o Cursor. A instalação coloca, entre outras coisas, a regra global do Cursor em `%USERPROFILE%\.cursor\rules\orquestrador-maestro.mdc`, as skills em `%USERPROFILE%\.cursor\skills` e o núcleo em `%USERPROFILE%\.orquestrador`.

O Cursor também diferencia regras globais das regras específicas de projeto; regras do projeto podem viver dentro da própria codebase, enquanto regras de usuário valem entre projetos. ([GitHub](https://github.com/slava-kudzinau/cursor-guide/blob/main/docs/01-fundamentals-core-concepts/02-environment-project-setup.md?utm_source=chatgpt.com "cursor-guide/docs/01-fundamentals-core-concepts/02-environment-project-setup.md at main · slava-kudzinau/cursor-guide · GitHub"))

### Na prática

Na primeira vez na sua máquina:

```powershell
npm install -g @iapro/orquestrador-maestro-cli@latest

orquestrador-maestro install

orquestrador-maestro verify
```

E o Orquestrador global já está disponível.

O que eu recomendo fazer **uma vez para cada projeto importante** é inicializar a memória `DEV/`:

```powershell
orquestrador-maestro init-dev --project-path .
```

Isso não reinstala o Orquestrador. Apenas cria a estrutura específica daquele projeto, como:

```text
DEV/
├── README.md
├── INDEX.md
├── HANDOFF.md
├── CONTEXT.md
├── SPECS/
│   └── ACTIVE.md
├── WORKLOG.md
├── VERIFY.md
├── ADR/
├── API/
├── DATABASE/
├── RUNBOOKS/
├── TASKS/
└── ...
```

O próprio projeto recomenda esse comando para inicializar `DEV/`, sem sobrescrever arquivos existentes.

Então pense assim:

```text
Instalar Maestro
       ↓
UMA VEZ POR COMPUTADOR/USUÁRIO

Criar DEV/
       ↓
UMA VEZ POR PROJETO
```

Por exemplo, para um projeto novo:

```powershell
mkdir rastro-de-vendas
cd rastro-de-vendas

orquestrador-maestro init-dev --project-path .

cursor .
```

E acabou.

Depois, quando você abrir o Cursor nesse projeto e disser:

> Implemente a integração com a Meta Marketing API.

o fluxo esperado será aproximadamente:

```text
Cursor
  ↓
regra global do Maestro
  ↓
AGENTS.md global
  ↓
DEV/ do Rastro de Vendas
  ↓
contexto atual
  ↓
seleciona skills
  ↓
implementa
  ↓
verifica
  ↓
atualiza DEV/HANDOFF.md
```


