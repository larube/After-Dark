# Capturer une séance « Ce soir »

La capture concerne la prochaine recherche lancée depuis l’application sur la branche de la PR #21. Quitter l’instance ouverte, lancer la commande depuis le dépôt et cliquer sur « Trouve-moi un film » avec les critères habituels.

```sh
AFTER_DARK_TONIGHT_DIAGNOSTIC_DIR="$HOME/after-dark-diagnostic-$(date +%Y%m%d-%H%M%S)" npm start
```

Le chemin doit être absolu et désigner un nouveau dossier dont le parent existe. Cette option se consomme à la première recherche de la session Electron. Le dossier privé contient `tonight.md`, un rapport que l’on peut annoter, et `tonight.json`, la trace détaillée. L’application suit le parcours habituel de cache et d’historique de séance. La capture ne crée aucun vote ni aucune note et n’envoie aucun rapport sur le réseau. Sans cette option, aucune trace de séance n’est produite. Les fichiers contiennent des titres et des affinités agrégées propres au profil. Les garder hors du dépôt et décider explicitement de ce que l’on partage.

## Lire le rapport

- **Acquisition.** Les requêtes Discover réussies, leur volume et le statut global TMDB permettent de distinguer une recherche pauvre d’un problème de disponibilité des détails. Le JSON sépare cache frais, détails intégrés, fiche introuvable, correspondance refusée, requête échouée, détail hors budget et traitement interrompu. En cas d’échec d’une requête Discover, le client conserve son comportement habituel et peut perdre le lot combiné. Les requêtes terminées avant la capture restent visibles.
- **Classement.** Le vivier correspond au catalogue effectivement lu après acquisition, qui peut inclure des films d’anciennes séances. Comparer sa répartition, les films scorés et les cinq premières places effectives, puis examiner les 30 premiers non retenus selon le score de base. Chaque ligne inclut les contributions positives ou négatives, les signaux d’affinité agrégés, les causes de rejet et le départage de chaque étape où elle a concouru. Les films écartés avant le calcul du score entrent dans les compteurs cumulables. Un résultat intéressant absent du rapport peut être hors du top 30 ou exclu avant le score.
- **Lecture humaine.** L’appartenance à une franchise est signalée seulement si le registre ou le cache contient une correspondance. Les mots-clés comme `sequel` ou `experimental film` sont rapportés comme indices de métadonnées. Le JSON donne aussi la classification de contenu, ses motifs et les mots-clés en commun avec les films retenus. Ces éléments servent à vérifier la dépendance à une série, le caractère expérimental ou atypique et la répétition de thèmes. Une fiche pauvre laisse la question ouverte. La colonne « Avis utilisateur » permet d’indiquer l’intérêt pour le film, les prérequis perçus et l’utilité de l’explication.

## Séance à l’origine de la demande

Les cinq exemples signalés étaient *Twin Peaks: Fire Walk with Me*, *Faust*, *Gamera III*, *La Leçon Faust* et *Requiem pour un massacre*. L’historique existant enregistre les rangs et les explications des films retenus, ainsi que les critères de séance. Il ne fige ni les résultats Discover, ni les autres candidats, ni les contributions au moment de la séance. Rejouer la recherche aujourd’hui peut changer le cache, l’historique récent et les réponses TMDB. Cette séance sert donc de point de comparaison qualitatif. Une nouvelle capture instrumentée est nécessaire pour attribuer un écart au vivier ou au classement.
