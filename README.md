# Dagbog

En personlig, krypteret dagbog som webapp (PWA). Den er bygget til én bruger og primært til telefonen.

## Sådan virker den

- **Lokal og krypteret:** Alt gemmes i browserens IndexedDB, krypteret med AES-GCM. Nøglen er låst med din kode (PBKDF2, 600.000 runder) og kan også låses op med Face ID/fingeraftryk via en passkey (WebAuthn PRF). Der er ingen server og ingen konto.
- **AI (valgfri):** Ugeopsummering, månedskapitler, "Gå dybere" og søgning med naturligt sprog kalder Claude API direkte fra browseren med din egen API-nøgle. Analysen bruger Claude Opus 5.5 og søgningen Claude Haiku 5.5. Begge modeller kan ændres i Indstillinger. Når AI er slået fra, forlader intet enheden.
- **Påmindelser:** Appen viser prikker på fanerne og på app-ikonet (Badging API). Ikonet opdateres kun, mens appen kører. Vil du have en påmindelse på et fast tidspunkt, kan du hente en kalenderfil (.ics) under Indstillinger.
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
