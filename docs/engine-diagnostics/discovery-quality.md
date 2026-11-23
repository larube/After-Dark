# Qualité de Découvertes

## Audit initial

- La sélection neuve exclut les statuts « vu », les films évalués et les refus explicites. À la reprise, les cartes proviennent d'un instantané SQLite et ne sont plus confrontées à ces changements ni aux métadonnées enrichies depuis.
- L'import résout les identifiants et vérifie les titres et années lorsque les informations sont suffisantes. Une œuvre absente du profil, sans statut ou sous une seconde identité ne peut pas être déduite comme vue. Les votes du Laboratoire constituent un historique séparé.
- Le classifieur partagé exploite les mots-clés et les données de sortie TMDB, mais sa liste de formats est étroite. TMDB ne fournit pas de type universel dans les fiches film utilisées ici. Le genre Téléfilm et un événement de diffusion sont deux indices différents.
- Les affiches de Découvertes sont lues depuis le cache disque sans téléchargement. L'enrichissement existant relie progressivement le catalogue aux fiches TMDB, avec un client partagé et des limites de débit.
- Les explications reprennent des traits réellement utilisés, mais la plupart des libellés proviennent directement des métadonnées. Les fréquences sont déjà calculées pour le classement. On peut les réutiliser dans le texte sans changer les scores.

## Cas vérifiés sur le catalogue local

Vérification SQLite en lecture seule, limitée aux trois fiches signalées et à des comptages. Les explorations les plus récentes ne contenaient aucun film marqué vu dans le profil pour les identifiants exacts. Ce constat ne permet pas de savoir si un autre identifiant désigne la même œuvre ou si le visionnage manque dans le profil. L’audit a compté 24 fiches portant le genre Téléfilm.

| Œuvre | Indices de la fiche | Décision |
| --- | --- | --- |
| Linkin Park and Friends Celebrate Life in Honor of Chester Bennington | Musique comme seul genre, mots-clés concert, musicien et célébration | Concert, écarté. L’éditeur confirme la nature de la [captation](https://press.warnerrecords.com/sites/g/files/g2000014901/files/2022-07/linkin-park-friends-celebrate-life-in-honor-of-chester-bennington-livestream-concert-exclusively-on-youtube_1508523589206.pdf). |
| Queen: Days of Our Lives | Documentaire et Musique, archives, entretiens et extraits de concerts | Conservé. La fiche locale ne décrit pas la structure en plusieurs parties recensée par le [British Council](https://filmsandfestivals.britishcouncil.org/projects/137). Un extrait de concert ne suffit pas à classifier une captation. |
| Ghost Adventures | Fiche film de 87 minutes, Documentaire et Horreur, deux événements de diffusion TV | Conservé. La fiche ne contient pas d’indice d’épisode et un documentaire du même nom a précédé la série. [American Society of Cinematographers](https://theasc.com/article/shooting-specters) |
| Téléfilms | Genre 10770 ou libellé local équivalent | Signalés dans Découvertes. La diffusion TV seule ne suffit pas à classifier un téléfilm. [Types de sortie TMDB](https://developer.themoviedb.org/docs/region-support) |

Les nouveaux indices s’appliquent au filtre partagé par « Ce soir », le Laboratoire et Découvertes. Des mots-clés explicites d’épisode ou de minisérie, sans sortie en salle contradictoire, entraînent l’exclusion. Les signaux plus faibles de série doivent être corroborés par le genre Téléfilm et une date de diffusion. Des indices de format contradictoires peuvent laisser la fiche admissible. Le catalogue et les signaux d’apprentissage restent intacts. Le moteur passe à 1.3.0 pour tracer le changement d’admissibilité.

## Décisions et limites

- Une exploration garde son ordre et son historique. À la reprise, seuls les films encore admissibles sont affichés, sans lancer un nouveau classement. Un film marqué vu depuis sa propre carte reste accessible jusqu’au changement de vue pour permettre la notation. Les réponses du Laboratoire sont transférables depuis le bilan après confirmation explicite, par identifiant exact et pour les séances terminées. On ne rapproche pas les œuvres par titre.
- Les cartes arrivent avec les informations déjà disponibles. Les affiches sont demandées ensuite par deux, avec deux téléchargements maximum, une seule résolution de fiche à la fois et le client TMDB partagé. Seul un identifiant film vérifié autorise une résolution ciblée. Les JPEG et les chemins résolus sont réutilisés sur disque. Les échecs réseau sont temporisés et les réponses des vues devenues inactives sont ignorées. Les films sans chemin ni identifiant vérifié restent tributaires de l’enrichissement ordinaire.
- Les explications filtrent le vocabulaire générique ou non traduit et nomment des traits réellement utilisés. Un lien positif n’est formulé que si l’affinité nette est positive au seuil existant. Les coefficients, seuils de classement et règles de rotation restent identiques.
- Sous la grille, ouvrir « Diagnostic de cette exploration » puis choisir « Exporter le diagnostic JSON ». Le schéma 1 contient les facteurs et pénalités utilisés au moment du choix, ainsi que l’état constaté au moment de l’export. Pour les explorations antérieures à discovery-v3, les contributions restent indisponibles jusqu’à la prochaine génération explicite. Aucun profil complet, note brute, commentaire, identifiant d’historique ni jeton ne figure dans l’export. Les titres et indices personnels du lot exporté restent privés.
- Une fiche incomplète peut laisser passer un format atypique. Les votes des séances ouvertes ou abandonnées ne sont pas proposés au transfert. Un film absent du profil ou visionné sous une autre identité nécessite une action de l’utilisateur.

## Validation

Sur la [fixture de 42 fiches](discovery-fixture-report.json), les identifiants, l’ordre et le renouvellement sont identiques à PR 13 dans les trois modes, sur les deux graines de référence. Les tests de classification reproduisent séparément les combinaisons d’indices observées pour Linkin Park, Queen et Ghost Adventures. Ce résultat vérifie l’absence de changement de classement à admissibilité identique. Il ne mesure pas l’intérêt des propositions sur un profil réel.

Lint, typecheck, 126 tests, build et packaging macOS arm64 validés. Vérifications Electron sur base isolée avec téléchargement effectif d’une affiche TMDB absente du cache, export JSON, reprise de la même exploration après un changement de statut et transfert confirmé sans nouvelle évaluation.

- [Découvertes à 1160 px](../screenshots/discovery-quality/discovery-qualite-1160.jpg)
- [Découvertes à 410 px](../screenshots/discovery-quality/discovery-etroite-410.jpg)
- [Export explicite du diagnostic](../screenshots/discovery-quality/discovery-diagnostic-410.jpg)
- [Confirmation du transfert depuis le Laboratoire](../screenshots/discovery-quality/discovery-laboratoire-520.jpg)
