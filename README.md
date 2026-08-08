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

Il combattimento è a turni e usa tiri in stile D&D: ogni attacco lancia un d20 più
il bonus per superare la classe armatura, poi applica formule come `2 + 1d4` per il
danno. Uno spostamento valido, un attacco, l'attesa o l'uso di un oggetto consumano
un turno, quindi i nemici percepiscono il giocatore, cercano un
percorso sulla griglia e si muovono o attaccano. Entrare nella cella di un nemico
esegue un attacco corpo a corpo. I nemici hanno vita, attacco, classe armatura e drop propri;
le barre sopra gli impostori mostrano i danni subiti, accompagnati da numeri
fluttuanti e da un breve feedback di trasparenza e movimento.

Il puntatore usa un raycast dalla camera per riconoscere mostri, drop, torce, pareti
e baule rispettando l'occlusione della scena. Un click su un nemico adiacente attacca,
mentre oggetti e contenuto del baule possono essere raccolti direttamente. Le torce
si possono staccare e fissare a un'altra parete: geometria, BVH e luci vengono
ricostruite anche nel backend WebGPU. Il baule non conclude la partita e resta
ispezionabile dopo essere stato svuotato. Il Ghost considera le torce una minaccia:
se entra nel loro raggio usa il proprio turno per allontanarsi dalla luce.

L'inventario contiene fino a otto oggetti e gestisce armi, armature e consumabili.
Gli oggetti a terra usano le stesse icone pixel art dell'inventario e vengono raccolti
automaticamente attraversandone la cella. Equipaggiare o usare un oggetto consuma
un turno, in stile roguelike. Il pannello mostra una griglia di sole icone; hover e
focus visualizzano nome, statistiche e descrizione dell'oggetto.

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

## Struttura del codice

- `index.ts`: stato della partita, turni, input, HUD e orchestrazione dei renderer.
- `game/content.ts`: definizioni e factory di nemici, giocatore, oggetti e drop.
- `game/combat.ts`: tiri d20 contro la classe armatura e formule dei dadi di danno.
- `game/level.ts`: mappa logica e conversione tra griglia e spazio 3D.
- `game/dungeon.ts`: materiali, mesh, luci e ricostruzione della scena dinamica.
- `game/interactions.ts`: raycast contestuale per mostri, oggetti, torce, pareti e baule.
- `game/enemy-ai.ts`: reazioni ambientali dei nemici, inclusa la fuga del Ghost dalla luce.
- `game/camera.ts`: base della camera, proiezione e generazione dei raggi primari.
- `game/cpu-path-tracer.ts`: fallback CPU progressivo, denoise e tone mapping.
- `game/impostor-renderer.ts`: nemici billboard, barre vita e oggetti a terra.
- `game/ui.ts`: HUD DOM, messaggi, inventario e tooltip accessibili.
- `game/input.ts`: mouse-look, zoom, tastiera e traduzione degli input in azioni.
- `game/math.ts`: tipi e operazioni vettoriali condivise.
- `ui.css`: skin pixel dell'HUD e dei pannelli.
- `mesh.ts` e `renderer-webgpu.ts`: accelerazione geometrica e backend WebGPU.

La scena e gli impostori sono renderizzati su canvas; HUD e inventario restano nel
DOM perché testo, tooltip, focus e controlli da tastiera richiederebbero molto più
codice e duplicazione se ricostruiti manualmente su un canvas UI.

Controlli: `W/S` avanti e indietro, `A/D` rotazione di 90°, `Q/E` strafing,
frecce come alternativa, click per l'azione indicata dal cursore contestuale,
trascinamento con il pulsante del mouse premuto per guardarsi
liberamente intorno e rotellina per lo zoom. La visuale e lo zoom rimangono impostati
finché non ci si sposta, quindi tornano all'orientamento cardinale più vicino e allo
zoom normale. `Spazio` o `.` attendono un turno, `I` apre l'inventario, i tasti
`1–8` usano o equipaggiano l'oggetto corrispondente, `P` mette in pausa il renderer
e `R` fa ricominciare. Il pulsante
nella barra superiore cambia ciclicamente la risoluzione interna tra 32×32, 64×64,
128×128 e 256×256, mantenendo sempre l'output pixel-perfect.

## Direzione futura

- Illuminazione come sistema stealth: distanza di percezione dei mostri ridotta al buio.
- Rune, tracce e passaggi segreti rivelati soltanto orientando una luce nel punto giusto.
- Creature con reazioni differenti alla luce: fuga, aggressività o vulnerabilità.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

Inserire nella cartella ModularDungeon i modelli OBJ del livello e in
`fantasycharacters` i PNG trasparenti degli impostori. Asset di Quaternius.
https://quaternius.com/packs/modulardungeon.html
