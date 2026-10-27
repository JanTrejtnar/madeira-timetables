# Ruční kontrola poloh zastávek

Přehled zastávek, jejichž poloha není ověřená a které je dobré zkontrolovat na mapě nebo v terénu.
Stav k commitu `186be18` (`data/missing-stops.json`: 2 zastávky bez souřadnic).
Souřadnice jsou WGS84 (lat, lon). Zdroj poloh: `data/stop-overrides.json`; po opravě spusť `npm run build:data` (a `npm run fetch:routes` + znovu `build:data`) a zastávku odstraň z tohoto dokumentu.

Typy polohy (`locationPrecision`): v aplikaci mají všechny kromě `exact` varovný štítek.

## 1. Zastávky bez GPS (2)

Aplikace u nich místo pinu ukazuje šedý štítek „Bez GPS polohy“ a nad seznamem upozornění.

| Zastávka | Linka | Směr | Předchozí → následující známá zastávka | Poznámka |
|---|---|---|---|---|
| **Fazenda** | 501 (Funchal – Boqueirão) | oba: Funchal → Boqueirão i zpět | Funchal (32.6472, -16.9061) ↔ Boqueirão (32.6906, -16.8333) | Úsek ~8 km. Odhady z obou směrů se rozcházejí o 4,6 km, v SIGA ani OSM zastávka tohoto jména není. Fazenda na lince 526 je jiné místo (vyřešeno, interpolace). |
| **Sant'Ana** | 725 (Água Pena) | Machico → Sant'Ana a Sant'Ana → Machico (varianta, 2 stopy) | Machico (32.7216, -16.7702) ↔ konec trasy | Jízdní řád SAM v Machicu. Konec trasy; v OSM/SIGA není místo tohoto jména v okolí. Není ověřeno, zda jde o „Capela de Santa Ana“. |

Co udělat: najít zastávku na mapě / v terénu a doplnit override do `data/stop-overrides.json` (nejlépe `manual_osm_match` na OSM uzel). Pak zastávka opustí `missing`.

## 2. `place_centroid` (5) – střed obce / bod zadaný ručně

Poloha je střed osady, **ne** nástupiště. Štítek v UI: „Not an official stop“.

| Zastávka | Linka | Souřadnice | Kde v obci leží / co zkontrolovat |
|---|---|---|---|
| **Maiata Baixo** | 208, 785 | 32.76689, -16.821417 | Střed osady Maiata Baixo; sousedé: P.Cruz, Cruz Guarda, Achada, Serra. Najít skutečné nástupiště mezi sousedními zastávkami. |
| **Fajã** | 218 | 32.713362, -17.160572 | Střed osady Fajã; sousedé: Rotunda Ledo ↔ Vila da Calheta. Zastávka by měla ležet na silnici mezi nimi. |
| **Porto da Cruz** (v datech též „P.Cruz“, „P. Cruz“, „Porto Cruz“ – sjednoceno, `scripts/lib-abbrev.mjs`) | 56, 208, 785, 825 | 32.7717386, -16.829496 | Bod zvolený správcem na mapy.com (OSM podklad), ~120 m od dřívějšího odhadu obce (32.7721, -16.828284). Nástupiště není ověřeno; na lince 208 sousedí Moinhos, Maroços, Maiata Baixo, Achada, Referta. |
| **Pastel** | 726 | 32.739309, -16.77493 | Střed osady Pastel; konečná, soused Machico. |
| **Lº Galego** | 56 | 32.773235, -16.874181 | OSM vesnice „Lombo do Galego“; sousedé: Faial ↔ Santana. |

## 3. Specifické odhady a interpolace

| Zastávka | Linka | Souřadnice | Typ | Kontext |
|---|---|---|---|---|
| **L. São João** | 146 | 32.701171, -17.116199 | `interpolated` | Střed úsečky mezi Achada a Canhas. Mezi nimi není nakreslená trasa (OSRM), takže nelze interpolovat po silnici. V SIGA/OSM nenalezena. Označeno „STRAIGHT-LINE MIDPOINT, NOT A SURVEYED STOP“. |
| **Socorro** | 146 | 32.7073696, -17.1281388 | `name_match` | Konečná. Zastávka SIGA 34560 (Capela do Socorro); v okruhu ~100 m je víc zastávek, vybraná je podle jména. Ověřit, kde staví autobus. |
| **Carvalhal** | 146 | 32.7041086, -17.1259217 | `name_match` | SIGA 34590 „Entrada CAM Carvalhal“ – nejbližší podle jména, ne potvrzená. Sousedé: Levada Poiso ↔ Socorro. |
| **Estreito (ESCOLA)** a „… – via CONTINENTE“ | 137 | 32.6720364, -16.9788224 | `name_match` | Škola v Estreito de Câmara de Lobos, SIGA 12973. Konečné stanice variant 0, 6, 8. |
| **Estreito (CONTINENTE)** | 137 | 32.669893, -16.977204 | `name_match` | SIGA 12901. Varianta 1. |
| **Castelejo** (Estreito (ESCOLA) – Castelejo; Castelejo – Ernesto; Ernesto-Castelejo) | 137 | 32.682016, -16.970259 | `name_match` | SIGA 12703 „ESTR Nova do Castelejo“, shodné s nepojmenovaným OSM uzlem 11486572120 (~100 m). Část „Ernesto“ se samostatně určit nedala (SIGA zastávky CAM do Ernesto leží o 1,4 km níž). Varianty 2, 3, 7. |
| **Corticeiras** (Estreito (ESCOLA) – Corticeiras) | 137 | 32.6848204, -16.9887962 | `name_match` | SIGA 13008. Varianta 4. |
| **Vargem / Caminho Ribeiro Real** (obě varianty) | 137 | 32.660264, -16.97172 | `name_match` | SIGA 10010. Použita 1 z 5 zastávek planneru v okolí (~300 m od sebe); ověřit, kde linka opravdu končí. Varianty 5, 9. |

Všechny varianty linky 137 mají v jízdním řádu jen dvě zastávky (Funchal + konec), takže špatná poloha konce posune celý nakreslený úsek.

## Ověření

- Po změně: `npm run build:data`, `npm run fetch:routes`, `npm run build:data`, pak `npm run verify`.
- Seznam bez poloh generuje `scripts/audit-stops.mjs` do `data/missing-stops.json`; sekce `estimated` tam obsahuje všechny odhadnuté polohy (včetně těch, které tu nejsou, např. `Rª Brava`).
