# Découvertes

La [PR 14](discovery-quality.md) documente la validation des lots enregistrés, le filtre partagé et les nouveaux diagnostics de `discovery-v3`.

Dans **Découvertes**, choisir une piste puis sélectionner **Explorer**. L’écran reprend la dernière exploration de chaque mode. **Explorer encore** demande une nouvelle sélection. Les actions sur les cartes utilisent les mêmes retours, séances et évaluations que « Ce soir » et « Ma collection ». Un film marqué vu ou écarté reste visible avec son nouvel état dans la sélection affichée. Il est retiré des prochaines sélections. L’action « Déjà vu » ouvre la notation facultative.

## Politique de sélection

Les trois modes lisent le même catalogue et le même profil local. Ils partagent `eligible()` avec « Ce soir », dont la politique classique de la PR 9A. Les films vus et les intentions explicites « Pas pour moi » sont exclus. Les réponses du Laboratoire restent indépendantes. Le profil continue d’utiliser ses évaluations historiques, y compris les demi-points, et les favoris. Les contenus ambigus et les fiches pauvres peuvent passer la politique de qualité.

Les contributions par trait viennent du modèle `current`. Pour le classement dans Découvertes, on additionne les réalisateurs, genres et pays avec les trois mots-clés les plus forts en valeur absolue, contributions négatives comprises. La somme est bornée à ±4 et notée **F** ci-dessous. Le moteur de « Ce soir » conserve sa formule. Les raisons de personnalisation citent des traits dont la contribution dépasse 0,08. Leur ordre tient compte de leur fréquence parmi les films admissibles. Les métadonnées sont descriptives et souvent incomplètes.

| Mode | Classement avant diversité et rotation |
| --- | --- |
| Les pépites | `0,6 × F + 2,2 × (1 − percentile)`. Le percentile ascendant TMDB est calculé parmi les films admissibles renseignés, avec le dernier rang en cas d’égalité. La popularité inconnue prend la valeur neutre de 0,5 pour le classement. Une pénalité de 0,9 réduit la priorité des affinités négatives. |
| Vos affinités | `F + 0,65 × E`. **E** additionne les contributions positives supérieures à 0,08, pondérées par `1 − 0,5 × fréquence relative`, avec un maximum de 2. Une pénalité de 0,9 réduit la priorité des films dont **F** ne dépasse pas 0,08. |
| Hors piste | `0,65 × min(F, 1,3) + 1,8 × D + 0,45 × N`. **D** divise le nombre de genres, pays et réalisateurs absents du profil par le nombre de traits disponibles, avec un dénominateur d’au moins 3. **N** vaut 1 si la décennie est connue et absente des films sources de signaux datés. Une pénalité de 0,9 réduit la priorité des affinités inférieures à −0,5. |

Un film sous −1 est classé après les candidats au-dessus de ce seuil, même si cela nécessite de réutiliser une proposition. Sans profil exploitable, la popularité relative, la diversité et la rotation restent utilisables. Il n’y a aucun bonus de distance si la fiche n’a pas de traits connus ou que le profil ne fournit aucun trait. La popularité TMDB est un repère relatif à l’instantané renseigné. Elle ne renseigne ni la qualité d’un film ni sa rareté historique.

### Diversification et renouvellement

La sélection gloutonne retient jusqu’à huit films distincts. L’étape suivante pénalise la plus forte ressemblance avec les films déjà retenus : genre commun (0,45), réalisateur commun (0,85), pays commun (0,45) et décennie identique connue (0,35). Ce total est multiplié par 0,73 pour Les pépites, 0,53 pour Vos affinités et 0,91 pour Hors piste. Les données manquantes ne créent aucune correspondance. Un film visible dans le dernier résultat d’un autre mode reçoit une pénalité de 0,48.

À chaque place, les candidats sont d’abord répartis par niveau de pertinence. **Vos affinités** privilégie un bilan supérieur à 0,08 accompagné d’au moins une contribution positive supérieure à 0,08, le seuil déjà utilisé pour justifier une proposition. **Les pépites** privilégie un bilan nul ou positif. **Hors piste** laisse les affinités modérément négatives concourir avec les films neutres et positifs. Dans tous les modes, un bilan inférieur à −1 reste un dernier recours.

Lorsqu’il existe des candidats dans l’historique récent, la rotation s’applique aux films du meilleur niveau encore disponible situés à 0,48 point ou moins du meilleur score ajusté à cette étape. Ce budget réutilise la pénalité de recouvrement entre modes : éviter une répétition dans un mode dispose de la même marge qu’éviter un doublon entre modes. La fenêtre tient compte de la diversité et du recouvrement, avant le départage par graine. Elle est recalculée à chaque place à mesure que les films sont retenus. Les inédits passent en premier dans cette fenêtre, suivis des films les plus anciens. Un candidat nettement meilleur reste donc sélectionnable même s’il vient d’être présenté.

À historique égal, le score ajusté et la variation issue du SHA-256 de la graine et de l’identifiant (0 à 0,32) départagent les films, puis le hachage et l’identifiant départagent les égalités résiduelles. Si aucun autre film n’entre dans la sélection, l’ordre courant est conservé et l’historique reste intact. Le protocole de découverte passe à `discovery-v2`. Les sélections précédentes restent lisibles et alimentent la rotation.

Le calcul parcourt les films pour construire les statistiques, trie les popularités connues, puis effectue jusqu’à huit passes gloutonnes sur les candidats. SQLite lit l’instantané dans une transaction et utilise un index par mode et par identifiant pour les recherches d’historique. Il conserve la date UTC, la version du protocole, la version moteur, la graine, les entrées de rotation, l’ordre des films et une empreinte SHA-256 des données lues. Le rejeu exact reste conditionné à la disponibilité de l’instantané correspondant. Ouvrir l’onglet ne demande que la lecture de l’exploration existante. Les requêtes en double utilisent l’identifiant de la sélection courante pour éviter une deuxième rotation.

La génération fonctionne hors ligne. L’écran utilise le cache d’affiches du processus principal et un remplacement visuel si le JPEG est absent. Aucun appel TMDB supplémentaire ne découle d’une exploration. Les données de consultation restent dans `discovery_explorations`.

## Comparaison sur une fixture fictive

```sh
node scripts/discovery-report.mjs > /tmp/discovery-fixture-report.json
```

Le [rapport JSON](discovery-fixture-report.json) utilise 42 fiches, un profil fictif, la date du 23 novembre 2026 et deux graines fixes. Les comparaisons initiales se font sans historique entre modes pour isoler le classement. Les 36 films admissibles incluent des films sans métadonnées complètes, des documentaires et des films d’animation. Les six exclusions couvrent deux films vus, un film écarté, un concert, un court et une sortie future.

| Mode | Genres | Pays | Réalisateurs | Décennies | Popularité médiane TMDB (min–max) | Affinité médiane (min–max) | Films renouvelés |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Les pépites | 4 | 4 | 6 | 4 | 6 (3–21) | 2,292 (0–4) | 6/8 |
| Vos affinités | 2 | 2 | 3 | 2 | 23,5 (10–28) | 4 (2,292–4) | 2/8 |
| Hors piste | 4 | 4 | 6 | 4 | 9 (4–23) | 0 (0–3,171) | 8/8 |

Les pépites et Vos affinités partagent deux titres. Hors piste partage un titre avec chacun des deux autres modes. La couverture cumulée est de 20 films sur 36 au premier passage, puis 28 sur 36 après un renouvellement dans chaque mode. Les 24 propositions initiales ont toutes une popularité renseignée. La fixture contient aussi une fiche sans popularité, admissible et couverte par les tests sur catalogue réduit.

- **Les pépites** choisit notamment *Les phares du nord 2*, dont la popularité TMDB est dans la moitié basse des films renseignés et qui partage des mots-clés associés aux retours positifs.
- **Vos affinités** privilégie notamment *Archives de brume 9*, porté par la réalisatrice Ariane Or et un mot-clé partagé avec un film apprécié. Plusieurs films du même ensemble restent en haut du classement, ce qui limite la variété de ce mode malgré la pénalité de ressemblance.
- **Hors piste** commence par *Les cartes sans bord 1*, qui apporte une réalisatrice et un genre absents du profil fictif. L’absence d’affinité identifiée est fréquente dans ce mode sur cette fixture.

Les genres, pays, périodes et réalisateurs sont corrélés par construction dans cette fixture. Les résultats vérifient que les stratégies se comportent différemment dans des conditions contrôlées. Il faudrait des catalogues et des profils plus variés, ainsi que des retours humains, pour évaluer la pertinence réelle. Les petits catalogues peuvent produire des listes identiques d’un mode à l’autre.


### Effet de la rotation

La version précédente plaçait les films inédits devant toutes les propositions de l’historique dès que leur affinité atteignait −1. Dans **Vos affinités**, cela pouvait promouvoir une fiche sans signal crédible. Dans **Les pépites**, la fraîcheur pouvait supplanter à la fois la popularité relative et l’affinité. Dans **Hors piste**, une affinité modérément négative pouvait l’emporter sur une piste beaucoup plus plausible par le seul effet de l’historique. Les tests construisent ces concurrences et contrôlent aussi le renouvellement entre candidats comparables. Le seuil de dernier recours pour les fortes affinités négatives existait déjà.

Mesures sur le même catalogue, le même profil, la même date et les mêmes graines. Le premier lot est identique sur cette fixture. Les distributions ci-dessous concernent le deuxième lot.

| Mode | Films renouvelés, v1 → v2 | Affinité médiane (min–max), v1 → v2 |
| --- | --- | --- |
| Les pépites | 8 → 6 | 2,058 (0–4) → 2,292 (0–4) |
| Vos affinités | 8 → 2 | 2,292 (1,824–3,171) → 4 (2,292–4) |
| Hors piste | 8 → 8 | 0 (0–3,171) → 0 (0–3,171) |

Le recouvrement après renouvellement passe de 1 à 3 titres entre Les pépites et Vos affinités, reste à 1 entre Les pépites et Hors piste, et passe de 1 à 0 entre Vos affinités et Hors piste. La couverture cumulée baisse de 30 à 28 films sur 36. Aucun des deux protocoles ne sélectionne de film à affinité négative sur cette fixture. Les tests ciblés couvrent le cas négatif absent de ces chiffres. La saturation à 4 masque des écarts dans Vos affinités et ce mode peut recycler davantage quand le profil est très concentré.

Pour reproduire la colonne v1, utiliser le domaine de la révision `3dcf93d` dans une copie de travail avec les dépendances installées et y exécuter le script de rapport de la présente révision. Le script utilise les mêmes entrées dans les deux copies.
