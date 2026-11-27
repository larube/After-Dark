# PR36 — Composition temporelle et géographique

## Causes observées

Instantané local du 27 novembre 2026, 1 488 films et 165 sources de signaux, hors ligne. Le catalogue contient 206 films d’avant 1980 (13,8 %), dont 133 des années 1970, et 28 productions incluant l’Inde (1,9 %). Cent fiches n’ont pas de pays connu.

| Catégorie, premier tour | Vivier après rotation | Avant 1980 / Inde, vivier | Avant 1980 / Inde, dix meilleurs scores admissibles | Avant 1980 / Inde, sélection 1.7 |
| --- | ---: | ---: | ---: | ---: |
| Pour moi | 261 | 26 / 9 | 1 / 2 | 1 / 2 |
| Cultes | 165 | 51 / 1 | 3 / 0 | 3 / 0 |
| Pépites | 31 | 6 / 5 | 2 / 3 | 1 / 3 |
| Thriller | 40 | 1 / 3 | 0 / 2 | 0 / 2 |
| Drame | 153 | 19 / 7 | 0 / 1 | 1 / 1 |
| Horreur | 11 | 0 / 0 | 0 / 0 | 0 / 0 |

Cultes concentre déjà les films anciens à l’admissibilité, conformément à son rôle de répertoire. Pépites concentre les productions incluant l’Inde d’abord à l’admissibilité (5 sur 31), puis dans les meilleurs scores (3 sur 10). La diversification existante ne réduit pas cette concentration au premier tour. Pour moi reste à un film d’avant 1980 par tour dans l’ancien rejeu. Ces résultats n’établissent pas une surreprésentation temporelle uniforme.

Les traces réseau PR31 du 25 novembre, à quatre pages maximum, ont été rapprochées du catalogue actuel. Dans Pépites, 121 des 139 IDs distincts de baseline et 138 des 183 de profile ont une correspondance locale. Parmi ces correspondances, 15 et 30 datent d’avant 1980, et chaque bras contient une production incluant l’Inde. En Horreur, les correspondances sont 86 sur 140 et 90 sur 152, dont 12 et 13 antérieures à 1980, avec une production incluant l’Inde par bras. La fraction non appariée et les dates différentes empêchent d’attribuer la concentration à une acquisition actuelle. Les exports de séances futures montrent désormais les pays à chaque étape mesurée. L’acquisition reste identique, y compris en cas de vivier épuisé hors ligne.

## Politique 1.8.0

La composition intervient après l’admissibilité, la rotation et le calcul des scores de l’étape. Le meilleur film conserve la vedette. Pour les suivants, les comparaisons sont limitées à un écart de 0,35 point avec le premier, soit le coût déjà admis par le moteur pour une répétition de décennie. Ce budget borne chaque substitution locale, sans garantie de borne cumulative sur les étapes suivantes.

- À partir de deux films d’avant 1980, un candidat ancien en tête cède la place à un film de 1980 ou plus récent si l’écart est dans cette marge. Une date inconnue ne peut pas servir à atteindre cette préférence. Un candidat nettement mieux classé ou sans alternative comparable reste sélectionnable. Les règles antérieures à 1970 déjà en place et l’exception éditoriale de Cultes restent en vigueur.
- La concentration se mesure en équivalents-films. Chaque film répartit une voix entre ses pays de production distincts. À partir de deux équivalents pour un pays, la sélection préfère un candidat comparable qui ajoute moins de concentration. Ce repère de composition (un cinquième d’une liste complète pour une production à un seul pays) déclenche un arbitrage et peut être dépassé. Les pays exprimés comme préférés ou obligatoires sont exemptés. Un pays inconnu ne peut pas apporter de gain géographique. L’arbitrage géographique ne remplace pas un film moderne par un film d’avant 1980.
- La règle s’applique à Sélection avec les deux stratégies d’acquisition. Les autres appels au moteur gardent leur politique, y compris le Laboratoire et les rejeux historiques. Aucun pays particulier n’intervient dans la règle.

## Rejeu comparatif

Six tours par catégorie, même catalogue, mêmes signaux et même historique de départ. Le rapport compare aussi chaque tour avec un historique identique entre bras afin d’isoler la décision de composition. Les sorties personnelles avec les titres, scores et contributions restent hors du dépôt.

| Catégorie | Propositions avant → après | Avant 1980 avant → après | Inde avant → après | Affinité moyenne avant → après |
| --- | ---: | ---: | ---: | ---: |
| Pour moi | 60 → 60 | 6 → 6 | 7 → 7 | 1,51 → 1,50 |
| Cultes | 60 → 60 | 12 → 10 | 1 → 1 | 0,92 → 0,89 |
| Pépites | 51 → 51 | 9 → 9 | 9 → 7 | 1,20 → 1,18 |
| Thriller | 60 → 60 | 3 → 3 | 6 → 6 | 1,19 → 1,17 |
| Drame | 60 → 60 | 6 → 6 | 4 → 5 | 1,42 → 1,42 |
| Horreur | 12 → 12 | 0 → 0 | 0 → 0 | 1,05 → 1,05 |

Au premier tour Pépites, à historique identique, les productions incluant l’Inde passent de trois à deux. Au troisième, les films d’avant 1980 passent de trois à deux. Au quatrième tour indépendant, le vivier ne contient que sept films et permet quatre films anciens. Drame illustre aussi l’effet des trajectoires de rotation. Ces résultats ne mesurent pas la satisfaction de visionnage.

## Reproduction

```sh
npm run diagnose:selection -- --sqlite "<base>" --date 2026-11-27 \
  --output "/tmp/after-dark-composition" --composition
```

Utiliser éventuellement `--criteria <fichier-json>` et `--acquisition-report <rapport-acquisition-json>`. Le diagnostic copie SQLite et son WAL, puis travaille en lecture seule. Il n’effectue aucun appel distant. Le dossier de sortie doit être hors du dépôt et les deux fichiers de rapport doivent y être absents.
