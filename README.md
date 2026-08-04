# Dungeon 64

Un piccolo dungeon crawler first-person a griglia, renderizzato da un ray tracer
CPU progressivo in un framebuffer reale da 64×64 pixel.

Include sfere e piano, materiali diffusi/metallici/dielettrici, ombre morbide,
riflessioni, rifrazioni, profondità di campo e accumulo progressivo dei campioni.
Durante il movimento usa lo stesso integratore del rendering finale con raggi primari
stabili e un denoise edge-aware. Quando la camera si ferma continua ad accumulare
dallo stesso buffer e riduce gradualmente il filtro, senza cambio di renderer.

Il livello usa istanze dei modelli OBJ `Wall_Modular`, `Floor_Modular`, `Arch`,
`Chest`, `Trap_spikes`, `Column`, `Torch` e `Woodfire`. Le mesh hanno una propria
BVH e le istanze sono raccolte in una seconda BVH di scena.

Falò e torce hanno geometria emissiva e luci campionate per importanza. La luce
diretta viene valutata a ogni rimbalzo diffuso, producendo illuminazione globale,
ombre morbide e color bleeding; una debole lanterna del giocatore garantisce la
leggibilità nei passaggi non illuminati.

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

Controlli: `W/S` avanti e indietro, `A/D` rotazione di 90°, `Q/E` strafing,
frecce come alternativa, `Spazio` per la pausa e `R` per ricominciare.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
