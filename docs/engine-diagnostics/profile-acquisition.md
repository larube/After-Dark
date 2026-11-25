# Acquisition guidée par le profil

PR29 expérimente l’acquisition de candidats pour Sélection. Le classement, les exclusions, les politiques éditoriales et le Laboratoire restent ceux du moteur 1.6.0. Sélection conserve l’acquisition historique. Le comparateur exécute la variante sur des copies temporaires.

## Audit de l’acquisition historique

- Pour moi et les genres utilisent des flux de popularité récente, d’avis favorables par décennie et d’avis avec un plafond de votes. Toutes les quatre recherches, un flux pré-1970 ajoute jusqu’à deux fiches. Les pages 1 à 4 et les périodes sont déterminées par le numéro de séance global, y compris lorsque la catégorie change.
- Cultes interroge le répertoire par nombre de votes puis par note dans une période. Pépites combine faible popularité et bonnes évaluations dans une période, avec un minimum de votes. Ces deux catégories ignoraient les pays et les langues préférés et les sélections de plusieurs langues obligatoires. Une seule langue obligatoire et la durée maximale s’appliquaient déjà à tous les flux.
- Les résultats des pages sont entrelacés et dédupliqués par identifiant TMDB. Le cache des détails est valable 30 jours. Le budget fixe de 18 détails pouvait être consacré à des films déjà vus, refusés, bloqués ou récents. Les films manquant d’indices de pertinence, les incompatibilités éditoriales et les exclusions de contenu apparaissaient seulement au classement.
- Le client conserve son espacement de 250 ms, son délai réseau de cinq secondes, un maximum de trois détails concurrents et le délai de reprise fourni par HTTP 429. Les films en cache restent disponibles sans TMDB. L’import par identifiant fiable et le traitement des correspondances ambiguës restent communs aux deux stratégies.

## Variante

| Étape | Politique |
| --- | --- |
| Signaux | Identifiants de réalisateurs des crédits TMDB avec le rôle Director, et identifiants des mots-clés TMDB. On réutilise la valeur des signaux existants. Il faut au moins deux films associés à un signal positif, davantage de films positifs que négatifs et un soutien net d’au moins 1. |
| Thèmes | Le seuil de fréquence exclut les mots-clés figurant dans plus de 10 % des fiches renseignées. Les libellés génériques relevés lors des audits sont écartés de l’acquisition. Un recouvrement de Jaccard de 75 % des films sources positifs suffit à écarter un thème redondant. Les mots-clés du classement restent intacts. |
| Planification | Deux pages générales au départ. Un flux géographique éventuel et les flux personnalisés occupent les autres places disponibles. La variante parcourt un réalisateur et un mot-clé par séance au maximum, en alternant les sources lorsque la place manque. Chaque page personnalisée transmet jusqu’à quatre résultats. |
| Adaptation | Après le premier passage, jusqu’à neuf détails, le moteur mesure les admissibles après rotation. En dessous de 20, l’acquisition puise dans les pages de réserve et le solde du budget, toujours plafonné à six pages Discover et 18 détails. Le seuil correspond à deux sélections théoriques. Il reste distinct du quota de composition et de l’effet des rotations futures. |
| Persistance | Les identifiants de réalisateurs rejoignent le cache TMDB lors d’une récupération de détails avec crédits. Les anciennes fiches restent utilisables et se complètent au fil des rafraîchissements normaux. Il n’y a aucun rattrapage massif ni rapprochement par nom. |

[TMDB Discover Movie](https://developer.themoviedb.org/reference/discover-movie) propose `with_crew`, `with_keywords`, `with_genres`, `with_origin_country` et `with_original_language`. Les [crédits du film](https://developer.themoviedb.org/reference/movie-credits) permettent de vérifier le rôle de réalisateur. Un candidat issu exclusivement du flux réalisateur doit avoir un crédit de réalisation correspondant. Le pays d’origine de Discover oriente une partie de l’acquisition. Les pays de production des détails restent la source des contraintes strictes, y compris pour les coproductions. Les langues obligatoires passent avant les préférées sur le flux ciblé. Le filtre local reste appliqué à tous les résultats. Tous les flux des cinq catégories de genre conservent le filtre TMDB correspondant.

Les seuils de soutien, de fréquence et de recouvrement limitent le bruit de la recherche. Ils restent expérimentaux et n’encodent pas un degré de pertinence. Les principales limites sont la couverture historique des identifiants, la fréquence fondée sur le catalogue local et les différences de pagination entre catégories et flux.

## Comparer sur une base locale

```sh
npm run diagnose:acquisition -- \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-25 \
  --output "$(mktemp -d)/after-dark-acquisition" \
  --network
```

Sans `--network`, le rapport isole le vivier local et l’effet de la rotation. Avec `--network`, le client lit `tmdb.json` à côté de la base source ou la variable `AFTER_DARK_TMDB_READ_TOKEN` et envoie à TMDB les paramètres Discover et identifiants nécessaires. Le rapport reste local. `--criteria <json>` permet de réutiliser les mêmes contraintes pour les huit catégories.

La commande capture d’abord la base et son WAL, vérifie que la source est stable, puis crée une copie jetable pour chaque catégorie et chaque stratégie. Chaque bras simule six séances par défaut et écrit ses propres fiches et historiques uniquement dans sa copie. Utiliser `--sessions 2` pour reprendre le protocole initial de la PR29. Les valeurs de 1 à 20 sont acceptées. Les rapports Markdown et JSON sont créés hors du dépôt avec les permissions `0600`. Ils contiennent des titres et des signaux dérivés du profil. Les deux bras partagent le plafond de 18 détails par séance. À six séances et huit catégories, le plafond théorique cumulé est de 480 pages Discover et 1 728 détails. Le rapport distingue ce plafond des appels logiques réellement comptés. Le délai et la politique de reprise du client TMDB restent applicables. L’ancienne acquisition utilise deux à quatre pages Discover et la variante jusqu’à six en fonction du vivier. Le rapport publie les coûts réalisés et les durées.

Consulter séparément le rendement en nouveaux admissibles, le renouvellement, l’affinité des nouveaux films et le coût. Les deux bras partent avec les mêmes films pour leur première séance. Les catalogues et rotations divergent ensuite par construction. Le contrôle de la date et de l’instantané SQLite ne fige pas les résultats réseau ou la latence TMDB. Les tests simulés couvrent le déterminisme sur des réponses fixes.

## Lire le rapport long

Le JSON versionné `after-dark-acquisition-v2` contient les métriques cumulées et les différences de titres par séance. Les listes marquent les fiches déjà présentes au départ, les fiches ajoutées pendant la séance et celles acquises plus tôt dans le bras. Le rapport compte un candidat nouvellement admissible à la séance de son acquisition. Les répétitions comptent les propositions déjà apparues pendant la simulation. Un film peut réapparaître après avoir quitté la fenêtre des 30 propositions récentes. Le compteur des admissibles masqués par rotation est une somme par séance. La diversité cumulée est mesurée sur les films distincts de chaque ensemble. Les distributions séparent l’affinité des nouveaux candidats admissibles de celle des films proposés.

Le verdict par catégorie compare le volume de nouveaux admissibles, le nombre de propositions, les répétitions, les séances incomplètes et le nombre d’appels. Il signale un bénéfice lorsque ces mesures évoluent uniquement dans un sens favorable et une régression lorsqu’elles évoluent uniquement dans un sens défavorable. Il reste indécis en présence d’un compromis, d’un résultat identique, d’une panne ou d’une exécution sans appels. Les écarts de durée, les distributions d’affinité et la diversité complètent le verdict. L’affinité calculée ne mesure pas la satisfaction.

La comparaison alterne l’ordre des deux bras selon la catégorie. Les mêmes critères, le même instantané et la même date s’appliquent aux deux stratégies. Le budget de détail est identique. Le coût Discover peut différer car il fait partie de la stratégie testée. Les réponses réelles peuvent évoluer entre deux appels. Un cache sans crédits réalisateur ne permet pas d’isoler les effets du flux réalisateur. Les mesures sur un unique profil ne valident ni la pertinence utilisateur ni une activation générale.

## Comparer à plafond commun

La PR31 compare Pépites et Horreur sur le même instantané, aux plafonds de quatre et six pages. Quatre correspond au maximum historique. La référence garde ses sources habituelles et peut donc utiliser moins de pages que son plafond. Le nombre de détails est borné séparément, avec 18 par défaut. Un appel logique est compté à son lancement par la stratégie, y compris lorsque le client le refuse en période de limitation. Les requêtes HTTP et les appels logiques peuvent donc différer en cas d’erreur ou de quota.

```sh
audit="$(mktemp -d)"
npm run diagnose:acquisition -- \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-25 --output "$audit" \
  --categories gems,horror --pages 4,6 --details 18 --sessions 6 --network
```

Chaque plafond produit un rapport JSON v3 et un Markdown distincts à partir de la même copie initiale. Les mesures de coût utilisent les appels effectivement tentés. Le coût par titre acquis et proposé compte les films distincts. Le total des propositions acquises compte aussi leurs réapparitions. Les renouvellements par rapport à la séance précédente et les réapparitions depuis le début du bras ont leurs propres compteurs.

Pour les six catégories de contrôle, relancer sans `--network` avec `--categories personal,classics,comedy,thriller,drama,scifi --pages 4` et un nouveau dossier. Le contrôle hors ligne vérifie que le classement et la rotation restent identiques quand le vivier est commun. Les tests exploitent en plus un TMDB simulé avec réponses fixes, détail borné et refus HTTP 429. Un essai réel ne peut figer ni les réponses TMDB ni leurs latences.

## Évaluation qualitative à l’aveugle

```sh
questionnaire="$(mktemp -d)"
npm run diagnose:acquisition-blind -- \
  --report "$audit/acquisition-audit-pages-4.json" --output "$questionnaire"
```

Lire seulement `questionnaire.md` et remplir `reponses.json`. Les réponses peuvent être complétées en plusieurs fois. Le fichier caché `.cle-privee.json` contient la correspondance. La personne qui donne son avis doit éviter ce fichier et les rapports techniques avant la fin. Le masquage est prévu pour un protocole local coopératif. Une graine privée peut être fournie avec `--seed` pour reproduire le même ordre et la même attribution à partir du même rapport. Si elle est absente, la commande génère une graine aléatoire.

Le questionnaire inclut un seul vote par film. Les titres présents dans les deux bras sur n’importe quelle séance du rapport sont écartés, même si leurs rangs ou catégories diffèrent. Les groupes peuvent avoir des tailles différentes. Pour éviter les doubles votes en comparant plusieurs plafonds, utiliser un seul questionnaire comme évaluation principale. Le synopsis et les raisons proviennent de la sélection elle-même.

```sh
npm run diagnose:acquisition-blind -- --output "$questionnaire" --reveal
```

La révélation exige une réponse valide pour chaque fiche. Elle écrit un bilan par groupe et catégorie dans le dossier privé et laisse la décision d’activation à la revue humaine. Les réponses « Déjà vu » et « Informations insuffisantes » sont comptabilisées séparément. Les fichiers restent locaux et ne sont pas lus par l’application.
