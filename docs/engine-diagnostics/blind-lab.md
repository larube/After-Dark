# Laboratoire de recommandations à l’aveugle

Le Laboratoire compare quatre modèles déjà disponibles dans le moteur 1.2.0. Il utilise le catalogue local, y compris le cache d’affiches. Le spectateur choisit l’une des six humeurs, répond à une proposition à la fois, puis décide quand ouvrir le bilan. « Interrompre la séance » conserve la progression. Quitter After Dark ou changer de page permet aussi de reprendre ensuite. Depuis l’écran de reprise, on peut aussi abandonner définitivement une séance. Une seule séance peut être en cours à la fois.

## Protocole `blind-v1`

1. Le processus principal ouvre une transaction SQLite et lit une seule fois les films, le profil et l’historique des recommandations classiques. Les quatre modèles utilisent le même jour UTC, la même humeur, les mêmes contraintes et la même politique classique de la PR 9A. L’écran laisse les autres critères neutres. Chaque modèle fournit jusqu’à cinq films dans son ordre de sélection final.
2. Le processus principal cherche exhaustivement une attribution unique dans ces quatre listes. Il maximise d’abord le nombre de modèles couverts, puis minimise le nombre de films déjà proposés dans les trois dernières séances finalisées du Laboratoire, puis la somme des rangs d’origine. Les égalités sont départagées par SHA-256 de la graine et de l’attribution. Un second hachage avec un libellé différent mélange l’ordre de présentation. Une graine aléatoire est générée et conservée pour chaque séance.
3. Si seules deux ou trois attributions distinctes existent, la séance utilise cette couverture réelle. Avec moins de deux films, elle ne démarre pas. Si toutes les propositions optimales ont déjà été présentées récemment, le spectateur peut confirmer qu’il souhaite les revoir. Les collisions du bilan comptent les **films distincts** présents dans plusieurs listes avant attribution.
4. Chaque réponse enregistre soit un intérêt ordinal, soit « Déjà vu », ainsi qu’une raison facultative. Le vote est écrit une seule fois par proposition. La finalisation est explicite, requiert toutes les réponses et reste idempotente. Les résultats portent sur les séances finalisées. Le bilan compte séparément les séances non terminées, y compris celle en cours et celles abandonnées.

Avant finalisation, les réponses IPC de la séance contiennent uniquement un identifiant opaque, la progression et la carte publique du film courant. L’interface ne reçoit ni listes de classement, ni attribution, ni identifiant de film en base. Les résultats et l’export dévoilent uniquement les attributions des séances finalisées. Cette séparation protège le vote dans l’interface. Une personne qui ouvre manuellement sa propre base SQLite peut lire les attributions persistées.

## Lecture des résultats

Le taux d’intérêt positif regroupe « Très envie de voir » et « Pourquoi pas » et les rapporte aux réponses sur des films que le spectateur n’a pas déjà vus. Un modèle évalué seulement sur des films vus n’a pas de taux calculable. Les quatre catégories de réponse restent visibles séparément. Les votes n’écrivent dans aucune table de notes, de favoris, de commentaires, d’historique de visionnage ou de recommandations classiques.

Le test compare une proposition attribuée par modèle. Une proposition peut convenir à plusieurs modèles, et sa place dans la liste d’origine peut différer entre eux. La recherche de films distincts, la préférence pour la nouveauté et la distribution des rangs modifient le choix effectivement montré. La notoriété, les métadonnées et la disponibilité d’une affiche peuvent aussi influencer les réponses. Les taux sont descriptifs, y compris avec plusieurs séances.

## Export et reproduction

Dans le bilan, **Exporter en JSON** ouvre le dialogue d’enregistrement macOS. Le format `1` inclut la version du protocole et du moteur, la politique, les dates, les critères, la graine, l’empreinte de l’entrée, les historiques utilisés, les listes ordonnées d’origine et les réponses finalisées avec leurs dates. Les métadonnées d’affichage des propositions sont figées à l’ouverture de la séance. Les séances ouvertes ou abandonnées apparaissent sous forme de résumés de progression, sans leurs réponses individuelles ni leurs attributions. Les notes et favoris sources ne sont pas copiés dans l’export.

Les quatre listes figées, l’historique du Laboratoire et la graine suffisent à rejouer l’attribution et l’ordre de présentation sans le profil. Recalculer les sélections du moteur exige un instantané identique du catalogue et du profil, vérifiable par l’empreinte. Conservez l’export localement puisqu’il contient les titres et les réponses du spectateur.

La migration 0006 ajoute deux tables séparées. La génération, le vote et le bilan fonctionnent hors ligne. Une affiche absente du cache utilise un visuel de remplacement. Les captures Electron utilisent un profil de démonstration isolé.

## Captures Electron

- [Choix de l’humeur](../screenshots/pr11/pr11-01-humeur-1160.jpg)
- [Vote à l’aveugle](../screenshots/pr11/pr11-02-vote-1160.jpg) et [fenêtre étroite](../screenshots/pr11/pr11-02-vote-520.jpg)
- [Reprise après redémarrage](../screenshots/pr11/pr11-03-reprise-1160.jpg)
- [Finalisation](../screenshots/pr11/pr11-04-terminer-1160.jpg)
- [Bilan et export](../screenshots/pr11/pr11-05-bilan-1160.jpg)
