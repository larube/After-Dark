# Affinités personnelles v2

**Décision de la PR 9B** — conserver le modèle A dans l’application, avec le moteur 1.2.0 et la politique de candidats classique de la PR 9A. B, C et D sont disponibles dans le diagnostic. C mérite une validation sur un autre échantillon. D apporte le meilleur rang de base médian sur l’instantané privé principal, avec des pertes de diversité et sans gain dans les cinq propositions.

## Hypothèses et calculs

Une fiche riche peut cumuler beaucoup de contributions modestes. Une caractéristique très répandue peut aussi distinguer peu de films. Enfin, une appréciation négative isolée peut refléter la réaction à un film précis. Les paramètres ci-dessous définissent des expériences de sensibilité. Ils sont communs aux deux instantanés privés et à la fixture, sans recherche de paramètres par maximisation du holdout.

### Profil partagé

- Une note numérique `r` donne `(r − 6) / 4` à partir de 6 et `(r − 6) / 6` en dessous. Ainsi, 8,5 donne 0,625 et 0 donne −1. L’échelle qualitative ordonnée existante reste distincte de la note sur 10. « Détesté », « bof », « bien », « beaucoup aimé » et « adoré » valent respectivement −1, −0,65, 0,25, 0,7 et 1. Le moteur associe uniquement les libellés reconnus des évaluations qualitatives structurées. Les commentaires libres ne font pas partie des entrées.
- Pour chaque film source, le moteur fait la moyenne de ses votes disponibles, puis ajoute 0,45 s’il figure dans les favoris spontanés, 0,25 s’il est mémorable et 0,20 pour une envie de revoir. Un favori peut donc contribuer sans note. Un film sans vote reconnu ni favori n’apporte aucun signal. Les évaluations numériques historiques et manuelles ont le même rôle dans ce calcul. Les plages historiques gardent leur milieu exact. SQLite conserve séparément leur provenance et leurs valeurs originales.
- Chaque trait normalisé est compté une fois par film source, dans sa famille. Par trait, le profil retient la somme `S` des votes de films, leur nombre `n` et, pour les variantes, le nombre `n−` de votes de films strictement négatifs. Cela regroupe les évaluations successives d’un même film avant de compter les occurrences. Les poids `w` sont 2,5 pour un réalisateur, 1 pour un genre, 0,7 pour un pays et 1,4 pour un mot-clé. La langue relève des critères de séance.

### Variantes

Pour un trait présent chez le candidat et dans le profil, sa contribution de référence est `T = w × S / (n + 1)`. Les traits absents du profil contribuent zéro. Chaque modèle somme les contributions signées puis borne le résultat à [−4, +4].

| Modèle | Contribution par trait |
| --- | --- |
| A · actuel | `T` |
| B · normalisé | `T × L × P` |
| C · rareté | `T × R × P` |
| D · hybride | `T × L × R × P` |

- `L = 1 / sqrt(max(1, k / b))`. `k` compte les traits distincts renseignés pour cette famille chez le candidat, y compris ceux sans correspondance. Le budget `b` vaut 3 pour les mots-clés et 1 pour les autres familles. Le facteur est au plus 1. Une fiche pauvre n’obtient ni bonus ni trait imputé. Une liste de mots-clés longue cumule encore des contributions, mais moins vite.
- `R = ln((N + 2) / (df + 1)) / ln(N + 2) × df / (df + 2)`. `N` compte les films de l’instantané et `df` les films où le trait apparaît, une fois par film. Le premier facteur atténue les traits fréquents. Le second limite le poids des très rares, avec un coefficient de 1/3 pour un trait unique avant le facteur logarithmique. La rareté est calculée sans note, favori, statut ni exclusion. Elle peut donc inclure les métadonnées statiques des cibles du holdout. Ces statistiques supposent un catalogue fermé connu. Elles ne mesurent pas la fréquence dans l’ensemble du cinéma.
- Pour une contribution nette négative, `P = n− / (n− + 2)`. Sinon `P = 1`. Un seul vote de film négatif conserve un tiers de sa contribution nette et trois en conservent trois cinquièmes. Les votes contradictoires se compensent déjà dans `S`. Un trait partagé reste une corrélation dans le profil, sans information sur la raison de l’appréciation. Les contrastes A–B et A–C incluent ce changement du traitement des négatifs. D–C isole l’ajout de la normalisation et D–B celui de la rareté.

`src/domain/affinity.ts` extrait les traits, construit le profil et calcule les contributions. `recommendation.ts` consomme le même calcul pour l’application et le diagnostic. Le score de base ajoute `1,6 × affinité` aux contributions de l’humeur, des préférences et autres critères PR 8. Valeur sûre ajoute encore l’affinité et Wildcard retire `0,6 × max(0, affinité)`. Pépite garde son bonus d’exploration. La pénalité de diversité reste fondée sur le recouvrement des traits et la langue des propositions déjà sélectionnées. Modifier l’affinité change donc à la fois le rang initial et les possibilités de sélection après diversification.

## Protocole

- Les onze scénarios PR 8 partagent, au sein d’un rapport, catalogue, métadonnées, signaux, historique, critères, date UTC et politique PR 9A. L’empreinte couvre ces entrées et le protocole de holdout. Le rapport JSON contient chaque rang, la décomposition complète de l’affinité, les sélections, leurs recouvrements deux à deux et les mesures de diversité PR 8.
- Le holdout PR 8 retient une cible lorsque la moyenne de ses notes numériques est ≥ 8. Les demi-points restent exacts. Cinq plis déterministes par hachage d’identifiant, ou moins s’il y a moins de cibles, utilisent le mode Surprends-moi. Chaque pli retire des signaux personnels **toutes** les évaluations et tous les favoris des cibles. Il neutralise le statut vu et la présence dans l’historique récent pour elles seules. Les autres exclusions restent applicables.
- Recall@5 et NDCG@5 binaires sont moyennés par pli et concernent les cinq propositions finales. Les cibles exclues restent au dénominateur et la couverture est rapportée séparément. Le rang de base précède les bonus de catégorie et la diversité. Une cible absente a un rang nul dans le JSON et est omise des statistiques de rang. Les candidats sans note ne fournissent aucun jugement de pertinence. Une recommandation non étiquetée ne constitue donc pas un échec démontré.
- Les baselines naïves ordonnent le même pool par identifiant croissant, par hachage d’identifiant avec un sel distinct du découpage, ou par popularité TMDB décroissante avec métadonnées manquantes en dernier. Elles utilisent directement leur top 5. Elles servent de repères sans dispositions éditoriales.
- Les ex æquo sont comptés comme nombre de candidats moins nombre de valeurs d’affinité distinctes, à précision complète. Un mot-clé est dit fréquent dans le rapport s’il apparaît dans ≥ 5 % du catalogue. Sa part rapporte la somme absolue des contributions de ces mots-clés à celle de tous les traits, avant plafonnement. Ce seuil décrit l’instantané et ne participe pas au calcul d’affinité.

## Instantanés privés — résultats mesurés

La base locale a été lue hors ligne par copie SQLite, avec la date UTC du 23 novembre 2026. L’instantané de 478 films de la PR 9A n’était disponible que sous forme de rapports, sans la totalité des métadonnées et signaux nécessaires pour le rejouer. L’instantané principal utilisable comptait **514 films**, 136 sources personnelles, 340 candidats admissibles avant historique et **328 après historique** pour Surprends-moi. A a été recalculé sur les mêmes entrées que B, C et D. Les 14 cibles ont toutes été admissibles. Les plis ont utilisé 133–134 signaux d’apprentissage et classé 330–331 candidats chacun.

| Modèle | Au plafond +4 sur 328 | Ex æquo | Au plafond parmi les 30 propositions | Recall@5 | NDCG@5 | Rang de base médian |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A · actuel | 178 (54,3 %) | 209 | 29 | 0 | 0 | 72,5 |
| B · normalisé | 72 (22,0 %) | 100 | 23 | 0 | 0 | 49 |
| C · rareté | 35 (10,7 %) | 64 | 21 | 0,100 | 0,077 | 34 |
| D · hybride | 1 (0,3 %) | 28 | 5 | 0 | 0 | 25,5 |
| Identifiant | — | — | — | 0,933 | 0,953 | 2 |
| Hachage d’identifiant | — | — | — | 0,067 | 0,040 | 126,5 |
| Popularité TMDB | — | — | — | 0 | 0 | 141,5 |

Le plafond porte sur Surprends-moi, sauf la colonne des 30 propositions qui couvre les six humeurs. Aucun candidat n’atteint −4. Quantiles bruts min / Q1 / médiane / Q3 / max et moyennes positives par famille pour Surprends-moi.

| Modèle | Quantiles d’affinité brute | Réalis. | Genres | Pays | Mots-clés | Part des mots-clés fréquents |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | 0 / 1,92 / 4,36 / 7,26 / 23,53 | 0,089 | 1,532 | 0,600 | 2,834 | 8,7 % |
| B | 0 / 1,33 / 2,68 / 3,83 / 11,04 | 0,089 | 0,912 | 0,487 | 1,253 | 7,3 % |
| C | 0 / 0,51 / 1,51 / 2,89 / 10,52 | 0,041 | 0,404 | 0,147 | 1,337 | 8,6 % |
| D | 0 / 0,35 / 0,91 / 1,40 / 4,80 | 0,041 | 0,237 | 0,114 | 0,591 | 7,6 % |

Six mots-clés franchissent le seuil de 5 %. Les mots-clés cumulés constituent la première famille en contribution positive dans les quatre modèles, malgré le poids unitaire plus élevé des réalisateurs. La rareté réduit leur contribution absolue et réduit encore davantage les genres et pays en proportion. Dans A, la médiane brute dépasse déjà +4. Des films dont la somme brute atteint 23,53 reçoivent donc la même affinité finale que ceux à 4. Le JSON conserve la ventilation négative séparément.

| Modèle | Films partagés par paire d’humeurs, moyenne sur 15 paires | Genres distincts | Réalisateurs distincts | Pays distincts | Langues distinctes | Écart moyen de rang face à A, Surprends-moi |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 0,20 | 8,33 | 5,33 | 7,50 | 3,67 | 0 |
| B | 0,47 | 8,17 | 5,00 | 8,00 | 3,50 | 35,3 |
| C | 0,20 | 8,33 | 5,33 | 9,50 | 3,33 | 39,0 |
| D | 0,93 | 7,50 | 4,83 | 8,00 | 2,83 | 47,8 |

Les dimensions de diversité sont des moyennes par sélection de cinq sur les six humeurs. Le nombre de films partagés avec A dans une même humeur varie de 1 à 4 pour B, et de 0 à 4 pour C et D. Les filtres font varier la taille des pools. Les résultats individuels des cinq scénarios filtrés et les recouvrements de traits entre propositions figurent aussi dans le JSON.

Une première copie du catalogue courant comptait 496 films. Elle donne une vérification de sensibilité avec des entrées différentes, hors comparaison directe avec la copie de 514 films. A plafonnait pour 163 candidats sur 311 (52,4 %). Les 13 cibles restaient toutes admissibles. Recall@5 vaut 0,10 pour A, C et D, et 0 pour B. Les mêmes rangs médians suivent l’ordre A, B, C, D avec 66, 60, 37 et 13. Les deux copies se recouvrent largement.

## Fixture fictive — reproduction

```sh
npm run diagnose -- --input docs/engine-diagnostics/fixture.json \
  --output "$(mktemp -d)" --reference-date 2026-11-23 --compare-affinity
```

La fixture comporte 18 films, 7 signaux personnels, 10 candidats après historique et 5 cibles admissibles sur 5. Son empreinte d’expérience est `b01223c82794fb52a459ccd2ea42ca1466d75664f956f60d66b0d83e0115d0bb`.

| Modèle | Affinité médiane Surprends-moi | Au plafond | Recall@5 | NDCG@5 | Rang de base médian |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 2,366 | 0 | 0 | 0 | 10 |
| B | 2,366 | 0 | 0 | 0 | 10 |
| C | 0,723 | 0 | 0 | 0 | 9 |
| D | 0,723 | 0 | 0,200 | 0,086 | 8 |
| Identifiant | — | — | 0,800 | 0,800 | 1 |
| Hachage d’identifiant | — | — | 0,800 | 0,726 | 1 |
| Popularité TMDB | — | — | 0,800 | 0,490 | 4 |

`--compare-affinity` crée `affinity-comparison.json` en plus du rapport habituel. Ajouter `--affinity rarity`, par exemple, donne le rapport détaillé HTML et JSON de C. Utiliser un dossier de sortie distinct par exécution. Pour le profil réel, remplacer `--input` par `--sqlite <chemin-local>` et utiliser un dossier privé hors du dépôt. Le diagnostic lit une copie SQLite avec son WAL si présent, sans réseau ni écriture dans la source. Seuls les résultats agrégés sont consignés ici.

## Interprétation et suite

- **Observé** — C relève le rang médian et fait entrer une cible dans les cinq propositions sur l’instantané principal, à couverture égale. D améliore encore le rang médian et réduit les ex æquo, avec des sélections plus répétitives entre humeurs et moins de langues et genres distincts. La fixture favorise D dans le top 5, avec une seule cible retrouvée sur cinq.
- **Limites** — Une sélection de cibles tirées des films déjà évalués est biaisée par les occasions de visionnage. Le niveau très élevé du tri par identifiant révèle une association entre les cibles et les petits identifiants, compatible avec l’ordre d’ajout ou d’import. Le tri par hachage, découplé de cet ordre, trouve lui aussi une cible sur l’instantané principal. Quatorze cibles sur un seul profil, deux instantanés fortement recouvrants et une petite fixture ne permettent ni de départager solidement les variantes ni de prévoir la satisfaction.
- **Hypothèse à tester** — Une atténuation par fréquence peut aider à retrouver des traits plus discriminants. Le gain de C dans les cinq propositions doit se reproduire sur des observations indépendantes, idéalement avec des jugements explicites après recommandation et une vérification à l’aveugle du recouvrement et de la diversité. Les paramètres de cette PR peuvent rester figés pour ce test. Les résultats disponibles justifient de conserver A en production.
