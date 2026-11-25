# Catégories de Sélection · PR25

## Audit et compatibilité

L'ancien champ `mood` pilote un bonus souple dans le score, un filtre d'acquisition TMDB et les diagnostics historiques. Certaines ambiances regroupent plusieurs genres. Par exemple, Tension couvre Thriller, Crime et Mystery. Le filtre « Ambiance à éviter » applique une pénalité aux indices correspondants. Le Laboratoire et ses archives utilisent ces mêmes ambiances. Le classement attribue aussi des étiquettes internes `safe`, `gem` et `wildcard` pour le contrat de réponse.

La Sélection transmet désormais `selectionCategory` et utilise `mood: "surprise"` pour conserver le classement personnalisé 1.5.0 sans bonus d'ambiance. `selectionCategory` est facultatif au niveau des critères afin de relire les requêtes et diagnostics historiques. Les nouvelles séances enregistrent ce champ dans le JSON existant, avec `atmosphere: "surprise"` pour les lecteurs historiques. Aucune migration ni réécriture d'historique. Le contrat de démarrage du Laboratoire reste celui des anciennes ambiances. Les étiquettes internes et « Ambiance à éviter » gardent leur sémantique, y compris lorsque l'utilisateur choisit un genre proche de l'ambiance qu'il évite.

## Politiques vérifiables

Toutes les catégories réutilisent le profil, le filtre de qualité, les franchises bloquées, les refus, l'exclusion des films déjà vus, la rotation récente et la diversité. La taille reste au maximum de dix. Les filtres de genre s'appliquent au vivier du catalogue après acquisition et ne retirent aucun film des signaux d'apprentissage.

| Catégorie | Admissibilité supplémentaire | Classement |
| --- | --- | --- |
| Pour moi | Aucune | Score de production identique à Surprise à entrées égales |
| Comédie, Thriller, Drame, Horreur, SF / Fantastique | Identifiants TMDB 35, 53, 18, 27, 878 ou 14 selon la tuile. Les libellés français ou anglais normalisés permettent aussi de reconnaître les fiches locales. | Score personnalisé parmi les films du genre. Crime et Mystery seuls ne suffisent pas pour Thriller. |
| Cultes | Sortie remontant à au moins dix ans à la précision de l'année, au moins 50 votes TMDB et contribution de réputation d'au moins 1,5. | Le score personnalisé conserve ses contributions. On y ajoute la réputation ajustée pour mettre en avant les films de répertoire solidement étayés. |
| Pépites | Au moins 50 votes, contribution de réputation positive, affinité nette d'au moins 1 et popularité strictement inférieure à celle d'au moins la moitié des candidats renseignés. | Le score personnalisé reçoit la fraction du vivier renseigné strictement plus populaire, entre 0,5 et moins de 1 point pour les candidats admis. Les ex æquo de popularité ont le même rang d'exposition. |

Les seuils de 50 votes, 1,5 en réputation et 1 en affinité réutilisent les repères du moteur. Les 50 votes correspondent à la force du rappel vers la moyenne de référence de 6,5. L'ajustement est `clamp(1,5 × (moyenne − 6,5) × votes / (votes + 50), −3, 3)`. Le seuil d'une décennie donne un délai de recul explicite pour la programmation de répertoire. Il reste à évaluer avec des sélections réelles. Le rang relatif de Pépites évite un seuil absolu sur l'échelle TMDB et borne le gain en dessous d'un point, soit moins que les 1,6 points apportés par une unité d'affinité. L'exposition se calcule avant le retrait des recommandations récentes pour qu'une simple rotation ne déplace pas la médiane.

Les sources TMDB ciblent chaque genre dans tous les flux. Cultes combine un flux par volume d'avis et un flux par moyenne sur des périodes tournantes. Pépites combine un flux par popularité croissante avec un flux par moyenne et volume de votes modéré. La vérification finale utilise toujours les métadonnées locales et le budget habituel de récupération des fiches. [TMDB Discover](https://developer.themoviedb.org/reference/discover-movie)

## Interprétation et limites

« Cultes » désigne ici une sélection de répertoire fondée sur l'ancienneté et une réputation communautaire étayée. TMDB ne mesure pas la diffusion culturelle ni le statut culte. Pour « Pépites », la popularité reflète notamment l'activité des membres de TMDB et l'âge du film. Elle peut varier et ne mesure ni la rareté réelle ni la valeur artistique. [TMDB Popularity & Trending](https://developer.themoviedb.org/docs/popularity-and-trending)

Les fiches lacunaires peuvent rester admissibles dans « Pour moi ». Elles peuvent manquer des preuves requises pour d'autres catégories. Un profil peu renseigné peut donc recevoir peu ou pas de « Pépites ». La Sélection annonce les résultats courts et les cas sans film admissible. Elle ne complète pas avec des films hors catégorie.

Les diagnostics de séance indiquent la catégorie demandée, les exclusions de genre ou de preuve, la contribution au score et, pour Pépites, la popularité disponible ainsi que le rang d'exposition. Les comparaisons avec la réputation masquée rendent par construction Cultes et Pépites inadmissibles. Ce résultat indique une dépendance à la couverture, sans mesurer la satisfaction.

## Vérification reproductible

`npm run test -- tests/selection-categories.test.ts tests/renderer.test.ts`

Sur la fixture fictive, le `Film 1` de 1995 se qualifie pour Cultes avec 8,5/10 sur 300 votes. Le `Film 2` de 2024 se qualifie pour Pépites grâce à ses associations avec les évaluations du profil, à sa réputation étayée et à sa popularité au-dessous de celle de 60 % du vivier renseigné. Le `Film 3`, encore moins exposé et noté 10/10 par une seule personne, ne se qualifie pour aucun des deux. La fixture vérifie également le filtrage des genres, l'identité de Pour moi avec Surprise, les exclusions et l'épuisement par rotation.
