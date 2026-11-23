# Ce soir · étude de composition

Ouvrir `index.html` pour A, ou `index.html?layout=b` pour B. Les données sont fictives. Les images des films sont des recadrages de l’imagerie d’humeur du dépôt, sans attribution à un film réel. La dernière proposition teste le cas sans affiche. Le portrait du bandeau est une création générée pour cette étude. Les captures montrent le prototype HTML rendu dans Electron et couvrent la page entière. Le renderer de l’application reste séparé.

## Deux sources visuelles

- **After Dark_ Votre Séance Personnelle** guide le nouveau portrait noir et blanc, les déchirures diagonales et les morceaux de papier rouge. Le portrait remplace la façade et rejoint la rangée d’humeurs. Le titre garde une zone sombre pour la lisibilité.
- **After Dark_ Suspense au cinéma** guide le contraste entre affiche et texte, la barrette de séance compacte et les bords d’affiche imprimée. Le masque irrégulier enveloppe le support papier. Le visuel de remplacement utilise le même cadre.

## Deux compositions

| Largeur | A · Vedette puis grille | B · Planche asymétrique |
| --- | --- | --- |
| 1160 px | La vedette occupe toute la largeur. Les quatre secondaires forment une grille 2 × 2, avec affiche à gauche du texte. | La vedette occupe la hauteur des deux rangées. Deux colonnes de secondaires, légèrement décalées, équilibrent la planche. |
| 780 px | La vedette reste au-dessus de deux colonnes de fiches horizontales. | La vedette rejoint le haut. Les secondaires gardent leur composition verticale à deux colonnes. |
| 520 px | Les secondaires forment une liste horizontale sous la vedette. | Les secondaires gardent une mosaïque de deux colonnes. |
| 410 px | La liste donne davantage de largeur au texte et aux actions. | La mosaïque garde plus de propositions côte à côte, avec davantage de retours à la ligne. |

| Largeur | A | B |
| --- | --- | --- |
| 1160 | [Capture](captures/a-1160.jpg) | [Capture](captures/b-1160.jpg) |
| 780 | [Capture](captures/a-780.jpg) | [Capture](captures/b-780.jpg) |
| 520 | [Capture](captures/a-520.jpg) | [Capture](captures/b-520.jpg) |
| 410 | [Capture](captures/a-410.jpg) | [Capture](captures/b-410.jpg) |

Par rapport à la PR actuelle, les deux variantes suppriment la colonne de quatre films sur un côté. A donne la priorité à la vedette et à la lecture. B crée une planche plus dense sur grand écran et montre plus de films côte à côte sur petit écran. Les deux études conservent cinq emplacements et illustrent catégories, explications et actions. Le prototype permet de tester la composition et les disclosures. L’intégration gardera le formulaire de la PR 5 et les opérations existantes de la PR 4.
