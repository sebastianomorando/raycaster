# 64² ray tracer

Un ray tracer CPU progressivo scritto in TypeScript. Renderizza in un framebuffer
reale da 64×64 pixel e lo ingrandisce solo per multipli interi, senza smoothing.

Include sfere e piano, materiali diffusi/metallici/dielettrici, ombre morbide,
riflessioni, rifrazioni, profondità di campo e accumulo progressivo dei campioni.
Durante il movimento usa lo stesso integratore del rendering finale con raggi primari
stabili e un denoise edge-aware. Quando la camera si ferma continua ad accumulare
dallo stesso buffer e riduce gradualmente il filtro, senza cambio di renderer.

To install dependencies:

```bash
bun install
```

Avvio in sviluppo (Bun fa da dev server e bundler):

```bash
bun run dev
```

Build di produzione:

```bash
bun run build
```

Controlli: `WASD` per muoversi, `Q/E` per cambiare quota, frecce o mouse per
guardarsi intorno, `Spazio` per la pausa e `R` per ripristinare la camera.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
