# kurat.ro — analiza site-ului vechi și documentul de entități

Pasul 2 din checklistul „Brain /manage — standard v1” (§6): `crawl` → `analyze` → entități.
Crawl făcut pe 2026-10-26; snapshot-ul e în `reference/snapshot/` (12 pagini, bundle-ul JS, configurația calculatorului din API).

## 1. Ce e site-ul acum

| | |
|---|---|
| Firma | Kurat, firmă de curățenie, București; lucrează în toată România |
| Tehnologie | Angular 22 (`ng-version="22.0.2"`), pagini prerandate; conținutul e **scris în componente**, nu vine dintr-un CMS |
| Backend | `https://api.kurat.ro` (răspunde `{"service":"Kurat","status":"running"}`): `/api/calculator/config` (public), `/api/calculator/quote`, `/api/calculator/offers`, `/api/products` (cere autentificare) |
| Pagini | `/`, `/servicii`, `/servicii/{locuinte,birouri,spatii-comerciale,mentenanta,generala,dupa-constructor}`, `/portofoliu`, `/despre-noi`, `/shop`, `/contact` |
| Lipsesc | `sitemap.xml` (404), `robots.txt` (502), JSON-LD (0 pe toate paginile), meta description proprie (aceeași pe toate cele 12) |
| Formular contact | deschide un `mailto:` precompletat; nu se salvează nimic |
| Magazin | „0 produse — Momentan nu sunt produse disponibile” |

## 2. Entitățile propuse (registrul)

Notații ca în standard. `→` = `ref` (N:1), `⇉` = `refs` (M:N).

| Cheie | Tabel | Ce e | Pagină publică | Câmpuri și relații principale | Opțiuni |
|---|---|---|---|---|---|
| `firma` | `company` | Date firmă | — | nume, telefon, whatsapp, email contact, email comenzi, adresă, CUI, Nr. Reg. Com., IBAN, an înființare, rating, cifrele (locuințe/clienți/birouri curățate) | `singleton`, `noStatus`; sursa jetoanelor `{telefon}`, `{email}`, `{adresa}`, `{whatsapp}` |
| `servicii` | `services` | Un singur tip pentru tot ce stă sub `/servicii/`, cu `fel` = spațiu (Locuințe, Birouri, Spații comerciale, Industriale) sau curățenie (Mentenanță, Generală, După constructor, După evenimente, Canapele & mochetă). Așa adresa rămâne unică, iar cardurile din homepage trimit la un singur tip. | `/servicii/<slug>` (dacă `pagina`) | fel, nume, nume scurt, aliasuri, slug, descriere, imagine, zone acoperite, `⇉ sarcini` (ordonat, cu atributul `grup`: Baie / Bucătărie / Balcon), `⇉ extra`, tarif pe mp (calculator) | `mentions`, `linkFields`, `duplicates: nume`; „Alte servicii” e listă prin regulă, nu relație |
| `tarife` | `prices` | Preț orientativ | — | `→ servicii` (doar `fel = curatenie`), etichetă (1–2 camere, 20–60 mp, Casă), preț, preț maxim, la cerere, `+TVA` | `approval`; „de la X lei” pe /servicii = **minim calculat**, nu scris |
| `extra` | `extras` | Serviciu suplimentar: canapea, saltea, aburi, scaun textil, călcat, geamuri, frigider, cuptor, balcon | — | nume, preț, unitate (`/ scaun`), `in_calculator` | `duplicates: name` |
| `sarcini` | `tasks` | Ce includem (o operațiune) | — | text, grup | `hub: false`; „N servicii incluse” = **numărat**, nu scris |
| `clienti` | `clients` | Client din portofoliu | — | nume, logo, site, tip | `mentions: true`, `aliases` |
| `testimoniale` | `testimonials` | Recenzie | — | text, `→ clienti`, sursă (Google / client), dată | `approval: true` (citate reale) |
| `valori` | `values` | Valorile K-U-R-A-T | — | literă, titlu, text, ordine | apar pe `/` și `/despre-noi` din aceeași sursă |
| `avantaje`, `pasi`, `etape`, `intrebari` | … | „De ce Kurat”, cei 4 pași, cele 3 etape, FAQ | — | titlu, text, ordine | conținut reutilizabil în secțiuni |
| `pagini` + `sectiuni` | `pages`, `sections` | Paginile compuse (`/`, `/despre-noi`, `/portofoliu`, `/contact`, `/servicii`) | `path` | secțiuni tipizate (`kind`: hero, servicii, avantaje, valori, pasi, calculator, garantie, testimoniale, faq, contact) care **trimit** la entitățile de mai sus | `sectiuni`: `hub: false` |
| `produse` | `products` | Produs din magazin | `/shop/<slug>` | nume, preț, imagine, stoc | **de decis**: Brain sau `api.kurat.ro` |
| `setari-calculator` | `settings` | Multiplicatori mobilier (1 / 1,1 / 1,25), preț minim | — | | `noStatus` |
| `cereri` | `leads` | Cereri de ofertă din calculator și din formular | — | | `operational` |
| `media` | `media` | Imagini, logo-uri, badge-uri ANPC | — | | amprentă SHA-1 |

**Relații-cheie pentru propagare:**
- `curatenii.tarife` (inversă: `tarife → curatenii`): un preț schimbat reface **doar** pagina tipului de curățenie, cardul de pe `/servicii` (prin „de la” calculat) și calculatorul. Testul §5.2.
- `curatenii.extra` ⇉: azi aceleași 5 extra sunt copiate pe 3 pagini și diferă de cele din calculator.
- `testimoniale → clienti`: logo-ul și numele vin din client; un client redenumit se schimbă peste tot.
- `sectiuni.*` ⇉ `valori` / `intrebari` / `testimoniale`: homepage și despre-noi trimit la aceleași înregistrări.

## 3. Ce a găsit analiza (merg în „De făcut” după import)

Toate sunt exemple ale aceleiași greșeli (§4, greșelile 16 și 17): **copii în loc de trimiteri**.

| # | Observație | Impact |
|---|---|---|
| 1 | **Calculatorul are trei liste de prețuri diferite.** API live: mentenanță 10, generală 15, după constructor 20 lei/mp, minim 400. Rezerva din bundle: 5 / 12 / 25 lei/mp, minim 150. Paginile au prețuri pe camere (350 / 450 / 800 lei + TVA). | mare |
| 2 | **Serviciile suplimentare se contrazic.** Pe pagini: canapea +200, saltea +50. În calculator: canapea 250, saltea 150, cuptor 100 (în bundle 40). | mare |
| 3 | **Numele serviciilor diferă între locuri.** „Curățenie generală” / „Generală”; „Canapele & mochetă” / „Mochetă / tapițerie”. Sunt candidați la dubluri. | mediu |
| 4 | **Numărul de servicii incluse diferă.** Pe homepage, Rezidențial are 13; pe `/servicii` și pe pagina Locuințe are 12. Numerele sunt scrise de mână. | mediu |
| 5 | **Serviciile de pe homepage nu au pagini:** Industriale, După evenimente, Canapele & mochetă. Ori primesc pagină, ori rămân fără link (`public.path` = null). | mediu |
| 6 | **Telefonul și emailul apar de 2–5 ori pe fiecare pagină,** de 44 de ori în total, toate scrise în cod. Devin `{telefon}` / `{email}`. Magazinul folosește `comenzi@kurat.ro`, iar restul site-ului `cezar@kurat.ro`. | mediu |
| 7 | **Codul poștal „01127” are 5 cifre** (în România are 6). Rămâne `unverified` până la confirmare. | mic |
| 8 | **Autonom are două testimoniale cu texte diferite** (unul pe homepage, altul în portofoliu). „Google” e client în portofoliu (are logo), nu o recenzie Google. | mic |
| 9 | Cifrele (955+, 1.100+, 145+, 4.9/5) nu au sursă. Merg ca `firma` cu proveniență `manual`, de confirmat. | mic |
| 10 | SEO tehnic: fără sitemap, cu robots.txt 502, fără JSON-LD, cu aceeași meta description pe toate paginile. | mare (pentru lansare) |

## 4. Decizii

**Luate**
1. **Arhitectura: varianta A.** Site nou pe nucleul Node, randat pe server din Brain (§3.1).
2. **Nucleul.** Repourile de referință (`stefanmorariu/*`) nu sunt accesibile din contul `toma776`. Nucleul e scris direct după standard (Anexa B pentru schemă, §1 pentru registru și import), cu aceleași nume de fișiere și funcții, ca să poată fi aliniat cu nucleul comun când e disponibil (§0.10).

**Deschise**
3. **Prețurile adevărate.** Care dintre cele trei liste (API / bundle / pagini) e cea corectă? Până la decizie, în Brain intră prețul de pe pagini, cu certitudinea `unverified`. Tarifele pe mp și prețul minim vin din API, tot `unverified`, iar ambele surse apar în proveniență.
4. **Magazinul.** Îl ține Brain-ul (`produse`, tip gol acum) sau rămâne în API?
5. **Serviciile fără pagină** (Industriale, După evenimente, Canapele & mochetă) primesc pagină?
6. **Cele 4 carduri din homepage potrivite după nume** sunt legături deduse, de confirmat sau de scos în „Legături de verificat”.

## 5. Cum se rulează

```bash
npm run crawl      # snapshot nou în reference/snapshot/ (rețea)
npm run analyze    # rapoarte în reference/analysis/ (observatii.json, mentiuni.json, câte un fișier pe tip)
npm run import     # data/brain.db + media/uploads/; --overwrite-edits doar cu acord
npm start          # site-ul public din Brain pe http://localhost:3000 (scanează la pornire dacă e nevoie)
npm test           # testele din §5
```

## 6. Ce acoperă codul acum (față de standard)

| Partea | Unde | Stare |
|---|---|---|
| Registru, schemă, store, proveniență, import (§1) | `src/registry/`, `src/core/{db,store,content,import}.mjs`, `scripts/` | gata |
| Context urmărit, `page_deps`, `#layout:` (§3.1–3.2) | `src/site/context.mjs` | gata |
| `affected()`, `processEvents()`, reîncercări, `sync_log`, `scan()` (§3.4–3.5) | `src/core/sync.mjs` | gata |
| Site public: pagini compuse, pagini de serviciu, calculator, formular, 404 | `src/site/pages.mjs`, `src/site/static/` | gata |
| 301 automat spre entitate, fără lanțuri sau bucle (§3.8); înlocuirea media cu același ID și `?v=` (§3.9) | `src/core/store.mjs` | gata |
| `sitemap.xml`, `robots.txt`, JSON-LD (CleaningService, Service, FAQPage), CSP | `src/server.mjs`, `src/site/pages.mjs` | gata |
| Tick de cron `POST /api/manage/cron/tick` (§3.7) | `src/server.mjs` | gata (cheia vine din `CRON_KEY`) |
| Autentificare și drepturi (§1.9): scrypt, sesiuni `HttpOnly`, limită de încercări, roluri, aprobarea pe toate căile, verificarea `Origin` | `src/auth/auth.mjs`, `scripts/user.mjs` | gata |
| /manage: Panou (De făcut, propagare cu „Reia” și „de ce?”, aprobări, cereri), Entități cu taburile Prezentare / Detalii / Relații / Surse / Unde apare / Istoric, Harta, Surse, Legături de verificat, Utilizatori, Previzualizare | `src/manage/`, `src/core/{whereused,graph,inferred,todo}.mjs` | gata |
| SSE între utilizatori (§3.11) | `src/manage/api.mjs`, `GET /api/manage/events` | gata |
| Dubluri pe orice tip, după regula din registru, și unirea lor (§1.7) | `src/core/duplicates.mjs`, `store.merge` | gata |
| Biblioteca media (§3.9): încărcare cu tip verificat după conținut, fără dubluri (SHA-1), text alternativ propagat, înlocuire cu același ID, ștergerea blocată pentru fișierele folosite | `/manage/media/`, `store.{createMedia,updateMedia,replaceMedia,deleteMedia}` | gata |
| „Datele sunt corecte” (§1.8): amprenta versiunii publicate, care expiră singură | `src/core/validations.mjs` | gata |
| Teste din §5 | `test/` | toate, mai puțin 11 (valabilitate), care nu se aplică fiindcă Kurat nu are oferte cu termen |
| Copii de siguranță (§3.12): automat o dată pe zi (verificat la fiecare oră și la tick-ul de cron), manual din Setări, descărcare, restaurare dintr-o copie sau dintr-un fișier încărcat, cu eveniment global | `src/core/backup.mjs`, `src/lib/tar.mjs`, `/manage/setari/` | gata |
| De făcut | — | variante redimensionate ale imaginilor (cer o bibliotecă de procesare, deci o dependență); copiile se țin pe același disc cu baza, iar o copie în afara serverului cere o destinație (S3, alt server) |

**Homepage-ul:** se păstrează structura actuală. Prototipul cu comutator casă / firmă a fost abandonat (2026-10-26). Corecturile țintite:
- prețul final, cu TVA inclus, pentru persoane fizice, din cota confirmată în Date firmă;
- ratingul doar cu sursă Google confirmată;
- garanția dintr-o singură politică (Garanție);
- testimoniale cu persoana care vorbește;
- datele legale în subsol.

Fiecare apare singură pe site când datele sunt completate și confirmate. Până atunci, golurile se văd la `/manage/previzualizare/`.

**Copiile de siguranță:** se salvează în `data/backups/` (sau în `BACKUP_DIR`) ca `.tar.gz`, cu baza, fișierele media și un manifest cu amprentele. Se păstrează ultimele 14 automate, toate cele manuale și ultimele 5 făcute înainte de o restaurare. Restaurarea face întâi o copie a stării curente și nu atinge conturile și sesiunile.

**Primul administrator** (parola se generează și se afișează o singură dată):

```bash
node scripts/user.mjs add --email=adresa@kurat.ro --name="Nume" --role=admin
```

`BRAIN_DEV_LOGIN=1` intră fără parolă, doar de pe localhost (e setat în `.claude/launch.json` pentru dezvoltare). **Nu se setează în producție.**

**De știut:** pe homepage apar acum 3 carduri de servicii din 7. Celelalte 4 sunt legături deduse („Curățenie rezidențială”, „Post-construcție” ×2, „Birouri și spații comerciale”) și nu apar pe site până nu le confirmă un om (§1.5). Testul §5.9 arată că, odată confirmate, apar singure.
