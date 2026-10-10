# Agenda

Agenda pessoal para usar no computador e no celular. Você escreve o compromisso com o dia
da semana, do jeito que falaria (“Dentista quinta às 15h”), e ela já marca sozinha.
Perto do dia, ela manda lembrete no WhatsApp (e por e-mail, se você quiser).

É um site estático (HTML, CSS e JS puros, sem build). Instala no celular como app (PWA)
e funciona sem internet.

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
tudo no formulário (dia da semana, horário, repetição, avisos, notas).

Na aba **Buscar** você pergunta por nome ou data: “dentista”, “sexta”, “dia 20”, “25/12”,
“tenho algo sexta?”. O calendário marca com pontinhos os dias que têm compromisso.

## Endereço

Publicado no Cloudflare (Worker `site-breno`):
**https://site-breno.brenoandreati.workers.dev**

Para publicar de novo depois de mudar algo: `npx wrangler deploy`.

## Computador e celular com a mesma agenda + avisos no WhatsApp

Sem configurar nada, a agenda já funciona, mas fica só no aparelho onde você anotou.
Para juntar os aparelhos e receber os avisos, crie o seu servidor gratuito no Google.
É uma vez só, uns 5 minutos, de preferência pelo computador:

1. No app, vá em **Ajustes → Como criar o servidor** e toque em *copiar o código do servidor*
   (é o arquivo [`servidor/Codigo.gs`](servidor/Codigo.gs)).
2. Abra [script.google.com](https://script.google.com/home/projects/create) e crie um **Novo projeto**.
3. Apague o que estiver lá, cole o código e troque `troque-esta-senha` por uma senha sua. Salve.
4. Com a função `instalar` escolhida no topo, clique em **Executar** e autorize
   (*Revisar permissões → sua conta → Avançado → Acessar → Permitir*).
   Isso cria a planilha “Agenda (dados)” no seu Drive e liga a verificação de 5 em 5 minutos.
5. **Implantar → Nova implantação → App da Web**, com *Executar como: Eu* e
   *Quem pode acessar: Qualquer pessoa*. Copie o **URL do app da Web** (termina em `/exec`).
6. No app, em **Ajustes**, cole o endereço e a senha e toque em **Conectar**.
   No outro aparelho, faça só este passo.

> Se um dia você trocar o código do servidor, use **Implantar → Gerenciar implantações →
> lápis → Versão: Nova versão**. Assim o endereço continua o mesmo.

### WhatsApp (CallMeBot)

Os avisos saem pelo [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/),
um serviço gratuito para mandar mensagens para o seu próprio WhatsApp:

1. Na página do CallMeBot, salve nos contatos o número que aparece lá.
2. Mande pelo WhatsApp para esse contato: `I allow callmebot to send me messages`.
3. Você recebe a sua **apikey**. No app, em **Ajustes → Avisos no WhatsApp**, coloque o seu número
   com DDD e a apikey, salve e toque em **Mandar teste**.

Em cada compromisso você escolhe quando ser avisado (na hora, 15 min, 30 min, 1 h, 2 h,
1 dia, 2 dias, 1 semana antes). O padrão é **1 dia antes e 1 hora antes**. Compromisso
sem horário conta a partir das 9h do dia. Também dá para ligar o **resumo do dia**, que manda
de manhã a lista do que você tem, e mandar os avisos **também por e-mail** como reserva.

## Como funciona por dentro

- `index.html`, `app/` — o app. Guarda a agenda no aparelho (`localStorage`) e, se estiver
  conectado, sincroniza com o servidor (vale a alteração mais recente de cada compromisso).
- `app/datas.js` — datas e repetições. É usado no app **e** no servidor.
- `app/interpretar.js` — entende as frases em português.
- `servidor/Codigo.gs` — o servidor no Google (Apps Script): guarda na planilha, sincroniza
  e manda os avisos. Ele leva uma cópia de `app/datas.js`; depois de mudar esse arquivo,
  rode `npm run servidor` para atualizar a cópia.
- `sw.js`, `manifest.webmanifest` — modo offline e instalação no celular.
- `wrangler.jsonc`, `.assetsignore` — publicação no Cloudflare.

## Testes

```bash
npm test        # frases, repetições e o servidor (com uma imitação do Google)
npm run abrir   # abre em http://localhost:8080
```
