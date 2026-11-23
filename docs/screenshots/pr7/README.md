# Expérience de séance dans Electron

Captures du paquet macOS Apple Silicon aux quatre largeurs de fenêtre. Le moteur utilise un profil de test avec de vrais films et des affiches en cache, dans une base SQLite isolée et sans jeton TMDB. Les captures cadrent la partie du renderer concernée.

| Largeur | Filtres | Vedette | Secondaire | Relance | Évaluation | Films à noter |
| --- | --- | --- | --- | --- | --- | --- |
| 1160 px | [Filtres](pr7-filtres-1160.jpg) | [Vedette](pr7-vedette-1160.jpg) | [Secondaire](pr7-secondaire-1160.jpg) | [Relance](pr7-relance-1160.jpg) | [Évaluation](pr7-evaluation-1160.jpg) | [Films à noter](pr7-collection-1160.jpg) |
| 780 px | [Filtres](pr7-filtres-780.jpg) | [Vedette](pr7-vedette-780.jpg) | [Secondaire](pr7-secondaire-780.jpg) | [Relance](pr7-relance-780.jpg) | [Évaluation](pr7-evaluation-780.jpg) | [Films à noter](pr7-collection-780.jpg) |
| 520 px | [Filtres](pr7-filtres-520.jpg) | [Vedette](pr7-vedette-520.jpg) | [Secondaire](pr7-secondaire-520.jpg) | [Relance](pr7-relance-520.jpg) | [Évaluation](pr7-evaluation-520.jpg) | [Films à noter](pr7-collection-520.jpg) |
| 410 px | [Filtres](pr7-filtres-410.jpg) | [Vedette](pr7-vedette-410.jpg) | [Secondaire](pr7-secondaire-410.jpg) | [Relance](pr7-relance-410.jpg) | [Évaluation](pr7-evaluation-410.jpg) | [Films à noter](pr7-collection-410.jpg) |

La barre passe de cinq colonnes à quatre filtres sur une ligne avec le bouton en dessous, puis à deux colonnes sur fenêtre étroite. Les puces restent visibles avec les sélecteurs fermés. Les actions principales occupent plus de place sur la vedette. Les actions secondaires restent directement accessibles sur toutes les cartes.

La relance apparaît au lancement suivant. Les trois captures de parcours correspondent à des états distincts de la base. Une séance attend d’abord une confirmation. La notation apparaît après confirmation, puis un autre film confirmé avec une note reportée apparaît dans « Films à noter ».
