# Auditer les catégories de Sélection

L’audit compare les huit catégories sur une copie temporaire du même catalogue et du même profil. Il utilise le classement de Sélection 1.5.0, les mêmes exclusions et la même taille maximale de dix films. Les diagnostics consomment les traces de production, notamment les décisions éditoriales de Cultes et Pépites. Aucun accès réseau.

## Exécution locale

Depuis le dépôt, choisissez une date UTC de référence et un nouveau dossier privé hors du dépôt.

```sh
npm run diagnose:selection -- \
  --sqlite "$HOME/Library/Application Support/After Dark/after-dark.sqlite" \
  --date 2026-11-25 \
  --output "$HOME/after-dark-audit-2026-11-25"
```

La commande génère `selection-audit.md` et `selection-audit.json`. Ces fichiers contiennent des titres et des scores dérivés du profil. Gardez-les localement. Ils n’incluent ni les notes sources ni les secrets. La commande copie la base et son journal WAL, vérifie que la source n’a pas changé pendant la copie, puis ouvre la copie avec `PRAGMA query_only`. Si le contrôle détecte des écritures, quittez After Dark et réessayez. Les rapports existants sont protégés contre l’écrasement.

Les critères par défaut sont ceux d’une Sélection sans filtre. Pour tester des filtres communs aux huit catégories, fournissez `--criteria <fichier.json>`, avec par exemple `{"mood":"surprise","preferredCountries":["FR"],"requiredCountries":[],"preferredLanguages":["fr"],"requiredLanguages":[]}`. Les options `maxMinutes` et `avoid` sont acceptées. La catégorie est remplacée pour chaque simulation.

## Lecture du rapport

- La comparaison avec et sans les 30 dernières recommandations isole l’effet de rotation sur les mêmes entrées. La matrice indique le nombre de films communs à chaque paire de listes.
- L’admissibilité individuelle précède la limite d’exceptions de période et la diversification. Les exclusions peuvent se cumuler. Les statistiques de réputation et de popularité indiquent leur couverture.
- Pour moi est comparé à l’ancien appel de production `surprise` sur cet instantané, scores et étapes compris. La comparaison réutilise le moteur actuel comme prévu pour ce chemin de compatibilité.
- Cultes indique les films satisfaisant ses critères éditoriaux et le filtre général, puis écartés par une condition de période. Le volume de votes, la note et l’ancienneté constituent des indicateurs d’audience et d’appréciation. Pour évaluer le statut culturel des titres, une revue humaine est nécessaire.
- Pépites présente les candidats à un seul critère éditorial près et signale ceux qui échouent aussi au filtre général de pertinence. Le rang d’exposition est calculé avant rotation dans le vivier éligible renseigné. Une popularité inconnue reste visible comme donnée manquante.
- Les plans TMDB comparés proviennent de la même fonction que les requêtes en production. Pour Cultes et Pépites, les préférences souples de pays et de langue ne changent pas les requêtes. Seule une langue stricte unique est poussée à TMDB pour ces deux catégories. Le classement local applique ensuite les préférences et contraintes de production. Le plan seul ne mesure pas combien de films une acquisition différente aurait rapportés.

## Priorités d’évaluation

1. Recueillir d’abord des jugements d’intérêt à l’aveugle. Comparer en particulier l’intérêt pour les propositions de Cultes à celui pour Pour moi lorsque leurs affinités diffèrent. Ne retenir un ajustement de réputation qu’avec des retours favorables.
2. Examiner les listes courtes, les candidats proches des seuils de Pépites et les conflits de période. Distinguer manque de métadonnées, faible affinité et effet de rotation avant de modifier un seuil.
3. Évaluer le rappel de l’acquisition dans une expérience séparée si des filtres géographiques ou linguistiques laissent des viviers trop petits. Conserver les mêmes critères et séparer l’effet des nouveaux films de celui du classement.

Les résultats sur le profil réel sont générés localement. Les tests versionnés utilisent des films fictifs et couvrent la compatibilité, les exclusions, les effets de rotation, les plans d’acquisition et la lecture d’une base avec WAL.
