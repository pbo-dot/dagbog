# Dagbog

En personlig, krypteret dagbog som webapp (PWA). Den er bygget til én bruger og primært til telefonen.

## Sådan virker den

- **Lokal og krypteret:** Alt gemmes i browserens IndexedDB, krypteret med AES-GCM. Nøglen er låst med din kode (PBKDF2, 600.000 runder) og kan også låses op med Face ID/fingeraftryk via en passkey (WebAuthn PRF). Der er ingen server og ingen konto.
- **AI (valgfri):** Ugeopsummering, månedskapitler, "Gå dybere" og søgning med naturligt sprog kalder Claude API direkte fra browseren med din egen API-nøgle. Analysen bruger Claude Opus 5.5 og søgningen Claude Haiku 5.5. Begge modeller kan ændres i Indstillinger. Når AI er slået fra, forlader intet enheden.
- **Påmindelser:** Appen viser prikker på fanerne og på app-ikonet (Badging API). Ikonet opdateres kun, mens appen kører. Vil du have en påmindelse på et fast tidspunkt, kan du hente en kalenderfil (.ics) under Indstillinger.
- **Samtaler:** Tryk Optag samtale under Husk → Samtaler → Ny samtale (skærmen holdes tændt, og dagbogen låser sig ikke under optagelsen), eller optag med fx Pixel Optager, og del teksten til Dagbog (Del → Dagbog, når appen er installeret via Chrome på Android) eller sæt den ind under Husk → Samtaler → Ny samtale. Claude laver et resumé med aftaler og ting at huske (og aftaler med dato, der kan lægges i kalenderen med ét tryk: Android-kalenderen eller Google Kalender åbner med aftalen udfyldt, og den gemmes først, når du trykker Gem), som lægges i dagens dagbog og som en note hos de personer, der var med. Hele teksten gemmes krypteret ved samtalen.
- **DB (optager-app):** En separat, neutral app i repoet [pbo-dot/db](https://github.com/pbo-dot/db), udgivet på https://pbo-dot.github.io/db/ (samme adresse som dagbogen, så de deler lager). Hvid skærm med en lille prik: grå = optager ikke, blå = optager. Teksten krypteres med en offentlig nøgle, som kun dagbogen har den private del af, og dukker op under Husk → Samtaler → Nye optagelser.
- **Spørg dagbogen (Husk):** Stil spørgsmål som "Hvad lavede jeg i januar?" eller "Hvad sagde lægen sidst?". Claude svarer ud fra dagbogen, samtalerne og noterne om mennesker, viser hvilke dage svaret bygger på, og man kan spørge videre. Nævnes en periode ("i januar", "sidste sommer", "i 2025", "de sidste 3 uger"), sendes kun den periode (`src/lib/period.ts`); opfølgende spørgsmål uden periode bruger den forrige. Uden periode sendes hele dagbogen, så længe den er under ca. 200.000 tegn; derover sendes det seneste halve år dag for dag og ældre måneder som månedskapitler og ugeopsummeringer. Materialet caches hos Anthropic i kort tid, så opfølgende spørgsmål er billigere.
- **Faste ting (Husk):** Medicin, indsprøjtninger m.m. på en fast plan (hver dag/uge/14. dag/måned eller hver N. dag), evt. skiftevis mellem fx "højre ben" og "venstre ben". På dagen står de øverst på Skriv-siden med "✓ Taget"; glemte står med rød kant, til de markeres (planen rykker sig ikke). Historikken er med i "Spørg dagbogen".
- **Eksport:** PDF, tekst eller en fuld JSON-sikkerhedskopi, som kan læses ind igen.

## Udvikling

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # bygger til dist/
```

## Udgivelse på GitHub Pages

1. Opret et repo og push koden til `main`.
2. Vælg Settings → Pages → Source: **GitHub Actions**.
3. Workflowet `.github/workflows/pages.yml` bygger og udgiver ved hvert push.
4. Åbn siden i Safari på iPhone → Del → **Føj til hjemmeskærm**.

Bemærk: Data er knyttet til domænet og browseren. Skifter du domæne eller telefon, så tag en sikkerhedskopi først, og læs den ind bagefter.
