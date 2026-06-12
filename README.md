# Quarto – Emrico & Raquel

Webbaserat tvåspelar-Quarto i realtid, byggt med Node.js, Express och Socket.IO.
Exklusivt för spelarna **Emrico** och **Raquel**.

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
| `game.js` | Ren spellogik (pjäser, turordning, vinstkontroll) — inga beroenden |
| `server.js` | Express + Socket.IO: identitet, onlinestatus, broadcast av tillstånd |
| `public/` | Frontend: vanilla HTML/CSS/JS, ritar allt utifrån serverns tillstånd |
| `test/` | Enhetstester, socket-integrationstest och Raquel-bot |

Pjäser kodas som heltal 0–15 där varje bit är en egenskap. Servern är
auktoritativ: klienten skickar bara intentioner (`selectPiece`, `placePiece`,
`claimQuarto`, `claimDraw`, `newGame`) och ritar om vid varje `state`-broadcast.

## Grafik & gameplay-detaljer

- Pjäserna ritas som SVG i elfenben/ebenholts med kraftig höjdskillnad och
  tydligt markerade hål — pjäsen i hand visar dessutom egenskaperna i text.
- Orientalisk lack-och-guld-estetik med sigill (四 = fyra), slumpat ordspråk
  per parti och syntetiserade ljud (träklocka vid drag, gong vid vinst).
- Vissa placeringar belönas slumpmässigt med ett flygande utrop ("Woah!",
  "Nämen!" …) hos båda spelarna. Drag som skapar tre i rad med gemensam
  egenskap har högre chans — men slumpen gör utropet till en opålitlig signal,
  så det avslöjar aldrig säkert något om brädet.
- Senast placerade pjäsen markeras med guldring.
