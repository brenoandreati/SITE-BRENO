# Site Breno Andreati: landing page grátis

Página de captação: oferece uma landing page grátis e envia o pedido direto para o WhatsApp.
É um site estático (HTML, CSS e JS puros), sem build.

## Antes de publicar

1. **WhatsApp e Instagram**: edite o bloco `CONFIG` no começo de `assets/main.js`.
   - `whatsapp`: DDI + DDD + número, só dígitos (ex.: `5511912345678`).
   - `instagram`: seu @ sem a arroba.
   - `vagasPorMes`: quantas páginas você abre por mês (use `0` para esconder o número).
2. **Exemplos**: troque os três blocos tracejados da seção `#exemplos` em `index.html` por
   `<img src="assets/exemplos/cliente.jpg" alt="Página do cliente X">`, com prints de 1200 × 800.
   Preencha o nome do cliente e o segmento na legenda.
3. **Textos**: a copy está toda em `index.html`. Revise principalmente “Por que de graça?” e o FAQ.

## Ver no computador

```bash
npx http-server -p 8080
```

Depois abra http://localhost:8080.

## Publicar no GitHub Pages

Em *Settings → Pages*, escolha a branch e a pasta `/ (root)`.
