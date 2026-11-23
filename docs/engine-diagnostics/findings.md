# Constats pour la PR 9

## Mesuré sur le jeu fictif

- 18 films, dont 7 marqués vus et 7 films sources de signaux. Sans filtre strict, 11 films passent l’éligibilité. L’historique en retire un à cette étape. Il contient aussi un film déjà vu, compté dans les deux causes.
- 15 films ont une popularité TMDB fictive. La médiane est 9. Selon l’humeur, 2 ou 3 films proposés sur 5 sont strictement sous cette médiane.
- Les six sélections par humeur couvrent chacune de 7 à 9 genres distincts. La sélection sous contraintes combinées compte 5 films, couvre 6 genres et prend tous les candidats encore disponibles après l’historique.
- Les cinq cibles du protocole hors échantillon ont un rang de base de 8 à 11. Aucune n’apparaît parmi les cinq propositions. Recall@5 et NDCG@5 valent donc 0 sur cette fixture. Le jeu est construit pour exercer le diagnostic et ne constitue pas une estimation de performance sur un profil réel.

## Observé dans les traces

- « Balise rouge » passe en tête pour Immersion et « La Peau des miroirs » pour Étrange / dérangeant. Les bonus d’humeur peuvent donc changer le premier choix sur ce jeu.
- « Cinq kilos de nuages » et « La Gare sans horloge » apparaissent dans les six sélections. Changer l’humeur modifie certains rangs et certains films tout en conservant un noyau ici.
- Avec Émotion, le cinquième film est « La Gare sans horloge ». Avec la même humeur et Suspense à éviter, « La Peau des miroirs » prend la cinquième place. Les traces conservent le poids négatif appliqué à l’ambiance.
- Dans les classements par emplacement, le bonus de catégorie et la diversité modifient la priorité par rapport au seul score de base. Les mesures descriptives de variété ne permettent pas, à elles seules, d’attribuer un effet causal à la pénalité.

## Hypothèses à tester

- Sur plusieurs catalogues, mesurer la stabilité des films récurrents selon l’humeur, à métadonnées et historique fixes. Examiner où cette stabilité vient des affinités, du plafond d’humeur ou du manque de candidats.
- Tester la sensibilité de la pénalité de diversité à la complétude des fiches, en contrôlant le nombre de traits renseignés et en observant les intersections par paire.
- Comparer la récupération des films appréciés à une référence simple et déterministe, puis répéter avec un protocole chronologique lorsque les dates sont suffisamment complètes. Sur chaque mesure, communiquer la taille des échantillons et le taux de films sans étiquette.
- Observer la relation entre la popularité TMDB disponible, les données manquantes et les découvertes signalées par l’utilisateur sur plusieurs séances. Une position sous la médiane locale ne suffit pas à établir la surprise ressentie.
