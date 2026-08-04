# Dungeon 64

Un piccolo dungeon crawler first-person a griglia, renderizzato da un ray tracer
CPU progressivo in un framebuffer quadrato a risoluzione selezionabile.

Include sfere e piano, materiali diffusi/metallici/dielettrici, ombre morbide,
riflessioni, rifrazioni, profondità di campo e accumulo progressivo dei campioni.
Durante il movimento usa lo stesso integratore del rendering finale con raggi primari
stabili e un denoise edge-aware. Quando la camera si ferma continua ad accumulare
dallo stesso buffer e riduce gradualmente il filtro, senza cambio di renderer.

Il livello usa istanze dei modelli OBJ `Wall_Modular`, `Floor_Modular`, `Arch`,
`Chest`, `Trap_spikes`, `Column`, `Torch`, `Woodfire`, `Spider`, `Bat`, `Dragon`,
`Skeleton` e `Slime`. Le mesh hanno una propria BVH e le istanze sono raccolte in
una seconda BVH di scena.

Falò e torce hanno geometria emissiva e luci campionate per importanza. La luce
diretta viene valutata a ogni rimbalzo diffuso, producendo illuminazione globale,
ombre morbide e color bleeding; una debole lanterna del giocatore garantisce la
leggibilità nei passaggi non illuminati.

Quando WebGPU è disponibile, triangoli, materiali, BLAS, TLAS e luci vengono
caricati in storage buffer e il path tracing viene eseguito da un compute shader
WGSL. Il renderer TypeScript CPU rimane disponibile come fallback automatico.
Un denoise bilaterale separabile in due compute pass filtra i primi campioni e si
ritira progressivamente entro 24 spp, mantenendo più stabile il movimento.

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
frecce come alternativa, trascinamento con il pulsante del mouse premuto per guardarsi
liberamente intorno e rotellina per lo zoom. La visuale e lo zoom rimangono impostati
finché non ci si sposta, quindi tornano all'orientamento cardinale più vicino e allo
zoom normale. `Spazio` mette in pausa e `R` fa ricominciare. Il pulsante
nella barra superiore cambia ciclicamente la risoluzione interna tra 32×32, 64×64,
128×128 e 256×256, mantenendo sempre l'output pixel-perfect.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Inserire nelle cartelle ModularDungeon, EasyEnemies e Monsters i modelli OBJ del livello. Presi da LowPoly Models by @Quaternius
https://quaternius.com/packs/modulardungeon.html
