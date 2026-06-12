# Quarto – Emreos & Raquel

Webbaserat tvåspelar-Quarto i realtid, byggt med Node.js, Express och Socket.IO.
Exklusivt för spelarna **Emreos** och **Raquel**.

## Spelregler

- 4×4-bräde och 16 unika pjäser. Varje pjäs har fyra egenskaper:
  ljus/mörk, hög/låg, rund/fyrkantig, ihålig/massiv.
- Du väljer vilken pjäs din motståndare ska placera. Efter placeringen
  väljer hen nästa pjäs åt dig.
- Fyra pjäser i rad (vågrätt, lodrätt eller diagonalt) som delar minst en
  egenskap är en vinnande rad — men du måste själv trycka **Quarto!** för
  att vinna. Trycker du fel förlorar du partiet direkt.
- Startspelaren slumpas första partiet och alternerar därefter.
  Ställningen räknas över flera partier.

## Spela mot boten

I lobbyn väntar **Don Quartolomé** — el maestro — med tre svårighetsgrader:

- **Lätt** – placerar och ger pjäser på måfå, ser bara sina egna fyror i rad
  och kan glatt ge dig den vinnande pjäsen.
- **Medel** – tar varje omedelbar vinst, ropar på rader du missar och ger dig
  aldrig en direkt vinnande pjäs om det går att undvika.
- **Svår** – sökmotor (negamax med alfa–beta och iterativ fördjupning under
  tidsbudget) som ser gafflar flera drag framåt och spelar slutspelet perfekt.

Botpartier körs helt i webbläsaren (`public/bot.js` + `public/local.js`
återanvänder regelmotorn i `game.js`) och rör aldrig det delade onlinepartiet —
du syns inte ens som online medan du tränar. Ställning och pågående parti
sparas i `localStorage` per plats och svårighetsgrad.

## Köra lokalt

```bash
npm install
npm start            # http://localhost:3000
```

Öppna sidan på två enheter (eller två flikar), välj varsin identitet och spela.
Spelet ligger i serverminnet: omladdning av sidan tappar ingenting,
men en serveromstart nollställer parti och ställning.

## Tester

```bash
npm test             # enhetstester för spellogiken + socket-integrationstest
node test/rakel-bot.js   # bot som spelar som Raquel mot en lokal server (manuell testning)
```

## Deploy (Render/Railway/Fly)

Appen är en vanlig långlivad Node-server och fungerar på alla Node-hostar.

**Render** (gratis tier):
1. Pusha repot till GitHub.
2. Skapa en **Web Service** på render.com kopplad till repot.
3. Build command: `npm install` — Start command: `npm start`.
4. Klart. Render sätter `PORT` automatiskt och ger https (krävs inte av appen,
   men skadar inte).

Obs: gratis-tier på Render somnar efter inaktivitet och startar om då och då —
eftersom spelet ligger i serverminnet nollställs ställningen vid omstart.

## Arkitektur

| Fil | Ansvar |
| --- | --- |
| `game.js` | Ren spellogik (pjäser, turordning, vinstkontroll) — inga beroenden, körs både i Node och webbläsaren |
| `server.js` | Express + Socket.IO: identitet, onlinestatus, broadcast av tillstånd |
| `public/` | Frontend: vanilla HTML/CSS/JS, ritar allt utifrån serverns tillstånd |
| `public/bot.js` | Botens beslutslogik i tre nivåer (slump → heuristik → negamax-sökning) |
| `public/local.js` | Lokal "låtsasserver" för botläget: samma kontrakt som socketvägen |
| `test/` | Enhetstester (logik + bot), socket-integrationstest och Raquel-bot |

Pjäser kodas som heltal 0–15 där varje bit är en egenskap. Servern är
auktoritativ: klienten skickar bara intentioner (`selectPiece`, `placePiece`,
`claimQuarto`, `claimDraw`, `newGame`) och ritar om vid varje `state`-broadcast.

## Design & gameplay-detaljer

- Exklusivt modernt formspråk: matt nästan-svart yta, hårfina linjer och en
  enda accent i mässing. Typografin bär rummet — Fraunces (serif) för display,
  Inter för gränssnittet, spärrade versaler för etiketter.
- Pjäserna ritas som SVG i champagne-metall mot grafit med kraftig
  höjdskillnad och tydligt markerade hål — pjäsen i hand visar dessutom
  egenskaperna i text.
- Fast spelvy utan scroll (100dvh): egna drag renderas optimistiskt och
  pjäserna flyger med FLIP-animation förråd → hand → bräde.
- Slumpat ordspråk per parti, syntetiserade ljud (träklocka vid drag, gong
  vid vinst) plus inspelade utrop i `public/sounds/`.
- Vissa placeringar belönas slumpmässigt med ett flygande utrop ("Woah!",
  "Nämen!" …) hos båda spelarna. Drag som skapar tre i rad med gemensam
  egenskap har högre chans — men slumpen gör utropet till en opålitlig signal,
  så det avslöjar aldrig säkert något om brädet.
- Senast placerade pjäsen markeras med en tunn mässingsring; vinst firas
  med stillsamt fallande guldstoft hos vinnaren.
