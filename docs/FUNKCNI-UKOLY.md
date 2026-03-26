# Funkční úkoly — Letáky Lidl (staging)

Tento dokument je **zdroj pravdy** pro to, co má aplikace umět. Po každé větší úpravě spusť **`npm run verify`** (lint + test parseru + build). Pokud něco spadne, oprav to před další změnou.

---

## Automatická kontrola (musí projít)

| Příkaz | Očekávání |
|--------|-----------|
| `npm run verify` | `lint` bez chyb, `test:parser` vypíše `verify-parser: OK`, `build` dokončí bez chyby |
| `npm run lint` | 0 errors |
| `npm run test:parser` | `verify-parser: OK` |
| `npm run build` | Next.js build úspěšný |

**Manuální smoke test (po změnách UI):**

1. `cd leaflet-review-app` → `npm run dev`
2. `http://localhost:3000` — načte se úvod
3. `/upload` — výběr **PDF** nebo **obrázku** → Pokračovat ke kontrole
4. `/review` — u PDF: přepínač stran, náhled vykreslený z PDF, **Extrahovat tuto stránku** (vyžaduje `OPENAI_API_KEY`; worker pdf.js načítá z CDN unpkg)
5. `http://localhost:3000/mockup.html` — statický náhled toku PDF → stránky → výstup

---

## Seznam funkcí (plán vs stav)

Legenda: **hotovo** | **částečně** | **chybí**

### Tok souboru a UI

| # | Funkce | Stav | Funkční test |
|---|--------|------|--------------|
| F1 | Nahrát PDF nebo obrázek (drag & drop + dialog) | hotovo | Na `/upload` vyber soubor → zobrazí se název + náhled (PDF iframe / obrázek img) |
| F2 | Volitelný odkaz na leták (`sourceUrl`) + přenos do kontroly | hotovo | Zadej URL na uploadu → na `/review` je vidět pole + odkaz „Otevřít“ |
| F3 | Výběr obchodu (Lidl/…) v kontextu | hotovo | Změna selectu na `/upload` přetrvá (stejný provider) |
| F4 | Přechod Upload → Review se zachovaným náhledem | hotovo | Po nahrání → Pokračovat → `/review` ukáže stejný soubor |
| F5 | Statický UI mockup (`/mockup.html`) | hotovo | Otevři `/mockup.html` — layout indigo + sidebar |

### Extrakce a API

| # | Funkce | Stav | Funkční test |
|---|--------|------|--------------|
| F6 | POST `/api/parse-lidl-page` — obrázek + metadata | hotovo | multipart `file` + `page_no`; bez `OPENAI_API_KEY` → 503 |
| F7 | Striktní JSON → validace `parseLidlPageOffersJson` | hotovo | `npm run test:parser` |
| F8 | Zobrazení výsledků v tabulce na `/review` | hotovo | Po úspěchu API → tabulka řádků |
| F9 | PDF → vykreslení stránky (pdf.js) → PNG → stejné API | hotovo | Nahraj PDF → `/review` změň číslo stránky → náhled PNG + extrakce projde (s klíčem) |
| F10 | Dávky / seznam importů (`/batches`) | částečně | Migrace `supabase/migrations/…`, stránka čte `import_batches` přes service role; bez env jen prázdný stav + návod |

### Databáze a schválení

| # | Funkce | Stav | Funkční test |
|---|--------|------|--------------|
| F11 | Uložení do `offers_staging` (Supabase) | chybí | Žádný zápis z UI |
| F12 | Checkbox / úprava / zamítnutí řádků | chybí | — |
| F13 | Odeslání schválených do `imports` / `offers_raw` | chybí | Tlačítko v UI není napojené |
| F14 | RLS / migrace v produkci | chybí | Migrační soubory v repu nemusí být nasazené |

---

## Počet

- **Hotovo v UI+API:** F1–F9, F5 → **10 funkcí**.
- **Částečně / chybí:** F10 (UI + SQL hotovo, zápis z uploadu ještě ne), F11–F14.

Číslo není „slib“ — slouží k tomu, aby se po každé úpravě neztratil rozsah. Při přidání feature sem dopiš řádek a test.

---

## Pravidlo pro úpravy kódu

1. Spusť **`npm run verify`** před commitem / před hlášením „hotovo“.
2. Pokud něco z UI přestane fungovat, **vracej změny**, dokud F1–F4 a manuální krok 4 neprojdou.
3. Nepřidávej nové „vylepšení“, dokud verify neprojde.
