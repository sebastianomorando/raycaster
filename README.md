# Dungeon 64

Un piccolo dungeon crawler first-person a griglia, renderizzato da un ray tracer
CPU progressivo in un framebuffer quadrato a risoluzione selezionabile.

Include sfere e piano, materiali diffusi/metallici/dielettrici, ombre morbide,
riflessioni, rifrazioni, profondità di campo e accumulo progressivo dei campioni.
Durante il movimento usa lo stesso integratore del rendering finale con raggi primari
stabili e un denoise edge-aware. Quando la camera si ferma continua ad accumulare
dallo stesso buffer e riduce gradualmente il filtro, senza cambio di renderer.

Il livello usa istanze dei modelli OBJ `Wall_Modular`, `Floor_Modular`, `Arch`,
`Chest`, `Trap_spikes`, `Column`, `Torch` e `Woodfire`. Le mesh hanno una propria
BVH e le istanze sono raccolte in una seconda BVH di scena.

I PNG trasparenti della cartella `fantasycharacters` possono essere usati come
impostori prospettici: vengono proiettati su un canvas sovrapposto, scalati con la
distanza, mantenuti frontali alla camera e verificati per colonne contro la geometria,
così muri e oggetti possono occultarli. La scena include esempi con imp, fantasma,
demone del magma e lich.

Il combattimento è a turni: uno spostamento valido, un attacco, l'attesa o l'uso di
un oggetto consumano un turno, quindi i nemici percepiscono il giocatore, cercano un
percorso sulla griglia e si muovono o attaccano. Entrare nella cella di un nemico
esegue un attacco corpo a corpo. I nemici hanno vita, attacco, difesa e drop propri;
le barre sopra gli impostori mostrano i danni subiti.

L'inventario contiene fino a otto oggetti e gestisce armi, armature e consumabili.
Gli oggetti a terra sono indicati da piccoli rombi colorati e vengono raccolti
automaticamente attraversandone la cella. Equipaggiare o usare un oggetto consuma
un turno, in stile roguelike.

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
zoom normale. `Spazio` o `.` attendono un turno, `I` apre l'inventario, i tasti
`1–8` usano o equipaggiano l'oggetto corrispondente, `P` mette in pausa il renderer
e `R` fa ricominciare. Il pulsante
nella barra superiore cambia ciclicamente la risoluzione interna tra 32×32, 64×64,
128×128 e 256×256, mantenendo sempre l'output pixel-perfect.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Inserire nella cartella ModularDungeon i modelli OBJ del livello e in
`fantasycharacters` i PNG trasparenti degli impostori. Asset di Quaternius.
https://quaternius.com/packs/modulardungeon.html
