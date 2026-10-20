# Agenda

Agenda para usar no computador e no celular. Cada pessoa cria a própria conta e vê só a
própria agenda. Você escreve o compromisso com o dia da semana, do jeito que falaria
(“Dentista quinta às 15h”), e ela já marca sozinha. Perto do dia, manda lembrete no WhatsApp.

**Endereço:** https://site-breno.brenoandreati.workers.dev

## O que ela entende

| Você escreve | Fica marcado |
| --- | --- |
| Dentista quinta às 15h | próxima quinta, 15:00 |
| Reunião com João amanhã às 14:30 | amanhã, 14:30 |
| Academia toda segunda e quarta 18h | toda segunda e quarta, 18:00 |
| Aula de inglês todas as terças 19h30 | toda terça, 19:30 |
| Reunião de segunda a sexta às 9 | dias úteis, 09:00 |
| Terapia a cada 2 semanas na quarta 17h | quarta sim, quarta não |
| Pagar aluguel dia 5 todo mês | todo dia 5 |
| Aniversário da mãe 12/11 | 12 de novembro, dia todo |
| Viagem 25 de dezembro · Prova daqui a 3 dias | a data certa |
| Reunião das 14h às 16h quinta | quinta, 14:00–16:00 |
| Inglês toda segunda até 15/12 | toda segunda, até 15/12 |

Antes de salvar aparece uma prévia do que ela entendeu. Em “Ajustar detalhes” dá para mudar
tudo no formulário. Na aba **Buscar** você pergunta por nome ou data: “dentista”, “sexta”,
“dia 20”, “tenho algo sexta?”.

## Contas

- **Criar conta:** nome, e-mail e senha (pelo menos 8 caracteres). Cada conta tem a sua agenda.
- **Entrar em outro aparelho:** o mesmo e-mail e senha. O login dura 180 dias e se renova
  sozinho com o uso.
- **Esqueci a senha:** o app manda um código de 6 números para o WhatsApp configurado na conta.
  Quem ainda não configurou o WhatsApp precisa pedir ajuda ao administrador (veja abaixo).
- **Trocar senha / apagar conta:** em Ajustes. Trocar a senha tira a conta dos outros aparelhos.
  Apagar a conta apaga também toda a agenda.
- **Sair:** a agenda some daquele aparelho (continua guardada na conta).

### Segurança

- A senha não sai do aparelho em texto: o app passa ela por PBKDF2 (250 mil rodadas, com o
  e-mail como sal) e o servidor ainda mistura um sal aleatório por pessoa antes de guardar.
- O login é um token aleatório; o servidor guarda só o hash dele.
- Login, cadastro e código de recuperação têm limite de tentativas.
- O site só roda os próprios scripts (Content-Security-Policy em `publico/_headers`).

## Avisos no WhatsApp

Cada pessoa configura o próprio WhatsApp em **Ajustes**, pelo
[CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) (gratuito):

1. Na página do CallMeBot, salve nos contatos o número que aparece lá.
2. Mande pelo WhatsApp para esse contato: `I allow callmebot to send me messages`.
3. Coloque o número com DDD e a **apikey** que chegar em Ajustes, salve e toque em **Mandar teste**.

Em cada compromisso você escolhe quando ser avisado (na hora, 15 min, 30 min, 1 h, 2 h,
1 dia, 2 dias, 1 semana antes). O padrão é **1 dia antes e 1 hora antes**. Compromisso sem
horário conta a partir das 9h. Também dá para ligar o **resumo do dia**, de manhã. O servidor
confere a cada 5 minutos, no fuso horário de cada pessoa.

## Como funciona por dentro

Tudo roda no Cloudflare, no Worker `site-breno`:

- `publico/` — o app (HTML, CSS e JS puros, sem build). Funciona sem internet e instala no
  celular. Guarda a agenda de cada conta no aparelho e sincroniza: manda o que mudou e
  recebe o que mudou nos outros aparelhos (vale a alteração mais recente).
  - `app/datas.js` — datas e repetições (usado também pelo servidor).
  - `app/interpretar.js` — entende as frases em português.
- `worker/` — o servidor: contas e login (`api.mjs`, `seguranca.mjs`), configuração dos
  avisos (`config.mjs`) e os lembretes que rodam a cada 5 minutos (`avisos.mjs`).
- `migrations/` — as tabelas do banco D1 `agenda`.
- `wrangler.jsonc` — configuração do Cloudflare (banco, cron de 5 em 5 minutos).

## Administração

Ver quantas contas existem:

```bash
npx wrangler d1 execute agenda --remote --command "SELECT nome, email, criado FROM usuarios"
```

Ajudar alguém que esqueceu a senha e não tem WhatsApp configurado: apague a conta dessa
pessoa e peça para ela criar de novo (a agenda dela se perde, a não ser que ela tenha uma
cópia de segurança baixada em Ajustes).

```bash
npx wrangler d1 execute agenda --remote --command "DELETE FROM usuarios WHERE email = 'pessoa@exemplo.com'"
```

## Rodar e publicar

```bash
npm test          # frases, repetições e o servidor (com um banco de teste)
npm run abrir     # roda tudo no computador: http://localhost:8787
npm run publicar  # aplica as tabelas novas no banco e publica no Cloudflare
```
