# CLAUDE.md

Projektkontekst og regler for Claude Code.

## Formål

Dagbog er en personlig, krypteret dagbog (PWA) til eget brug: https://pbo-dot.github.io/dagbog/. Se README.md for funktionerne.

## Opbygning

- React + TypeScript + Vite, `vite-plugin-pwa`. Ingen server: alt gemmes krypteret i IndexedDB på telefonen (AES-GCM).
- `src/screens/` skærme, `src/lib/` logik (lager, kryptering, AI, kalender, Google), `src/ui.tsx` fælles komponenter og ikoner, `src/index.css` al styling.
- Claude API kaldes direkte fra telefonen med ejerens egen nøgle. Google Kalender hentes med ejerens eget klient-id (kun læsning).
- Sikkerhedskopi (`src/lib/backup.ts`, `drive.ts`, `backupSync.ts`): hele databasen pakkes og krypteres med dagbogens nøgle og gemmes dagligt i mappen "Dagbog-kopi" på ejerens Google Drev (scope `drive.file`, de seneste 14). Ved ny start kan kopien hentes og åbnes med koden.
- `public/share-sw.js` modtager "Del → Dagbog" (tekst og lydfiler).
- Søsterappen DB (optager) ligger i repoet pbo-dot/db.

## Byg og udgivelse

- `npm run build` og `npm run lint` før commit. Test i browser med `npx vite preview` og Playwright.
- Udvikl på arbejdsgrenen, og læg ændringer på `main`. GitHub Actions udgiver til GitHub Pages.

## Arbejdsform med ejeren

- Skriv på dansk, kort og i almindeligt sprog. Ejeren er ikke programmør.
- Nye funktioner drøftes og godkendes (gerne med et visuelt forslag), før de bygges. Fejlrettelser må laves med det samme.
- Sig til med link, når en ændring er ude. Vær ærlig om, hvad der er testet, og hvad kun kan testes på telefonen.
- Kommentarer og brugertekster på dansk.

## Design (top-design anno 2026)

Ejeren ønsker, at alt nyt og alt, der ændres, lever op til top-design anno 2026. Det gælder alle ejerens apps.

- Følg ånden i Googles **Material 3 Expressive** (som på ejerens Pixel), tilpasset appens egen stil og farver.
- Stor, letlæselig skrift og stærk kontrast. Både lys og mørk tilstand skal se godt ud.
- Store trykflader (mindst 44–48 px) og runde knapper. Brug tre slags knapper: fyldt (hovedhandling), tonal (almindelig) og tekst (mindre vigtig).
- Kort uden kanter, store runde hjørner og god luft. Ensartede streg-ikoner.
- Korte tekster. Ingen lange grå hjælpetekster; forklar kun, når det er nødvendigt.
- Bløde, diskrete overgange og trykeffekter (respektér "reducer bevægelse").
- Vis altid et visuelt forslag (billede), før nye skærme eller større ændringer bygges.
