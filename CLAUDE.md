# CLAUDE.md

Projektkontekst og regler for Claude Code.

## Formål

Dagbog er en personlig, krypteret dagbog (PWA) til eget brug: https://pbo-dot.github.io/dagbog/. Se README.md for funktionerne.

## Opbygning

- React + TypeScript + Vite, `vite-plugin-pwa`. Ingen server: alt gemmes krypteret i IndexedDB på telefonen (AES-GCM).
- `src/screens/` skærme, `src/lib/` logik (lager, kryptering, AI, kalender, Google), `src/ui.tsx` fælles komponenter og ikoner, `src/index.css` al styling.
- Claude API kaldes direkte fra telefonen med ejerens egen nøgle. "Spørg dagbogen" kan foreslå nye noter, aftaler, faste ting og noter om mennesker og rette egne noter, aftaler og faste ting (`proposals.ts`, `Proposal.tsx`); intet gemmes før Gem, og alt kan fortrydes. Google-aftaler, dagbogsdage og sletning røres aldrig. Tre typer svar: Dagbogen (`ai.askModel`, Sonnet som standard; opslag med smalt materiale (`focusScope`) bruger søgemodellen, og "Svar grundigere" spørger igen med Opus, `DEEP_MODEL`), + Nettet (først `webLookup` med web_search uden dagbogen, så svaret med fundene) og Hurtig (søgemodel). Google Kalender hentes med ejerens eget klient-id. Aftaler oprettet i Dagbog sendes til Google (`gcalWrite.ts`, scope `calendar.events`); aftaler fra Google røres aldrig.
- Sikkerhedskopi (`src/lib/backup.ts`, `drive.ts`, `backupSync.ts`): hele databasen pakkes og krypteres med dagbogens nøgle og gemmes dagligt i mappen "Dagbog-kopi" på ejerens Google Drev (scope `drive.file`, de seneste 14). Ved ny start kan kopien hentes og åbnes med koden. Automatisk: `autoSignIn` (main.tsx) henter en ny Google-nøgle uden at spørge før oplåsning (højst hver 45. min, kræver husket konto i vault `google`), og `useAutoBackup` gemmer 4 s efter oplåsning, hvis dagens kopi mangler. Hvert trin skrives i en lille log uden for kryptering (`noteAuto`, vault `autolog`, de seneste 12), som vises under Sikkerhedskopi › "Seneste forsøg"; er kopien 2+ dage gammel, viser Skriv "Kopien er N dage gammel · Gem nu" (`BackupNudge`).
- Skriv-siden (`Entry.tsx`): skrivefeltet står højt oppe. "Fortæl om dagen" og "Få overblik" er to små kort (`.talk-row`), og aftaler, faste ting, fødselsdage og huskeliste er samlet i én linje "I dag · 1 aftale · 3 faste ting · 5 huskepunkter" (`TodayFold`, folder ud med et tryk, valget huskes i `localStorage["dagbog-idag-aaben"]`; prik, hvis noget er overskredet). "Gem"-bjælken vises først, når der er skrevet noget.
- Huskeliste (`src/lib/todos.ts`, `src/screens/Todos.tsx`): huskepunkter uden tidspunkt (samling `todos`). "I dag" på Skriv-siden viser højst 3 (fristen først); punkter kan udsættes (`showFrom`) eller lægges væk til "Engang" (`someday`). Claude kan foreslå huskepunkter (`kind: "todo"` i Spørg) og ser åbne punkter under HUSKELISTE; "+ Huskeliste" (`AddTodoButton`) ved samtalers "Husk" og ugens løse ender. Gentagelse (`Todo.repeat` uge/måned/år, vælges under "Gentag" i `TodoEditScreen`): når et gentagende punkt klares, laver `nextTodo` det næste (ny frist, og det dukker op lidt før: 0/3/14 dage; uden frist om en uge/måned/et år), `Todo.nextId` husker det, så Fortryd fjerner det igen.
- Påmindelser (`src/lib/todoReminders.ts`, `syncTodoReminders` i `googleSync.ts`): Dagbog har ingen server, så påmindelser lægges som 15-minutters aftaler i Google Kalender, og Google giver beskeden på telefonen (`reminderEvent`, popup). Slås til under Indstillinger → Google Kalender (`settings.google.remind = {on, time, cal, write, birthdays}`). `wantedReminders` laver listen: huskepunkter med frist (kl. `time`, standard 9.00; kun frister fra i dag og frem), faste ting med "Påmind kl." (`Routine.remindAt`, gentaget med `routineRule`: `FREQ=DAILY;INTERVAL=n` eller månedlig, første gang `firstFrom`), "skriv i dagbogen" hver dag (`write`, tid og tekst fra `settings.reminder`) og fødselsdage (`birthdays`, årlig, besked på dagen og en uge før). `planReminders` sammenligner med `settings.google.todoEvents` (nøgle: huskepunkt-id, `r:<fast ting>`, `w`, `b:<person>` → `{cal, id, key}`) og opretter, retter (når `sig` ændrer sig) og fjerner. Kører 1,5 s efter en ændring og når appen kommer frem (`remindSoon`, én fælles timer, `sentIndex` så intet laves to gange). Påmindelserne skjules i Dagbogs egen kalender (`googleEvents`, også gentagne med id `<id>_<tid>`). Hvert forsøg står i "Seneste forsøg" (`noteAuto`). Dagbog kan kun rette i Google, mens appen er åben, og en fast tings påmindelse ved ikke, om der er trykket "Taget".
- "Før du mødes" og dagens spørgsmål (`src/lib/meet.ts`, uden Claude): `meetPreps` finder aftaler i dag (ikke begyndt for over en time siden) og i morgen, hvor titlen nævner en fra Mennesker (`peopleIn`: hele navnet, eller fornavnet hvis kun én har det), og `MeetCards` på Skriv viser "Vigtigt lige nu", seneste note, seneste samtale og åbne huskepunkter med navnet (højst 2 kort; × skjuler resten af dagen, `localStorage["dagbog-moedes-skjult"]`). `dayQuestion` vælger dagens spørgsmål: efter en aftale med klokkeslæt "Hvordan gik det med Camilla i dag?"/"Hvordan gik "…"?", før den "I dag kl. 14.00: "…". Hvad håber du på?", ellers et huskepunkt klaret i dag eller humøret i går, ellers de faste spørgsmål.
- Forslag (ikke bygget, venter på ejerens ja): siden "Det ved jeg om dig", se `docs/forslag-det-ved-jeg-om-dig.png`.
- Spørg: "Gem som note" under hvert svar (`saveAsNote` i `Ask.tsx`): spørgsmålet bliver titel, svaret teksten, etiket "Fra Spørg", links fra nettet kommer med. Samtalen huskes stadig kun, mens appen er åben (`saved`).
- Forbrug (`src/lib/usage.ts`, `src/screens/Usage.tsx`): `track()` efter hvert Claude-svar i `ai.ts` regner tokens om til dollar (listepriser i `PRICES`) og gemmes pr. måned i samlingen `usage`. Vises i kroner (`DKK_PER_USD`) under Indstillinger → AI, på siden Forbrug og under hvert svar i Spørg.
- Google Keep (`src/lib/keep.ts`, `src/screens/Keep.tsx`): Google tillader ikke Keep-adgang for almindelige konti, så noter hentes fra en Takeout-zip, der pakkes ud på telefonen med fflate. Etiketter, links og billeder kommer med (`Note.labels/links/photos`); `Note.keep` forhindrer dubletter ved ny import. Etiketter er filtre i Noter og sendes med til Spørg.
- Noter er en fane (Mennesker ligger under Husk): kort i to spalter som i Keep, fastgjorte øverst (`Note.pinned`), farver (`Note.color`, `--nc-*`), filter på etiket som dropdown, oprettet-dato på kortene (og "Oprettet … · rettet …" i noten). Noter gemmer sig selv, mens der skrives. "Ryd op med Claude" (`TidyScreen`, `tidyNotes` i `ai.ts`, Sonnet i bunker á 40) foreslår noter at slette (aldrig fastgjorte) og etiketter (som standard kun eksisterende); intet gemmes før Gem, kopi til Drev først, og Fortryd lægger alt tilbage.
- Faner: Skriv, Husk (minder: søg eller spørg, overblik, (minde-kortene for 1 år/3 mdr/1 md siden er fjernet fra Husk, ejeren vil finde dagene via måned og uge; `settings.memories` ligger uset i data), "Månedens kapitel" (altid i listen: nyt kapitel med prik, ellers det seneste; ‹ › bladrer mellem måneder i `MonthScreen`), ugen, samtaler, mennesker, mønstre), Noter, Plan (`PlanTabs`: Kalender, Huskeliste, Faste ting) og Mere. Søgefeltet i Husk søger i dage, noter, mennesker og huskeliste på telefonen, og "Spørg Claude" sender ordene videre til Spørg. Huskepunkter med frist i dag eller før giver prik på Skriv og app-ikonet. Indstillinger er delt i korte sider (`indstillinger/<side>`, se `PAGES` i `Settings.tsx`).
- Tal med dagbogen (`src/screens/Talk.tsx`, `talkNext`/`talkDraft` i `ai.ts`, rute `tal`): telefonens talegenkendelse og oplæsning (`speak` i `device.ts`). Claude (askModel) stiller højst 3 korte spørgsmål med dagens aftaler, de seneste 3 dage og åbne huskepunkter som baggrund (følger højst én gang op på noget derfra), og skriver så dagen med personens egne ord plus humør, tags og huskepunkter. Lægges efter det, der allerede er skrevet i dag; intet gemmes før "Gem dagen".
- Få overblik (`src/screens/Clarity.tsx`, `clarityNext`/`clarityResult` i `ai.ts`, rute `overblik`, knap på Skriv): man fortæller (skriv eller tal) om en svær situation; Claude (askModel) stiller højst 4 åbne spørgsmål og må give ét modspil (`MODSPIL:`; `KRISE:` viser `CrisisHelp`). Overblikket sorterer i Fakta (📷 kamera-testen), Antagelser og Vurderinger (med tankefælder, `TRAPS`), Følelser og "Ved det ikke endnu"; kort kan flyttes. Næste skridt: konflikttrappen (`LADDER`, trin 0 = ingen modpart), 2–3 skridt som man selv vælger, "Sådan kan du sige det" (Jeg blev … og jeg har brug for …). Gem laver en note (🧭, etiket "Overblik"), valgte skridt på huskelisten og "Hvordan gik det med …?" med `showFrom` om 2 dage. Claude roser ikke, dømmer ikke og tager ikke parti.
- `public/share-sw.js` modtager "Del → Dagbog" (tekst og lydfiler). Et delt link (`asLink` i `conversation.ts`: url eller tekst med link og højst 300 tegn mere) bliver straks til en note med `links`; anden tekst åbner en ny samtale. Et delt Word-dokument (.docx) eller en tekstfil (`doc` i `share_target`, cache `dagbog-delt-dok`) bliver til en note med hele teksten (`noteFromFile` i `docNote.ts`, .docx pakkes ud med fflate); det samme gør "Hent fra dokument" nederst i Noter. Delte billeder (`image` i `share_target`, cache `dagbog-delt-billeder`, `?bil=<antal>&btext=<tekst>`, højst 10) bliver til en note med billederne (`takeSharedImages` i `conversation.ts`, behandlet i `App.tsx`; formindskes med `compressImage`).
- DB-appen (pbo-dot/db, optager) bruges ikke længere og er sat på pause. Dagbog laver ingen ny nøgle til den; gamle optagelser, der stadig venter, kan læses med en gemt nøgle (`loadInboxKey` i `inbox.ts`) og vises under Samtaler som "Optagelser, der venter".

## Byg og udgivelse

- `npm run build` og `npm run lint` før commit. Test i browser med `npx vite preview` og Playwright.
- Udvikl på arbejdsgrenen, og læg ændringer på `main`. GitHub Actions udgiver til GitHub Pages.

## Arbejdsform med ejeren

- **Se før du retter:** Byg detaljeret log og "Del med Claude" (én fil, ejeren gemmer på Drev) som noget af det første i en ny funktion, der skal virke på telefonen. Bed om én hel rigtig kørsel med log, før der designes, og ret først, når loggen viser fejlen. Én rettelse ad gangen: ret → kør → send loggen. Lært af Lukker (ca. 70 versioner, hvor loggen kom for sent).
- **Nye, ukendte funktioner:** Skriv ikke fra bunden først. Undersøg kendte løsninger (open source-projekter på GitHub, velholdte biblioteker og officiel dokumentation), sammenlign kort 2–3 fremgangsmåder i forslaget til ejeren, og vælg den mest gennemprøvede. Brug kun kode med åben licens, og hold appen let.
- **Forslag undervejs:** Kom løbende med korte forslag til forbedringer, når du ser noget, der gentager sig, kan gå galt eller kan gøres nemmere for ejeren. Giv en anbefaling og en rækkefølge. Forslag bygges først, når ejeren har sagt ja (fejlrettelser dog med det samme).
- **Gennemgang en gang imellem:** Når ejeren beder om det (fx "Hvad tænker du om den overordnede funktionalitet, brugervenlighed, struktur og design? Du har frie tøjler, tænk kreativt"), så tag en rundtur i hele appen med friske skærmbilleder, og giv en ærlig vurdering: hvad der virker, hvad der halter, og 3–5 forslag i anbefalet rækkefølge. Byg først efter ejerens ja.
- Skriv på dansk, kort og i almindeligt sprog. Ejeren er ikke programmør.
- Nye funktioner drøftes og godkendes (gerne med et visuelt forslag), før de bygges. Fejlrettelser må laves med det samme.
- Sig til med link, når en ændring er ude. Vær ærlig om, hvad der er testet, og hvad kun kan testes på telefonen.
- Kommentarer og brugertekster på dansk.

## Færdig-tjekliste (før ejeren får besked)

- [ ] `npm run build` og `npm run lint` uden fejl.
- [ ] Prøvet i browseren (`npx vite preview` + Playwright) med skærmbillede, også mørk tilstand ved nye skærme.
- [ ] CLAUDE.md opdateret, hvis noget nyt er bygget.
- [ ] Skubbet til arbejdsgrenen og `main`, og GitHub Pages-byggeriet er grønt.
- [ ] Ejeren har fået linket og en ærlig besked om, hvad der kun kan testes på telefonen.
- [ ] Guide-noterne ("Guide til Dagbog" / "Teknisk guide") nævner det, hvis ejeren selv skal kunne finde funktionen.

## Design (top-design anno 2026)

Ejeren ønsker, at alt nyt og alt, der ændres, lever op til top-design anno 2026. Det gælder alle ejerens apps.

- Følg ånden i Googles **Material 3 Expressive** (som på ejerens Pixel), tilpasset appens egen stil og farver.
- Stor, letlæselig skrift og stærk kontrast. Både lys og mørk tilstand skal se godt ud.
- Store trykflader (mindst 44–48 px) og runde knapper. Brug tre slags knapper: fyldt (hovedhandling), tonal (almindelig) og tekst (mindre vigtig).
- Kort uden kanter, store runde hjørner og god luft. Ensartede streg-ikoner.
- Korte tekster. Ingen lange grå hjælpetekster; forklar kun, når det er nødvendigt.
- Bløde, diskrete overgange og trykeffekter (respektér "reducer bevægelse").
- Vis altid et visuelt forslag (billede), før nye skærme eller større ændringer bygges.
