# Hromadný import Lidl: SQLite / CSV → Setrik

Na stránce `/upload` je panel **Lidl: import jedním kliknutím**.

## Předpoklady
- Server musí mít `NEXT_PUBLIC_SUPABASE_URL` pro Supabase Setrik (`qeemacnpokbklmmyidet`) a `SUPABASE_SERVICE_ROLE_KEY`. Servisní klíč **nikdy** nevkládejte do prohlížeče.
- Nastavte v serverových proměnných prostředí `BULK_IMPORT_TOKEN` na dlouhou náhodnou hodnotu (jinou než Supabase service-role key). Zadejte ji do formuláře pro odeslání; do localStorage ani repozitáře se neukládá.
- Pro přímo nahrané soubory SQLite musí server poskytovat Node.js 22.13+ s vestavěným `node:sqlite` a zapisovatelným dočasným adresářem. Na Cloudflare Workers nemusí být `node:sqlite` a zápis na disk dostupný: v takovém nasazení použijte CSV, nebo před nasazením doplňte SQLite → CSV konverzi v prohlížeči / kompatibilním backendu.
- Horní limit souboru je 25 MB; limity hostingu mohou být přísnější.

## Formát
CSV: `product_id,nazev,znacka,baleni,cena,bezna_cena,klubova_cena,kategorie,podkategorie,strana,poradi,platnost_od,platnost_do,typ_nabidky,podminky,pdf_sha256,raw_json`.
Povinné jsou `product_id`, `nazev`, `cena`, `platnost_od` a `platnost_do`.
Vyžaduje se prefix `letak:lidl:` v `product_id`.
SQLite: existující export Setrik s tabulkami `letaky`, `letak_nabidky`, `produkty`. Importují se pouze schválené řádky ze záznamů, kde `letaky.obchod` je Lidl.

## Bezpečnost a duplicity
- Samostatný importní klíč je povinný, protože aktuální `requireOperatorApi` v aplikaci přístup **neověřuje**.
- Import se váže na konkrétní projekt Setrik; omyl v konfiguraci jiné databáze skončí chybou.
- Sjednocení shodných názvů, cen a platnosti odpovídá existujícímu indexu `offers_raw_import_identity_uidx` (NULLS NOT DISTINCT). Databázový konflikt nezpůsobí zdvojení.
- ID importu je odvozeno ze SHA letáku (nebo ze seznamu ID nabídky, chybí-li SHA). Opakovaný import téhož zdroje používá stejnou dávku a již zapsané řádky nepřepisuje.
- `imports` je vytvářeno před zápisem do `offers_raw`; při výpadku uprostřed dávky lze tentýž soubor importovat znovu, přičemž se již uložené řádky přeskočí.
- Import automaticky nepublikuje: `moderation_status=pending`.

## Ověření po nasazení
1. Nastavte proměnné a otevřete `/upload`.
2. Nahrajte CSV z původního exportu (214 zdrojových řádků).
3. Očekávaný výsledek na prázdné cílové dávce: 212 vloženo, 2 duplicitní řádky přeskočeny.
4. Nahrajte stejný soubor znovu: 0 nových záznamů.
5. Ověřte `/batches/<import_id>` a filtrem `import_id` v `public.offers_raw`.
6. Na kompatibilním Node hostingu ověřte také `.sqlite3` ze stejného exportu.

Žádná změna schématu Supabase není vyžadována.
